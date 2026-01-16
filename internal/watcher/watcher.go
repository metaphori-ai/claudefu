// Package watcher provides file system watching for Claude Code session files.
// It monitors JSONL session files and notifies the runtime when changes occur.
package watcher

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"

	"claudefu/internal/runtime"
	"claudefu/internal/types"
)

// =============================================================================
// FILE WATCHER - Monitors JSONL Files
// =============================================================================

// FileWatcher watches session JSONL files for changes and notifies the runtime.
type FileWatcher struct {
	watcher         *fsnotify.Watcher
	runtime         *runtime.WorkspaceRuntime
	workspaceID     string
	folderToAgentID map[string]string // folder path -> agent UUID
	watchedDirs     map[string]bool   // Track watched directories
	watchedFiles    map[string]bool   // Track watched files
	mu              sync.RWMutex
	ctx             context.Context
	cancel          context.CancelFunc
}

// NewFileWatcher creates a new file watcher.
func NewFileWatcher() (*FileWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	fw := &FileWatcher{
		watcher:         w,
		folderToAgentID: make(map[string]string),
		watchedDirs:     make(map[string]bool),
		watchedFiles:    make(map[string]bool),
		ctx:             ctx,
		cancel:          cancel,
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
func (fw *FileWatcher) SetWorkspaceContext(workspaceID string, folderToAgentID map[string]string) {
	fw.mu.Lock()
	defer fw.mu.Unlock()
	fw.workspaceID = workspaceID
	fw.folderToAgentID = folderToAgentID
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

	// Get agentID from folder
	fw.mu.RLock()
	agentID, ok := fw.folderToAgentID[folder]
	fw.mu.RUnlock()
	if !ok {
		return
	}

	// Get or create session state in runtime
	session := rt.GetOrCreateSessionState(agentID, sessionID)
	if session == nil {
		return
	}

	// Skip delta reads until initial load is complete (prevents race condition)
	if !rt.IsInitialLoadDone(agentID, sessionID) {
		return
	}

	// Read new messages from file
	newMessages := fw.readNewMessages(path, session.FilePosition)
	if len(newMessages) == 0 {
		return
	}

	// Update file position
	if info, err := os.Stat(path); err == nil {
		rt.SetFilePosition(agentID, sessionID, info.Size())
	}

	// Append messages to runtime
	rt.AppendMessages(agentID, sessionID, newMessages)

	// Emit unread:changed event
	rt.EmitUnreadChanged(agentID, sessionID)

	// If this is the active session, also emit session:messages
	isActive := rt.IsActiveSession(agentID, sessionID)
	activeAgent, activeSession := rt.GetActiveSession()
	fmt.Printf("[DEBUG] handleFileChange: isActive=%v thisAgent=%s thisSession=%s activeAgent=%s activeSession=%s\n",
		isActive, agentID, sessionID, activeAgent, activeSession)
	if isActive {
		fmt.Printf("[DEBUG] handleFileChange: emitting session:messages for %d messages\n", len(newMessages))
		rt.EmitSessionMessages(agentID, sessionID, newMessages)
	}
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

	// Get agentID from folder
	fw.mu.RLock()
	agentID, ok := fw.folderToAgentID[folder]
	fw.mu.RUnlock()
	if !ok {
		return
	}

	// Add the file to our watch list
	fw.mu.Lock()
	if !fw.watchedFiles[path] {
		fw.watcher.Add(path)
		fw.watchedFiles[path] = true
	}
	fw.mu.Unlock()

	// Create session state in runtime
	session := rt.GetOrCreateSessionState(agentID, sessionID)
	if session == nil {
		return
	}

	// Set file position to current size (start watching from now)
	if info, err := os.Stat(path); err == nil {
		rt.SetFilePosition(agentID, sessionID, info.Size())
	}

	// Mark initial load done (new file, nothing to load)
	rt.MarkInitialLoadDone(agentID, sessionID)

	// Emit session:discovered event
	rt.Emit("session:discovered", agentID, sessionID, map[string]any{
		"agentId": agentID,
		"session": types.Session{
			ID:        sessionID,
			AgentID:   agentID,
			CreatedAt: session.CreatedAt,
			UpdatedAt: session.UpdatedAt,
		},
	})
}

// =============================================================================
// AGENT WATCHING
// =============================================================================

// StartWatchingAgent begins watching all sessions for an agent folder.
// lastViewedMap contains last viewed timestamps (Unix ms) for calculating initial unread.
func (fw *FileWatcher) StartWatchingAgent(agentID, folder string, lastViewedMap map[string]int64) error {
	fw.mu.Lock()
	fw.folderToAgentID[folder] = agentID
	rt := fw.runtime
	fw.mu.Unlock()

	if rt == nil {
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

		// Initialize viewed state from persisted lastViewedAt
		lastViewed := int64(0)
		if lastViewedMap != nil {
			lastViewed = lastViewedMap[sessionID]
		}
		rt.InitializeSessionViewed(agentID, sessionID, lastViewed)

		// Mark initial load complete - now delta reads can proceed
		rt.MarkInitialLoadDone(agentID, sessionID)

		// Watch the file
		fw.mu.Lock()
		if !fw.watchedFiles[filePath] {
			fw.watcher.Add(filePath)
			fw.watchedFiles[filePath] = true
		}
		fw.mu.Unlock()
	}

	return nil
}

// StopWatchingAgent stops watching sessions for an agent folder.
func (fw *FileWatcher) StopWatchingAgent(folder string) {
	sessionsDir := GetSessionsDir(folder)

	fw.mu.Lock()
	defer fw.mu.Unlock()

	// Remove folder mapping
	delete(fw.folderToAgentID, folder)

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
}

// StopAllWatchers stops watching all agents.
func (fw *FileWatcher) StopAllWatchers() {
	fw.mu.Lock()
	defer fw.mu.Unlock()

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
	fw.folderToAgentID = make(map[string]string)
}

// =============================================================================
// SESSION RELOAD
// =============================================================================

// ReloadSession clears a session's cache and reloads it from the JSONL file.
// This is called after JSONL patching to refresh the in-memory state.
func (fw *FileWatcher) ReloadSession(folder, sessionID string) error {
	fw.mu.RLock()
	rt := fw.runtime
	agentID, ok := fw.folderToAgentID[folder]
	fw.mu.RUnlock()

	if rt == nil {
		return fmt.Errorf("runtime not set")
	}
	if !ok {
		return fmt.Errorf("agent not found for folder: %s", folder)
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
	// Increase buffer for large lines
	scanBuf := make([]byte, 0, 64*1024)
	scanner.Buffer(scanBuf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		msg := fw.parseLine(line)
		if msg != nil {
			messages = append(messages, *msg)
		}
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
	scanner.Buffer(buf, 1024*1024)

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

	// Find last compaction message
	lastCompactionIdx := -1
	for i := len(allMessages) - 1; i >= 0; i-- {
		if allMessages[i].IsCompaction {
			lastCompactionIdx = i
			break
		}
	}

	// Determine which messages to load
	var messagesToLoad []types.Message
	if lastCompactionIdx >= 0 {
		messagesToLoad = allMessages[lastCompactionIdx:]
	} else if len(allMessages) > FallbackMessageCount {
		// No compaction point - use smart fallback that ensures we include user messages
		// Find the last N user messages and include everything from the first one
		startIdx := len(allMessages) - FallbackMessageCount

		// Look for user messages in the portion we'd skip
		// Find index of Nth-from-last user message to include more context
		userMsgCount := 0
		minUserMsgsToInclude := 5 // Ensure at least 5 user messages if available
		for i := len(allMessages) - 1; i >= 0; i-- {
			if allMessages[i].Type == "user" {
				userMsgCount++
				if userMsgCount >= minUserMsgsToInclude && i < startIdx {
					// Found a user message before our fallback window - extend to include it
					startIdx = i
				}
			}
		}

		// Also cap at a reasonable maximum to avoid loading too much
		// This should be less than or equal to runtime.MaxBufferSize (750)
		maxFallbackMessages := 500
		if len(allMessages)-startIdx > maxFallbackMessages {
			startIdx = len(allMessages) - maxFallbackMessages
		}

		messagesToLoad = allMessages[startIdx:]
	} else {
		messagesToLoad = allMessages
	}

	// Debug: count message types
	typeCounts := make(map[string]int)
	for _, msg := range messagesToLoad {
		typeCounts[msg.Type]++
	}
	sessionID := filepath.Base(filePath)
	fmt.Printf("[DEBUG] loadInitialMessages: file=%s lines=%d parsed=%d failures=%d compaction=%d loading=%d (types: %v)\n",
		sessionID, lineCount, len(allMessages), parseFailures, lastCompactionIdx, len(messagesToLoad), typeCounts)

	// Get file position (EOF)
	fileInfo, _ := file.Stat()
	filePos := int64(0)
	if fileInfo != nil {
		filePos = fileInfo.Size()
	}

	return messagesToLoad, filePos
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

	for f := range fw.folderToAgentID {
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
// PATH HELPERS (exported for use by other packages)
// =============================================================================

const (
	// FallbackMessageCount is the number of messages to load if no compaction found
	// The actual buffer limit is defined in runtime.MaxBufferSize (500)
	FallbackMessageCount = 60
)

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
