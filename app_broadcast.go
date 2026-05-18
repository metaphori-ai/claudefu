package main

import (
	"fmt"
	"strings"
)

// =============================================================================
// USER BROADCAST METHODS (Bound to frontend)
// =============================================================================
//
// This is the user-initiated counterpart to the MCP AgentMessage tool. The user
// picks one or more agents in the BroadcastDialog and sends a single message;
// the same delivery paths fire (local inbox or cross-workspace spool) but
// without routing through Claude/MCP.

// BroadcastableAgent is one row in the recipient picker.
type BroadcastableAgent struct {
	ID               string `json:"id"`
	Slug             string `json:"slug"`
	Description      string `json:"description"`
	Folder           string `json:"folder"`
	IsCrossWorkspace bool   `json:"isCrossWorkspace"` // true = global registry only, not in current workspace
}

// BroadcastResult reports per-agent delivery outcome for the dialog to render.
type BroadcastResult struct {
	AgentID   string `json:"agentId"`
	AgentSlug string `json:"agentSlug"`
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
}

// GetBroadcastableAgents returns the union of current-workspace agents plus
// cross-workspace agents from the global registry (filtered to those with
// AGENT_CROSS_WORKSPACE=true). Workspace agents appear first; cross-workspace
// agents are flagged via IsCrossWorkspace=true.
//
// Unlike the MCP tool's agent listing, this is NOT filtered by mcpEnabled —
// the user is the actor here, and the mcpEnabled flag only governs whether
// Claude-initiated MCP calls can target an agent.
func (a *App) GetBroadcastableAgents() []BroadcastableAgent {
	out := []BroadcastableAgent{}
	inWorkspace := map[string]bool{}

	if a.currentWorkspace != nil {
		for _, ag := range a.currentWorkspace.Agents {
			inWorkspace[ag.ID] = true
			out = append(out, BroadcastableAgent{
				ID:               ag.ID,
				Slug:             ag.GetSlug(),
				Description:      ag.Description,
				Folder:           ag.Folder,
				IsCrossWorkspace: false,
			})
		}
	}

	if a.workspace != nil {
		for folder, info := range a.workspace.GetAllAgentInfo() {
			if inWorkspace[info.ID] {
				continue
			}
			if strings.ToLower(info.Meta["AGENT_CROSS_WORKSPACE"]) != "true" {
				continue
			}
			out = append(out, BroadcastableAgent{
				ID:               info.ID,
				Slug:             info.GetSlug(),
				Description:      info.Meta["AGENT_DESCRIPTION"],
				Folder:           folder,
				IsCrossWorkspace: true,
			})
		}
	}

	return out
}

// BroadcastToInbox delivers `message` to every agent in `agentIDs`. Each
// recipient is routed by membership:
//
//	in current workspace → DeliverUserMessageLocal (direct SQLite write + emit)
//	otherwise + AGENT_CROSS_WORKSPACE=true → DeliverUserMessageSpool (Syncthing-replicated)
//	otherwise → recorded as failure with explanatory error
//
// Returns one BroadcastResult per requested agent, in input order.
// `fromName` defaults to "user" when empty; `priority` defaults to "normal".
func (a *App) BroadcastToInbox(agentIDs []string, message, fromName, priority string) []BroadcastResult {
	if fromName == "" {
		fromName = "user"
	}
	if priority == "" {
		priority = "normal"
	}

	results := make([]BroadcastResult, 0, len(agentIDs))

	if a.mcpServer == nil {
		// The v0.5.42 startup race surface — return per-agent errors so the dialog
		// can show a meaningful message rather than a silent zero-result.
		for _, id := range agentIDs {
			results = append(results, BroadcastResult{
				AgentID: id,
				Success: false,
				Error:   "MCP server not initialized — wait a moment and retry",
			})
		}
		return results
	}

	// Build agent-ID → Agent map for fast workspace-membership lookup.
	inWorkspace := map[string]string{} // id → slug
	if a.currentWorkspace != nil {
		for _, ag := range a.currentWorkspace.Agents {
			inWorkspace[ag.ID] = ag.GetSlug()
		}
	}

	for _, id := range agentIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}

		if slug, ok := inWorkspace[id]; ok {
			a.mcpServer.DeliverUserMessageLocal(id, fromName, message, priority)
			results = append(results, BroadcastResult{
				AgentID:   id,
				AgentSlug: slug,
				Success:   true,
			})
			continue
		}

		// Not in current workspace — try registry as cross-workspace recipient.
		if a.workspace == nil {
			results = append(results, BroadcastResult{
				AgentID: id,
				Success: false,
				Error:   "workspace manager not initialized",
			})
			continue
		}

		info, _ := a.workspace.FindAgentByID(id)
		if info == nil {
			results = append(results, BroadcastResult{
				AgentID: id,
				Success: false,
				Error:   "agent not found in registry",
			})
			continue
		}

		if strings.ToLower(info.Meta["AGENT_CROSS_WORKSPACE"]) != "true" {
			results = append(results, BroadcastResult{
				AgentID:   id,
				AgentSlug: info.GetSlug(),
				Success:   false,
				Error:     "AGENT_CROSS_WORKSPACE not enabled for this agent",
			})
			continue
		}

		if err := a.mcpServer.DeliverUserMessageSpool(id, fromName, message, priority); err != nil {
			results = append(results, BroadcastResult{
				AgentID:   id,
				AgentSlug: info.GetSlug(),
				Success:   false,
				Error:     fmt.Sprintf("spool write failed: %v", err),
			})
			continue
		}

		results = append(results, BroadcastResult{
			AgentID:   id,
			AgentSlug: info.GetSlug(),
			Success:   true,
		})
	}

	return results
}
