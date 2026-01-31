// Package runtime provides the single source of truth for workspace runtime state.
// All session data, message buffers, and unread counts are managed here.
package runtime

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
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
	Slug            string    // Session slug (e.g., "polymorphic-roaming-hummingbird") - plan file at ~/.claude/plans/{slug}.md
	LastSendTime    time.Time // Time when user sent last message (for timestamp-based filtering)
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
// Also creates the agent state if it doesn't exist (needed for newly added agents).
func (rt *WorkspaceRuntime) GetOrCreateSessionState(agentID, sessionID string) *SessionState {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		// Create agent state if it doesn't exist (e.g., newly added agent)
		fmt.Printf("[DEBUG] GetOrCreateSessionState: CREATING NEW agentState for agent=%s\n", agentID[:8])
		agentState = &AgentState{
			Sessions: make(map[string]*SessionState),
		}
		rt.agentStates[agentID] = agentState
	}

	session, exists := agentState.Sessions[sessionID]
	if !exists {
		fmt.Printf("[DEBUG] GetOrCreateSessionState: CREATING NEW session=%s agent=%s (FilePosition will be 0!)\n", sessionID[:8], agentID[:8])
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
	} else {
		fmt.Printf("[DEBUG] GetOrCreateSessionState: FOUND EXISTING session=%s filePos=%d msgCount=%d initialLoadDone=%v\n",
			sessionID[:8], session.FilePosition, len(session.Messages), session.InitialLoadDone)
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

// RefreshSessionUpdatedAt updates the UpdatedAt timestamp for an existing session.
// This is called during rescan to sync UpdatedAt with the file's modification time.
func (rt *WorkspaceRuntime) RefreshSessionUpdatedAt(agentID, sessionID string, updatedAt time.Time) {
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

	session.UpdatedAt = updatedAt
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
// Returns the slice of actually added messages (after deduplication).
func (rt *WorkspaceRuntime) AppendMessages(agentID, sessionID string, messages []types.Message) []types.Message {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		fmt.Printf("[DEBUG] AppendMessages: agent %s not found\n", agentID)
		return nil
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		fmt.Printf("[DEBUG] AppendMessages: session %s not found for agent %s\n", sessionID, agentID)
		return nil
	}

	// Build set of existing UUIDs for deduplication
	existingUUIDs := make(map[string]bool, len(session.Messages))
	for _, msg := range session.Messages {
		if msg.UUID != "" {
			existingUUIDs[msg.UUID] = true
		}
	}

	// Filter out duplicates
	var newMessages []types.Message
	duplicateCount := 0
	for _, msg := range messages {
		if msg.UUID != "" && existingUUIDs[msg.UUID] {
			duplicateCount++
			continue
		}
		newMessages = append(newMessages, msg)
		if msg.UUID != "" {
			existingUUIDs[msg.UUID] = true // Prevent duplicates within the batch too
		}
	}

	// Debug: count message types
	typeCounts := make(map[string]int)
	for _, msg := range newMessages {
		typeCounts[msg.Type]++
	}
	fmt.Printf("[DEBUG] AppendMessages: agent=%s session=%s incoming=%d duplicates=%d adding=%d (types: %v) prevCount=%d\n",
		agentID[:8], sessionID[:8], len(messages), duplicateCount, len(newMessages), typeCounts, len(session.Messages))

	if len(newMessages) == 0 {
		return nil
	}

	prevCount := len(session.Messages)
	session.Messages = append(session.Messages, newMessages...)

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

	// Extract session slug from new messages (used to derive plan file path)
	for _, msg := range messages {
		if msg.Slug != "" {
			session.Slug = msg.Slug
			break // Slug is the same across all messages in a session
		}
	}

	// Recalculate unread count
	session.UnreadCount = max(0, len(session.Messages)-session.ViewedIndex)

	// Update agent total unread
	rt.recalculateAgentUnread(agentState)

	return newMessages
}

// GetMessages returns all messages for a session.
// Applies pending question detection before returning.
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

	// Return a copy with pending question detection applied
	result := make([]types.Message, len(session.Messages))
	copy(result, session.Messages)
	return DetectPendingQuestions(result)
}

