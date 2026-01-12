// Package runtime provides the single source of truth for workspace runtime state.
// All session data, message buffers, and unread counts are managed here.
package runtime

import (
	"fmt"
	"maps"
	"sync"
	"time"

	"claudefu/internal/types"
	"claudefu/internal/workspace"
)

// =============================================================================
// CONSTANTS
// =============================================================================

// MaxBufferSize is the maximum number of messages to keep in memory per session.
// This creates a FIFO buffer - older messages are dropped when limit is exceeded.
// For older history, we can read from disk on demand.
// With ~6-8 agents per workspace max, 750 messages per session is reasonable.
const MaxBufferSize = 750

// =============================================================================
// WORKSPACE RUNTIME - Single State Container
// =============================================================================

// WorkspaceRuntime is the single state container for a loaded workspace.
// It manages all agent states, session buffers, and coordinates event emission.
type WorkspaceRuntime struct {
	workspace       *workspace.Workspace
	workspaceID     string
	agentStates     map[string]*AgentState // agent_id -> state
	folderToAgentID map[string]string      // folder -> agent_id (for file watcher lookups)
	activeAgentID   string
	activeSessionID string
	emitFunc        func(types.EventEnvelope)
	mu              sync.RWMutex
}

// AgentState holds runtime state for a single agent.
type AgentState struct {
	Agent       workspace.Agent
	Sessions    map[string]*SessionState // session_id -> state
	TotalUnread int
}

// SessionState holds runtime state for a single session.
// This is the single source of truth for session messages and unread counts.
type SessionState struct {
	SessionID       string
	AgentID         string
	Messages        []types.Message
	FilePosition    int64     // For delta reads from JSONL
	InitialLoadDone bool      // True after initial load completes (prevents race with delta reads)
	LastViewedAt    time.Time // Persisted, used to calculate ViewedIndex on load
	ViewedIndex     int       // Index up to which user has seen messages
	UnreadCount     int       // Derived: len(Messages) - ViewedIndex
	Preview         string    // First user message preview
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// =============================================================================
// CONSTRUCTOR
// =============================================================================

// NewWorkspaceRuntime creates a new runtime for a workspace.
func NewWorkspaceRuntime(ws *workspace.Workspace, emitFunc func(types.EventEnvelope)) *WorkspaceRuntime {
	rt := &WorkspaceRuntime{
		workspace:       ws,
		workspaceID:     ws.ID,
		agentStates:     make(map[string]*AgentState),
		folderToAgentID: make(map[string]string),
		emitFunc:        emitFunc,
	}

	// Initialize agent states and folder mapping
	for _, agent := range ws.Agents {
		rt.agentStates[agent.ID] = &AgentState{
			Agent:       agent,
			Sessions:    make(map[string]*SessionState),
			TotalUnread: 0,
		}
		rt.folderToAgentID[agent.Folder] = agent.ID
	}

	return rt
}

// =============================================================================
// WORKSPACE ACCESSORS
// =============================================================================

// GetWorkspace returns the current workspace.
func (rt *WorkspaceRuntime) GetWorkspace() *workspace.Workspace {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.workspace
}

// GetWorkspaceID returns the current workspace ID.
func (rt *WorkspaceRuntime) GetWorkspaceID() string {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.workspaceID
}

// =============================================================================
// AGENT STATE ACCESSORS
// =============================================================================

// GetAgentState returns the state for an agent by ID.
func (rt *WorkspaceRuntime) GetAgentState(agentID string) *AgentState {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.agentStates[agentID]
}

// GetAgentIDByFolder returns the agent ID for a given folder path.
func (rt *WorkspaceRuntime) GetAgentIDByFolder(folder string) (string, bool) {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	id, ok := rt.folderToAgentID[folder]
	return id, ok
}

// GetAllAgentStates returns all agent states.
func (rt *WorkspaceRuntime) GetAllAgentStates() map[string]*AgentState {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	// Return a copy to prevent external mutation
	result := make(map[string]*AgentState, len(rt.agentStates))
	maps.Copy(result, rt.agentStates)
	return result
}

// =============================================================================
// SESSION STATE MANAGEMENT
// =============================================================================

// GetSessionState returns the session state for a given agent and session.
func (rt *WorkspaceRuntime) GetSessionState(agentID, sessionID string) *SessionState {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return nil
	}
	return agentState.Sessions[sessionID]
}

// GetOrCreateSessionState returns existing session state or creates a new one.
func (rt *WorkspaceRuntime) GetOrCreateSessionState(agentID, sessionID string) *SessionState {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return nil
	}

	session, exists := agentState.Sessions[sessionID]
	if !exists {
		session = &SessionState{
			SessionID:   sessionID,
			AgentID:     agentID,
			Messages:    make([]types.Message, 0),
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
			ViewedIndex: 0,
			UnreadCount: 0,
		}
		agentState.Sessions[sessionID] = session
	}
	return session
}

// MarkInitialLoadDone marks a session as having completed its initial load.
// This prevents race conditions where delta reads could interfere with initial load.
func (rt *WorkspaceRuntime) MarkInitialLoadDone(agentID, sessionID string) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return
	}

	session.InitialLoadDone = true
}

