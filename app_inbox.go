package main

import (
	"fmt"

	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"

	"claudefu/internal/mcpserver"
	"claudefu/internal/types"
)

// =============================================================================
// MCP INBOX METHODS (Bound to frontend)
// =============================================================================

// GetInboxMessages returns all messages in an agent's inbox
func (a *App) GetInboxMessages(agentID string) []mcpserver.InboxMessage {
	if a.mcpServer == nil {
		return []mcpserver.InboxMessage{}
	}
	return a.mcpServer.GetInbox().GetMessages(agentID)
}

// GetInboxUnreadCount returns the number of unread inbox messages for an agent
func (a *App) GetInboxUnreadCount(agentID string) int {
	if a.mcpServer == nil {
		return 0
	}
	return a.mcpServer.GetInbox().GetUnreadCount(agentID)
}

// GetInboxTotalCount returns the total number of inbox messages for an agent
func (a *App) GetInboxTotalCount(agentID string) int {
	if a.mcpServer == nil {
		return 0
	}
	return a.mcpServer.GetInbox().GetTotalCount(agentID)
}

// MarkInboxMessageRead marks an inbox message as read
func (a *App) MarkInboxMessageRead(agentID, messageID string) bool {
	if a.mcpServer == nil {
		return false
	}
	return a.mcpServer.GetInbox().MarkRead(agentID, messageID)
}

// DeleteInboxMessage removes an inbox message
func (a *App) DeleteInboxMessage(agentID, messageID string) bool {
	if a.mcpServer == nil {
		return false
	}
	deleted := a.mcpServer.GetInbox().DeleteMessage(agentID, messageID)
	if deleted {
		// Emit updated unread count
		wailsrt.EventsEmit(a.ctx, "mcp:inbox", types.EventEnvelope{
			AgentID:   agentID,
			EventType: "mcp:inbox",
			Payload: map[string]any{
				"unreadCount": a.mcpServer.GetInbox().GetUnreadCount(agentID),
			},
		})
	}
	return deleted
}

// InjectInboxMessage sends an inbox message to a Claude session
func (a *App) InjectInboxMessage(agentID, sessionID, messageID string) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	if a.claude == nil {
		return fmt.Errorf("claude service not initialized")
	}

	// Get the message
	msg := a.mcpServer.GetInbox().GetMessage(agentID, messageID)
	if msg == nil {
		return fmt.Errorf("message not found: %s", messageID)
	}

	// Get agent folder
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	// Format the injected message with context
	formattedMsg := fmt.Sprintf("[Message from %s]\n\n%s", msg.FromAgentName, msg.Message)

	// Send to Claude session
	if err := a.claude.SendMessage(agent.Folder, sessionID, formattedMsg, nil, false); err != nil {
		return err
	}

	// Mark as read and delete after injection
	a.mcpServer.GetInbox().MarkRead(agentID, messageID)
	a.mcpServer.GetInbox().DeleteMessage(agentID, messageID)

	// Emit updated count
	wailsrt.EventsEmit(a.ctx, "mcp:inbox", types.EventEnvelope{
		AgentID:   agentID,
		EventType: "mcp:inbox",
		Payload: map[string]any{
			"unreadCount": a.mcpServer.GetInbox().GetUnreadCount(agentID),
		},
	})

	return nil
}

// GetMCPServerPort returns the port the MCP server is running on
func (a *App) GetMCPServerPort() int {
	if a.mcpServer == nil {
		return 0
	}
	return a.mcpServer.GetPort()
}

// MarkAllInboxRead marks all inbox messages for an agent as read
func (a *App) MarkAllInboxRead(agentID string) {
	if a.mcpServer != nil {
		a.mcpServer.GetInbox().MarkAllRead(agentID)
	}
}

// ClearAgentInbox clears all messages in an agent's inbox
func (a *App) ClearAgentInbox(agentID string) {
	if a.mcpServer != nil {
		a.mcpServer.GetInbox().Clear(agentID)
	}
}
