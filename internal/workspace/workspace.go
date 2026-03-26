package workspace

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"claudefu/internal/types"
)

// Agent represents a configured agent in a workspace.
// Identity (slug, description) comes from registry via PopulateAgentsFromRegistry.
// There is no separate "name" — AGENT_SLUG is the single identifier everywhere.
type Agent struct {
	ID                string `json:"id"`                          // UUID for stable identification
	Folder            string `json:"folder"`                      // Project folder path this agent monitors
	WatchMode         string `json:"watchMode,omitempty"`         // "file" or "stream" (default: file)
	SelectedSessionID string `json:"selectedSessionId,omitempty"` // Last viewed session for this agent
	Provider          string `json:"provider,omitempty"`          // claude_code, anthropic, openai
	Specialization    string `json:"specialization,omitempty"`    // backend, frontend, devops, etc.
	ClaudeMdPath      string `json:"claudeMdPath,omitempty"`      // Custom CLAUDE.md path override

	// Agent Identity (populated from registry via PopulateAgentsFromRegistry)
	Slug        string `json:"slug,omitempty"`        // Agent slug — THE identifier (sidebar, MCP, templates). From AGENT_SLUG in registry.
	Description string `json:"description,omitempty"` // Agent description, from AGENT_DESCRIPTION in registry
	Type        string `json:"type,omitempty"`        // "agent" (default), "sifu". From AGENT_TYPE in registry.

	// Per-workspace MCP config (stored in workspace JSON)
	MCPEnabled *bool `json:"mcpEnabled,omitempty"` // Participates in inter-agent communication (default: true)
}

// GetWatchMode returns the agent's watch mode, defaulting to "file"
func (a *Agent) GetWatchMode() string {
	if a.WatchMode == "" {
		return types.WatchModeFile
	}
	return a.WatchMode
}

// GetMCPEnabled returns whether this agent participates in MCP communication (default: true)
func (a *Agent) GetMCPEnabled() bool {
	if a.MCPEnabled == nil {
		return true // Default to enabled
	}
	return *a.MCPEnabled
}

// GetSlug returns the agent slug. If Slug is set, returns it; otherwise derives from folder basename.
func (a *Agent) GetSlug() string {
	if a.Slug != "" {
		return a.Slug
	}
	// Fallback: derive from folder basename
	if a.Folder != "" {
		parts := strings.Split(a.Folder, "/")
		if len(parts) > 0 {
			return Slugify(parts[len(parts)-1])
		}
	}
	return a.ID[:8] // Last resort: truncated UUID
}

// GetType returns the agent type. Default is "agent".
func (a *Agent) GetType() string {
	if a.Type != "" {
		return a.Type
	}
	return "agent"
}

// IsSifu returns true if this is a Sifu agent.
func (a *Agent) IsSifu() bool {
	return a.Type == "sifu"
}

// Slugify converts a name to a slug — preserves case, replaces spaces with dashes,
// strips non-alphanumeric except dashes. e.g., "TrueMemory BFF" -> "TrueMemory-BFF"
func Slugify(name string) string {
	slug := strings.ReplaceAll(name, " ", "-")
	// Remove non-alphanumeric characters except dashes (preserve case)
	var result strings.Builder
	for _, r := range slug {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
			result.WriteRune(r)
		}
	}
	return result.String()
}