// IsInitialLoadDone returns true if the session has completed its initial load.
func (rt *WorkspaceRuntime) IsInitialLoadDone(agentID, sessionID string) bool {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return false
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return false
	}

	return session.InitialLoadDone
}

// GetSessionsForAgent returns all sessions for an agent.
func (rt *WorkspaceRuntime) GetSessionsForAgent(agentID string) []*SessionState {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return nil
	}

	sessions := make([]*SessionState, 0, len(agentState.Sessions))
	for _, s := range agentState.Sessions {
		sessions = append(sessions, s)
	}
	return sessions
}

// =============================================================================
// ACTIVE SESSION MANAGEMENT
// =============================================================================

// GetActiveSession returns the currently active agent and session IDs.
func (rt *WorkspaceRuntime) GetActiveSession() (agentID, sessionID string) {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.activeAgentID, rt.activeSessionID
}

// SetActiveSession sets the currently active session.
func (rt *WorkspaceRuntime) SetActiveSession(agentID, sessionID string) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.activeAgentID = agentID
	rt.activeSessionID = sessionID
}

// ClearActiveSession clears the currently active session.
func (rt *WorkspaceRuntime) ClearActiveSession() {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.activeAgentID = ""
	rt.activeSessionID = ""
}

// IsActiveSession returns true if the given session is currently active.
func (rt *WorkspaceRuntime) IsActiveSession(agentID, sessionID string) bool {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.activeAgentID == agentID && rt.activeSessionID == sessionID
}

// =============================================================================
// MESSAGE MANAGEMENT
// =============================================================================

// AppendMessages adds new messages to a session and updates unread counts.
// Returns the number of new messages added.
func (rt *WorkspaceRuntime) AppendMessages(agentID, sessionID string, messages []types.Message) int {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		fmt.Printf("[DEBUG] AppendMessages: agent %s not found\n", agentID)
		return 0
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		fmt.Printf("[DEBUG] AppendMessages: session %s not found for agent %s\n", sessionID, agentID)
		return 0
	}

	// Debug: count message types
	typeCounts := make(map[string]int)
	for _, msg := range messages {
		typeCounts[msg.Type]++
	}
	fmt.Printf("[DEBUG] AppendMessages: agent=%s session=%s adding %d messages (types: %v) prevCount=%d\n",
		agentID[:8], sessionID[:8], len(messages), typeCounts, len(session.Messages))

	prevCount := len(session.Messages)
	session.Messages = append(session.Messages, messages...)

	// Enforce FIFO buffer limit - trim oldest messages if over limit
	if len(session.Messages) > MaxBufferSize {
		excess := len(session.Messages) - MaxBufferSize
		session.Messages = session.Messages[excess:]
		// Adjust ViewedIndex to account for dropped messages
		session.ViewedIndex = max(0, session.ViewedIndex-excess)
	}

	// Update timestamps from actual message data
	if len(messages) > 0 {
		// Set CreatedAt from first message if this is initial load
		if prevCount == 0 && len(session.Messages) > 0 {
			if ts := parseTimestampToTime(session.Messages[0].Timestamp); !ts.IsZero() {
				session.CreatedAt = ts
			}
		}
		// Set UpdatedAt from last message
		lastMsg := messages[len(messages)-1]
		if ts := parseTimestampToTime(lastMsg.Timestamp); !ts.IsZero() {
			session.UpdatedAt = ts
		}
	}

	// Update preview if this is the first message
	if session.Preview == "" && len(messages) > 0 {
		for _, msg := range messages {
			if msg.Type == "user" && msg.Content != "" {
				session.Preview = truncatePreview(msg.Content, 100)
				break
			}
		}
	}

	// Recalculate unread count
	session.UnreadCount = max(0, len(session.Messages)-session.ViewedIndex)

	// Update agent total unread
	rt.recalculateAgentUnread(agentState)

	return len(session.Messages) - prevCount
}

// GetMessages returns all messages for a session.
func (rt *WorkspaceRuntime) GetMessages(agentID, sessionID string) []types.Message {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		fmt.Printf("[DEBUG] GetMessages: agent %s not found\n", agentID)
		return nil
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		fmt.Printf("[DEBUG] GetMessages: session %s not found for agent %s\n", sessionID, agentID)
		return nil
	}

	// Debug: count message types in buffer
	typeCounts := make(map[string]int)
	for _, msg := range session.Messages {
		typeCounts[msg.Type]++
	}
	fmt.Printf("[DEBUG] GetMessages: agent=%s session=%s returning %d messages (types: %v)\n",
		agentID[:8], sessionID[:8], len(session.Messages), typeCounts)

	// Return a copy
	result := make([]types.Message, len(session.Messages))
	copy(result, session.Messages)
	return result
}

// =============================================================================
// UNREAD MANAGEMENT
// =============================================================================

// MarkSessionViewed marks all current messages as viewed.
func (rt *WorkspaceRuntime) MarkSessionViewed(agentID, sessionID string) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return
	}

	session.ViewedIndex = len(session.Messages)
	session.UnreadCount = 0
	session.LastViewedAt = time.Now()

	// Update agent total
	rt.recalculateAgentUnread(agentState)
}

