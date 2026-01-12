// Package watcher provides file system watching for Claude Code session files.
// This file handles subagent (Task tool) watching within sessions.
package watcher

import (
	"bufio"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"claudefu/internal/runtime"
	"claudefu/internal/types"
)

// =============================================================================
// SUBAGENT WATCHER - Monitors Task Agent Executions
// =============================================================================

// SubagentWatcher watches for subagent JSONL files within a session.
// Subagent files are stored in: {session_id}/subagents/agent-{short_id}.jsonl
type SubagentWatcher struct {
	watcher     *fsnotify.Watcher
	runtime     *runtime.WorkspaceRuntime
	agentID     string
	sessionID   string
	folder      string
	subagents   map[string]*subagentState // short_id -> state
	watchedDir  string
	mu          sync.RWMutex
	stopCh      chan struct{}
}

// subagentState tracks internal state for a watched subagent.
type subagentState struct {
	ID           string
	FilePath     string
	FilePosition int64
}

// NewSubagentWatcher creates a new watcher for subagents within a session.
func NewSubagentWatcher(rt *runtime.WorkspaceRuntime, agentID, sessionID, folder string) (*SubagentWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	sw := &SubagentWatcher{
		watcher:   w,
		runtime:   rt,
		agentID:   agentID,
		sessionID: sessionID,
		folder:    folder,
		subagents: make(map[string]*subagentState),
		stopCh:    make(chan struct{}),
	}

	return sw, nil
}

// Start begins watching for subagents in the session.
func (sw *SubagentWatcher) Start() error {
	// Build path to subagents directory
	sessionsDir := GetSessionsDir(sw.folder)
	subagentsDir := filepath.Join(sessionsDir, sw.sessionID, "subagents")

	// Create directory if it doesn't exist (Claude will create it)
	if _, err := os.Stat(subagentsDir); os.IsNotExist(err) {
		// Directory doesn't exist yet - that's OK
		// We'll create a watch on the session directory to detect when subagents dir is created
		sessionDir := filepath.Join(sessionsDir, sw.sessionID)
		if _, err := os.Stat(sessionDir); os.IsNotExist(err) {
			// Even session dir doesn't exist - nothing to watch yet
			return nil
		}
		if err := sw.watcher.Add(sessionDir); err != nil {
			return err
		}
	} else {
		// Subagents directory exists - watch it
		sw.watchedDir = subagentsDir
		if err := sw.watcher.Add(subagentsDir); err != nil {
			return err
		}

		// Discover existing subagent files
		if err := sw.discoverExisting(subagentsDir); err != nil {
			return err
		}
	}

	go sw.run()
	return nil
}

// Stop stops watching for subagents.
func (sw *SubagentWatcher) Stop() {
	close(sw.stopCh)
	sw.watcher.Close()
}

// run processes file system events.
func (sw *SubagentWatcher) run() {
	for {
		select {
		case <-sw.stopCh:
			return
		case event, ok := <-sw.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Create) {
				sw.handleCreate(event.Name)
			} else if event.Has(fsnotify.Write) {
				sw.handleWrite(event.Name)
			}
		case _, ok := <-sw.watcher.Errors:
			if !ok {
				return
			}
			// Log error but continue
		}
	}
}

// handleCreate handles new file/directory creation.
func (sw *SubagentWatcher) handleCreate(path string) {
	// Check if this is the subagents directory being created
	if filepath.Base(path) == "subagents" {
		sw.mu.Lock()
		sw.watchedDir = path
		sw.mu.Unlock()
		sw.watcher.Add(path)
		return
	}

	// Check if this is a new subagent file
	if !strings.HasSuffix(path, ".jsonl") {
		return
	}

	// Parse subagent ID from filename (agent-{short_id}.jsonl)
	base := filepath.Base(path)
	if !strings.HasPrefix(base, "agent-") {
		return
	}
	shortID := strings.TrimSuffix(strings.TrimPrefix(base, "agent-"), ".jsonl")

	sw.mu.Lock()
	if _, exists := sw.subagents[shortID]; exists {
		sw.mu.Unlock()
		return
	}

	state := &subagentState{
		ID:           shortID,
		FilePath:     path,
		FilePosition: 0,
	}
	sw.subagents[shortID] = state
	sw.mu.Unlock()

	// Watch the file
	sw.watcher.Add(path)

	// Emit subagent:started event
	if sw.runtime != nil {
		sw.runtime.Emit("subagent:started", sw.agentID, sw.sessionID, map[string]any{
			"subagentId": shortID,
			"subagent": types.SubagentState{
				ID:        shortID,
				SessionID: sw.sessionID,
				AgentID:   sw.agentID,
				Status:    types.SubagentStatusRunning,
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			},
		})
	}
}

