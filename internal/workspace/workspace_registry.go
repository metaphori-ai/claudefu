package workspace

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// WorkspaceInfo holds the full identity and metadata for a registered workspace.
// All values (system + custom) are stored in the Meta map with ALL_CAPS keys.
// This ensures NAMES consistency — JSON keys match attribute definitions exactly.
type WorkspaceInfo struct {
	ID   string            `json:"id"`
	Meta map[string]string `json:"meta,omitempty"` // ALL_CAPS keys (WORKSPACE_NAME, WORKSPACE_SLUG, etc.)
}

// Helper accessors for common fields
func (w *WorkspaceInfo) GetName() string     { return w.Meta["WORKSPACE_NAME"] }
func (w *WorkspaceInfo) GetSlug() string     { return w.Meta["WORKSPACE_SLUG"] }
func (w *WorkspaceInfo) GetSifuName() string { return w.Meta["WORKSPACE_SIFU_NAME"] }
func (w *WorkspaceInfo) GetSifuSlug() string { return w.Meta["WORKSPACE_SIFU_SLUG"] }

type workspaceRegistryData struct {
	Version    int                      `json:"version"`
	Workspaces map[string]WorkspaceInfo `json:"workspaces"` // workspace ID → info
}

// WorkspaceRegistry provides centralized workspace metadata storage.
// Mirrors the AgentRegistry pattern. Thread-safe via RWMutex.
type WorkspaceRegistry struct {
	mu       sync.RWMutex
	filePath string
	data     workspaceRegistryData
}

// NewWorkspaceRegistry creates a registry backed by workspaces.json in the config directory.
func NewWorkspaceRegistry(configPath string) *WorkspaceRegistry {
	return &WorkspaceRegistry{
		filePath: filepath.Join(configPath, "workspaces.json"),
		data: workspaceRegistryData{
			Version:    1,
			Workspaces: make(map[string]WorkspaceInfo),
		},
	}
}

// Load reads the registry from disk. If the file doesn't exist, starts empty.
func (r *WorkspaceRegistry) Load() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	raw, err := os.ReadFile(r.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("Workspace registry not found at %s, starting fresh", r.filePath)
			return nil
		}
		return fmt.Errorf("failed to read workspace registry: %w", err)
	}

	// Parse into raw structure to handle migration from old camelCase format
	var rawData struct {
		Version    int                                `json:"version"`
		Workspaces map[string]map[string]interface{} `json:"workspaces"`
	}
	if err := json.Unmarshal(raw, &rawData); err != nil {
		return fmt.Errorf("failed to parse workspace registry: %w", err)
	}

	r.data.Version = rawData.Version
	r.data.Workspaces = make(map[string]WorkspaceInfo)

	needsMigration := false
	for wsID, rawInfo := range rawData.Workspaces {
		info := WorkspaceInfo{
			ID: wsID,
		}

		// Check if meta already exists (new format)
		if metaRaw, ok := rawInfo["meta"]; ok && metaRaw != nil {
			if metaMap, ok := metaRaw.(map[string]interface{}); ok {
				info.Meta = make(map[string]string, len(metaMap))
				for k, v := range metaMap {
					if s, ok := v.(string); ok {
						info.Meta[k] = s
					}
				}
			}
		}
		if info.Meta == nil {
			info.Meta = make(map[string]string)
		}

		// Migrate old camelCase fields into meta (if not already in meta)
		migrations := map[string]string{
			"name":     "WORKSPACE_NAME",
			"slug":     "WORKSPACE_SLUG",
			"sifuName": "WORKSPACE_SIFU_NAME",
			"sifuSlug": "WORKSPACE_SIFU_SLUG",
		}
		for oldKey, newKey := range migrations {
			if val, ok := rawInfo[oldKey]; ok && val != nil {
				if s, ok := val.(string); ok && s != "" {
					if info.Meta[newKey] == "" {
						info.Meta[newKey] = s
						needsMigration = true
					}
				}
			}
		}

		// Ensure ID from the "id" field
		if idVal, ok := rawInfo["id"]; ok {
			if s, ok := idVal.(string); ok {
				info.ID = s
			}
		}

		r.data.Workspaces[wsID] = info
	}

	// Persist migrated format
	if needsMigration {
		log.Printf("Workspace registry: migrating camelCase fields to ALL_CAPS meta")
		if err := r.save(); err != nil {
			log.Printf("Warning: failed to persist workspace registry migration: %v", err)
		}
	}

	return nil
}

// GetInfo returns the workspace info for a given ID. Returns nil if not registered.
func (r *WorkspaceRegistry) GetInfo(workspaceID string) *WorkspaceInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if info, ok := r.data.Workspaces[workspaceID]; ok {
		cp := info
		return &cp
	}
	return nil
}

