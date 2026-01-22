// Package watcher provides file system watching for Claude Code session files.
// It monitors JSONL session files and notifies the runtime when changes occur.
package watcher

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"claudefu/internal/runtime"
	"claudefu/internal/types"
)

// =============================================================================
// FILE WATCHER - Monitors JSONL Files
// =============================================================================

// FileWatcher watches session JSONL files for changes and notifies the runtime.
type FileWatcher struct {
	watcher           *fsnotify.Watcher
	runtime           *runtime.WorkspaceRuntime
	workspaceID       string
	folderToAgentIDs  map[string][]string // folder path -> list of agent UUIDs (multiple agents can share a folder)
	watchedDirs       map[string]bool     // Track watched directories
	watchedFiles      map[string]bool     // Track watched files
	loadedAgents      map[string]bool     // Track agents that have completed initial session load
	activeSessionPath string              // Currently watched active session file (only ONE at a time)
	mu                sync.RWMutex
	ctx               context.Context
	cancel            context.CancelFunc
}

// NewFileWatcher creates a new file watcher.
func NewFileWatcher() (*FileWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	fw := &FileWatcher{
		watcher:          w,
		folderToAgentIDs: make(map[string][]string),
		watchedDirs:      make(map[string]bool),
		watchedFiles:     make(map[string]bool),
		loadedAgents:     make(map[string]bool),
		ctx:              ctx,
		cancel:           cancel,
	}

	go fw.run()
	return fw, nil
}

// SetRuntime sets the workspace runtime for state management and event emission.
func (fw *FileWatcher) SetRuntime(rt *runtime.WorkspaceRuntime) {
	fw.mu.Lock()
	defer fw.mu.Unlock()
	fw.runtime = rt
	if rt != nil {
		fw.workspaceID = rt.GetWorkspaceID()
	}
}

// SetWorkspaceContext sets the workspace context for event routing.
// This maps folder paths to agent IDs for proper event routing.
// NOTE: Multiple agents can share the same folder, each watching a different session.
func (fw *FileWatcher) SetWorkspaceContext(workspaceID string, folderToAgentIDs map[string][]string) {
	fw.mu.Lock()
	defer fw.mu.Unlock()
	fw.workspaceID = workspaceID
	fw.folderToAgentIDs = folderToAgentIDs
}

// =============================================================================
// ACTIVE SESSION WATCHING
// Only ONE session file should be watched at a time (the active one).
// This saves resources - we don't need to watch 100+ session files.
// Directory-level watching handles new file discovery.
// =============================================================================

// SetActiveSessionWatch switches the watched session file to the active session.
// Unwatches the previous session file and watches the new one.
func (fw *FileWatcher) SetActiveSessionWatch(agentID, sessionID string) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	// Get folder for this agent (check all folders since multiple agents can share a folder)
	var folder string
	for f, agentIDs := range fw.folderToAgentIDs {
		for _, id := range agentIDs {
			if id == agentID {
				folder = f
				break
			}
		}
		if folder != "" {
			break
		}
	}
	if folder == "" {
		fmt.Printf("[DEBUG] SetActiveSessionWatch: agent %s not found in folderToAgentIDs\n", agentID[:8])
		return
	}

	newPath := filepath.Join(GetSessionsDir(folder), sessionID+".jsonl")

	// Skip if already watching this file
	if fw.activeSessionPath == newPath {
		fmt.Printf("[DEBUG] SetActiveSessionWatch: already watching %s\n", sessionID[:8])
		return
	}

	// Unwatch previous active session file
	if fw.activeSessionPath != "" {
		fw.watcher.Remove(fw.activeSessionPath)
		delete(fw.watchedFiles, fw.activeSessionPath)
		fmt.Printf("[DEBUG] SetActiveSessionWatch: unwatched previous session\n")
	}

	// Watch new active session file
	if err := fw.watcher.Add(newPath); err == nil {
		fw.watchedFiles[newPath] = true
		fw.activeSessionPath = newPath
		fmt.Printf("[DEBUG] SetActiveSessionWatch: now watching session=%s path=%s\n", sessionID[:8], newPath)
	} else {
		fmt.Printf("[DEBUG] SetActiveSessionWatch: failed to watch %s: %v\n", newPath, err)
	}
}

