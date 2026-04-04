package mcpserver

// Cross-workspace message spool manager.
//
// Architecture: cross-workspace messages use append-only JSON files instead
// of direct SQLite writes. This avoids Syncthing conflicts on binary SQLite
// files when two machines write to inbox DBs at the same path.
//
// Layout:
//   ~/.claudefu/inbox/spool/{recipient-agent-id}/{timestamp}-{sender}-{uuid}.json
//
// Flow:
//   1. Sender: WriteMessage() drops JSON file in recipient's spool dir
//   2. Syncthing: replicates the file to the recipient machine (no conflict -- unique name)
//   3. Receiver: fsnotify watcher detects new file, imports into local SQLite, deletes file
//   4. Syncthing: propagates deletion back to sender

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"claudefu/internal/types"
	"claudefu/internal/workspace"

	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
)

// SpoolManager writes outbound cross-workspace messages to disk and watches
// for inbound spool files created by Syncthing from other machines.
//
// IMPORTANT: Only machines that "own" a recipient agent (i.e., have it in the
// current workspace) import its spool files. All other machines — including
// the sender — leave files alone so Syncthing can deliver them to the correct
// machine. Without this check, the sender's own fsnotify watcher would race
// Syncthing and import+delete its own writes before replication completes.
type SpoolManager struct {
	configPath      string // e.g. ~/.claudefu/inbox/spool
	inbox           *InboxManager
	emitFunc        func(types.EventEnvelope)
	workspaceGetter func() *workspace.Workspace // Used to check agent ownership

	watcher *fsnotify.Watcher
	ctx     context.Context
	cancel  context.CancelFunc

	// This machine's hostname, sanitized for filenames. Stamped into every
	// outbound spool filename so receivers can identify the source and the
	// sender can recognize (and skip) its own writes without a race-prone
	// in-memory tracking map.
	hostname string

	// Debounce timers keyed by file path. Syncthing may write in chunks,
	// so we wait briefly after the last write event before importing.
	pending map[string]*time.Timer
	mu      sync.Mutex

	running bool
}

// NewSpoolManager creates a spool manager backed by the given directory.
// The hostname is captured at construction and stamped into every outbound
// spool filename.
func NewSpoolManager(configPath string, inbox *InboxManager, emitFunc func(types.EventEnvelope)) *SpoolManager {
	hostname := "unknown"
	if h, err := os.Hostname(); err == nil && h != "" {
		hostname = sanitizeForFilename(h)
	}
	if hostname == "" {
		hostname = "unknown"
	}
	return &SpoolManager{
		configPath: configPath,
		inbox:      inbox,
		emitFunc:   emitFunc,
		hostname:   hostname,
		pending:    make(map[string]*time.Timer),
	}
}

// SetWorkspaceGetter configures how the manager determines which agents are
// "local" (owned by this machine). An agent is local iff it exists in the
// current workspace; only local agents' spool files are imported.
func (sm *SpoolManager) SetWorkspaceGetter(getter func() *workspace.Workspace) {
	sm.workspaceGetter = getter
}

// isLocalAgent returns true if the given agent ID is in the current workspace.
// Only local agents have their spool files imported and deleted; all others
// are left in place for Syncthing to deliver to the machine that owns them.
func (sm *SpoolManager) isLocalAgent(agentID string) bool {
	if sm.workspaceGetter == nil {
		return false // Safe default: don't import if ownership is unknown
	}
	ws := sm.workspaceGetter()
	if ws == nil {
		return false
	}
	for _, agent := range ws.Agents {
		if agent.ID == agentID {
			return true
		}
	}
	return false
}

// WriteMessage writes a spool file for the target agent. The caller need not
// know anything about the recipient machine — the file will replicate via
// Syncthing and be ingested by the receiver's SpoolManager.
func (sm *SpoolManager) WriteMessage(toAgentID string, msg InboxMessage) error {
	dir := filepath.Join(sm.configPath, toAgentID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create spool dir: %w", err)
	}

	// Filename: {timestamp}--{hostname}--{sender-slug}--{uuid}.json
	// - timestamp: natural ordering
	// - hostname:  identifies the sending machine (sender can skip its own)
	// - sender:    the sending agent's slug (from_agent)
	// - uuid:      collision-resistant short id
	// Double dashes separate fields so we can parse reliably even if a
	// sanitized slug/hostname contains a single dash.
	sender := sanitizeForFilename(msg.FromAgentName)
	if sender == "" {
		sender = "unknown"
	}
	filename := fmt.Sprintf("%s--%s--%s--%s.json",
		msg.Timestamp.UTC().Format("20060102T150405.000000000"),
		sm.hostname,
		sender,
		uuid.New().String()[:8],
	)
	path := filepath.Join(dir, filename)

	// Write via atomic rename so readers never see partial files
	tmp := path + ".tmp"
	raw, err := json.MarshalIndent(msg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal spool message: %w", err)
	}
	if err := os.WriteFile(tmp, raw, 0644); err != nil {
		return fmt.Errorf("write spool tmp: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename spool: %w", err)
	}

	fmt.Printf("[MCP:Spool] Wrote spool file for agent %s: %s\n", toAgentID[:8], filename)
	return nil
}