// handleWrite handles file modification.
func (sw *SubagentWatcher) handleWrite(path string) {
	if !strings.HasSuffix(path, ".jsonl") {
		return
	}

	base := filepath.Base(path)
	if !strings.HasPrefix(base, "agent-") {
		return
	}
	shortID := strings.TrimSuffix(strings.TrimPrefix(base, "agent-"), ".jsonl")

	sw.mu.RLock()
	state, exists := sw.subagents[shortID]
	sw.mu.RUnlock()

	if !exists {
		// Handle as create first
		sw.handleCreate(path)
		sw.mu.RLock()
		state = sw.subagents[shortID]
		sw.mu.RUnlock()
		if state == nil {
			return
		}
	}

	// Read new messages
	messages := sw.readNewMessages(path, state.FilePosition)
	if len(messages) == 0 {
		return
	}

	// Update file position
	if info, err := os.Stat(path); err == nil {
		sw.mu.Lock()
		state.FilePosition = info.Size()
		sw.mu.Unlock()
	}

	// Emit subagent:messages event
	if sw.runtime != nil {
		sw.runtime.Emit("subagent:messages", sw.agentID, sw.sessionID, map[string]any{
			"subagentId": shortID,
			"messages":   messages,
		})
	}

	// Check for completion (result:success event in the stream)
	if slices.ContainsFunc(messages, isSubagentComplete) {
		sw.runtime.Emit("subagent:completed", sw.agentID, sw.sessionID, map[string]any{
			"subagentId": shortID,
			"status":     types.SubagentStatusCompleted,
		})
	}
}

// discoverExisting finds and loads existing subagent files.
func (sw *SubagentWatcher) discoverExisting(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		if !strings.HasPrefix(entry.Name(), "agent-") {
			continue
		}

		shortID := strings.TrimSuffix(strings.TrimPrefix(entry.Name(), "agent-"), ".jsonl")
		filePath := filepath.Join(dir, entry.Name())

		// Get file size for position
		info, err := entry.Info()
		if err != nil {
			continue
		}

		sw.mu.Lock()
		sw.subagents[shortID] = &subagentState{
			ID:           shortID,
			FilePath:     filePath,
			FilePosition: info.Size(), // Start from end (already loaded)
		}
		sw.mu.Unlock()

		// Watch the file
		sw.watcher.Add(filePath)
	}

	return nil
}

// readNewMessages reads new messages from a subagent file.
func (sw *SubagentWatcher) readNewMessages(path string, startPos int64) []types.Message {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()

	_, err = file.Seek(startPos, 0)
	if err != nil {
		return nil
	}

	var messages []types.Message
	scanner := bufio.NewScanner(file)
	scanBuf := make([]byte, 0, 64*1024)
	scanner.Buffer(scanBuf, 1024*1024)

	// Create a temporary FileWatcher to reuse parseLine
	fw := &FileWatcher{}

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		if msg := fw.parseLine(line); msg != nil {
			messages = append(messages, *msg)
		}
	}

	return messages
}

// isSubagentComplete checks if a message indicates subagent completion.
// In streaming mode, this would be a result:success event.
// In JSONL, we look for patterns indicating the Task tool completed.
func isSubagentComplete(msg types.Message) bool {
	// Check for assistant message with no more tool use (completed response)
	if msg.Type == "assistant" {
		hasToolUse := false
		for _, block := range msg.ContentBlocks {
			if block.Type == "tool_use" {
				hasToolUse = true
				break
			}
		}
		// If there's text but no tool_use, might be final response
		if !hasToolUse && msg.Content != "" {
			return true
		}
	}
	return false
}

// GetSubagentIDs returns all discovered subagent IDs.
func (sw *SubagentWatcher) GetSubagentIDs() []string {
	sw.mu.RLock()
	defer sw.mu.RUnlock()

	ids := make([]string, 0, len(sw.subagents))
	for id := range sw.subagents {
		ids = append(ids, id)
	}
	return ids
}