// GetPlanFilePath returns the active plan file path for a session.
func (rt *WorkspaceRuntime) GetPlanFilePath(agentID, sessionID string) string {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return ""
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return ""
	}

	if session.Slug == "" {
		return ""
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(homeDir, ".claude", "plans", session.Slug+".md")
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
	for sessionID, session := range agentState.Sessions {
		if session.UnreadCount > 0 {
			fmt.Printf("[DEBUG] recalculateAgentUnread: session=%s unread=%d\n", sessionID[:8], session.UnreadCount)
		}
		total += session.UnreadCount
	}
	fmt.Printf("[DEBUG] recalculateAgentUnread: agentTotal=%d\n", total)
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
		fmt.Printf("[DEBUG] SetFilePosition: agent not found agentID=%s\n", agentID[:8])
		return
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		fmt.Printf("[DEBUG] SetFilePosition: session not found sessionID=%s\n", sessionID[:8])
		return
	}

	oldPos := session.FilePosition
	session.FilePosition = pos
	fmt.Printf("[DEBUG] SetFilePosition: session=%s oldPos=%d newPos=%d delta=%d\n",
		sessionID[:8], oldPos, pos, pos-oldPos)
}

// =============================================================================
// SEND TIME TRACKING (for timestamp-based message filtering)
// =============================================================================

// SetLastSendTime records when the user sent a message.
// This is used to filter out historical context that Claude Code writes when resuming.
func (rt *WorkspaceRuntime) SetLastSendTime(agentID, sessionID string, t time.Time) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		fmt.Printf("[DEBUG] SetLastSendTime: agent not found agentID=%s\n", agentID[:8])
		return
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		fmt.Printf("[DEBUG] SetLastSendTime: session not found sessionID=%s\n", sessionID[:8])
		return
	}

	session.LastSendTime = t
	fmt.Printf("[DEBUG] SetLastSendTime: session=%s time=%v\n", sessionID[:8], t.Format(time.RFC3339))
}

// GetLastSendTime returns the time when the user last sent a message.
// Returns zero time if not set.
func (rt *WorkspaceRuntime) GetLastSendTime(agentID, sessionID string) time.Time {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		return time.Time{}
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		return time.Time{}
	}

	return session.LastSendTime
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

	fmt.Printf("[DEBUG] EmitUnreadChanged: session=%s unread=%d agentTotal=%d\n", sessionID[:8], unread, agentTotal)

	rt.Emit("unread:changed", agentID, sessionID, map[string]int{
		"unread":     unread,
		"agentTotal": agentTotal,
	})
}

