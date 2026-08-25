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

// GetInboxUnreadCount returns the number of unread inbox messages for an agent.
// Returns 0 during the startup race where mcpServer is not yet wired —
// the Sidebar listens for the "mcp:ready" event to re-poll once initialization completes.
func (a *App) GetInboxUnreadCount(agentID string) int {
	if a.mcpServer == nil {
		return 0
	}
	return a.mcpServer.GetInbox().GetUnreadCount(agentID)
}

// GetInboxTotalCount returns the total number of inbox messages for an agent.
// Returns 0 during the startup race where mcpServer is not yet wired —
// the Sidebar listens for the "mcp:ready" event to re-poll once initialization completes.
func (a *App) GetInboxTotalCount(agentID string) int {
	if a.mcpServer == nil {
		return 0
	}
	return a.mcpServer.GetInbox().GetTotalCount(agentID)
}

// MarkInboxMessageRead marks an inbox message as read, and propagates the
// read state to other machines via a spool read-marker.
func (a *App) MarkInboxMessageRead(agentID, messageID string) bool {
	if a.mcpServer == nil {
		return false
	}
	marked := a.mcpServer.GetInbox().MarkRead(agentID, messageID)
	if marked {
		a.mcpServer.WriteReadMarker(agentID, messageID)
	}
	return marked
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

	// Send to Claude session — no model/effort override, use the agent's configured default.
	// The session's sticky OAuth pool key (if any) rides along for cache continuity.
	_, extraEnv, _ := a.resolveOAuthEnv(sessionID, "")
	if err := a.claude.SendMessage(agent.Folder, sessionID, formattedMsg, nil, false, "", "", extraEnv); err != nil {
		return err
	}

	// Mark as read (propagate to other machines) and delete locally after injection.
	if a.mcpServer.GetInbox().MarkRead(agentID, messageID) {
		a.mcpServer.WriteReadMarker(agentID, messageID)
	}
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

// SpoolRescanResult reports what an on-demand spool rescan picked up.
type SpoolRescanResult struct {
	Imported    int `json:"imported"`    // messages newly imported into local inboxes
	ReadApplied int `json:"readApplied"` // read markers newly applied
}

// RescanInboxSpool triggers the same spool scan that runs at startup — imports
// any pending messages and applies any pending read markers — without restarting
// the app. Bound to the Inbox dialog's refresh button. Per-import mcp:inbox
// events fire from the spool manager itself, so badges refresh automatically.
func (a *App) RescanInboxSpool() SpoolRescanResult {
	if a.mcpServer == nil {
		return SpoolRescanResult{}
	}
	imported, readApplied := a.mcpServer.RescanSpool()
	return SpoolRescanResult{Imported: imported, ReadApplied: readApplied}
}

// GetMCPServerPort returns the port the MCP server is running on
func (a *App) GetMCPServerPort() int {
	if a.mcpServer == nil {
		return 0
	}
	return a.mcpServer.GetPort()
}

// MarkAllInboxRead marks all inbox messages for an agent as read, and writes a
// read-marker for each previously-unread message so other machines follow suit.
func (a *App) MarkAllInboxRead(agentID string) {
	if a.mcpServer == nil {
		return
	}
	// Capture the currently-unread IDs BEFORE marking, so we only propagate
	// the messages this action actually changed.
	var unreadIDs []string
	for _, m := range a.mcpServer.GetInbox().GetMessages(agentID) {
		if !m.Read {
			unreadIDs = append(unreadIDs, m.ID)
		}
	}
	a.mcpServer.GetInbox().MarkAllRead(agentID)
	for _, id := range unreadIDs {
		a.mcpServer.WriteReadMarker(agentID, id)
	}
}

// ClearAgentInbox clears all messages in an agent's inbox
func (a *App) ClearAgentInbox(agentID string) {
	if a.mcpServer != nil {
		a.mcpServer.GetInbox().Clear(agentID)
	}
}
