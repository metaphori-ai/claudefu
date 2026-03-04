package workspace

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/google/uuid"
)

// AgentRegistry maintains a global folder→agent info mapping so that the same
// project folder always gets the same agent ID, regardless of which
// workspace it appears in.
//
// v2 also stores slug and name for cross-workspace agent resolution.
//
// Persisted at: ~/.claudefu/agents.json
type AgentRegistry struct {
	mu       sync.RWMutex
	filePath string
	data     registryData
}

// AgentInfo holds the full identity for a registered agent.
type AgentInfo struct {
	ID   string `json:"id"`
	Slug string `json:"slug,omitempty"` // MCP slug (e.g., "claudefu-main")
	Name string `json:"name,omitempty"` // Display name (e.g., "ClaudeFu Main")
}

type registryData struct {
	Version int                  `json:"version"`
	Agents  map[string]AgentInfo `json:"agents"` // folder path → agent info
}

// registryDataV1 is the legacy format for v1→v2 migration
type registryDataV1 struct {
	Version int               `json:"version"`
	Agents  map[string]string `json:"agents"` // folder path → UUID string
}

// NewAgentRegistry creates a registry backed by the given file path.
func NewAgentRegistry(configPath string) *AgentRegistry {
	return &AgentRegistry{
		filePath: filepath.Join(configPath, "agents.json"),
		data: registryData{
			Version: 2,
			Agents:  make(map[string]AgentInfo),
		},
	}
}

// Load reads the registry from disk. If the file doesn't exist, starts empty.
// Automatically migrates v1 format (folder→UUID string) to v2 (folder→AgentInfo).
func (r *AgentRegistry) Load() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	raw, err := os.ReadFile(r.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("Agent registry not found at %s, starting fresh", r.filePath)
			return nil
		}
		return err
	}

	// Peek at version to determine format
	var versionCheck struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &versionCheck); err != nil {
		log.Printf("Warning: corrupt agent registry at %s, starting fresh: %v", r.filePath, err)
		return nil
	}

	if versionCheck.Version < 2 {
		// v1 migration: folder → UUID string → folder → AgentInfo{ID: uuid}
		var v1 registryDataV1
		if err := json.Unmarshal(raw, &v1); err != nil {
			log.Printf("Warning: corrupt v1 agent registry at %s, starting fresh: %v", r.filePath, err)
			return nil
		}

		r.data = registryData{
			Version: 2,
			Agents:  make(map[string]AgentInfo, len(v1.Agents)),
		}
		for folder, id := range v1.Agents {
			r.data.Agents[folder] = AgentInfo{ID: id}
		}

		// Persist the migrated format
		if err := r.save(); err != nil {
			log.Printf("Warning: failed to persist v1→v2 registry migration: %v", err)
		}
		log.Printf("Agent registry migrated v1→v2: %d entries", len(r.data.Agents))
		return nil
	}

	// v2 format
	var d registryData
	if err := json.Unmarshal(raw, &d); err != nil {
		log.Printf("Warning: corrupt agent registry at %s, starting fresh: %v", r.filePath, err)
		return nil
	}

	if d.Agents == nil {
		d.Agents = make(map[string]AgentInfo)
	}
	r.data = d
	log.Printf("Agent registry loaded: %d entries", len(r.data.Agents))
	return nil
}

// Save writes the current registry to disk (public, acquires lock).
func (r *AgentRegistry) Save() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.save()
}

// save writes the current registry to disk (internal, caller must hold lock).
func (r *AgentRegistry) save() error {
	raw, err := json.MarshalIndent(r.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(r.filePath, raw, 0644)
}

// GetOrCreateID returns the stable UUID for a folder. If the folder has
// never been seen, a new UUID is generated, persisted, and returned.
func (r *AgentRegistry) GetOrCreateID(folder string) string {
	r.mu.Lock()
	defer r.mu.Unlock()

	if info, ok := r.data.Agents[folder]; ok {
		return info.ID
	}

	id := uuid.New().String()
	r.data.Agents[folder] = AgentInfo{ID: id}
	if err := r.save(); err != nil {
		log.Printf("Warning: failed to persist agent registry: %v", err)
	}
	log.Printf("Agent registry: new entry %s → %s", folder, id)
	return id
}

// GetID returns the UUID for a folder without creating one. Returns empty
// string if the folder is not registered.
func (r *AgentRegistry) GetID(folder string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if info, ok := r.data.Agents[folder]; ok {
		return info.ID
	}
	return ""
}

// GetInfo returns the full AgentInfo for a folder. Returns nil if not registered.
func (r *AgentRegistry) GetInfo(folder string) *AgentInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if info, ok := r.data.Agents[folder]; ok {
		cp := info
		return &cp
	}
	return nil
}