// isOwnWrite returns true if the filename indicates it was written by this
// machine (hostname matches). Deterministic — no race windows, no timers.
// Works across process restarts too.
func (sm *SpoolManager) isOwnWrite(path string) bool {
	// Filename format: {timestamp}--{hostname}--{sender}--{uuid}.json
	base := filepath.Base(path)
	parts := strings.Split(strings.TrimSuffix(base, ".json"), "--")
	if len(parts) < 4 {
		return false // Unknown format — treat as foreign, safer
	}
	return parts[1] == sm.hostname
}

// Start begins watching the spool directory for incoming messages and does
// a one-time scan to import any files that arrived while ClaudeFu was stopped.
func (sm *SpoolManager) Start(ctx context.Context) error {
	sm.mu.Lock()
	if sm.running {
		sm.mu.Unlock()
		return nil
	}
	sm.running = true
	sm.mu.Unlock()

	// Ensure base spool dir exists
	if err := os.MkdirAll(sm.configPath, 0755); err != nil {
		return fmt.Errorf("create spool base dir: %w", err)
	}

	sm.ctx, sm.cancel = context.WithCancel(ctx)

	// Create fsnotify watcher
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create fsnotify watcher: %w", err)
	}
	sm.watcher = w

	// Watch the base spool dir. We'll add per-recipient subdirs as they appear.
	if err := sm.watcher.Add(sm.configPath); err != nil {
		return fmt.Errorf("watch spool base dir: %w", err)
	}

	// Walk existing recipient subdirs and watch each
	entries, err := os.ReadDir(sm.configPath)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				subdir := filepath.Join(sm.configPath, entry.Name())
				if err := sm.watcher.Add(subdir); err != nil {
					fmt.Printf("[MCP:Spool] Warning: watch subdir %s: %v\n", subdir, err)
				}
			}
		}
	}

	// Event loop
	go sm.runLoop()

	// One-time scan for any pending files (Syncthing may have delivered
	// while ClaudeFu was stopped)
	imported := sm.ScanAndImport()
	if imported > 0 {
		fmt.Printf("[MCP:Spool] Startup scan imported %d pending messages\n", imported)
	}

	return nil
}

// Stop shuts down the watcher and pending timers.
func (sm *SpoolManager) Stop() {
	sm.mu.Lock()
	if !sm.running {
		sm.mu.Unlock()
		return
	}
	sm.running = false

	for _, t := range sm.pending {
		t.Stop()
	}
	sm.pending = make(map[string]*time.Timer)
	sm.mu.Unlock()

	if sm.cancel != nil {
		sm.cancel()
	}
	if sm.watcher != nil {
		sm.watcher.Close()
	}
}

// runLoop processes fsnotify events until the context is cancelled.
func (sm *SpoolManager) runLoop() {
	for {
		select {
		case <-sm.ctx.Done():
			return

		case event, ok := <-sm.watcher.Events:
			if !ok {
				return
			}
			sm.handleEvent(event)

		case err, ok := <-sm.watcher.Errors:
			if !ok {
				return
			}
			fmt.Printf("[MCP:Spool] Watcher error: %v\n", err)
		}
	}
}

// handleEvent dispatches a single fsnotify event.
func (sm *SpoolManager) handleEvent(event fsnotify.Event) {
	// New directory: watch it (for new recipient subdirs)
	if event.Op&fsnotify.Create != 0 {
		if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
			if err := sm.watcher.Add(event.Name); err != nil {
				fmt.Printf("[MCP:Spool] Warning: watch new subdir %s: %v\n", event.Name, err)
			}
			// Also scan it immediately in case files arrived with the dir
			sm.scanAndImportDir(event.Name)
			return
		}
	}

	// JSON file created/written: debounce, then import
	if strings.HasSuffix(event.Name, ".json") {
		if event.Op&(fsnotify.Create|fsnotify.Write) != 0 {
			sm.debounceImport(event.Name)
		}
	}
}