// EmitSessionMessages emits a session:messages event.
// Applies pending question detection on FULL session (not just delta) since
// the tool_use and tool_result may be in different events.
func (rt *WorkspaceRuntime) EmitSessionMessages(agentID, sessionID string, messages []types.Message) {
	// Get the full session messages for proper pending question detection
	// The tool_use (AskUserQuestion) and tool_result (is_error) may be in different events
	rt.mu.RLock()
	agentState, ok := rt.agentStates[agentID]
	if !ok {
		rt.mu.RUnlock()
		// Fall back to just the delta messages
		detectedMessages := DetectPendingQuestions(messages)
		rt.Emit("session:messages", agentID, sessionID, map[string]any{
			"messages": detectedMessages,
		})
		return
	}
	session, ok := agentState.Sessions[sessionID]
	if !ok {
		rt.mu.RUnlock()
		// Fall back to just the delta messages
		detectedMessages := DetectPendingQuestions(messages)
		rt.Emit("session:messages", agentID, sessionID, map[string]any{
			"messages": detectedMessages,
		})
		return
	}

	// Make a copy of all session messages for detection
	allMessages := make([]types.Message, len(session.Messages))
	copy(allMessages, session.Messages)
	rt.mu.RUnlock()

	// Apply detection on full session to properly match tool_use with tool_result
	DetectPendingQuestions(allMessages)

	// Now extract just the delta messages with their pendingQuestion populated
	// We need to find the delta messages in the detected set by matching UUIDs
	deltaUUIDs := make(map[string]bool)
	for _, msg := range messages {
		deltaUUIDs[msg.UUID] = true
	}

	detectedDelta := make([]types.Message, 0, len(messages))
	for _, msg := range allMessages {
		if deltaUUIDs[msg.UUID] {
			detectedDelta = append(detectedDelta, msg)
		}
	}

	rt.Emit("session:messages", agentID, sessionID, map[string]any{
		"messages": detectedDelta,
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

// ClearSession clears a session's message cache and resets its state.
// This is called after JSONL patching to force a reload from disk.
func (rt *WorkspaceRuntime) ClearSession(agentID, sessionID string) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	agentState, ok := rt.agentStates[agentID]
	if !ok {
		fmt.Printf("[DEBUG] ClearSession: agent %s not found\n", agentID)
		return
	}

	session, ok := agentState.Sessions[sessionID]
	if !ok {
		fmt.Printf("[DEBUG] ClearSession: session %s not found for agent %s\n", sessionID, agentID)
		return
	}

	fmt.Printf("[DEBUG] ClearSession: clearing %d messages for agent=%s session=%s\n",
		len(session.Messages), agentID[:8], sessionID[:8])

	// Clear messages and reset state for reload
	session.Messages = make([]types.Message, 0)
	session.FilePosition = 0
	session.InitialLoadDone = false
	session.Slug = ""
	// Keep ViewedIndex and LastViewedAt - these represent user's read state
}

// =============================================================================
// PENDING QUESTION DETECTION
// =============================================================================

// DetectPendingQuestions scans messages for failed AskUserQuestion tool calls.
// When Claude Code runs with --print, AskUserQuestion auto-fails with is_error: true.
// This function detects that pattern and marks the message with PendingQuestion
// so the frontend can show an interactive UI.
//
// IMPORTANT: Only the LAST failed AskUserQuestion is truly "pending".
// Historical ones where the conversation continued are marked as "skipped".
//
// Pattern:
//   1. assistant message with tool_use (name: "AskUserQuestion", id: "toolu_xxx")
//   2. user message with tool_result (tool_use_id: "toolu_xxx", is_error: true)
//   3. No subsequent assistant messages or user input after the tool_result
func DetectPendingQuestions(messages []types.Message) []types.Message {
	// Map of tool_use_id -> questions from AskUserQuestion blocks
	askUserQuestions := make(map[string][]map[string]interface{})

	// First pass: collect AskUserQuestion tool_use blocks
	for _, msg := range messages {
		for _, block := range msg.ContentBlocks {
			if block.Type == "tool_use" && block.Name == "AskUserQuestion" && block.ID != "" {
				if input, ok := block.Input.(map[string]interface{}); ok {
					if questions, ok := input["questions"].([]interface{}); ok {
						askUserQuestions[block.ID] = convertToMapSlice(questions)
					}
				}
			}
		}
	}

	// Second pass: find ALL failed AskUserQuestion tool_results and their positions
	type failedQuestion struct {
		messageIndex int
		toolUseID    string
		questions    []map[string]interface{}
	}
	var failedQuestions []failedQuestion

	for i := range messages {
		// Clear any previous pending state
		messages[i].PendingQuestion = nil

		for _, block := range messages[i].ContentBlocks {
			if block.Type == "tool_result" && block.IsError && block.ToolUseID != "" {
				if questions, ok := askUserQuestions[block.ToolUseID]; ok {
					failedQuestions = append(failedQuestions, failedQuestion{
						messageIndex: i,
						toolUseID:    block.ToolUseID,
						questions:    questions,
					})
				}
			}
		}
	}

	if len(failedQuestions) == 0 {
		return messages
	}

	// Third pass: determine which failed questions are truly "pending" vs "skipped"
	// A question is pending ONLY if:
	// 1. It's the last failed question with no meaningful content after it
	// 2. It's recent (within 2 hours) - stale questions should just show as failed
	for idx, fq := range failedQuestions {
		isLast := idx == len(failedQuestions)-1
		isPending := false

		if isLast {
			// Check if there's any meaningful content after this failed question
			hasContentAfter := false
			for j := fq.messageIndex + 1; j < len(messages); j++ {
				msg := messages[j]
				// Assistant message with actual content = conversation continued
				if msg.Type == "assistant" && (msg.Content != "" || len(msg.ContentBlocks) > 0) {
					hasContentAfter = true
					break
				}
				// User message with actual text content = user responded
				if msg.Type == "user" && msg.Content != "" {
					hasContentAfter = true
					break
				}
			}
			isPending = !hasContentAfter

			// Only show as pending if it's recent (within 2 hours)
			// Stale questions from hours/days ago should just show as failed
			if isPending {
				msgTime := parseTimestampToTime(messages[fq.messageIndex].Timestamp)
				if !msgTime.IsZero() && time.Since(msgTime) > 2*time.Hour {
					isPending = false
					fmt.Printf("[DEBUG] DetectPendingQuestions: question %s is stale (%.1f hours old), marking as failed\n",
						fq.toolUseID[:8], time.Since(msgTime).Hours())
				}
			}
		}

		if isPending {
			messages[fq.messageIndex].PendingQuestion = &types.PendingQuestion{
				ToolUseID: fq.toolUseID,
				Questions: fq.questions,
			}
		}
		// For non-pending (skipped) questions, PendingQuestion stays nil
		// The frontend will show them as read-only with "Skipped" status
	}

	return messages
}

// convertToMapSlice converts []interface{} to []map[string]interface{}.
func convertToMapSlice(items []interface{}) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]interface{}); ok {
			result = append(result, m)
		}
	}
	return result
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