// ClearActiveSessionWatch stops watching any session file.
func (fw *FileWatcher) ClearActiveSessionWatch() {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	if fw.activeSessionPath != "" {
		fw.watcher.Remove(fw.activeSessionPath)
		delete(fw.watchedFiles, fw.activeSessionPath)
		fmt.Printf("[DEBUG] ClearActiveSessionWatch: unwatched %s\n", fw.activeSessionPath)
		fw.activeSessionPath = ""
	}
}

// =============================================================================
// EVENT LOOP
// =============================================================================

// run processes file system events.
func (fw *FileWatcher) run() {
	for {
		select {
		case <-fw.ctx.Done():
			return
		case event, ok := <-fw.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Write) {
				fw.handleFileChange(event.Name)
			} else if event.Has(fsnotify.Create) {
				fw.handleFileCreate(event.Name)
			}
		case _, ok := <-fw.watcher.Errors:
			if !ok {
				return
			}
			// Log error but continue
		}
	}
}

// handleFileChange reads new content from a changed file.
func (fw *FileWatcher) handleFileChange(path string) {
	// Only process .jsonl files
	if !strings.HasSuffix(path, ".jsonl") {
		return
	}

	// Skip subagent files (format: agent-{short-id}.jsonl)
	// These are quick task executions, not main session conversations
	base := filepath.Base(path)
	if strings.HasPrefix(base, "agent-") {
		return
	}

	fw.mu.RLock()
	rt := fw.runtime
	fw.mu.RUnlock()

	if rt == nil {
		return
	}

	// Parse path to get folder and sessionID
	folder, sessionID := fw.parseSessionPath(path)
	if folder == "" || sessionID == "" {
		return
	}

	// Get all agent IDs for this folder (multiple agents can share a folder)
	fw.mu.RLock()
	agentIDs, ok := fw.folderToAgentIDs[folder]
	fw.mu.RUnlock()
	if !ok || len(agentIDs) == 0 {
		return
	}

	// Use the first agent that owns this folder
	// (Multiple agents can share a folder, but they share session state)
	// IMPORTANT: Always emit events regardless of "active" status
	// The frontend handles displaying only relevant sessions
	// This fixes state sync issues when user switches agents during a response
	agentID := agentIDs[0]

	// Get or create session state in runtime
	session := rt.GetOrCreateSessionState(agentID, sessionID)
	if session == nil {
		return
	}

	// Skip delta reads until initial load is complete (prevents race condition)
	if !rt.IsInitialLoadDone(agentID, sessionID) {
		fmt.Printf("[DEBUG] handleFileChange: skipping - initial load not done for session=%s\n", sessionID[:8])
		return
	}

	// Get current file size for comparison
	fileInfo, _ := os.Stat(path)
	currentSize := int64(0)
	if fileInfo != nil {
		currentSize = fileInfo.Size()
	}

	// Detailed position tracking for debugging
	oldPosition := session.FilePosition
	delta := currentSize - oldPosition
	fmt.Printf("[DEBUG] handleFileChange: session=%s filePos=%d fileSize=%d delta=%d bytes\n",
		sessionID[:8], oldPosition, currentSize, delta)

	// WARN if delta is suspiciously large (>100KB - could be image/document upload or position reset)
	if delta > 100*1024 {
		fmt.Printf("[WARN] handleFileChange: LARGE DELTA detected! session=%s delta=%d bytes (possible image/document upload)\n",
			sessionID[:8], delta)
	}

	// Read new messages from file (limit to currentSize to avoid reading content still being written)
	newMessages := fw.readNewMessagesLimited(path, oldPosition, currentSize)
	fmt.Printf("[DEBUG] handleFileChange: read %d messages from pos=%d (limited to %d)\n", len(newMessages), oldPosition, currentSize)
	if len(newMessages) == 0 {
		return
	}

	// TIMESTAMP-BASED FILTERING: When Claude Code resumes a session, it writes historical
	// context messages with OLD timestamps but NEW UUIDs. UUID deduplication doesn't work
	// because the UUIDs are different. Instead, we filter by timestamp: only emit messages
	// with timestamps >= (lastSendTime - buffer). The buffer accounts for clock skew.
	lastSendTime := rt.GetLastSendTime(agentID, sessionID)
	if !lastSendTime.IsZero() {
		// Use 10 second buffer to account for clock skew and include the user's own message
		cutoffTime := lastSendTime.Add(-10 * time.Second)
		var filteredMessages []types.Message
		skippedOld := 0
		for _, msg := range newMessages {
			// Parse message timestamp
			msgTime := parseTimestampToTime(msg.Timestamp)
			if msgTime.IsZero() {
				// Can't parse timestamp, include the message to be safe
				filteredMessages = append(filteredMessages, msg)
			} else if msgTime.After(cutoffTime) || msgTime.Equal(cutoffTime) {
				// Message is recent enough, include it
				filteredMessages = append(filteredMessages, msg)
			} else {
				// Message is too old (historical context), skip it
				skippedOld++
			}
		}
		fmt.Printf("[DEBUG] handleFileChange: timestamp filter cutoff=%v, kept=%d, skippedOld=%d\n",
			cutoffTime.Format(time.RFC3339), len(filteredMessages), skippedOld)
		newMessages = filteredMessages

		if len(newMessages) == 0 {
			// All messages were historical context, nothing to emit
			// But still update file position so we don't re-process these bytes
			rt.SetFilePosition(agentID, sessionID, currentSize)
			return
		}
	}

	// Update file position to what we actually read up to (currentSize), NOT current EOF
	// This ensures we don't skip content if Claude wrote more while we were processing
	fmt.Printf("[DEBUG] handleFileChange: updating file position from %d to %d (delta: %d bytes)\n", oldPosition, currentSize, currentSize-oldPosition)
	rt.SetFilePosition(agentID, sessionID, currentSize)

	// Append messages to runtime (returns only the actually added messages after deduplication)
	addedMessages := rt.AppendMessages(agentID, sessionID, newMessages)

	// If nothing was actually added (all duplicates), skip emission
	if len(addedMessages) == 0 {
		fmt.Printf("[DEBUG] handleFileChange: all %d messages were duplicates, skipping emission\n", len(newMessages))
		return
	}

	// Emit unread:changed event (for active session, this will show 0 since we're viewing it)
	rt.EmitUnreadChanged(agentID, sessionID)

	// Emit session:messages (we already filtered to only active session above)
	fmt.Printf("[DEBUG] handleFileChange: emitting session:messages for %d messages\n", len(addedMessages))
	rt.EmitSessionMessages(agentID, sessionID, addedMessages)
}