// debounceImport waits briefly after the last write before importing, so we
// don't race with Syncthing writing the file in chunks.
func (sm *SpoolManager) debounceImport(path string) {
	// Skip files written by this machine — they're for other machines to consume
	if sm.isOwnWrite(path) {
		return
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	// If a timer already exists, let it run (don't reset — keeps throughput up)
	if _, exists := sm.pending[path]; exists {
		return
	}
	sm.pending[path] = time.AfterFunc(500*time.Millisecond, func() {
		sm.mu.Lock()
		delete(sm.pending, path)
		sm.mu.Unlock()
		sm.importFile(path)
	})
}

// ScanAndImport walks the entire spool directory and imports all pending files.
// Returns the count of imported messages.
func (sm *SpoolManager) ScanAndImport() int {
	count := 0
	entries, err := os.ReadDir(sm.configPath)
	if err != nil {
		return 0
	}
	for _, entry := range entries {
		if entry.IsDir() {
			subdir := filepath.Join(sm.configPath, entry.Name())
			count += sm.scanAndImportDir(subdir)
		}
	}
	return count
}

// scanAndImportDir imports all JSON files in a single recipient subdir.
func (sm *SpoolManager) scanAndImportDir(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		// Skip our own writes even during startup scans — we may have
		// crashed mid-send before Syncthing replicated, and we don't want
		// to self-import on restart.
		if sm.isOwnWrite(path) {
			continue
		}
		if sm.importFile(path) {
			count++
		}
	}
	return count
}

// importFile reads a spool JSON file, inserts into SQLite, emits mcp:inbox,
// and deletes the file. Returns true on successful import.
//
// Ownership check: the recipient agent ID is encoded in the parent directory
// name (spool/{agentID}/file.json). If the agent is not in our current
// workspace, we skip this file entirely — leaving it for Syncthing to deliver
// to the machine that owns the agent. This prevents the sender from racing
// Syncthing to import+delete its own writes.
func (sm *SpoolManager) importFile(path string) bool {
	agentID := filepath.Base(filepath.Dir(path))
	if !sm.isLocalAgent(agentID) {
		// Not our agent — leave for Syncthing to deliver to the owning machine
		return false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		// File may have been moved by another process — not an error
		return false
	}

	var msg InboxMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		fmt.Printf("[MCP:Spool] Corrupt spool file %s: %v — deleting\n", path, err)
		_ = os.Remove(path)
		return false
	}

	if msg.ToAgentID == "" || msg.Message == "" {
		fmt.Printf("[MCP:Spool] Invalid spool file %s (missing fields) — deleting\n", path)
		_ = os.Remove(path)
		return false
	}

	// Insert into local SQLite via the inbox manager. AddMessageRaw preserves
	// the original ID so duplicate imports are idempotent (SQLite PRIMARY KEY).
	if err := sm.inbox.AddMessageRaw(msg); err != nil {
		fmt.Printf("[MCP:Spool] Failed to insert spool message from %s: %v\n", path, err)
		// Leave file in place so a retry can pick it up
		return false
	}

	// Emit mcp:inbox event so UI refreshes
	if sm.emitFunc != nil {
		total := sm.inbox.GetTotalCount(msg.ToAgentID)
		unread := sm.inbox.GetUnreadCount(msg.ToAgentID)
		sm.emitFunc(types.EventEnvelope{
			AgentID:   msg.ToAgentID,
			EventType: "mcp:inbox",
			Payload: map[string]any{
				"agentId": msg.ToAgentID,
				"total":   total,
				"unread":  unread,
			},
		})
	}

	// Remove the spool file — Syncthing will propagate the deletion
	if err := os.Remove(path); err != nil {
		fmt.Printf("[MCP:Spool] Warning: failed to remove imported spool file %s: %v\n", path, err)
	}

	fmt.Printf("[MCP:Spool] Imported message from %q for agent %s\n", msg.FromAgentName, msg.ToAgentID[:8])
	return true
}

// sanitizeForFilename strips characters that don't belong in filenames.
func sanitizeForFilename(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			sb.WriteRune(r)
		}
	}
	return sb.String()
}