// RegisterID explicitly sets the UUID for a folder. Used during migration
// when we want to seed the registry with existing agent IDs.
func (r *AgentRegistry) RegisterID(folder, id string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.data.Agents[folder]; exists {
		return // don't overwrite existing mapping
	}
	r.data.Agents[folder] = AgentInfo{ID: id}
	if err := r.save(); err != nil {
		log.Printf("Warning: failed to persist agent registry after register: %v", err)
	}
}

// UpdateAgentMeta updates the slug and name for a folder's agent entry.
// Called when agents are added or updated to keep registry metadata current.
// Only updates non-empty values; does not clear existing values.
func (r *AgentRegistry) UpdateAgentMeta(folder, slug, name string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	info, exists := r.data.Agents[folder]
	if !exists {
		return // Only update existing entries; GetOrCreateID creates new ones
	}

	changed := false
	if slug != "" && info.Slug != slug {
		info.Slug = slug
		changed = true
	}
	if name != "" && info.Name != name {
		info.Name = name
		changed = true
	}

	if changed {
		r.data.Agents[folder] = info
		if err := r.save(); err != nil {
			log.Printf("Warning: failed to persist agent registry after meta update: %v", err)
		}
	}
}

// FindByID searches all registry entries for an agent with the given UUID.
// Returns the AgentInfo and folder path, or nil if not found.
func (r *AgentRegistry) FindByID(id string) (*AgentInfo, string) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for folder, info := range r.data.Agents {
		if info.ID == id {
			cp := info
			return &cp, folder
		}
	}
	return nil, ""
}

// FindBySlug searches all registry entries for an agent with the given slug.
// Matches against stored slug first, then derives slug from stored name.
// Returns the AgentInfo and folder path, or nil if not found.
func (r *AgentRegistry) FindBySlug(slug string) (*AgentInfo, string) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	slug = strings.ToLower(slug)
	for folder, info := range r.data.Agents {
		// Match stored slug
		if info.Slug != "" && strings.ToLower(info.Slug) == slug {
			cp := info
			return &cp, folder
		}
		// Derive slug from name and match
		if info.Name != "" && Slugify(info.Name) == slug {
			cp := info
			return &cp, folder
		}
	}
	return nil, ""
}

// AllSlugs returns all known slugs from the registry (for suggestions).
// Includes both explicit slugs and derived-from-name slugs.
func (r *AgentRegistry) AllSlugs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var slugs []string
	seen := make(map[string]bool)
	for _, info := range r.data.Agents {
		s := info.Slug
		if s == "" && info.Name != "" {
			s = Slugify(info.Name)
		}
		if s != "" && !seen[s] {
			seen[s] = true
			slugs = append(slugs, s)
		}
	}
	return slugs
}

// ReconcileWorkspace checks each agent in a workspace against the registry.
// If an agent's folder is already registered with a different ID, the agent's
// ID is updated to the canonical one. Slug/name are only set if the registry
// entry doesn't have them yet (first-write-wins), ensuring canonical slugs
// persist across workspaces even when the same folder has different agent names.
// Returns a map of oldID→newID for any agents that were changed.
func (r *AgentRegistry) ReconcileWorkspace(ws *Workspace) map[string]string {
	r.mu.Lock()
	defer r.mu.Unlock()

	changed := make(map[string]string)
	metaUpdated := false

	for i := range ws.Agents {
		agent := &ws.Agents[i]
		folder := agent.Folder

		info, exists := r.data.Agents[folder]
		if !exists {
			// First time seeing this folder — register current ID with metadata
			r.data.Agents[folder] = AgentInfo{
				ID:   agent.ID,
				Slug: agent.GetSlug(),
				Name: agent.Name,
			}
			metaUpdated = true
			continue
		}

		if agent.ID != info.ID {
			oldID := agent.ID
			agent.ID = info.ID
			changed[oldID] = info.ID
			log.Printf("Agent registry: reconciled agent %q (%s → %s)", agent.Name, oldID, info.ID)
		}

		// Only populate slug/name if registry doesn't have them yet (first-write-wins).
		// This ensures a canonical slug persists across workspaces even if the same
		// folder has different agent names in different workspaces.
		// Explicit user changes go through UpdateAgentMeta (called by UpdateAgent).
		agentSlug := agent.GetSlug()
		needsUpdate := false
		if info.Slug == "" && agentSlug != "" {
			info.Slug = agentSlug
			needsUpdate = true
		}
		if info.Name == "" && agent.Name != "" {
			info.Name = agent.Name
			needsUpdate = true
		}
		if needsUpdate {
			r.data.Agents[folder] = info
			metaUpdated = true
		}
	}

	if len(changed) > 0 || metaUpdated {
		if err := r.save(); err != nil {
			log.Printf("Warning: failed to persist agent registry after reconciliation: %v", err)
		}
	}

	return changed
}

// AllEntries returns a copy of the registry map (for debugging/inspection).
func (r *AgentRegistry) AllEntries() map[string]AgentInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]AgentInfo, len(r.data.Agents))
	for k, v := range r.data.Agents {
		result[k] = v
	}
	return result
}