// handleFileCreate handles new file creation (new sessions).
func (fw *FileWatcher) handleFileCreate(path string) {
	// Only process .jsonl files
	if !strings.HasSuffix(path, ".jsonl") {
		return
	}

	// Skip subagent files (format: agent-{short-id}.jsonl)
	// These are quick task executions, not main session conversations
	base := filepath.Base(path)
	if strings.HasPrefix(base, "agent-") {
		return
	}

	fw.mu.RLock()
	rt := fw.runtime
	fw.mu.RUnlock()

	if rt == nil {
		return
	}

	// Parse path to get folder and sessionID
	folder, sessionID := fw.parseSessionPath(path)
	if folder == "" || sessionID == "" {
		return
	}

	// Get all agent IDs for this folder (multiple agents can share a folder)
	fw.mu.RLock()
	agentIDs, ok := fw.folderToAgentIDs[folder]
	fw.mu.RUnlock()
	if !ok || len(agentIDs) == 0 {
		return
	}

	// NOTE: We do NOT automatically watch new session files.
	// Only the ACTIVE session should be watched (via SetActiveSessionWatch).
	// New sessions that aren't active don't need file watches.

	// Load initial messages (file may already have content if created externally)
	messages, filePos := fw.loadInitialMessages(path)

	// Check if this is a real session (has user/assistant messages)
	hasRealMessages := false
	for _, msg := range messages {
		if msg.Type == "user" || msg.Type == "assistant" {
			hasRealMessages = true
			break
		}
	}

	fmt.Printf("[DEBUG] handleFileCreate: session=%s messages=%d hasRealMessages=%v filePos=%d\n",
		sessionID[:8], len(messages), hasRealMessages, filePos)

	// Skip summary-only sessions (no actual user/assistant messages)
	if !hasRealMessages && len(messages) > 0 {
		fmt.Printf("[DEBUG] handleFileCreate: Skipping summary-only session: %s\n", sessionID)
		return
	}

	// Notify ALL agents that share this folder about the new session
	for _, agentID := range agentIDs {
		// Create session state in runtime
		session := rt.GetOrCreateSessionState(agentID, sessionID)
		if session == nil {
			continue
		}

		// Add loaded messages to session (if any)
		if len(messages) > 0 {
			rt.AppendMessages(agentID, sessionID, messages)
			fmt.Printf("[DEBUG] handleFileCreate: loaded %d messages for agent=%s session=%s\n",
				len(messages), agentID[:8], sessionID[:8])
		}

		// Set file position for future delta reads
		rt.SetFilePosition(agentID, sessionID, filePos)

		// Mark initial load done - now delta reads can proceed
		rt.MarkInitialLoadDone(agentID, sessionID)

		// Emit session:discovered event
		rt.Emit("session:discovered", agentID, sessionID, map[string]any{
			"agentId": agentID,
			"session": types.Session{
				ID:           sessionID,
				AgentID:      agentID,
				MessageCount: len(messages),
				CreatedAt:    session.CreatedAt,
				UpdatedAt:    session.UpdatedAt,
			},
		})
	}
}

