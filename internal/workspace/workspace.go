package workspace

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"claudefu/internal/types"
)

// Agent represents a configured agent in a workspace
type Agent struct {
	ID                string `json:"id"`                          // UUID for stable identification
	Name              string `json:"name"`                        // Display name
	Folder            string `json:"folder"`                      // Project folder path this agent monitors
	WatchMode         string `json:"watchMode,omitempty"`         // "file" or "stream" (default: file)
	SelectedSessionID string `json:"selectedSessionId,omitempty"` // Last viewed session for this agent
	Provider          string `json:"provider,omitempty"`          // claude_code, anthropic, openai
	Specialization    string `json:"specialization,omitempty"`    // backend, frontend, devops, etc.
	ClaudeMdPath      string `json:"claudeMdPath,omitempty"`

	// MCP Inter-Agent Communication Fields
	MCPSlug        string `json:"mcpSlug,omitempty"`        // Custom MCP identifier (e.g., "bff"). Auto-derived from name if empty
	MCPEnabled     *bool  `json:"mcpEnabled,omitempty"`     // Participates in inter-agent communication (default: true)
	MCPDescription string `json:"mcpDescription,omitempty"` // What this agent knows (e.g., "handles auth, sessions")
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

// GetSlug returns the MCP slug for this agent.
// If MCPSlug is set, returns it; otherwise derives from Name.
func (a *Agent) GetSlug() string {
	if a.MCPSlug != "" {
		return a.MCPSlug
	}
	return slugify(a.Name)
}

// slugify converts a name to a URL-friendly slug
// e.g., "TrueMemory BFF" -> "truememory-bff"
func slugify(name string) string {
	slug := strings.ToLower(name)
	slug = strings.ReplaceAll(slug, " ", "-")
	// Remove non-alphanumeric characters except dashes
	var result strings.Builder
	for _, r := range slug {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
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
	Version         int              `json:"version"`                   // Schema version (3 = with MCP config)
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Agents          []Agent          `json:"agents"`
	MCPConfig       *MCPConfig       `json:"mcpConfig,omitempty"`       // MCP server configuration
	SelectedSession *SelectedSession `json:"selectedSession,omitempty"`
	Created         time.Time        `json:"created"`
	LastOpened      time.Time        `json:"lastOpened"`
}

// CurrentWorkspaceVersion is the latest workspace schema version
const CurrentWorkspaceVersion = 3

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

// MigrateWorkspace upgrades a workspace to the current schema version.
// This handles backwards compatibility for workspaces created before UUID support.
func (m *Manager) MigrateWorkspace(ws *Workspace) *Workspace {
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

// Manager handles workspace operations
type Manager struct {
	configPath string
	Registry   *AgentRegistry
}

// NewManager creates a new workspace manager
func NewManager(configPath string) *Manager {
	// Ensure workspaces directory exists
	workspacesDir := filepath.Join(configPath, "workspaces")
	os.MkdirAll(workspacesDir, 0755)

	// Initialize and load the global agent registry
	registry := NewAgentRegistry(configPath)
	if err := registry.Load(); err != nil {
		fmt.Printf("Warning: failed to load agent registry: %v\n", err)
	}

	return &Manager{configPath: configPath, Registry: registry}
}

// GetOrCreateAgentID returns a stable agent ID for the given folder,
// using the global registry to ensure the same folder always gets the same UUID.
func (m *Manager) GetOrCreateAgentID(folder string) string {
	if m.Registry != nil {
		return m.Registry.GetOrCreateID(folder)
	}
	// Fallback if registry somehow not initialized
	return GenerateAgentID()
}

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

		workspaces = append(workspaces, WorkspaceSummary{
			ID:         ws.ID,
			Name:       ws.Name,
			LastOpened: ws.LastOpened,
		})
	}

	// Sort by last opened (most recent first)
	sort.Slice(workspaces, func(i, j int) bool {
		return workspaces[i].LastOpened.After(workspaces[j].LastOpened)
	})

	return workspaces, nil
}

// GetCurrentWorkspaceID returns the ID of the currently active workspace
func (m *Manager) GetCurrentWorkspaceID() (string, error) {
	currentPath := filepath.Join(m.configPath, "current.json")
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

// SetCurrentWorkspace sets the currently active workspace ID
func (m *Manager) SetCurrentWorkspace(id string) error {
	current := CurrentWorkspace{ID: id}
	data, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.configPath, "current.json"), data, 0644)
}

// SaveWorkspace saves a workspace configuration
// Uses workspace ID for filename (stable, no rename issues)
func (m *Manager) SaveWorkspace(ws *Workspace) error {
	ws.LastOpened = time.Now()
	if ws.Created.IsZero() {
		ws.Created = time.Now()
	}

	// Generate ID if not set
	if ws.ID == "" {
		ws.ID = GenerateWorkspaceID()
	}

	// Use workspace ID as filename (stable across renames)
	filename := ws.ID + ".json"
	wsPath := filepath.Join(m.configPath, "workspaces", filename)

	data, err := json.MarshalIndent(ws, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(wsPath, data, 0644); err != nil {
		return err
	}

	// Update current workspace
	return m.SetCurrentWorkspace(ws.ID)
}

// SaveWorkspaceWithRename is kept for API compatibility but just calls SaveWorkspace
// (rename logic no longer needed since files are named by ID)
func (m *Manager) SaveWorkspaceWithRename(ws *Workspace, oldName string) error {
	return m.SaveWorkspace(ws)
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

	return &ws, nil
}

// CreateWorkspace creates a new workspace with a generated ID
func (m *Manager) CreateWorkspace(name string) (*Workspace, error) {
	ws := &Workspace{
		ID:         GenerateWorkspaceID(),
		Name:       name,
		Agents:     []Agent{},
		Created:    time.Now(),
		LastOpened: time.Now(),
	}

	if err := m.SaveWorkspace(ws); err != nil {
		return nil, err
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

// encodeProjectPath encodes a folder path like Claude Code does
func encodeProjectPath(path string) string {
	// Replace / with -
	return strings.ReplaceAll(path, "/", "-")
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

	return nil
}
