package mcpserver

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"claudefu/internal/providers"
	"claudefu/internal/types"
	"claudefu/internal/workspace"

	"github.com/mark3labs/mcp-go/mcp"
)

// findMCPEnabledAgent finds an agent by slug or name, only if MCP is enabled for it
func (s *MCPService) findMCPEnabledAgent(identifier string) *workspace.Agent {
	ws := s.workspace()
	if ws == nil {
		return nil
	}

	identifier = strings.ToLower(identifier)
	for i := range ws.Agents {
		agent := &ws.Agents[i]
		if !agent.GetMCPEnabled() {
			continue // Skip agents with MCP disabled
		}
		// Match by slug (custom or derived) or case-insensitive name
		if strings.ToLower(agent.GetSlug()) == identifier ||
			strings.EqualFold(agent.Name, identifier) {
			return agent
		}
	}
	return nil
}

// getAvailableAgentSlugs returns slugs of all MCP-enabled agents
func (s *MCPService) getAvailableAgentSlugs() []string {
	ws := s.workspace()
	if ws == nil {
		return nil
	}

	var slugs []string
	for _, agent := range ws.Agents {
		if agent.GetMCPEnabled() {
			slugs = append(slugs, agent.GetSlug())
		}
	}
	return slugs
}

// getMCPConfigJSON returns the inline JSON config for --mcp-config flag
func (s *MCPService) getMCPConfigJSON() string {
	// Format: {"mcpServers":{"name":{"type":"sse","url":"..."}}}
	return fmt.Sprintf(`{"mcpServers":{"claudefu":{"type":"sse","url":"http://localhost:%d/sse"}}}`, s.port)
}

// handleAgentQuery handles the AgentQuery tool call
// Spawns a stateless claude --print query in the target agent's folder
func (s *MCPService) handleAgentQuery(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	targetAgent, err := req.RequireString("target_agent")
	if err != nil {
		return mcp.NewToolResultError("target_agent is required"), nil
	}

	query, err := req.RequireString("query")
	if err != nil {
		return mcp.NewToolResultError("query is required"), nil
	}

	// Find the target agent (must be MCP-enabled)
	agent := s.findMCPEnabledAgent(targetAgent)
	if agent == nil {
		available := s.getAvailableAgentSlugs()
		return mcp.NewToolResultError(fmt.Sprintf(
			"Agent '%s' not found or MCP disabled. Available agents: %s",
			targetAgent, strings.Join(available, ", "),
		)), nil
	}

	// Get claude binary path
	claudePath := providers.GetClaudePath()
	if claudePath == "" {
		return mcp.NewToolResultError("claude CLI not found"), nil
	}

	// Spawn stateless query with --print
	// Include MCP config so the queried agent can also use inter-agent tools
	// Pre-approve MCP tools so they don't require permission prompts
	// Append system prompt to ensure concise, fact-only response
	cmd := exec.CommandContext(ctx, claudePath,
		"--print",
		"--mcp-config", s.getMCPConfigJSON(),
		"--allowed-tools", "mcp__claudefu__AgentBroadcast,mcp__claudefu__AgentQuery,mcp__claudefu__NotifyUser",
		"-p", query,
		"--append-system-prompt", "You are responding to a query from another agent. Respond concisely with facts only. Do NOT offer to make changes or ask follow-up questions.",
	)
	cmd.Dir = agent.Folder

	output, err := cmd.CombinedOutput()
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Query failed: %v\nOutput: %s", err, string(output))), nil
	}

	return mcp.NewToolResultText(string(output)), nil
}

// handleAgentBroadcast handles the AgentBroadcast tool call
// Adds a message to the target agent's inbox
func (s *MCPService) handleAgentBroadcast(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	targetAgent, err := req.RequireString("target_agent")
	if err != nil {
		return mcp.NewToolResultError("target_agent is required"), nil
	}

	message, err := req.RequireString("message")
	if err != nil {
		return mcp.NewToolResultError("message is required"), nil
	}

	// Optional fields
	fromAgent, _ := req.RequireString("from_agent")
	priority, _ := req.RequireString("priority")
	if priority == "" {
		priority = "normal"
	}

	// Find the target agent(s) in the workspace
	ws := s.workspace()
	if ws == nil {
		return mcp.NewToolResultError("no workspace loaded"), nil
	}

	// Handle broadcast to "all" MCP-enabled agents
	if strings.ToLower(targetAgent) == "all" {
		count := 0
		for _, agent := range ws.Agents {
			if !agent.GetMCPEnabled() {
				continue // Skip agents with MCP disabled
			}
			s.inbox.AddMessage(agent.ID, "", fromAgent, message, priority)
			s.emitInboxUpdate(agent.ID)
			count++
		}
		return mcp.NewToolResultText(fmt.Sprintf("Broadcast sent to %d agents", count)), nil
	}

	// Find specific agent (must be MCP-enabled)
	agent := s.findMCPEnabledAgent(targetAgent)
	if agent == nil {
		available := s.getAvailableAgentSlugs()
		return mcp.NewToolResultError(fmt.Sprintf(
			"Agent '%s' not found or MCP disabled. Available agents: %s",
			targetAgent, strings.Join(available, ", "),
		)), nil
	}

	// Add to inbox
	msg := s.inbox.AddMessage(agent.ID, "", fromAgent, message, priority)

	// Emit event to update UI
	s.emitInboxUpdate(agent.ID)

	return mcp.NewToolResultText(fmt.Sprintf("Message sent to %s (id: %s)", agent.Name, msg.ID)), nil
}

// handleNotifyUser handles the NotifyUser tool call
// Emits an event to show a notification in the ClaudeFu UI
func (s *MCPService) handleNotifyUser(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	message, err := req.RequireString("message")
	if err != nil {
		return mcp.NewToolResultError("message is required"), nil
	}

	notifType, err := req.RequireString("type")
	if err != nil {
		return mcp.NewToolResultError("type is required"), nil
	}

	// Validate type
	validTypes := map[string]bool{"info": true, "success": true, "warning": true, "question": true}
	if !validTypes[notifType] {
		return mcp.NewToolResultError("type must be one of: info, success, warning, question"), nil
	}

	// Optional title
	title, _ := req.RequireString("title")

	// Emit notification event
	s.emitFunc(types.EventEnvelope{
		EventType: "mcp:notification",
		Payload: map[string]any{
			"type":    notifType,
			"message": message,
			"title":   title,
		},
	})

	return mcp.NewToolResultText("Notification sent"), nil
}

// emitInboxUpdate emits an inbox update event for the given agent
func (s *MCPService) emitInboxUpdate(agentID string) {
	s.emitFunc(types.EventEnvelope{
		AgentID:   agentID,
		EventType: "mcp:inbox",
		Payload: map[string]any{
			"unreadCount": s.inbox.GetUnreadCount(agentID),
		},
	})
}