// =============================================================================
// AGENT WATCHING
// =============================================================================

// StartWatchingAgent begins watching all sessions for an agent folder.
// lastViewedMap contains last viewed timestamps (Unix ms) for calculating initial unread.
// NOTE: Multiple agents can share the same folder, each watching a different session.
func (fw *FileWatcher) StartWatchingAgent(agentID, folder string, lastViewedMap map[string]int64) error {
	fw.mu.Lock()
	// Add agent to folder's list (multiple agents can share a folder)
	if fw.folderToAgentIDs[folder] == nil {
		fw.folderToAgentIDs[folder] = []string{}
	}
	fw.folderToAgentIDs[folder] = append(fw.folderToAgentIDs[folder], agentID)
	rt := fw.runtime
	alreadyLoaded := fw.loadedAgents[agentID]
	fw.mu.Unlock()

	if rt == nil {
		return nil
	}

	// Guard: skip session discovery if agent was already loaded
	if alreadyLoaded {
		fmt.Printf("[DEBUG] StartWatchingAgent: SKIPPING agent=%s (already loaded)\n", agentID[:8])
		return nil
	}

	// Get the sessions directory for this folder
	sessionsDir := GetSessionsDir(folder)

	// Check if directory exists
	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		// Directory doesn't exist yet - that's OK
		return nil
	}

	// Watch the sessions directory for new files
	fw.mu.Lock()
	if !fw.watchedDirs[sessionsDir] {
		if err := fw.watcher.Add(sessionsDir); err != nil {
			fw.mu.Unlock()
			return err
		}
		fw.watchedDirs[sessionsDir] = true
	}
	fw.mu.Unlock()

	// Discover and load existing sessions
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}

		// Skip subagent files (format: agent-{short-id}.jsonl)
		// These are quick task executions, not main session conversations
		if strings.HasPrefix(entry.Name(), "agent-") {
			continue
		}

		sessionID := strings.TrimSuffix(entry.Name(), ".jsonl")
		filePath := filepath.Join(sessionsDir, entry.Name())

		// Load initial messages first to check if this is a real session
		messages, filePos := fw.loadInitialMessages(filePath)

		// Skip summary-only sessions (no actual user/assistant messages)
		hasRealMessages := false
		for _, msg := range messages {
			if msg.Type == "user" || msg.Type == "assistant" {
				hasRealMessages = true
				break
			}
		}
		if !hasRealMessages {
			fmt.Printf("[DEBUG] Skipping summary-only session: %s\n", sessionID)
			continue
		}

		// Create session state in runtime
		session := rt.GetOrCreateSessionState(agentID, sessionID)
		if session == nil {
			continue
		}

		// Add messages to session
		if len(messages) > 0 {
			rt.AppendMessages(agentID, sessionID, messages)
		}
		rt.SetFilePosition(agentID, sessionID, filePos)

		// Refresh UpdatedAt from file modification time (more accurate than message timestamps
		// when the session has been updated externally while ClaudeFu wasn't watching)
		fileInfo, err := os.Stat(filePath)
		if err == nil {
			rt.RefreshSessionUpdatedAt(agentID, sessionID, fileInfo.ModTime())
		}

		// Initialize viewed state from persisted lastViewedAt
		lastViewed := int64(0)
		if lastViewedMap != nil {
			lastViewed = lastViewedMap[sessionID]
		}
		rt.InitializeSessionViewed(agentID, sessionID, lastViewed)

		// Mark initial load complete - now delta reads can proceed
		rt.MarkInitialLoadDone(agentID, sessionID)

		// NOTE: We do NOT watch individual session files here.
		// Only the ACTIVE session file should be watched (via SetActiveSessionWatch).
		// Directory-level watching handles new file creation events.
		// This saves resources - we don't need 100+ fsnotify watches.
	}

	// Mark agent as loaded to prevent duplicate discovery
	fw.mu.Lock()
	fw.loadedAgents[agentID] = true
	fw.mu.Unlock()
	fmt.Printf("[DEBUG] StartWatchingAgent: completed agent=%s\n", agentID[:8])

	return nil
}

