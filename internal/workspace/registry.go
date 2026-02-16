package workspace

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"
)

// AgentRegistry maintains a global folder→UUID mapping so that the same
// project folder always gets the same agent ID, regardless of which
// workspace it appears in.
//
// Persisted at: ~/.claudefu/agents.json
type AgentRegistry struct {
	mu       sync.RWMutex
	filePath string
	data     registryData
}

type registryData struct {
	Version int               `json:"version"`
	Agents  map[string]string `json:"agents"` // folder path → UUID
}

// NewAgentRegistry creates a registry backed by the given file path.
func NewAgentRegistry(configPath string) *AgentRegistry {
	return &AgentRegistry{
		filePath: filepath.Join(configPath, "agents.json"),
		data: registryData{
			Version: 1,
			Agents:  make(map[string]string),
		},
	}
}

// Load reads the registry from disk. If the file doesn't exist, starts empty.
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

	var d registryData
	if err := json.Unmarshal(raw, &d); err != nil {
		log.Printf("Warning: corrupt agent registry at %s, starting fresh: %v", r.filePath, err)
		return nil
	}

	if d.Agents == nil {
		d.Agents = make(map[string]string)
	}
	r.data = d
	log.Printf("Agent registry loaded: %d entries", len(r.data.Agents))
	return nil
}

// Save writes the current registry to disk.
func (r *AgentRegistry) Save() error {
	// Caller must hold at least an RLock; we don't lock here because
	// callers (GetOrCreateID) already hold the write lock.
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

	if id, ok := r.data.Agents[folder]; ok {
		return id
	}

	id := uuid.New().String()
	r.data.Agents[folder] = id
	if err := r.Save(); err != nil {
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
	return r.data.Agents[folder]
}

// RegisterID explicitly sets the UUID for a folder. Used during migration
// when we want to seed the registry with existing agent IDs.
func (r *AgentRegistry) RegisterID(folder, id string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.data.Agents[folder]; exists {
		return // don't overwrite existing mapping
	}
	r.data.Agents[folder] = id
	if err := r.Save(); err != nil {
		log.Printf("Warning: failed to persist agent registry after register: %v", err)
	}
}

// ReconcileWorkspace checks each agent in a workspace against the registry.
// If an agent's folder is already registered with a different ID, the agent's
// ID is updated to the canonical one. Returns a map of oldID→newID for any
// agents that were changed (empty map if no changes).
func (r *AgentRegistry) ReconcileWorkspace(ws *Workspace) map[string]string {
	r.mu.Lock()
	defer r.mu.Unlock()

	changed := make(map[string]string)

	for i := range ws.Agents {
		agent := &ws.Agents[i]
		folder := agent.Folder

		canonicalID, exists := r.data.Agents[folder]
		if !exists {
			// First time seeing this folder — register current ID
			r.data.Agents[folder] = agent.ID
			continue
		}

		if agent.ID != canonicalID {
			oldID := agent.ID
			agent.ID = canonicalID
			changed[oldID] = canonicalID
			log.Printf("Agent registry: reconciled agent %q (%s → %s)", agent.Name, oldID, canonicalID)
		}
	}

	if len(changed) > 0 {
		if err := r.Save(); err != nil {
			log.Printf("Warning: failed to persist agent registry after reconciliation: %v", err)
		}
	}

	return changed
}

// AllEntries returns a copy of the registry map (for debugging/inspection).
func (r *AgentRegistry) AllEntries() map[string]string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]string, len(r.data.Agents))
	for k, v := range r.data.Agents {
		result[k] = v
	}
	return result
}
