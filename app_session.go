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

	a.rt.SetActiveSession(agentID, sessionID)
	return nil
}

// ClearActiveSession clears the active session
func (a *App) ClearActiveSession() {
	if a.rt != nil {
		a.rt.ClearActiveSession()
	}
}

// MarkSessionViewed marks a session as viewed
func (a *App) MarkSessionViewed(agentID, sessionID string) error {
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