// RescanSessions re-scans the filesystem for new sessions (for refresh functionality).
// Unlike StartWatchingAgent, this doesn't guard against already-loaded agents.
// It only discovers NEW sessions that aren't already in memory.
func (fw *FileWatcher) RescanSessions(agentID, folder string, lastViewedMap map[string]int64) (int, error) {
	fw.mu.RLock()
	rt := fw.runtime
	fw.mu.RUnlock()

	if rt == nil {
		return 0, fmt.Errorf("runtime not set")
	}

	// Get the sessions directory for this folder
	sessionsDir := GetSessionsDir(folder)

	// Check if directory exists
	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		return 0, nil // Directory doesn't exist yet - that's OK
	}

	// Read all JSONL files in the directory
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		return 0, err
	}

	// Get existing sessions from runtime (track both ID and message count)
	existingSessions := make(map[string]int) // sessionID -> messageCount
	for _, s := range rt.GetSessionsForAgent(agentID) {
		existingSessions[s.SessionID] = len(s.Messages)
	}

	newCount := 0
	reloadedCount := 0
	refreshedCount := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}

		// Skip subagent files (format: agent-{short-id}.jsonl)
		if strings.HasPrefix(entry.Name(), "agent-") {
			continue
		}

		sessionID := strings.TrimSuffix(entry.Name(), ".jsonl")

		// Check if already in memory
		msgCount, exists := existingSessions[sessionID]
		if exists && msgCount > 0 {
			// Already loaded with messages - but still refresh UpdatedAt from file mod time
			filePath := filepath.Join(sessionsDir, entry.Name())
			fileInfo, err := os.Stat(filePath)
			if err == nil {
				rt.RefreshSessionUpdatedAt(agentID, sessionID, fileInfo.ModTime())
				refreshedCount++
			}
			continue
		}

		// Either new session OR existing session with 0 messages (needs reload)

		filePath := filepath.Join(sessionsDir, entry.Name())

		// Load initial messages first to check if this is a real session
		messages, filePos := fw.loadInitialMessages(filePath)

		// Skip summary-only sessions (no actual user/assistant messages)
		hasRealMessages := false
		for _, msg := range messages {
			if msg.Type == "user" || msg.Type == "assistant" {
				hasRealMessages = true
				break
			}
		}
		if !hasRealMessages {
			continue
		}

		// Create session state in runtime
		session := rt.GetOrCreateSessionState(agentID, sessionID)
		if session == nil {
			continue
		}

		// Add messages to session
		if len(messages) > 0 {
			rt.AppendMessages(agentID, sessionID, messages)
		}
		rt.SetFilePosition(agentID, sessionID, filePos)

		// Initialize viewed state from persisted lastViewedAt
		lastViewed := int64(0)
		if lastViewedMap != nil {
			lastViewed = lastViewedMap[sessionID]
		}
		rt.InitializeSessionViewed(agentID, sessionID, lastViewed)

		// Mark initial load complete
		rt.MarkInitialLoadDone(agentID, sessionID)

		// Track whether this was a new discovery or a reload of empty session
		if exists {
			reloadedCount++
		} else {
			newCount++
		}
	}

	if newCount > 0 || reloadedCount > 0 || refreshedCount > 0 {
		fmt.Printf("[DEBUG] RescanSessions: agent=%s new=%d reloaded=%d refreshed=%d\n",
			agentID[:8], newCount, reloadedCount, refreshedCount)
	}

	return newCount + reloadedCount, nil
}

