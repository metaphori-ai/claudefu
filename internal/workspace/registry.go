package workspace

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
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

// AgentInfo holds the full identity and metadata for a registered agent.
// All values (system + custom) are stored in the Meta map with ALL_CAPS keys.
// This ensures NAMES consistency — JSON keys match attribute definitions exactly.
type AgentInfo struct {
	ID   string            `json:"id"`
	Meta map[string]string `json:"meta,omitempty"` // ALL_CAPS keys (AGENT_NAME, AGENT_SLUG, etc.)
}

// Helper accessors for common fields
func (a *AgentInfo) GetName() string { return a.Meta["AGENT_NAME"] }
func (a *AgentInfo) GetSlug() string { return a.Meta["AGENT_SLUG"] }

// EnsureMeta initializes the Meta map if nil
func (a *AgentInfo) EnsureMeta() {
	if a.Meta == nil {
		a.Meta = make(map[string]string)
	}
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
// Load reads the agent registry from disk. Pure deserialization — no migrations.
// All migrations are handled by the sequential migration system (migrations.go).
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

	if err := json.Unmarshal(raw, &r.data); err != nil {
		log.Printf("Warning: corrupt agent registry at %s, starting fresh: %v", r.filePath, err)
		return nil
	}

	if r.data.Agents == nil {
		r.data.Agents = make(map[string]AgentInfo)
	}

	// Ensure all AgentInfo have initialized Meta maps
	for folder, info := range r.data.Agents {
		if info.Meta == nil {
			info.Meta = make(map[string]string)
			r.data.Agents[folder] = info
		}
	}

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
// Agents are sorted case-insensitively by folder path for human readability.
func (r *AgentRegistry) save() error {
	raw, err := r.marshalSorted()
	if err != nil {
		return err
	}
	return os.WriteFile(r.filePath, raw, 0644)
}

// marshalSorted produces indented JSON with agents sorted case-insensitively
// by folder path. Go's encoding/json sorts map keys by byte value (ASCII),
// which puts uppercase before lowercase. This produces natural alphabetical order.
func (r *AgentRegistry) marshalSorted() ([]byte, error) {
	keys := make([]string, 0, len(r.data.Agents))
	for k := range r.data.Agents {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return strings.ToLower(keys[i]) < strings.ToLower(keys[j])
	})

	var buf bytes.Buffer
	vb, err := json.Marshal(r.data.Version)
	if err != nil {
		return nil, err
	}
	buf.WriteString("{\n  \"version\": ")
	buf.Write(vb)
	buf.WriteString(",\n  \"agents\": {")

	for i, k := range keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, err := json.Marshal(k)
		if err != nil {
			return nil, err
		}
		// Prefix "    " applied to continuation lines of the value block:
		// fields get "    " + "  " = 6 spaces, closing "}" gets "    " = 4 spaces.
		vb, err := json.MarshalIndent(r.data.Agents[k], "    ", "  ")
		if err != nil {
			return nil, err
		}
		buf.WriteString("\n    ")
		buf.Write(kb)
		buf.WriteString(": ")
		buf.Write(vb)
	}

	if len(keys) > 0 {
		buf.WriteString("\n  ")
	}
	buf.WriteString("}\n}")
	return buf.Bytes(), nil
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

	info.EnsureMeta()
	changed := false
	if slug != "" && info.Meta["AGENT_SLUG"] != slug {
		info.Meta["AGENT_SLUG"] = slug
		changed = true
	}
	if name != "" && info.Meta["AGENT_NAME"] != name {
		info.Meta["AGENT_NAME"] = name
		changed = true
	}

	if changed {
		r.data.Agents[folder] = info
		if err := r.save(); err != nil {
			log.Printf("Warning: failed to persist agent registry after meta update: %v", err)
		}
	}
}

// UpdateAgentCustomMeta updates the custom meta map for an agent's registry entry.
// The meta map is replaced entirely (not merged) — frontend sends the full map.
func (r *AgentRegistry) UpdateAgentCustomMeta(folder string, meta map[string]string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	info, exists := r.data.Agents[folder]
	if !exists {
		return fmt.Errorf("agent not found in registry: %s", folder)
	}

	info.Meta = meta
	r.data.Agents[folder] = info
	if err := r.save(); err != nil {
		return fmt.Errorf("failed to persist agent meta: %w", err)
	}
	return nil
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
		if info.GetSlug() != "" && strings.ToLower(info.GetSlug()) == slug {
			cp := info
			return &cp, folder
		}
		// Derive slug from name and match
		if info.GetName() != "" && Slugify(info.GetName()) == slug {
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
		s := info.GetSlug()
		if s == "" && info.GetName() != "" {
			s = Slugify(info.GetName())
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
				ID: agent.ID,
				Meta: map[string]string{
					"AGENT_SLUG": agent.GetSlug(),
					"AGENT_NAME": agent.Name,
				},
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
		info.EnsureMeta()
		agentSlug := agent.GetSlug()
		needsUpdate := false
		if info.GetSlug() == "" && agentSlug != "" {
			info.Meta["AGENT_SLUG"] = agentSlug
			needsUpdate = true
		}
		if info.GetName() == "" && agent.Name != "" {
			info.Meta["AGENT_NAME"] = agent.Name
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

// EnrichWorkspaceAgents fills Folder/Name/MCPSlug for agents that have an empty Folder
// (v4 slim workspace format). Agents that already have Folder populated (old format)
// are skipped so that old workspaces continue to load identically.
func (r *AgentRegistry) EnrichWorkspaceAgents(ws *Workspace) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for i := range ws.Agents {
		agent := &ws.Agents[i]
		if agent.Folder != "" {
			continue // Already populated (old format) — skip
		}
		for folder, info := range r.data.Agents {
			if info.ID == agent.ID {
				agent.Folder = folder
				if agent.Name == "" {
					agent.Name = info.GetName()
				}
				if agent.MCPSlug == "" {
					agent.MCPSlug = info.GetSlug()
				}
				break
			}
		}
	}
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
