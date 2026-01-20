package main

import (
	"fmt"
	"strings"

	"claudefu/internal/types"
)

// =============================================================================
// SESSION METHODS (Bound to frontend)
// =============================================================================

// GetSessions returns sessions for an agent
func (a *App) GetSessions(agentID string) ([]types.Session, error) {
	if a.rt == nil {
		return nil, fmt.Errorf("runtime not initialized")
	}

	sessions := a.rt.GetSessionsForAgent(agentID)
	result := make([]types.Session, 0, len(sessions))
	for _, s := range sessions {
		// Skip subagent sessions (format: agent-{short-id})
		// These are quick task executions, not main conversations
		if strings.HasPrefix(s.SessionID, "agent-") {
			continue
		}

		result = append(result, types.Session{
			ID:           s.SessionID,
			AgentID:      s.AgentID,
			Preview:      s.Preview,
			MessageCount: len(s.Messages),
			CreatedAt:    s.CreatedAt,
			UpdatedAt:    s.UpdatedAt,
		})
	}
	return result, nil
}

// RefreshSessions re-scans the filesystem for new sessions and returns updated list.
// This is called by the "Refresh" button in SessionsDialog.
func (a *App) RefreshSessions(agentID string) ([]types.Session, error) {
	if a.watcher == nil {
		return nil, fmt.Errorf("watcher not initialized")
	}
	if a.rt == nil {
		return nil, fmt.Errorf("runtime not initialized")
	}

	// Get the agent's folder
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	// Get last viewed timestamps for unread calculation
	var lastViewedMap map[string]int64
	if a.sessions != nil {
		lastViewedMap = a.sessions.GetAllLastViewed(agent.Folder)
	}

	// Rescan filesystem for new sessions
	newCount, err := a.watcher.RescanSessions(agentID, agent.Folder, lastViewedMap)
	if err != nil {
		return nil, fmt.Errorf("failed to rescan sessions: %w", err)
	}

	if newCount > 0 {
		fmt.Printf("[DEBUG] RefreshSessions: discovered %d new sessions for agent=%s\n", newCount, agentID[:8])
	}

	// Return updated session list (same as GetSessions)
	return a.GetSessions(agentID)
}

// GetConversation returns messages for a session
func (a *App) GetConversation(agentID, sessionID string) ([]types.Message, error) {
	if a.rt == nil {
		return nil, fmt.Errorf("runtime not initialized")
	}

	messages := a.rt.GetMessages(agentID, sessionID)
	if messages == nil {
		return []types.Message{}, nil
	}
	return messages, nil
}

// ConversationResult is the paged conversation response for frontend
type ConversationResult struct {
	SessionID  string          `json:"sessionId"`
	Messages   []types.Message `json:"messages"`
	TotalCount int             `json:"totalCount"`
	HasMore    bool            `json:"hasMore"`
}

// GetConversationPaged returns messages with pagination support
// limit: max messages to return (0 = all)
// offset: skip this many messages from the end (for loading older messages)
func (a *App) GetConversationPaged(agentID, sessionID string, limit, offset int) (*ConversationResult, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	conv, err := a.workspace.GetConversationPaged(agent.Folder, sessionID, limit, offset)
	if err != nil {
		return nil, err
	}

	return &ConversationResult{
		SessionID:  conv.SessionID,
		Messages:   conv.Messages,
		TotalCount: conv.TotalCount,
		HasMore:    conv.HasMore,
	}, nil
}

// GetSubagentConversation returns messages from a subagent JSONL file
func (a *App) GetSubagentConversation(agentID, sessionID, subagentID string) ([]types.Message, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	return a.workspace.GetSubagentConversation(agent.Folder, sessionID, subagentID)
}

// SetActiveSession sets the currently active session for streaming updates
func (a *App) SetActiveSession(agentID, sessionID string) error {
	if a.rt == nil {
		return fmt.Errorf("runtime not initialized")
	}

	// Validation: Two agents from the same folder cannot watch the same sessionID
	// This would be weird - you'd see the same conversation in two different "agents"
	if a.currentWorkspace != nil {
		thisAgent := a.getAgentByID(agentID)
		if thisAgent != nil {
			for _, otherAgent := range a.currentWorkspace.Agents {
				if otherAgent.ID == agentID {
					continue // Skip self
				}
				if otherAgent.Folder != thisAgent.Folder {
					continue // Different folder, no conflict
				}
				// Same folder - check if the other agent is already watching this session
				currentActiveAgent, currentActiveSession := a.rt.GetActiveSession()
				if currentActiveAgent == otherAgent.ID && currentActiveSession == sessionID {
					return fmt.Errorf("session %s is already active in agent '%s'", sessionID[:8], otherAgent.Name)
				}
			}
		}
	}

	a.rt.SetActiveSession(agentID, sessionID)

	// Update file watcher to only watch this session file
	// This saves resources - we don't need 100+ fsnotify watches
	if a.watcher != nil {
		a.watcher.SetActiveSessionWatch(agentID, sessionID)
	}

	return nil
}

// ClearActiveSession clears the active session
func (a *App) ClearActiveSession() {
	if a.rt != nil {
		a.rt.ClearActiveSession()
	}
	if a.watcher != nil {
		a.watcher.ClearActiveSessionWatch()
	}
}

// MarkSessionViewed marks a session as viewed
func (a *App) MarkSessionViewed(agentID, sessionID string) error {
	fmt.Printf("[DEBUG] MarkSessionViewed called: agentID=%s sessionID=%s\n", agentID, sessionID[:8])

	// Get folder from agent
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	// Update persisted timestamp
	if a.sessions != nil {
		if err := a.sessions.SetLastViewed(agent.Folder, sessionID); err != nil {
			return err
		}
	}

	// Update runtime state
	if a.rt != nil {
		a.rt.MarkSessionViewed(agentID, sessionID)
		a.rt.EmitUnreadChanged(agentID, sessionID)
	}

	fmt.Printf("[DEBUG] MarkSessionViewed complete: agentID=%s sessionID=%s\n", agentID, sessionID[:8])
	return nil
}

// =============================================================================
// UNREAD METHODS (Bound to frontend)
// =============================================================================

// GetUnreadCounts returns unread counts for all sessions in an agent
func (a *App) GetUnreadCounts(agentID string) map[string]int {
	if a.rt == nil {
		return make(map[string]int)
	}
	return a.rt.GetAllUnreadCounts(agentID)
}

// GetAgentTotalUnread returns total unread count for an agent
func (a *App) GetAgentTotalUnread(agentID string) int {
	if a.rt == nil {
		return 0
	}
	return a.rt.GetAgentTotalUnread(agentID)
}

// =============================================================================
// SESSION NAMING METHODS (Bound to frontend)
// =============================================================================

// GetSessionName returns the custom name for a session
func (a *App) GetSessionName(agentID, sessionID string) string {
	if a.sessions == nil {
		return ""
	}
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return ""
	}
	return a.sessions.GetSessionName(agent.Folder, sessionID)
}

// SetSessionName sets a custom name for a session
func (a *App) SetSessionName(agentID, sessionID, name string) error {
	if a.sessions == nil {
		return fmt.Errorf("session manager not initialized")
	}
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}
	return a.sessions.SetSessionName(agent.Folder, sessionID, name)
}

// GetAllSessionNames returns all session names for an agent
func (a *App) GetAllSessionNames(agentID string) map[string]string {
	if a.sessions == nil {
		return make(map[string]string)
	}
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return make(map[string]string)
	}
	return a.sessions.GetAllSessionNames(agent.Folder)
}