// StopWatchingAgent stops watching sessions for a specific agent.
// If this was the last agent watching a folder, the directory watch is also removed.
func (fw *FileWatcher) StopWatchingAgent(agentID, folder string) {
	sessionsDir := GetSessionsDir(folder)

	fw.mu.Lock()
	defer fw.mu.Unlock()

	// Clear active session watch if it belongs to this agent
	if fw.activeSessionPath != "" && strings.HasPrefix(fw.activeSessionPath, sessionsDir+"/") {
		fw.watcher.Remove(fw.activeSessionPath)
		delete(fw.watchedFiles, fw.activeSessionPath)
		fw.activeSessionPath = ""
	}

	// Clear agent from loadedAgents
	delete(fw.loadedAgents, agentID)

	// Remove agent from folder's list
	if agentIDs, ok := fw.folderToAgentIDs[folder]; ok {
		newList := make([]string, 0, len(agentIDs))
		for _, id := range agentIDs {
			if id != agentID {
				newList = append(newList, id)
			}
		}
		if len(newList) == 0 {
			// No more agents watching this folder - remove entirely
			delete(fw.folderToAgentIDs, folder)

			// Unwatch directory
			if fw.watchedDirs[sessionsDir] {
				fw.watcher.Remove(sessionsDir)
				delete(fw.watchedDirs, sessionsDir)
			}

			// Unwatch all session files in this directory
			for filePath := range fw.watchedFiles {
				if strings.HasPrefix(filePath, sessionsDir+"/") {
					fw.watcher.Remove(filePath)
					delete(fw.watchedFiles, filePath)
				}
			}
		} else {
			fw.folderToAgentIDs[folder] = newList
		}
	}
}

// StopAllWatchers stops watching all agents.
func (fw *FileWatcher) StopAllWatchers() {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	// Clear active session watch
	fw.activeSessionPath = ""

	// Unwatch all directories
	for dir := range fw.watchedDirs {
		fw.watcher.Remove(dir)
	}
	fw.watchedDirs = make(map[string]bool)

	// Unwatch all files
	for file := range fw.watchedFiles {
		fw.watcher.Remove(file)
	}
	fw.watchedFiles = make(map[string]bool)

	// Clear folder mapping
	fw.folderToAgentIDs = make(map[string][]string)

	// Clear loaded agents (allows re-loading on next StartWatchingAgent)
	fw.loadedAgents = make(map[string]bool)
}