// InitializeSessionViewed sets the viewed state for a session based on lastViewedAt timestamp.
// This is called during initial load to calculate how many messages are unread.
func (rt *WorkspaceRuntime) InitializeSessionViewed(agentID, sessionID string, lastViewedAt int64) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return
	}

	if lastViewedAt > 0 {
		// Calculate viewedIndex based on message timestamps
		viewedIndex := 0
		for i, msg := range session.Messages {
			msgTime := parseTimestamp(msg.Timestamp)
			if msgTime <= lastViewedAt {
				viewedIndex = i + 1
			}
		}
		session.ViewedIndex = viewedIndex
		session.LastViewedAt = time.UnixMilli(lastViewedAt)
	} else {
		// Never viewed - mark all current messages as seen
		// (only new messages after this point will be unread)
		session.ViewedIndex = len(session.Messages)
	}

	// Recalculate unread
	session.UnreadCount = max(0, len(session.Messages)-session.ViewedIndex)

	// Update agent total
	rt.recalculateAgentUnread(agentState)
}

// parseTimestamp converts ISO timestamp string to Unix milliseconds.
func parseTimestamp(ts string) int64 {
	if ts == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, ts)
		if err != nil {
			return 0
		}
	}
	return t.UnixMilli()
}

// parseTimestampToTime converts ISO timestamp string to time.Time.
func parseTimestampToTime(ts string) time.Time {
	if ts == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, ts)
		if err != nil {
			return time.Time{}
		}
	}
	return t
}

// GetUnreadCount returns the unread count for a session.
func (rt *WorkspaceRuntime) GetUnreadCount(agentID, sessionID string) int {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return 0
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return 0
	}

	return session.UnreadCount
}

// GetAgentTotalUnread returns the total unread count for an agent.
func (rt *WorkspaceRuntime) GetAgentTotalUnread(agentID string) int {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return 0
	}

	return agentState.TotalUnread
}

// GetAllUnreadCounts returns unread counts for all sessions in an agent.
func (rt *WorkspaceRuntime) GetAllUnreadCounts(agentID string) map[string]int {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return nil
	}

	result := make(map[string]int, len(agentState.Sessions))
	for sessionID, session := range agentState.Sessions {
		result[sessionID] = session.UnreadCount
	}
	return result
}

// recalculateAgentUnread recalculates the total unread for an agent.
// Must be called with lock held.
func (rt *WorkspaceRuntime) recalculateAgentUnread(agentState *AgentState) {
	total := 0
	for _, session := range agentState.Sessions {
		total += session.UnreadCount
	}
	agentState.TotalUnread = total
}

// =============================================================================
// FILE POSITION TRACKING (for delta reads)
// =============================================================================

// GetFilePosition returns the file position for delta reads.
func (rt *WorkspaceRuntime) GetFilePosition(agentID, sessionID string) int64 {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return 0
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return 0
	}

	return session.FilePosition
}

// SetFilePosition updates the file position for delta reads.
func (rt *WorkspaceRuntime) SetFilePosition(agentID, sessionID string, pos int64) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return
	}

	session.FilePosition = pos
}

// =============================================================================
// EVENT EMISSION
// =============================================================================

// Emit sends an event wrapped in an EventEnvelope.
func (rt *WorkspaceRuntime) Emit(eventType string, agentID, sessionID string, payload any) {
	if rt.emitFunc == nil {
		return
	}

	envelope := types.EventEnvelope{
		WorkspaceID: rt.workspaceID,
		AgentID:     agentID,
		SessionID:   sessionID,
		EventType:   eventType,
		Payload:     payload,
	}

	rt.emitFunc(envelope)
}

// EmitUnreadChanged emits an unread:changed event for a session.
func (rt *WorkspaceRuntime) EmitUnreadChanged(agentID, sessionID string) {
	rt.mu.RLock()
	agentState := rt.agentStates[agentID]
	var unread, agentTotal int
	if agentState != nil {
		agentTotal = agentState.TotalUnread
		if session := agentState.Sessions[sessionID]; session != nil {
			unread = session.UnreadCount
		}
	}
	rt.mu.RUnlock()

	rt.Emit("unread:changed", agentID, sessionID, map[string]int{
		"unread":     unread,
		"agentTotal": agentTotal,
	})
}

// EmitSessionMessages emits a session:messages event.
func (rt *WorkspaceRuntime) EmitSessionMessages(agentID, sessionID string, messages []types.Message) {
	rt.Emit("session:messages", agentID, sessionID, map[string]any{
		"messages": messages,
	})
}

// =============================================================================
// CLEANUP
// =============================================================================

// Clear resets all runtime state. Called during workspace switch.
func (rt *WorkspaceRuntime) Clear() {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	rt.workspace = nil
	rt.workspaceID = ""
	rt.agentStates = make(map[string]*AgentState)
	rt.folderToAgentID = make(map[string]string)
	rt.activeAgentID = ""
	rt.activeSessionID = ""
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// truncatePreview truncates a string to maxLen characters with ellipsis.
func truncatePreview(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}