// SelectedSession tracks the last viewed session
type SelectedSession struct {
	AgentID   string `json:"agentId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Folder    string `json:"folder,omitempty"`
}

// MCPConfig holds MCP server configuration for a workspace
type MCPConfig struct {
	Enabled bool `json:"enabled"` // Master switch for MCP server (default: true)
	Port    int  `json:"port"`    // SSE server port (default: 9315)
}

// GetPort returns the configured port or default (9315)
func (c *MCPConfig) GetPort() int {
	if c == nil || c.Port == 0 {
		return 9315
	}
	return c.Port
}

// IsEnabled returns whether MCP is enabled (default: true)
func (c *MCPConfig) IsEnabled() bool {
	if c == nil {
		return true // Default to enabled
	}
	return c.Enabled
}

// Workspace represents a saved workspace configuration
type Workspace struct {
	Version         int              `json:"version"`                   // Schema version (4 = slim agents, no name/folder duplication)
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Agents          []Agent          `json:"agents"`
	MCPConfig       *MCPConfig       `json:"mcpConfig,omitempty"`       // MCP server configuration
	SelectedSession *SelectedSession `json:"selectedSession,omitempty"` // In-memory only (set by populateWorkspaceFromState)
	LastOpened      time.Time        `json:"lastOpened"`                // In-memory only (set by populateWorkspaceFromState); kept for backward compat read
}

// CurrentWorkspaceVersion is the latest workspace schema version
const CurrentWorkspaceVersion = 4

// agentDiskEntry is the slim on-disk representation of an agent.
// Agent identity (name, folder, slug) lives exclusively in agents.json.
// agentDiskEntry is the slim on-disk representation of an agent.
// Agent identity (name, folder, slug, description) lives exclusively in agents.json registry.
// Only per-workspace config (watchMode, mcpEnabled) is stored here.
type agentDiskEntry struct {
	ID         string `json:"id"`
	WatchMode  string `json:"watchMode,omitempty"`
	MCPEnabled *bool  `json:"mcpEnabled,omitempty"`
}

// workspaceDisk is the on-disk representation of a workspace (v4 slim format).
type workspaceDisk struct {
	Version   int              `json:"version"`
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Agents    []agentDiskEntry `json:"agents"`
	MCPConfig *MCPConfig       `json:"mcpConfig,omitempty"`
}

// WorkspaceSummary is a minimal reference for listing workspaces
type WorkspaceSummary struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	LastOpened time.Time `json:"lastOpened"`
}

// CurrentWorkspace stores the active workspace ID
type CurrentWorkspace struct {
	ID string `json:"id"`
}

// WorkspaceState holds per-machine runtime state that should NOT be synced.
// Persisted to ~/.claudefu/local/workspace-state/{workspace_id}.json
type WorkspaceState struct {
	SelectedSession *SelectedSession  `json:"selectedSession,omitempty"`
	LastOpened      time.Time         `json:"lastOpened"`
	AgentSessions   map[string]string `json:"agentSessions,omitempty"` // agentID -> sessionID
}

// GenerateWorkspaceID creates a unique workspace ID
func GenerateWorkspaceID() string {
	return fmt.Sprintf("ws-%d", time.Now().UnixNano()/1000000)
}

// GenerateAgentID creates a new UUID for an agent
func GenerateAgentID() string {
	return uuid.New().String()
}

// isValidUUID checks if a string is a valid UUID
func isValidUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil
}

// UpgradeWorkspaceSchema upgrades a workspace to the current schema version.
// This handles backwards compatibility for workspaces created before UUID support.
func (m *Manager) UpgradeWorkspaceSchema(ws *Workspace) *Workspace {
	if ws.Version < CurrentWorkspaceVersion {
		// Migrate agents to have proper UUIDs (using registry for stability)
		for i := range ws.Agents {
			if ws.Agents[i].ID == "" || !isValidUUID(ws.Agents[i].ID) {
				ws.Agents[i].ID = m.GetOrCreateAgentID(ws.Agents[i].Folder)
			}
			// Ensure WatchMode has a default
			if ws.Agents[i].WatchMode == "" {
				ws.Agents[i].WatchMode = types.WatchModeFile
			}
		}
		ws.Version = CurrentWorkspaceVersion
	}
	return ws
}

// Session represents a Claude Code chat session
type Session struct {
	SessionID    string    `json:"sessionId"`
	LastModified time.Time `json:"lastModified"`
	MessageCount int       `json:"messageCount"`
	Preview      string    `json:"preview"` // First user message preview
}

// Manager handles workspace operations. Registries are private — all access goes through Manager methods.
type Manager struct {
	configPath        string
	agentRegistry     *AgentRegistry
	workspaceRegistry *WorkspaceRegistry
	metaSchema        *MetaSchemaManager
}

// NewManager creates a new workspace manager
func NewManager(configPath string) *Manager {
	// Ensure workspaces directory exists
	workspacesDir := filepath.Join(configPath, "workspaces")
	os.MkdirAll(workspacesDir, 0755)

	// Initialize and load registries (pure deserialization — no migrations in Load)
	registry := NewAgentRegistry(configPath)
	if err := registry.Load(); err != nil {
		fmt.Printf("Warning: failed to load agent registry: %v\n", err)
	}

	wsRegistry := NewWorkspaceRegistry(configPath)
	if err := wsRegistry.Load(); err != nil {
		fmt.Printf("Warning: failed to load workspace registry: %v\n", err)
	}

	metaSchema := NewMetaSchemaManager(configPath)
	if err := metaSchema.Load(); err != nil {
		fmt.Printf("Warning: failed to load meta schema: %v\n", err)
	}

	m := &Manager{
		configPath:        configPath,
		agentRegistry:     registry,
		workspaceRegistry: wsRegistry,
		metaSchema:        metaSchema,
	}

	// Run sequential migrations (all migration logic lives in migrations.go)
	if err := m.RunMigrations(); err != nil {
		fmt.Printf("Warning: migration failed: %v\n", err)
	}

	return m
}

// =============================================================================
// MANAGER API: Agent Registry Methods
// =============================================================================

// GetOrCreateAgentID returns a stable agent ID for the given folder.
func (m *Manager) GetOrCreateAgentID(folder string) string {
	if m.agentRegistry != nil {
		return m.agentRegistry.GetOrCreateID(folder)
	}
	return GenerateAgentID()
}

// GetAgentInfo returns the full AgentInfo for a folder. Returns nil if not registered.
func (m *Manager) GetAgentInfo(folder string) *AgentInfo {
	if m.agentRegistry == nil {
		return nil
	}
	return m.agentRegistry.GetInfo(folder)
}

// UpdateAgentSlug updates the AGENT_SLUG in the agent registry.
func (m *Manager) UpdateAgentSlug(folder, slug string) {
	if m.agentRegistry != nil {
		m.agentRegistry.UpdateAgentSlug(folder, slug)
	}
}

// UpdateAgentCustomMeta replaces the custom meta map for an agent.
func (m *Manager) UpdateAgentCustomMeta(folder string, meta map[string]string) error {
	if m.agentRegistry == nil {
		return fmt.Errorf("agent registry not initialized")
	}
	return m.agentRegistry.UpdateAgentCustomMeta(folder, meta)
}

// FindAgentBySlug searches for an agent by slug. Returns info + folder.
func (m *Manager) FindAgentBySlug(slug string) (*AgentInfo, string) {
	if m.agentRegistry == nil {
		return nil, ""
	}
	return m.agentRegistry.FindBySlug(slug)
}

// FindAgentByID searches for an agent by UUID. Returns info + folder.
func (m *Manager) FindAgentByID(id string) (*AgentInfo, string) {
	if m.agentRegistry == nil {
		return nil, ""
	}
	return m.agentRegistry.FindByID(id)
}

// GetAllAgentInfo returns a copy of all agent registry entries.
func (m *Manager) GetAllAgentInfo() map[string]AgentInfo {
	if m.agentRegistry == nil {
		return make(map[string]AgentInfo)
	}
	return m.agentRegistry.GetAllInfo()
}

// GetAllAgentSlugs returns all known agent slugs.
func (m *Manager) GetAllAgentSlugs() []string {
	if m.agentRegistry == nil {
		return nil
	}
	return m.agentRegistry.GetAllSlugs()
}

// SyncAgentIDsFromRegistry validates agent IDs against the registry.
func (m *Manager) SyncAgentIDsFromRegistry(ws *Workspace) map[string]string {
	if m.agentRegistry == nil {
		return nil
	}
	return m.agentRegistry.SyncAgentIDsFromRegistry(ws)
}

// EnsureSifuAgent creates the Sifu agent folder and registers it if configured for the workspace.
// Called during workspace load. Idempotent — safe to call multiple times.
// sifuEnabled and sifuRootFolder come from global settings (Manager doesn't own Settings).
func (m *Manager) EnsureSifuAgent(ws *Workspace, sifuEnabled bool, sifuRootFolder string) error {
	if !sifuEnabled || sifuRootFolder == "" {
		return nil
	}

	// Get WORKSPACE_SIFU_SLUG from workspace registry
	wsInfo := m.GetWorkspaceMeta(ws.ID)
	if wsInfo == nil {
		return nil
	}
	sifuSlug := wsInfo.GetSifuSlug()
	if sifuSlug == "" {
		return nil
	}

	// Derive folder path
	root := sifuRootFolder
	if strings.HasPrefix(root, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			root = filepath.Join(home, root[2:])
		}
	}
	sifuFolder := filepath.Join(root, sifuSlug)

	// Create folder if missing
	if err := os.MkdirAll(sifuFolder, 0755); err != nil {
		return fmt.Errorf("failed to create sifu folder %s: %w", sifuFolder, err)
	}

	// Register agent in agents.json if not already registered
	agentID := m.GetOrCreateAgentID(sifuFolder)
	info := m.GetAgentInfo(sifuFolder)
	if info == nil || info.GetSlug() == "" {
		m.UpdateAgentSlug(sifuFolder, sifuSlug)
	}
	// Ensure AGENT_TYPE is "sifu"
	if info == nil || info.Meta["AGENT_TYPE"] != "sifu" {
		existingInfo := m.GetAgentInfo(sifuFolder)
		meta := make(map[string]string)
		if existingInfo != nil && existingInfo.Meta != nil {
			for k, v := range existingInfo.Meta {
				meta[k] = v
			}
		}
		meta["AGENT_TYPE"] = "sifu"
		meta["AGENT_SLUG"] = sifuSlug
		m.UpdateAgentCustomMeta(sifuFolder, meta)
	}

	// Check if agent already in workspace agents list
	alreadyInWorkspace := false
	for _, agent := range ws.Agents {
		if agent.ID == agentID || agent.Folder == sifuFolder {
			alreadyInWorkspace = true
			break
		}
	}

	// Add to workspace if not present (prepend — sifu always first)
	if !alreadyInWorkspace {
		sifuAgent := Agent{
			ID:     agentID,
			Folder: sifuFolder,
			Slug:   sifuSlug,
			Type:   "sifu",
		}
		ws.Agents = append([]Agent{sifuAgent}, ws.Agents...)
		if err := m.SaveWorkspace(ws); err != nil {
			return fmt.Errorf("failed to save workspace after adding sifu: %w", err)
		}
		fmt.Printf("[INFO] EnsureSifuAgent: added sifu agent %s to workspace %s (prepended)\n", sifuSlug, ws.ID)
	} else {
		// Ensure sifu is at index 0 — it may have been appended by an older version
		m.ensureSifuFirst(ws)
	}

	// Always refresh permissions (additive merge of all agent folders)
	if genErr := m.GenerateSifuPermissions(ws, sifuFolder); genErr != nil {
		fmt.Printf("[WARN] EnsureSifuAgent: failed to generate permissions: %v\n", genErr)
	}

	// CLAUDE.md is NOT auto-generated — user triggers via RefreshSifuAgent
	// Only generate on first creation (scaffold flow handles this)

	return nil
}

// ensureSifuFirst moves the first sifu agent to index 0 if it isn't already there.
// Only moves one sifu — find-first, not iterate-all. Saves workspace if moved.
func (m *Manager) ensureSifuFirst(ws *Workspace) {
	if len(ws.Agents) == 0 {
		return
	}
	// Already at top?
	if ws.Agents[0].Type == "sifu" {
		return
	}
	// Find first sifu
	for i := 1; i < len(ws.Agents); i++ {
		if ws.Agents[i].Type == "sifu" {
			sifu := ws.Agents[i]
			ws.Agents = append(append([]Agent{sifu}, ws.Agents[:i]...), ws.Agents[i+1:]...)
			if err := m.SaveWorkspace(ws); err != nil {
				fmt.Printf("[WARN] ensureSifuFirst: failed to save: %v\n", err)
			} else {
				fmt.Printf("[INFO] ensureSifuFirst: moved %s to index 0\n", sifu.GetSlug())
			}
			return
		}
	}
}

// PopulateAgentsFromRegistry fills Folder/Slug/Description/Type for agents from registry.
func (m *Manager) PopulateAgentsFromRegistry(ws *Workspace) {
	if m.agentRegistry != nil {
		m.agentRegistry.PopulateAgentsFromRegistry(ws)
	}
}

// RegisterAgentID explicitly sets the UUID for a folder.
func (m *Manager) RegisterAgentID(folder, id string) {
	if m.agentRegistry != nil {
		m.agentRegistry.RegisterID(folder, id)
	}
}

// =============================================================================
// MANAGER API: Workspace Registry Methods
// =============================================================================

// GetWorkspaceMeta returns workspace metadata by ID.
func (m *Manager) GetWorkspaceMeta(wsID string) *WorkspaceInfo {
	if m.workspaceRegistry == nil {
		return nil
	}
	return m.workspaceRegistry.GetInfo(wsID)
}

// GetAllWorkspaceMeta returns all workspace metadata entries.
func (m *Manager) GetAllWorkspaceMeta() map[string]WorkspaceInfo {
	if m.workspaceRegistry == nil {
		return make(map[string]WorkspaceInfo)
	}
	return m.workspaceRegistry.GetAll()
}

// UpdateWorkspaceMeta replaces the workspace's entire meta map.
func (m *Manager) UpdateWorkspaceMeta(wsID string, meta map[string]string) error {
	if m.workspaceRegistry == nil {
		return fmt.Errorf("workspace registry not initialized")
	}
	return m.workspaceRegistry.UpdateMeta(wsID, meta)
}

// UpdateWorkspaceRegistryName updates the workspace name in the registry.
func (m *Manager) UpdateWorkspaceRegistryName(wsID, name string) {
	if m.workspaceRegistry != nil {
		m.workspaceRegistry.SyncName(wsID, name)
	}
}

// DeleteWorkspaceMeta removes a workspace from the registry.
func (m *Manager) DeleteWorkspaceMeta(wsID string) {
	if m.workspaceRegistry != nil {
		m.workspaceRegistry.Delete(wsID)
	}
}

// GetOrCreateWorkspaceMeta returns workspace info, creating if not found.
func (m *Manager) GetOrCreateWorkspaceMeta(wsID, name string) *WorkspaceInfo {
	if m.workspaceRegistry == nil {
		return nil
	}
	return m.workspaceRegistry.GetOrCreateInfo(wsID, name)
}

// =============================================================================
// MANAGER API: Meta Schema Methods
// =============================================================================

// GetMetaSchema returns the current meta schema.
func (m *Manager) GetMetaSchema() MetaSchema {
	if m.metaSchema == nil {
		return DefaultSchema()
	}
	return m.metaSchema.GetSchema()
}

// SaveMetaSchema validates and persists the meta schema.
func (m *Manager) SaveMetaSchema(schema MetaSchema) error {
	if m.metaSchema == nil {
		return fmt.Errorf("meta schema not initialized")
	}
	return m.metaSchema.SaveSchema(schema)
}

// =============================================================================
// WORKSPACE OPERATIONS
// =============================================================================

// HasAgentWithFolder checks if any agent in the workspace already has the given folder.
func HasAgentWithFolder(ws *Workspace, folder string) bool {
	for _, agent := range ws.Agents {
		if agent.Folder == folder {
			return true
		}
	}
	return false
}

// GetAllWorkspaces returns all workspaces from the workspaces folder
func (m *Manager) GetAllWorkspaces() ([]WorkspaceSummary, error) {
	workspacesDir := filepath.Join(m.configPath, "workspaces")
	entries, err := os.ReadDir(workspacesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []WorkspaceSummary{}, nil
		}
		return nil, err
	}

	workspaces := []WorkspaceSummary{}  // Initialize as empty slice, not nil (nil becomes JSON null)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		wsPath := filepath.Join(workspacesDir, entry.Name())
		data, err := os.ReadFile(wsPath)
		if err != nil {
			continue
		}

		var ws Workspace
		if err := json.Unmarshal(data, &ws); err != nil {
			continue
		}

		// Source LastOpened from local workspace state (per-machine), not workspace JSON
		wsState := m.LoadWorkspaceState(ws.ID)
		lastOpened := wsState.LastOpened
		if lastOpened.IsZero() {
			// Fallback: use workspace JSON's LastOpened if state file doesn't exist yet
			lastOpened = ws.LastOpened
		}

		workspaces = append(workspaces, WorkspaceSummary{
			ID:         ws.ID,
			Name:       ws.Name,
			LastOpened: lastOpened,
		})
	}

	// Sort by last opened (most recent first)
	sort.Slice(workspaces, func(i, j int) bool {
		return workspaces[i].LastOpened.After(workspaces[j].LastOpened)
	})

	return workspaces, nil
}

// EnsureLocalDirs creates ~/.claudefu/local/ and subdirectories.
// Called on startup to ensure the local runtime state directory exists.
func (m *Manager) EnsureLocalDirs() error {
	dirs := []string{
		filepath.Join(m.configPath, "local"),
		filepath.Join(m.configPath, "local", "workspace-state"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create local dir %s: %w", dir, err)
		}
	}
	return nil
}

// GetCurrentWorkspaceID returns the ID of the currently active workspace.
// Reads from local/current.json (per-machine state).
func (m *Manager) GetCurrentWorkspaceID() (string, error) {
	currentPath := filepath.Join(m.configPath, "local", "current.json")
	data, err := os.ReadFile(currentPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil // No current workspace set
		}
		return "", err
	}

	var current CurrentWorkspace
	if err := json.Unmarshal(data, &current); err != nil {
		return "", err
	}

	return current.ID, nil
}

// SetCurrentWorkspace sets the currently active workspace ID.
// Writes to local/current.json (per-machine state).
func (m *Manager) SetCurrentWorkspace(id string) error {
	current := CurrentWorkspace{ID: id}
	data, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.configPath, "local", "current.json"), data, 0644)
}

// LoadWorkspaceState reads per-machine runtime state from local/workspace-state/{id}.json
func (m *Manager) LoadWorkspaceState(workspaceID string) *WorkspaceState {
	statePath := filepath.Join(m.configPath, "local", "workspace-state", workspaceID+".json")
	data, err := os.ReadFile(statePath)
	if err != nil {
		// Not found is normal (first run or new workspace)
		return &WorkspaceState{}
	}

	var state WorkspaceState
	if err := json.Unmarshal(data, &state); err != nil {
		fmt.Printf("[WARN] Failed to parse workspace state %s: %v\n", workspaceID, err)
		return &WorkspaceState{}
	}
	return &state
}

// SaveWorkspaceState writes per-machine runtime state to local/workspace-state/{id}.json
// Uses a snapshot copy to avoid concurrent map read/write panics during JSON serialization.
func (m *Manager) SaveWorkspaceState(workspaceID string, state *WorkspaceState) error {
	statePath := filepath.Join(m.configPath, "local", "workspace-state", workspaceID+".json")

	// Snapshot the map to avoid concurrent map iteration panic
	// (SetActiveSession writes to AgentSessions while SaveWorkspaceState serializes it)
	// Strip folder from SelectedSession — folder is derived from AgentID via the registry.
	var selectedSession *SelectedSession
	if state.SelectedSession != nil {
		selectedSession = &SelectedSession{
			AgentID:   state.SelectedSession.AgentID,
			SessionID: state.SelectedSession.SessionID,
			// Folder omitted — derived from registry via AgentID
		}
	}
	snapshot := &WorkspaceState{
		SelectedSession: selectedSession,
		LastOpened:      state.LastOpened,
	}
	if state.AgentSessions != nil {
		snapshot.AgentSessions = make(map[string]string, len(state.AgentSessions))
		for k, v := range state.AgentSessions {
			snapshot.AgentSessions[k] = v
		}
	}

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(statePath, data, 0644)
}

// DeleteWorkspaceState removes the local workspace state file for a workspace.
func (m *Manager) DeleteWorkspaceState(workspaceID string) {
	statePath := filepath.Join(m.configPath, "local", "workspace-state", workspaceID+".json")
	os.Remove(statePath) // Ignore error if file doesn't exist
}

// ExtractRuntimeToStateFile extracts runtime fields from a workspace JSON
// into a WorkspaceState file, then cleans the workspace JSON. One-time migration.
func (m *Manager) ExtractRuntimeToStateFile(ws *Workspace) {
	// Check if workspace still has runtime fields
	hasRuntime := ws.SelectedSession != nil || !ws.LastOpened.IsZero()
	hasAgentSessions := false
	for _, agent := range ws.Agents {
		if agent.SelectedSessionID != "" {
			hasAgentSessions = true
			break
		}
	}

	if !hasRuntime && !hasAgentSessions {
		return // Nothing to migrate
	}

	// Check if we already have a state file
	statePath := filepath.Join(m.configPath, "local", "workspace-state", ws.ID+".json")
	if _, err := os.Stat(statePath); err == nil {
		// State file already exists — just clean the workspace JSON without overwriting state
		m.clearRuntimeFields(ws)
		return
	}

	// Extract runtime state
	state := &WorkspaceState{
		SelectedSession: ws.SelectedSession,
		LastOpened:       ws.LastOpened,
		AgentSessions:   make(map[string]string),
	}

	for _, agent := range ws.Agents {
		if agent.SelectedSessionID != "" {
			state.AgentSessions[agent.ID] = agent.SelectedSessionID
		}
	}

	// Save to local state file
	if err := m.SaveWorkspaceState(ws.ID, state); err != nil {
		fmt.Printf("[WARN] Failed to save workspace state during migration: %v\n", err)
		return
	}

	// Clean runtime fields from workspace JSON
	m.clearRuntimeFields(ws)

	fmt.Printf("[INFO] Migrated runtime fields from workspace %s to local/workspace-state/\n", ws.ID)
}

// clearRuntimeFields removes runtime fields from workspace in-memory
// and re-saves the workspace JSON without them.
func (m *Manager) clearRuntimeFields(ws *Workspace) {
	ws.SelectedSession = nil
	ws.LastOpened = time.Time{} // Zero value — omitempty won't help since time marshals even zero

	for i := range ws.Agents {
		ws.Agents[i].SelectedSessionID = ""
	}
}

// SaveWorkspace saves a workspace configuration (config only, no runtime state).
// Uses workspace ID for filename (stable, no rename issues).
// Runtime state (selectedSession, lastOpened, agentSessions) is saved separately
// via SaveWorkspaceState to avoid sync conflicts on multi-machine setups.
//
// v4 slim format: only id/watchMode/mcpEnabled per agent.
// Agent identity (name, folder, slug) lives exclusively in agents.json.
func (m *Manager) SaveWorkspace(ws *Workspace) error {
	// Generate ID if not set
	if ws.ID == "" {
		ws.ID = GenerateWorkspaceID()
	}

	// Build slim disk struct — no name/folder/slug duplication
	disk := workspaceDisk{
		Version:   CurrentWorkspaceVersion,
		ID:        ws.ID,
		Name:      ws.Name,
		MCPConfig: ws.MCPConfig,
	}
	disk.Agents = make([]agentDiskEntry, len(ws.Agents))
	for i, a := range ws.Agents {
		disk.Agents[i] = agentDiskEntry{
			ID:         a.ID,
			WatchMode:  a.WatchMode,
			MCPEnabled: a.MCPEnabled,
		}
	}

	data, err := json.MarshalIndent(&disk, "", "  ")
	if err != nil {
		return err
	}

	wsPath := filepath.Join(m.configPath, "workspaces", ws.ID+".json")
	fmt.Printf("[DEBUG] SaveWorkspace: writing %d agents to %s (%d bytes)\n", len(disk.Agents), wsPath, len(data))
	return os.WriteFile(wsPath, data, 0644)
}


// LoadWorkspace loads a workspace by ID
func (m *Manager) LoadWorkspace(id string) (*Workspace, error) {
	// Direct file lookup by ID
	wsPath := filepath.Join(m.configPath, "workspaces", id+".json")
	data, err := os.ReadFile(wsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("workspace not found: %s", id)
		}
		return nil, err
	}

	var ws Workspace
	if err := json.Unmarshal(data, &ws); err != nil {
		return nil, err
	}

	// Enrich agents with name/folder/slug from the registry (v4 slim format).
	// Safe to call on old-format workspaces: PopulateAgentsFromRegistry skips agents
	// that already have Folder populated.
	if m.agentRegistry != nil {
		m.agentRegistry.PopulateAgentsFromRegistry(&ws)
	}

	return &ws, nil
}

// CreateWorkspace creates a new workspace with a generated ID
func (m *Manager) CreateWorkspace(name string) (*Workspace, error) {
	ws := &Workspace{
		ID:     GenerateWorkspaceID(),
		Name:   name,
		Agents: []Agent{},
	}

	if err := m.SaveWorkspace(ws); err != nil {
		return nil, err
	}

	// Save initial workspace state (LastOpened) to local/
	state := &WorkspaceState{LastOpened: time.Now()}
	if err := m.SaveWorkspaceState(ws.ID, state); err != nil {
		fmt.Printf("[WARN] Failed to save initial workspace state: %v\n", err)
	}

	// Register in workspace registry
	if m.workspaceRegistry != nil {
		m.workspaceRegistry.GetOrCreateInfo(ws.ID, ws.Name)
	}

	// Set as current workspace
	if err := m.SetCurrentWorkspace(ws.ID); err != nil {
		fmt.Printf("[WARN] Failed to set current workspace: %v\n", err)
	}

	return ws, nil
}

// GetSessions returns chat sessions for a folder from Claude Code's storage
func (m *Manager) GetSessions(folder string) ([]Session, error) {
	// Encode folder path like Claude Code does
	encodedName := encodeProjectPath(folder)
	projectDir := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName)

	entries, err := os.ReadDir(projectDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []Session{}, nil // No sessions yet
		}
		return nil, err
	}

	sessions := []Session{}
	for _, entry := range entries {
		name := entry.Name()
		// Skip non-jsonl files and agent files
		if !strings.HasSuffix(name, ".jsonl") || strings.HasPrefix(name, "agent-") {
			continue
		}

		sessionID := strings.TrimSuffix(name, ".jsonl")
		filePath := filepath.Join(projectDir, name)

		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Get preview and count from file
		preview, count := getSessionPreview(filePath)

		// Skip summary-only sessions (no actual user/assistant messages)
		if count == 0 {
			continue
		}

		sessions = append(sessions, Session{
			SessionID:    sessionID,
			LastModified: info.ModTime(),
			MessageCount: count,
			Preview:      preview,
		})
	}

	// Sort by last modified (most recent first)
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].LastModified.After(sessions[j].LastModified)
	})

	return sessions, nil
}

// encodeProjectPath encodes a folder path like Claude Code does.
// Claude CLI replaces every non-alphanumeric character with "-".
func encodeProjectPath(path string) string {
	return encodeProjectPathRegex(path)
}

var nonAlphanumeric = regexp.MustCompile(`[^a-zA-Z0-9]`)

func encodeProjectPathRegex(path string) string {
	return nonAlphanumeric.ReplaceAllString(path, "-")
}

// getSessionPreview reads first user message from session file using the classifier.
func getSessionPreview(filePath string) (string, int) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", 0
	}
	defer file.Close()

	// Read up to 64KB to find first user message
	buf := make([]byte, 64*1024)
	n, _ := file.Read(buf)
	content := string(buf[:n])

	preview := ""
	count := 0

	// Parse JSONL lines using classifier
	for _, line := range strings.Split(content, "\n") {
		if line == "" {
			continue
		}

		classified, err := types.ClassifyJSONLEvent(line)
		if err != nil {
			continue
		}

		// Count user and assistant messages
		if classified.EventType == types.JSONLEventUser || classified.EventType == types.JSONLEventAssistant {
			count++
		}

		// Get first user message as preview
		if preview == "" && classified.EventType == types.JSONLEventUser && classified.User != nil {
			msg := types.ConvertToMessage(classified)
			if msg != nil && msg.Content != "" {
				preview = msg.Content
				if len(preview) > 100 {
					preview = preview[:100] + "..."
				}
			}
		}
	}

	return preview, count
}

// sanitizeFilename makes a string safe for use as filename
func sanitizeFilename(name string) string {
	// Replace unsafe characters
	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		"*", "-",
		"?", "-",
		"\"", "-",
		"<", "-",
		">", "-",
		"|", "-",
	)
	return replacer.Replace(name)
}

// Conversation represents a chat conversation with pagination info
type Conversation struct {
	SessionID  string          `json:"sessionId"`
	Messages   []types.Message `json:"messages"`
	TotalCount int             `json:"totalCount"` // Total messages available
	HasMore    bool            `json:"hasMore"`    // More messages available to load
}

// GetConversation reads conversation with optional limit (0 = all, returns last N messages)
func (m *Manager) GetConversation(folder, sessionID string) (*Conversation, error) {
	return m.GetConversationPaged(folder, sessionID, 30, 0) // Default to last 30
}

// GetConversationPaged reads conversation with pagination using the classifier.
// limit: max messages to return (0 = all)
// offset: skip this many messages from the end (for loading older messages)
func (m *Manager) GetConversationPaged(folder, sessionID string, limit, offset int) (*Conversation, error) {
	encodedName := encodeProjectPath(folder)
	sessionPath := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")

	data, err := os.ReadFile(sessionPath)
	if err != nil {
		return nil, err
	}

	// Collect all displayable messages using the classifier.
	// We collect displayable messages (not tool_result_carrier) into one slice,
	// and carrier messages into another for the frontend to match tool results.
	displayMessages := []types.Message{}
	carrierMessages := []types.Message{}

	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}

		classified, err := types.ClassifyJSONLEvent(line)
		if err != nil {
			continue
		}

		msg := types.ConvertToMessage(classified)
		if msg != nil {
			if msg.Type == "tool_result_carrier" {
				// Keep carrier messages separate - they shouldn't count toward limit
				carrierMessages = append(carrierMessages, *msg)
			} else {
				displayMessages = append(displayMessages, *msg)
			}
		}
	}

	totalCount := len(displayMessages)

	// Apply pagination (from the end) to displayable messages only
	var messages []types.Message
	hasMore := false

	if limit <= 0 {
		// Return all messages
		messages = displayMessages
	} else {
		// Calculate slice indices for last N messages with offset
		endIdx := totalCount - offset
		if endIdx < 0 {
			endIdx = 0
		}
		startIdx := endIdx - limit
		if startIdx < 0 {
			startIdx = 0
		}

		if startIdx < endIdx {
			messages = displayMessages[startIdx:endIdx]
		}
		hasMore = startIdx > 0
	}

	// Append carrier messages so frontend can match tool results
	// (they're filtered out of display but needed for tool result lookup)
	messages = append(messages, carrierMessages...)

	return &Conversation{
		SessionID:  sessionID,
		Messages:   messages,
		TotalCount: totalCount,
		HasMore:    hasMore,
	}, nil
}

// GetUnreadCount returns the number of messages in a session after the given timestamp
func (m *Manager) GetUnreadCount(folder, sessionID string, lastViewedMs int64) (int, error) {
	encodedName := encodeProjectPath(folder)
	sessionPath := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")

	data, err := os.ReadFile(sessionPath)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}

	count := 0
	lastViewedTime := time.UnixMilli(lastViewedMs)

	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}

		var raw struct {
			Type      string `json:"type"`
			Timestamp string `json:"timestamp"`
		}

		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}

		// Only count user and assistant messages
		if raw.Type != "user" && raw.Type != "assistant" {
			continue
		}

		// Parse timestamp and compare
		msgTime, err := time.Parse(time.RFC3339Nano, raw.Timestamp)
		if err != nil {
			// Try alternate format
			msgTime, err = time.Parse(time.RFC3339, raw.Timestamp)
			if err != nil {
				continue
			}
		}

		if msgTime.After(lastViewedTime) {
			count++
		}
	}

	return count, nil
}

// GetAllUnreadCounts returns unread counts for all sessions in a folder
func (m *Manager) GetAllUnreadCounts(folder string, lastViewedMap map[string]int64) (map[string]int, error) {
	sessions, err := m.GetSessions(folder)
	if err != nil {
		return nil, err
	}

	result := make(map[string]int)
	for _, session := range sessions {
		lastViewed := lastViewedMap[session.SessionID]
		count, err := m.GetUnreadCount(folder, session.SessionID, lastViewed)
		if err != nil {
			continue
		}
		if count > 0 {
			result[session.SessionID] = count
		}
	}

	return result, nil
}

// GetSubagentConversation reads messages from a subagent JSONL file.
// The subagent files are stored at:
// ~/.claude/projects/{encodedFolder}/{sessionID}/subagents/{subagentID}.jsonl
func (m *Manager) GetSubagentConversation(folder, sessionID, subagentID string) ([]types.Message, error) {
	encodedName := encodeProjectPath(folder)
	subagentPath := filepath.Join(
		os.Getenv("HOME"),
		".claude",
		"projects",
		encodedName,
		sessionID,
		"subagents",
		subagentID+".jsonl",
	)

	data, err := os.ReadFile(subagentPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("subagent file not found: %s", subagentID)
		}
		return nil, err
	}

	// Collect all messages using the classifier
	messages := []types.Message{}

	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}

		classified, err := types.ClassifyJSONLEvent(line)
		if err != nil {
			continue
		}

		msg := types.ConvertToMessage(classified)
		if msg != nil {
			messages = append(messages, *msg)
		}
	}

	return messages, nil
}

// DeleteWorkspace removes a workspace by ID.
// Returns an error if it's the only workspace (cannot delete the last one).
func (m *Manager) DeleteWorkspace(id string) error {
	// Don't allow deleting if it's the only workspace
	workspaces, err := m.GetAllWorkspaces()
	if err != nil {
		return fmt.Errorf("failed to check workspaces: %w", err)
	}
	if len(workspaces) <= 1 {
		return fmt.Errorf("cannot delete the only workspace")
	}

	// Delete the workspace file
	filePath := filepath.Join(m.configPath, "workspaces", id+".json")
	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("workspace not found: %s", id)
		}
		return fmt.Errorf("failed to delete workspace: %w", err)
	}

	// Remove from workspace registry
	if m.workspaceRegistry != nil {
		m.workspaceRegistry.Delete(id)
	}

	return nil
}

// RenameWorkspace changes a workspace's name by ID.
func (m *Manager) RenameWorkspace(id string, newName string) error {
	// Load the workspace
	ws, err := m.LoadWorkspace(id)
	if err != nil {
		return fmt.Errorf("failed to load workspace: %w", err)
	}

	// Update the name
	ws.Name = newName

	// Save it back
	if err := m.SaveWorkspace(ws); err != nil {
		return fmt.Errorf("failed to save workspace: %w", err)
	}

	// Sync name to workspace registry
	if m.workspaceRegistry != nil {
		m.workspaceRegistry.SyncName(id, newName)
	}

	return nil
}