// =============================================================================
// SESSION RELOAD
// =============================================================================

// ReloadSession clears a session's cache and reloads it from the JSONL file.
// This is called after JSONL patching to refresh the in-memory state.
func (fw *FileWatcher) ReloadSession(agentID, folder, sessionID string) error {
	fw.mu.RLock()
	rt := fw.runtime
	fw.mu.RUnlock()

	if rt == nil {
		return fmt.Errorf("runtime not set")
	}

	// Build JSONL file path
	sessionsDir := GetSessionsDir(folder)
	filePath := filepath.Join(sessionsDir, sessionID+".jsonl")

	fmt.Printf("[DEBUG] ReloadSession: clearing and reloading agent=%s session=%s from %s\n",
		agentID[:8], sessionID[:8], filePath)

	// Clear the session cache in runtime
	rt.ClearSession(agentID, sessionID)

	// Reload messages from JSONL
	messages, filePos := fw.loadInitialMessages(filePath)
	if len(messages) > 0 {
		rt.AppendMessages(agentID, sessionID, messages)
	}
	rt.SetFilePosition(agentID, sessionID, filePos)

	// Mark initial load complete
	rt.MarkInitialLoadDone(agentID, sessionID)

	fmt.Printf("[DEBUG] ReloadSession: loaded %d messages, filePos=%d\n", len(messages), filePos)
	return nil
}

// =============================================================================
// FILE READING
// =============================================================================

