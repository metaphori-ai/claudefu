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
type WorkspaceInfo struct {
	ID       string            `json:"id"`
	Name     string            `json:"name,omitempty"`
	Slug     string            `json:"slug,omitempty"`
	SifuName string            `json:"sifuName,omitempty"`
	SifuSlug string            `json:"sifuSlug,omitempty"`
	Meta     map[string]string `json:"meta,omitempty"` // Custom attribute values (ALL_CAPS keys)
}

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

	if err := json.Unmarshal(raw, &r.data); err != nil {
		return fmt.Errorf("failed to parse workspace registry: %w", err)
	}

	if r.data.Workspaces == nil {
		r.data.Workspaces = make(map[string]WorkspaceInfo)
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
		ID:   workspaceID,
		Name: name,
		Slug: Slugify(name),
	}
	r.data.Workspaces[workspaceID] = info
	if err := r.save(); err != nil {
		log.Printf("Warning: failed to persist workspace registry: %v", err)
	}
	log.Printf("Workspace registry: new entry %s → %s (%s)", workspaceID, name, info.Slug)
	cp := info
	return &cp
}

// UpdateMeta updates workspace metadata. Only non-empty string fields and non-nil meta are applied.
// The Meta map is replaced entirely (not merged) when non-nil — frontend sends the full map.
func (r *WorkspaceRegistry) UpdateMeta(workspaceID string, update WorkspaceInfo) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	info, exists := r.data.Workspaces[workspaceID]
	if !exists {
		return fmt.Errorf("workspace not found in registry: %s", workspaceID)
	}

	changed := false

	if update.Name != "" && info.Name != update.Name {
		info.Name = update.Name
		changed = true
	}
	if update.Slug != "" && info.Slug != update.Slug {
		info.Slug = update.Slug
		changed = true
	}
	if update.SifuName != "" && info.SifuName != update.SifuName {
		info.SifuName = update.SifuName
		changed = true
	}
	if update.SifuSlug != "" && info.SifuSlug != update.SifuSlug {
		info.SifuSlug = update.SifuSlug
		changed = true
	}
	// Meta map: replace entirely when provided (allows clearing values)
	if update.Meta != nil {
		info.Meta = update.Meta
		changed = true
	}

	if changed {
		r.data.Workspaces[workspaceID] = info
		return r.save()
	}
	return nil
}

// SyncName updates the workspace name in the registry. Called on workspace rename.
func (r *WorkspaceRegistry) SyncName(workspaceID, name string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	info, exists := r.data.Workspaces[workspaceID]
	if !exists {
		return
	}
	if info.Name == name {
		return
	}

	info.Name = name
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
			ID:   wsID,
			Name: name,
			Slug: Slugify(name),
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
