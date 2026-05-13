package settings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const SessionNamesFile = "session-names.json"
const SessionViewsFile = "session-views.json"

// SessionNames maps folder paths to session ID -> name mappings
// Example: {"/Users/foo/project": {"session-123": "Fix auth bug"}}
type SessionNames map[string]map[string]string

// SessionViews maps folder paths to session ID -> last viewed timestamp (Unix ms)
// Example: {"/Users/foo/project": {"session-123": 1704067200000}}
type SessionViews map[string]map[string]int64

// SessionManager handles session naming and view state operations
type SessionManager struct {
	configPath string
	names      SessionNames
	views      SessionViews
	mu         sync.RWMutex

	// lastLoadMtime is the on-disk mtime of session-names.json at the last
	// successful load/save. reloadIfChanged() uses this to detect external
	// modifications (e.g., Syncthing pushing an update from another machine)
	// and refresh the in-memory map without restarting the app.
	lastLoadMtime time.Time
}

// NewSessionManager creates a new session manager.
// Session names stay in root (synced config), session views go to local/ (per-machine state).
func NewSessionManager(configPath string) (*SessionManager, error) {
	sm := &SessionManager{
		configPath: configPath,
		names:      make(SessionNames),
		views:      make(SessionViews),
	}

	// Migrate session-views.json from root to local/ (one-time)
	sm.migrateViewsToLocal()

	// Load existing session names (from root — synced config) and views (from local/)
	_ = sm.load()
	_ = sm.loadViews()

	return sm, nil
}

// GetSessionName returns the custom name for a session, or empty string if not set.
// Reloads from disk first if session-names.json was modified externally (e.g., by
// Syncthing pushing an update from another machine).
func (sm *SessionManager) GetSessionName(folder, sessionId string) string {
	sm.reloadIfChanged()

	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if folderNames, ok := sm.names[folder]; ok {
		return folderNames[sessionId]
	}
	return ""
}

// SetSessionName sets a custom name for a session
func (sm *SessionManager) SetSessionName(folder, sessionId, name string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Initialize folder map if needed
	if sm.names[folder] == nil {
		sm.names[folder] = make(map[string]string)
	}

	if name == "" {
		// Remove the name if empty
		delete(sm.names[folder], sessionId)
		// Clean up empty folder entries
		if len(sm.names[folder]) == 0 {
			delete(sm.names, folder)
		}
	} else {
		sm.names[folder][sessionId] = name
	}

	return sm.save()
}

// GetAllSessionNames returns all session names for a folder.
// Reloads from disk first if session-names.json was modified externally (e.g.,
// by Syncthing pushing an update from another machine).
func (sm *SessionManager) GetAllSessionNames(folder string) map[string]string {
	sm.reloadIfChanged()

	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if folderNames, ok := sm.names[folder]; ok {
		// Return a copy to avoid race conditions
		result := make(map[string]string)
		for k, v := range folderNames {
			result[k] = v
		}
		return result
	}
	return make(map[string]string)
}

// load reads session names from disk. Records mtime after successful read
// so reloadIfChanged() can detect external modifications.
func (sm *SessionManager) load() error {
	path := filepath.Join(sm.configPath, SessionNamesFile)

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // File doesn't exist, use defaults
		}
		return err
	}

	if err := json.Unmarshal(data, &sm.names); err != nil {
		return err
	}

	// Record mtime so reloadIfChanged() only re-reads when the file
	// is modified externally (e.g., by Syncthing).
	if stat, err := os.Stat(path); err == nil {
		sm.lastLoadMtime = stat.ModTime()
	}
	return nil
}