// readNewMessages reads new messages from a file starting at the given position.
func (fw *FileWatcher) readNewMessages(path string, startPos int64) []types.Message {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()

	// Seek to last known position
	_, err = file.Seek(startPos, 0)
	if err != nil {
		return nil
	}

	var messages []types.Message
	scanner := bufio.NewScanner(file)
	// Increase buffer for large lines (images can be 1.5MB+ when base64 encoded)
	scanBuf := make([]byte, 0, 64*1024)
	scanner.Buffer(scanBuf, 10*1024*1024) // 10MB max line size

	lineNum := 0
	for scanner.Scan() {
		line := scanner.Text()
		lineNum++
		if line == "" {
			continue
		}

		msg := fw.parseLine(line)
		if msg != nil {
			messages = append(messages, *msg)
			fmt.Printf("[DEBUG] readNewMessages: line %d, len=%d, type=%s, uuid=%s\n", lineNum, len(line), msg.Type, msg.UUID[:8])
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Printf("[DEBUG] readNewMessages: scanner error: %v\n", err)
	}

	return messages
}

// readNewMessagesLimited reads new messages from startPos up to endPos (exclusive).
// This prevents reading content that's still being written by Claude Code.
// The endPos should be the file size observed at the START of handleFileChange.
func (fw *FileWatcher) readNewMessagesLimited(path string, startPos, endPos int64) []types.Message {
	if endPos <= startPos {
		return nil
	}

	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()

	// Seek to last known position
	_, err = file.Seek(startPos, 0)
	if err != nil {
		return nil
	}

	// Limit reading to exactly the bytes we observed at the start
	// This prevents reading content Claude is still writing
	limitReader := io.LimitReader(file, endPos-startPos)

	var messages []types.Message
	scanner := bufio.NewScanner(limitReader)
	// Increase buffer for large lines (images can be 1.5MB+ when base64 encoded)
	scanBuf := make([]byte, 0, 64*1024)
	scanner.Buffer(scanBuf, 10*1024*1024) // 10MB max line size

	lineNum := 0
	for scanner.Scan() {
		line := scanner.Text()
		lineNum++
		if line == "" {
			continue
		}

		msg := fw.parseLine(line)
		if msg != nil {
			messages = append(messages, *msg)
			fmt.Printf("[DEBUG] readNewMessagesLimited: line %d, len=%d, type=%s, uuid=%s\n", lineNum, len(line), msg.Type, msg.UUID[:8])
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Printf("[DEBUG] readNewMessagesLimited: scanner error: %v\n", err)
	}

	return messages
}

// loadInitialMessages loads messages from a file for initial session load.
// Returns messages and the file position (EOF).
func (fw *FileWatcher) loadInitialMessages(filePath string) ([]types.Message, int64) {
	file, err := os.Open(filePath)
	if err != nil {
		fmt.Printf("[DEBUG] loadInitialMessages: failed to open %s: %v\n", filePath, err)
		return nil, 0
	}
	defer file.Close()

	// Read all messages to find compaction point
	var allMessages []types.Message
	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 10*1024*1024) // 10MB max line size for large image messages

	lineCount := 0
	parseFailures := 0
	for scanner.Scan() {
		line := scanner.Text()
		lineCount++
		if line == "" {
			continue
		}
		if msg := fw.parseLine(line); msg != nil {
			allMessages = append(allMessages, *msg)
		} else {
			parseFailures++
		}
	}

	// Load ALL messages for proper deduplication when Claude Code resumes
	// (Claude Code may write context that includes old messages - we need all UUIDs to deduplicate)
	// Note: The frontend handles pagination/display limits via GetConversationPaged

	// Debug: count message types
	typeCounts := make(map[string]int)
	for _, msg := range allMessages {
		typeCounts[msg.Type]++
	}
	sessionID := filepath.Base(filePath)

	// Get file position (EOF)
	fileInfo, _ := file.Stat()
	filePos := int64(0)
	if fileInfo != nil {
		filePos = fileInfo.Size()
	}

	fmt.Printf("[DEBUG] loadInitialMessages: file=%s lines=%d parsed=%d failures=%d loading=%d filePos=%d (types: %v)\n",
		sessionID, lineCount, len(allMessages), parseFailures, len(allMessages), filePos, typeCounts)

	return allMessages, filePos
}

// =============================================================================
// JSONL PARSING
// =============================================================================

// parseLine parses a JSONL line into a Message using the classifier.
func (fw *FileWatcher) parseLine(line string) *types.Message {
	classified, err := types.ClassifyJSONLEvent(line)
	if err != nil || classified == nil {
		return nil
	}
	return types.ConvertToMessage(classified)
}

// =============================================================================
// PATH UTILITIES
// =============================================================================

// parseSessionPath extracts folder and sessionID from a session file path.
func (fw *FileWatcher) parseSessionPath(path string) (folder, sessionID string) {
	// Path format: ~/.claude/projects/{encoded-folder}/{sessionID}.jsonl
	if !strings.HasSuffix(path, ".jsonl") {
		return "", ""
	}

	dir := filepath.Dir(path)
	base := filepath.Base(path)
	sessionID = strings.TrimSuffix(base, ".jsonl")

	// The folder name is encoded (/ replaced with -)
	// Find which agent folder this belongs to
	fw.mu.RLock()
	defer fw.mu.RUnlock()

	for f := range fw.folderToAgentIDs {
		encodedName := strings.ReplaceAll(f, "/", "-")
		expectedDir := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName)
		if dir == expectedDir {
			return f, sessionID
		}
	}

	return "", ""
}

// =============================================================================
// CLEANUP
// =============================================================================

// Close stops the watcher and releases resources.
func (fw *FileWatcher) Close() {
	fw.cancel()
	fw.watcher.Close()
}

// =============================================================================
// TIMESTAMP HELPERS
// =============================================================================

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

// =============================================================================
// PATH HELPERS (exported for use by other packages)
// =============================================================================

// BuildSessionPath constructs the path to a session JSONL file.
func BuildSessionPath(folder, sessionID string) string {
	encodedName := strings.ReplaceAll(folder, "/", "-")
	return filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")
}

// GetSessionsDir returns the directory containing session files for a folder.
func GetSessionsDir(folder string) string {
	encodedName := strings.ReplaceAll(folder, "/", "-")
	return filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName)
}
