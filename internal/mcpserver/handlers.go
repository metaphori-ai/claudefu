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

	// Get system prompt from configurable instructions
	systemPrompt := s.toolInstructions.GetInstructions().AgentQuerySystemPrompt

	// Build command args
	// Include MCP config so the queried agent can also use inter-agent tools
	// Pre-approve MCP tools so they don't require permission prompts
	args := []string{
		"--print",
		"--mcp-config", s.getMCPConfigJSON(),
		"--allowed-tools", "mcp__claudefu__AgentQuery,mcp__claudefu__AgentMessage,mcp__claudefu__AgentBroadcast,mcp__claudefu__NotifyUser",
		"-p", query,
	}

	// Only append system prompt if configured
	if systemPrompt != "" {
		args = append(args, "--append-system-prompt", systemPrompt)
	}

	cmd := exec.CommandContext(ctx, claudePath, args...)
	cmd.Dir = agent.Folder

	output, err := cmd.CombinedOutput()
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Query failed: %v\nOutput: %s", err, string(output))), nil
	}

	return mcp.NewToolResultText(string(output)), nil
}

// handleAgentMessage handles the AgentMessage tool call
// Sends a message to one or more specific agents' inboxes
func (s *MCPService) handleAgentMessage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	targetAgents, err := req.RequireString("target_agents")
	if err != nil {
		return mcp.NewToolResultError("target_agents is required"), nil
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

	// Parse comma-separated agent list
	agentIdentifiers := strings.Split(targetAgents, ",")
	var sentTo []string
	var notFound []string

	for _, identifier := range agentIdentifiers {
		identifier = strings.TrimSpace(identifier)
		if identifier == "" {
			continue
		}

		// Find specific agent (must be MCP-enabled)
		agent := s.findMCPEnabledAgent(identifier)
		if agent == nil {
			notFound = append(notFound, identifier)
			continue
		}

		// Add to inbox
		s.inbox.AddMessage(agent.ID, "", fromAgent, message, priority)
		s.emitInboxUpdate(agent.ID)
		sentTo = append(sentTo, agent.GetSlug())
	}

	// Build response
	if len(sentTo) == 0 {
		available := s.getAvailableAgentSlugs()
		return mcp.NewToolResultError(fmt.Sprintf(
			"No valid agents found. Requested: %s. Available agents: %s",
			targetAgents, strings.Join(available, ", "),
		)), nil
	}

	response := fmt.Sprintf("Message sent to: %s", strings.Join(sentTo, ", "))
	if len(notFound) > 0 {
		response += fmt.Sprintf(" (not found: %s)", strings.Join(notFound, ", "))
	}

	return mcp.NewToolResultText(response), nil
}

// handleAgentBroadcast handles the AgentBroadcast tool call
// Broadcasts a message to ALL agents' inboxes in the workspace
func (s *MCPService) handleAgentBroadcast(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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

	// Get workspace
	ws := s.workspace()
	if ws == nil {
		return mcp.NewToolResultError("no workspace loaded"), nil
	}

	// Broadcast to ALL MCP-enabled agents
	count := 0
	var sentTo []string
	for _, agent := range ws.Agents {
		if !agent.GetMCPEnabled() {
			continue // Skip agents with MCP disabled
		}
		s.inbox.AddMessage(agent.ID, "", fromAgent, message, priority)
		s.emitInboxUpdate(agent.ID)
		sentTo = append(sentTo, agent.GetSlug())
		count++
	}

	if count == 0 {
		return mcp.NewToolResultError("No MCP-enabled agents found in workspace"), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Broadcast sent to %d agents: %s", count, strings.Join(sentTo, ", "))), nil
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

	// Optional fields
	title, _ := req.RequireString("title")
	fromAgent, _ := req.RequireString("from_agent")

	// Emit notification event
	s.emitFunc(types.EventEnvelope{
		EventType: "mcp:notification",
		Payload: map[string]any{
			"type":       notifType,
			"message":    message,
			"title":      title,
			"from_agent": fromAgent,
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