// GetOrCreateInfo returns workspace info for the given ID.
// If the workspace is not yet registered, creates an entry with the given name and derived slug.
func (r *WorkspaceRegistry) GetOrCreateInfo(workspaceID, name string) *WorkspaceInfo {
	r.mu.Lock()
	defer r.mu.Unlock()

	if info, ok := r.data.Workspaces[workspaceID]; ok {
		cp := info
		return &cp
	}

	info := WorkspaceInfo{
		ID: workspaceID,
		Meta: map[string]string{
			"WORKSPACE_NAME": name,
			"WORKSPACE_SLUG": Slugify(name),
		},
	}
	r.data.Workspaces[workspaceID] = info
	if err := r.save(); err != nil {
		log.Printf("Warning: failed to persist workspace registry: %v", err)
	}
	log.Printf("Workspace registry: new entry %s → %s (%s)", workspaceID, name, info.GetSlug())
	cp := info
	return &cp
}

// UpdateMeta replaces the workspace's entire meta map.
// Frontend sends the complete map — all values (system + custom) in ALL_CAPS keys.
func (r *WorkspaceRegistry) UpdateMeta(workspaceID string, meta map[string]string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	info, exists := r.data.Workspaces[workspaceID]
	if !exists {
		return fmt.Errorf("workspace not found in registry: %s", workspaceID)
	}

	info.Meta = meta
	r.data.Workspaces[workspaceID] = info
	return r.save()
}

// SyncName updates the workspace name in the registry. Called on workspace rename.
func (r *WorkspaceRegistry) SyncName(workspaceID, name string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	info, exists := r.data.Workspaces[workspaceID]
	if !exists {
		return
	}
	if info.Meta == nil {
		info.Meta = make(map[string]string)
	}
	if info.Meta["WORKSPACE_NAME"] == name {
		return
	}

	info.Meta["WORKSPACE_NAME"] = name
	r.data.Workspaces[workspaceID] = info
	if err := r.save(); err != nil {
		log.Printf("Warning: failed to sync workspace name to registry: %v", err)
	}
}

// Delete removes a workspace from the registry.
func (r *WorkspaceRegistry) Delete(workspaceID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.data.Workspaces[workspaceID]; !exists {
		return
	}
	delete(r.data.Workspaces, workspaceID)
	if err := r.save(); err != nil {
		log.Printf("Warning: failed to persist workspace registry after delete: %v", err)
	}
}

// GetAll returns a copy of all workspace entries.
func (r *WorkspaceRegistry) GetAll() map[string]WorkspaceInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]WorkspaceInfo, len(r.data.Workspaces))
	for k, v := range r.data.Workspaces {
		result[k] = v
	}
	return result
}

// PopulateFromWorkspaceFiles scans existing workspace JSON files and registers any
// that aren't already in the registry. Called on startup for migration.
func (r *WorkspaceRegistry) PopulateFromWorkspaceFiles(workspacesDir string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	entries, err := os.ReadDir(workspacesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	changed := false
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		wsID := strings.TrimSuffix(entry.Name(), ".json")
		if _, exists := r.data.Workspaces[wsID]; exists {
			continue // Already registered
		}

		// Read workspace file to get name
		data, err := os.ReadFile(filepath.Join(workspacesDir, entry.Name()))
		if err != nil {
			continue
		}

		var ws struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(data, &ws); err != nil {
			continue
		}

		name := ws.Name
		if name == "" {
			name = wsID
		}

		r.data.Workspaces[wsID] = WorkspaceInfo{
			ID: wsID,
			Meta: map[string]string{
				"WORKSPACE_NAME": name,
				"WORKSPACE_SLUG": Slugify(name),
			},
		}
		changed = true
		log.Printf("Workspace registry: migrated %s → %s", wsID, name)
	}

	if changed {
		return r.save()
	}
	return nil
}

// save persists the registry to disk with sorted keys for deterministic output.
func (r *WorkspaceRegistry) save() error {
	data, err := r.marshalSorted()
	if err != nil {
		return err
	}
	return os.WriteFile(r.filePath, data, 0644)
}

// marshalSorted produces deterministic JSON with workspace IDs sorted alphabetically.
func (r *WorkspaceRegistry) marshalSorted() ([]byte, error) {
	ids := make([]string, 0, len(r.data.Workspaces))
	for id := range r.data.Workspaces {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	// Build sorted JSON manually for readable output
	var buf strings.Builder
	buf.WriteString("{\n  \"version\": ")
	buf.WriteString(fmt.Sprintf("%d", r.data.Version))
	buf.WriteString(",\n  \"workspaces\": {")

	for i, id := range ids {
		info := r.data.Workspaces[id]
		infoJSON, err := json.MarshalIndent(info, "    ", "  ")
		if err != nil {
			return nil, err
		}
		if i > 0 {
			buf.WriteString(",")
		}
		buf.WriteString("\n    ")
		idJSON, _ := json.Marshal(id)
		buf.Write(idJSON)
		buf.WriteString(": ")
		buf.Write(infoJSON)
	}

	if len(ids) > 0 {
		buf.WriteString("\n  ")
	}
	buf.WriteString("}\n}")
	return []byte(buf.String()), nil
}
