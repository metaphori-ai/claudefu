package main

import (
	"fmt"
	"strings"
	"time"

	"claudefu/internal/types"
	"claudefu/internal/workspace"
)

// =============================================================================
// SESSION METHODS (Bound to frontend)
// =============================================================================

// GetSessions returns sessions for an agent.
//
// File truth wins for counts: TurnCount / JsonlLineCount / MessageCount /
// Preview come from scanning the JSONL files on disk (workspace.Manager.
// GetSessions), not from len(SessionState.Messages) — which only reflects
// what's loaded into memory for view (default 25 turns post-v0.5.45) and
// would lie about how long a session actually is.
//
// Runtime data contributes precise timestamps (CreatedAt/UpdatedAt) when
// available; file mtime is the fallback for never-opened sessions.
func (a *App) GetSessions(agentID string) ([]types.Session, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	// File-truth stats from disk scan (one streaming pass per session file).
	fileSessions, err := a.workspace.GetSessions(agent.Folder)
	if err != nil {
		return nil, err
	}

	// Runtime sessions for precise timestamps. Optional — sessions that have
	// never been opened don't have a runtime entry; file mtime is the fallback.
	type tsEntry struct{ created, updated time.Time }
	tsByID := make(map[string]tsEntry, len(fileSessions))
	if a.rt != nil {
		for _, s := range a.rt.GetSessionsForAgent(agentID) {
			tsByID[s.SessionID] = tsEntry{created: s.CreatedAt, updated: s.UpdatedAt}
		}
	}

	result := make([]types.Session, 0, len(fileSessions))
	for _, fs := range fileSessions {
		// Skip subagent sessions defensively (format: agent-{short-id}).
		if strings.HasPrefix(fs.SessionID, "agent-") {
			continue
		}

		sess := types.Session{
			ID:             fs.SessionID,
			AgentID:        agentID,
			Preview:        fs.Preview,
			MessageCount:   fs.MessageCount,
			TurnCount:      fs.TurnCount,
			JsonlLineCount: fs.JsonlLineCount,
			CreatedAt:      fs.LastModified, // fallback when runtime has no entry
			UpdatedAt:      fs.LastModified,
		}
		if rt, ok := tsByID[fs.SessionID]; ok {
			if !rt.created.IsZero() {
				sess.CreatedAt = rt.created
			}
			if !rt.updated.IsZero() {
				sess.UpdatedAt = rt.updated
			}
		}
		result = append(result, sess)
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

// ConversationResult is the paged conversation response for frontend.
// Carries both legacy message-based pagination fields (TotalCount/HasMore/
// DisplayCount) and the newer turn-based fields (TurnCount/TurnsLoaded/
// HasMoreTurns) so callers can choose either unit. ChatView now uses the
// turn-based fields exclusively.
type ConversationResult struct {
	SessionID      string          `json:"sessionId"`
	Messages       []types.Message `json:"messages"`
	TotalCount     int             `json:"totalCount"`
	HasMore        bool            `json:"hasMore"`
	DisplayCount   int             `json:"displayCount"`   // Display messages in this page (excludes carriers)
	TurnCount      int             `json:"turnCount"`      // Total turns in file (real user messages)
	TurnsLoaded    int             `json:"turnsLoaded"`    // Turns included in this page
	HasMoreTurns   bool            `json:"hasMoreTurns"`   // True if earlier turns exist beyond this page
	JsonlLineCount int             `json:"jsonlLineCount"` // Raw non-empty JSONL line count
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
		SessionID:      conv.SessionID,
		Messages:       conv.Messages,
		TotalCount:     conv.TotalCount,
		HasMore:        conv.HasMore,
		DisplayCount:   conv.DisplayCount,
		TurnCount:      conv.TurnCount,
		TurnsLoaded:    conv.TurnsLoaded,
		HasMoreTurns:   conv.HasMoreTurns,
		JsonlLineCount: conv.JsonlLineCount,
	}, nil
}

// GetConversationByTurns returns the last `turnLimit` turns from a session.
// A turn is one real user message + everything that follows until the next
// real user message. turnLimit <= 0 means "all turns".
//
// This is the turn-based sibling of GetConversationPaged. ChatView uses this
// for both the initial load and the Load Recent buttons because users
// naturally count conversations in turns, not in (user|assistant|carrier)
// message records.
func (a *App) GetConversationByTurns(agentID, sessionID string, turnLimit int) (*ConversationResult, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	conv, err := a.workspace.GetConversationByTurns(agent.Folder, sessionID, turnLimit)
	if err != nil {
		return nil, err
	}

	return &ConversationResult{
		SessionID:      conv.SessionID,
		Messages:       conv.Messages,
		TotalCount:     conv.TotalCount,
		HasMore:        conv.HasMore,
		DisplayCount:   conv.DisplayCount,
		TurnCount:      conv.TurnCount,
		TurnsLoaded:    conv.TurnsLoaded,
		HasMoreTurns:   conv.HasMoreTurns,
		JsonlLineCount: conv.JsonlLineCount,
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
					return fmt.Errorf("session %s is already active in agent '%s'", sessionID[:8], otherAgent.GetSlug())
				}
			}
		}
	}

	a.rt.SetActiveSession(agentID, sessionID)

	// Update file watcher — each agent watches one session file (the selected one).
	// An agent can have 100+ historical sessions; we only watch the active one per agent.
	if a.watcher != nil {
		a.watcher.SetActiveSessionWatch(agentID, sessionID)
	}

	// Persist the selected session to workspace state (local/, not workspace JSON).
	// This avoids sync conflicts since workspace state is per-machine.
	if a.currentWorkspace != nil && a.workspaceState != nil {
		// Find the agent's folder
		var folder string
		for i := range a.currentWorkspace.Agents {
			if a.currentWorkspace.Agents[i].ID == agentID {
				a.currentWorkspace.Agents[i].SelectedSessionID = sessionID // Keep in-memory for menu/frontend
				folder = a.currentWorkspace.Agents[i].Folder
				break
			}
		}

		// Update in-memory workspace (for frontend emission and menu)
		a.currentWorkspace.SelectedSession = &workspace.SelectedSession{
			AgentID:   agentID,
			SessionID: sessionID,
			Folder:    folder,
		}

		// Update workspace state (source of truth for persistence)
		if a.workspaceState.AgentSessions == nil {
			a.workspaceState.AgentSessions = make(map[string]string)
		}
		a.workspaceState.AgentSessions[agentID] = sessionID
		a.workspaceState.SelectedSession = &workspace.SelectedSession{
			AgentID:   agentID,
			SessionID: sessionID,
			Folder:    folder,
		}

		// Save to local/workspace-state/ (fast, no sync conflict)
		if err := a.workspace.SaveWorkspaceState(a.currentWorkspace.ID, a.workspaceState); err != nil {
			fmt.Printf("[WARN] Failed to save workspace state after SetActiveSession: %v\n", err)
			// Don't return error - selection still works in memory
		}
	}

	return nil
}