// save writes session names to disk. Updates lastLoadMtime to the post-write
// mtime so our own write doesn't make reloadIfChanged() think the file
// changed externally.
func (sm *SessionManager) save() error {
	path := filepath.Join(sm.configPath, SessionNamesFile)

	jsonData, err := json.MarshalIndent(sm.names, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(path, jsonData, 0644); err != nil {
		return err
	}

	// Sync our cached mtime with the on-disk file after our own write.
	if stat, err := os.Stat(path); err == nil {
		sm.lastLoadMtime = stat.ModTime()
	}
	return nil
}

// reloadIfChanged reloads session-names.json from disk if its on-disk mtime
// has advanced since the last load/save. This catches Syncthing-propagated
// updates from other machines without requiring an app restart. Caller must
// NOT hold sm.mu — this method acquires the write lock when reloading.
func (sm *SessionManager) reloadIfChanged() {
	path := filepath.Join(sm.configPath, SessionNamesFile)
	stat, err := os.Stat(path)
	if err != nil {
		return // File missing or unreadable — nothing to do
	}

	// Cheap mtime comparison under the read lock first; only take the write
	// lock if we actually need to reload.
	sm.mu.RLock()
	unchanged := !stat.ModTime().After(sm.lastLoadMtime)
	sm.mu.RUnlock()
	if unchanged {
		return
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()
	// Re-check under the write lock in case a concurrent caller already reloaded.
	if !stat.ModTime().After(sm.lastLoadMtime) {
		return
	}
	// Re-read from disk. Reuse load() but call its body inline since we
	// already hold the write lock (load() doesn't lock — its callers do).
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var fresh SessionNames
	if err := json.Unmarshal(data, &fresh); err != nil {
		return // Leave existing in-memory map intact on parse error
	}
	sm.names = fresh
	sm.lastLoadMtime = stat.ModTime()
}

// ============================================================================
// SESSION VIEW STATE METHODS
// ============================================================================

// GetLastViewed returns the last viewed timestamp (Unix ms) for a session, or 0 if never viewed
func (sm *SessionManager) GetLastViewed(folder, sessionId string) int64 {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if folderViews, ok := sm.views[folder]; ok {
		return folderViews[sessionId]
	}
	return 0
}

// SetLastViewed sets the last viewed timestamp for a session to now
func (sm *SessionManager) SetLastViewed(folder, sessionId string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Initialize folder map if needed
	if sm.views[folder] == nil {
		sm.views[folder] = make(map[string]int64)
	}

	sm.views[folder][sessionId] = time.Now().UnixMilli()

	return sm.saveViews()
}

// GetAllLastViewed returns all last viewed timestamps for a folder
func (sm *SessionManager) GetAllLastViewed(folder string) map[string]int64 {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	if folderViews, ok := sm.views[folder]; ok {
		// Return a copy to avoid race conditions
		result := make(map[string]int64)
		for k, v := range folderViews {
			result[k] = v
		}
		return result
	}
	return make(map[string]int64)
}

// viewsPath returns the path for session-views.json in local/ (per-machine state)
func (sm *SessionManager) viewsPath() string {
	return filepath.Join(sm.configPath, "local", SessionViewsFile)
}

// migrateViewsToLocal moves session-views.json from root to local/ (one-time).
func (sm *SessionManager) migrateViewsToLocal() {
	oldPath := filepath.Join(sm.configPath, SessionViewsFile)
	newPath := sm.viewsPath()

	// Only migrate if old exists and new doesn't
	if _, err := os.Stat(oldPath); err != nil {
		return // Old doesn't exist
	}
	if _, err := os.Stat(newPath); err == nil {
		return // New already exists
	}

	// Ensure local/ directory exists
	os.MkdirAll(filepath.Join(sm.configPath, "local"), 0755)

	if err := os.Rename(oldPath, newPath); err != nil {
		fmt.Printf("[WARN] Failed to migrate session-views.json to local/: %v\n", err)
	} else {
		fmt.Printf("[INFO] Migrated session-views.json to local/session-views.json\n")
	}
}

// loadViews reads session view states from local/ (per-machine state)
func (sm *SessionManager) loadViews() error {
	data, err := os.ReadFile(sm.viewsPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil // File doesn't exist, use defaults
		}
		return err
	}

	return json.Unmarshal(data, &sm.views)
}

// saveViews writes session view states to local/ (per-machine state)
func (sm *SessionManager) saveViews() error {
	jsonData, err := json.MarshalIndent(sm.views, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(sm.viewsPath(), jsonData, 0644)
}