// ClearActiveSession clears the active session in the runtime (UI view state).
// NOTE: This does NOT unwatch the agent's session file. With per-agent watching,
// each agent's selected session stays watched even when the user switches to a
// different agent. File watcher cleanup happens in StopWatchingAgent (agent removal)
// or SetActiveSessionWatch (session change within same agent).
func (a *App) ClearActiveSession() {
	if a.rt != nil {
		a.rt.ClearActiveSession()
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

// DeleteFromMessage truncates a session from the specified message UUID downward.
// Removes the target message and everything after it from the JSONL file.
// Returns the number of JSONL lines removed.
func (a *App) DeleteFromMessage(agentID, sessionID, messageUUID string) (int, error) {
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return 0, fmt.Errorf("agent not found: %s", agentID)
	}

	removed, err := workspace.DeleteFromMessage(agent.Folder, sessionID, messageUUID)
	if err != nil {
		return 0, err
	}

	// Reload session to refresh frontend state
	if a.watcher != nil {
		if reloadErr := a.watcher.ReloadSession(agentID, agent.Folder, sessionID); reloadErr != nil {
			fmt.Printf("[WARN] DeleteFromMessage: reload failed: %v\n", reloadErr)
		}
	}

	return removed, nil
}

// DuplicateSession copies a session JSONL to a new file with " copy" appended to the name.
// Returns the new session ID.
func (a *App) DuplicateSession(agentID, sessionID string) (string, error) {
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return "", fmt.Errorf("agent not found: %s", agentID)
	}

	if a.sessionService == nil {
		return "", fmt.Errorf("session service not initialized")
	}

	newID, err := a.sessionService.DuplicateSession(agent.Folder, sessionID)
	if err != nil {
		return "", err
	}

	// Copy session name with " copy" suffix
	if a.sessions != nil {
		sourceName := a.sessions.GetSessionName(agent.Folder, sessionID)
		if sourceName != "" {
			_ = a.sessions.SetSessionName(agent.Folder, newID, sourceName+" copy")
		}
	}

	return newID, nil
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
