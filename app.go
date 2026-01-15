package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"

	"claudefu/internal/auth"
	"claudefu/internal/providers"
	"claudefu/internal/runtime"
	"claudefu/internal/settings"
	"claudefu/internal/types"
	"claudefu/internal/watcher"
	"claudefu/internal/workspace"
)

// App struct holds the application state
type App struct {
	ctx              context.Context
	settings         *settings.Manager
	sessions         *settings.SessionManager
	auth             *auth.Service
	workspace        *workspace.Manager
	watcher          *watcher.FileWatcher
	claude           *providers.ClaudeCodeService
	rt               *runtime.WorkspaceRuntime
	currentWorkspace *workspace.Workspace
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// =============================================================================
// STARTUP - Single Initialization Chain
// =============================================================================

// emitLoadingStatus emits a loading status message to the frontend splash screen
func (a *App) emitLoadingStatus(status string) {
	wailsrt.EventsEmit(a.ctx, "loading:status", map[string]any{
		"status": status,
	})
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Step 1: Load persisted state (settings, session timestamps)
	a.emitLoadingStatus("Initializing settings...")
	a.loadPersistedState()

	// Step 2: Load current workspace
	a.emitLoadingStatus("Loading workspace...")
	a.loadCurrentWorkspace()

	// Step 3: Initialize file watcher
	a.emitLoadingStatus("Setting up file watchers...")
	a.initializeWatcher()

	// Step 4: Initialize runtime and start watching
	a.initializeRuntime()

	// Step 5: Start watching all agents (emits per-agent status internally)
	a.startWatchingAllAgents()

	// Step 6: Initialize Claude CLI
	a.emitLoadingStatus("Initializing Claude CLI...")
	a.initializeClaude()

	// Step 7: Emit initial state to frontend
	a.emitInitialState()

	wailsrt.LogInfo(ctx, fmt.Sprintf("ClaudeFu initialized. Config path: %s", a.settings.GetConfigPath()))
}

// loadPersistedState loads settings and session state from disk
func (a *App) loadPersistedState() {
	// Initialize settings manager
	sm, err := settings.NewManager()
	if err != nil {
		wailsrt.LogError(a.ctx, fmt.Sprintf("Failed to initialize settings: %v", err))
		return
	}
	a.settings = sm

	// Initialize session manager (for lastViewed timestamps and names)
	sessMgr, err := settings.NewSessionManager(sm.GetConfigPath())
	if err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to initialize session manager: %v", err))
	} else {
		a.sessions = sessMgr
	}

	// Initialize auth service
	a.auth = auth.NewService(sm)

	// Initialize workspace manager
	a.workspace = workspace.NewManager(sm.GetConfigPath())
}

// loadCurrentWorkspace loads the current workspace and migrates if needed
func (a *App) loadCurrentWorkspace() {
	if a.workspace == nil {
		return
	}

	wsID, err := a.workspace.GetCurrentWorkspaceID()
	if err != nil || wsID == "" {
		wailsrt.LogInfo(a.ctx, "No current workspace set")
		return
	}

	ws, err := a.workspace.LoadWorkspace(wsID)
	if err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load workspace %s: %v", wsID, err))
		return
	}

	// Migrate workspace to latest version (adds UUIDs to agents)
	ws = a.workspace.MigrateWorkspace(ws)

	// Save migrated workspace
	if err := a.workspace.SaveWorkspace(ws); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to save migrated workspace: %v", err))
	}

	a.currentWorkspace = ws
}

// initializeWatcher creates the file watcher
func (a *App) initializeWatcher() {
	fw, err := watcher.NewFileWatcher()
	if err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to initialize file watcher: %v", err))
		return
	}
	a.watcher = fw
}

// initializeRuntime creates the workspace runtime if we have a workspace
func (a *App) initializeRuntime() {
	if a.currentWorkspace == nil || a.watcher == nil {
		return
	}

	// Create emit function that wraps events in EventEnvelope
	emitFunc := func(envelope types.EventEnvelope) {
		wailsrt.EventsEmit(a.ctx, envelope.EventType, envelope)
	}

	// Create runtime
	a.rt = runtime.NewWorkspaceRuntime(a.currentWorkspace, emitFunc)

	// Connect watcher to runtime
	a.watcher.SetRuntime(a.rt)
}

// startWatchingAllAgents starts watching all agents in the current workspace
func (a *App) startWatchingAllAgents() {
	if a.currentWorkspace == nil || a.watcher == nil {
		return
	}

	for _, agent := range a.currentWorkspace.Agents {
		// Emit per-agent loading status
		a.emitLoadingStatus(fmt.Sprintf("Loading %s...", agent.Name))

		// Get last viewed timestamps for this agent's sessions
		var lastViewedMap map[string]int64
		if a.sessions != nil {
			lastViewedMap = a.sessions.GetAllLastViewed(agent.Folder)
		}

		if err := a.watcher.StartWatchingAgent(agent.ID, agent.Folder, lastViewedMap); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to start watching agent %s: %v", agent.Name, err))
		}
	}
}

// initializeClaude initializes the Claude CLI integration
func (a *App) initializeClaude() {
	a.claude = providers.NewClaudeCodeService(a.ctx)

	if providers.IsClaudeInstalled() {
		if version, err := providers.GetClaudeVersion(); err == nil {
			wailsrt.LogInfo(a.ctx, fmt.Sprintf("Claude Code CLI detected: %s", version))
		}
	} else {
		wailsrt.LogWarning(a.ctx, "Claude Code CLI not found in PATH - message sending will be disabled")
	}
}

// emitInitialState emits the workspace:loaded event with all initial state
func (a *App) emitInitialState() {
	if a.currentWorkspace == nil || a.rt == nil {
		return
	}

	// Build sessions map
	sessionsMap := make(map[string][]types.Session)
	unreadMap := make(map[string]map[string]int)

	for _, agent := range a.currentWorkspace.Agents {
		sessions := a.rt.GetSessionsForAgent(agent.ID)
		typeSessions := make([]types.Session, 0, len(sessions))
		sessionUnread := make(map[string]int)

		for _, s := range sessions {
			typeSessions = append(typeSessions, types.Session{
				ID:           s.SessionID,
				AgentID:      s.AgentID,
				Preview:      s.Preview,
				MessageCount: len(s.Messages),
				CreatedAt:    s.CreatedAt,
				UpdatedAt:    s.UpdatedAt,
			})
			sessionUnread[s.SessionID] = s.UnreadCount
		}

		sessionsMap[agent.ID] = typeSessions
		unreadMap[agent.ID] = sessionUnread
	}

	// Emit workspace:loaded event
	a.rt.Emit("workspace:loaded", "", "", map[string]any{
		"workspace":    a.currentWorkspace,
		"agents":       a.currentWorkspace.Agents,
		"sessions":     sessionsMap,
		"unreadCounts": unreadMap,
	})
}

// =============================================================================
// SETTINGS METHODS (Bound to frontend)
// =============================================================================

// GetSettings returns current application settings
func (a *App) GetSettings() settings.Settings {
	if a.settings == nil {
		return settings.Settings{}
	}
	return a.settings.GetSettings()
}

// SaveSettings saves application settings
func (a *App) SaveSettings(s settings.Settings) error {
	if a.settings == nil {
		return fmt.Errorf("settings manager not initialized")
	}
	return a.settings.SaveSettings(s)
}

// GetConfigPath returns the path to the config directory (~/.claudefu)
func (a *App) GetConfigPath() string {
	if a.settings == nil {
		return ""
	}
	return a.settings.GetConfigPath()
}

// =============================================================================
// AUTH METHODS (Bound to frontend)
// =============================================================================

// GetAuthStatus returns current authentication status
func (a *App) GetAuthStatus() auth.AuthStatus {
	if a.auth == nil {
		return auth.AuthStatus{}
	}
	return a.auth.GetAuthStatus()
}

// SetAPIKey sets the Anthropic API key for authentication
func (a *App) SetAPIKey(apiKey string) error {
	if a.auth == nil {
		return fmt.Errorf("auth service not initialized")
	}
	return a.auth.SetAPIKey(apiKey)
}

// ClearAPIKey removes the stored API key
func (a *App) ClearAPIKey() error {
	if a.auth == nil {
		return fmt.Errorf("auth service not initialized")
	}
	return a.auth.ClearAPIKey()
}

// StartHyperLogin initiates Claude Pro/Max device auth flow
func (a *App) StartHyperLogin() (*auth.DeviceAuthInfo, error) {
	if a.auth == nil {
		return nil, fmt.Errorf("auth service not initialized")
	}

	info, err := a.auth.StartHyperLogin(a.ctx)
	if err != nil {
		return nil, err
	}

	wailsrt.BrowserOpenURL(a.ctx, info.VerificationURL)
	return info, nil
}

// CompleteHyperLogin polls for auth completion
func (a *App) CompleteHyperLogin(deviceCode string, expiresIn int) error {
	if a.auth == nil {
		return fmt.Errorf("auth service not initialized")
	}
	return a.auth.CompleteHyperLogin(a.ctx, deviceCode, expiresIn)
}

// Logout clears all authentication data
func (a *App) Logout() error {
	if a.auth == nil {
		return fmt.Errorf("auth service not initialized")
	}
	return a.auth.Logout()
}

// =============================================================================
// DIALOG WRAPPERS (Go-only runtime functions exposed to frontend)
// =============================================================================

// SelectDirectory opens a directory picker dialog
func (a *App) SelectDirectory(title string) (string, error) {
	return wailsrt.OpenDirectoryDialog(a.ctx, wailsrt.OpenDialogOptions{
		Title: title,
	})
}

// SelectFile opens a file picker dialog
func (a *App) SelectFile(title string) (string, error) {
	return wailsrt.OpenFileDialog(a.ctx, wailsrt.OpenDialogOptions{
		Title: title,
	})
}

// SaveFile opens a save file dialog
func (a *App) SaveFile(defaultFilename string) (string, error) {
	return wailsrt.SaveFileDialog(a.ctx, wailsrt.SaveDialogOptions{
		DefaultFilename: defaultFilename,
	})
}

// ConfirmDialog shows a confirmation dialog
func (a *App) ConfirmDialog(title, message string) (bool, error) {
	result, err := wailsrt.MessageDialog(a.ctx, wailsrt.MessageDialogOptions{
		Type:    wailsrt.QuestionDialog,
		Title:   title,
		Message: message,
	})
	return result == "Yes", err
}

// AlertDialog shows an info alert dialog
func (a *App) AlertDialog(title, message string) error {
	_, err := wailsrt.MessageDialog(a.ctx, wailsrt.MessageDialogOptions{
		Type:    wailsrt.InfoDialog,
		Title:   title,
		Message: message,
	})
	return err
}

// =============================================================================
// WORKSPACE METHODS (Bound to frontend)
// =============================================================================

// GetAllWorkspaces returns all workspaces from the workspaces folder
func (a *App) GetAllWorkspaces() ([]workspace.WorkspaceSummary, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}
	return a.workspace.GetAllWorkspaces()
}

// GetCurrentWorkspaceID returns the ID of the currently active workspace
func (a *App) GetCurrentWorkspaceID() (string, error) {
	if a.workspace == nil {
		return "", fmt.Errorf("workspace manager not initialized")
	}
	return a.workspace.GetCurrentWorkspaceID()
}

// SwitchWorkspace performs a clean workspace switch with full state teardown
func (a *App) SwitchWorkspace(workspaceID string) (*workspace.Workspace, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}

	// Step 1: Emit workspace:changed (triggers frontend splash)
	a.emitLoadingStatus("Switching workspace...")
	if a.rt != nil {
		a.rt.Emit("workspace:changed", "", "", map[string]any{
			"workspaceId": nil,
		})
	}

	// Step 2: Stop all watchers
	if a.watcher != nil {
		a.watcher.StopAllWatchers()
	}

	// Step 3: Clear runtime state
	if a.rt != nil {
		a.rt.Clear()
	}

	// Step 4: Load new workspace
	a.emitLoadingStatus("Loading workspace...")
	ws, err := a.workspace.LoadWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	// Step 5: Migrate and save
	ws = a.workspace.MigrateWorkspace(ws)
	if err := a.workspace.SaveWorkspace(ws); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to save migrated workspace: %v", err))
	}

	// Step 6: Set as current
	if err := a.workspace.SetCurrentWorkspace(workspaceID); err != nil {
		return nil, err
	}
	a.currentWorkspace = ws

	// Step 7: Re-initialize runtime
	a.emitLoadingStatus("Setting up file watchers...")
	a.initializeRuntime()

	// Step 8: Start watching all agents (emits per-agent status internally)
	a.startWatchingAllAgents()

	// Step 9: Emit initial state
	a.emitInitialState()

	return ws, nil
}

// CreateWorkspace creates a new workspace with a generated ID
func (a *App) CreateWorkspace(name string) (*workspace.Workspace, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}
	return a.workspace.CreateWorkspace(name)
}

// SaveWorkspace saves workspace configuration
func (a *App) SaveWorkspace(ws workspace.Workspace) error {
	if a.workspace == nil {
		return fmt.Errorf("workspace manager not initialized")
	}
	return a.workspace.SaveWorkspace(&ws)
}

// SaveWorkspaceWithRename saves workspace and deletes old file if name changed
func (a *App) SaveWorkspaceWithRename(ws workspace.Workspace, oldName string) error {
	if a.workspace == nil {
		return fmt.Errorf("workspace manager not initialized")
	}
	return a.workspace.SaveWorkspaceWithRename(&ws, oldName)
}

// SelectWorkspaceFolder opens folder picker and returns selected path
func (a *App) SelectWorkspaceFolder() (string, error) {
	return wailsrt.OpenDirectoryDialog(a.ctx, wailsrt.OpenDialogOptions{
		Title: "Select Project Folder",
	})
}

// =============================================================================
// AGENT METHODS (Bound to frontend)
// =============================================================================

// getAgentByID finds an agent by ID in the current workspace
func (a *App) getAgentByID(agentID string) *workspace.Agent {
	if a.currentWorkspace == nil {
		return nil
	}
	for i := range a.currentWorkspace.Agents {
		if a.currentWorkspace.Agents[i].ID == agentID {
			return &a.currentWorkspace.Agents[i]
		}
	}
	return nil
}

// AddAgent adds a new agent to the current workspace
func (a *App) AddAgent(name, folder string) (*workspace.Agent, error) {
	if a.currentWorkspace == nil {
		return nil, fmt.Errorf("no workspace loaded")
	}

	agent := workspace.Agent{
		ID:        workspace.GenerateAgentID(),
		Name:      name,
		Folder:    folder,
		WatchMode: types.WatchModeFile,
	}

	a.currentWorkspace.Agents = append(a.currentWorkspace.Agents, agent)

	if err := a.workspace.SaveWorkspace(a.currentWorkspace); err != nil {
		return nil, err
	}

	// Start watching the new agent
	if a.watcher != nil && a.rt != nil {
		var lastViewedMap map[string]int64
		if a.sessions != nil {
			lastViewedMap = a.sessions.GetAllLastViewed(folder)
		}
		a.watcher.StartWatchingAgent(agent.ID, folder, lastViewedMap)
	}

	// Emit agent:added event
	if a.rt != nil {
		a.rt.Emit("agent:added", agent.ID, "", map[string]any{
			"agent": agent,
		})
	}

	return &agent, nil
}

// RemoveAgent removes an agent from the current workspace
func (a *App) RemoveAgent(agentID string) error {
	if a.currentWorkspace == nil {
		return fmt.Errorf("no workspace loaded")
	}

	// Find and remove the agent
	var folder string
	for i, agent := range a.currentWorkspace.Agents {
		if agent.ID == agentID {
			folder = agent.Folder
			a.currentWorkspace.Agents = append(a.currentWorkspace.Agents[:i], a.currentWorkspace.Agents[i+1:]...)
			break
		}
	}

	if folder == "" {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	if err := a.workspace.SaveWorkspace(a.currentWorkspace); err != nil {
		return err
	}

	// Stop watching the agent
	if a.watcher != nil {
		a.watcher.StopWatchingAgent(folder)
	}

	// Emit agent:removed event
	if a.rt != nil {
		a.rt.Emit("agent:removed", agentID, "", map[string]any{
			"agentId": agentID,
		})
	}

	return nil
}

// UpdateAgent updates an existing agent
func (a *App) UpdateAgent(agent workspace.Agent) error {
	if a.currentWorkspace == nil {
		return fmt.Errorf("no workspace loaded")
	}

	for i := range a.currentWorkspace.Agents {
		if a.currentWorkspace.Agents[i].ID == agent.ID {
			a.currentWorkspace.Agents[i] = agent
			return a.workspace.SaveWorkspace(a.currentWorkspace)
		}
	}

	return fmt.Errorf("agent not found: %s", agent.ID)
}

// GetAgent returns an agent by ID
func (a *App) GetAgent(agentID string) (*workspace.Agent, error) {
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}
	return agent, nil
}

// =============================================================================
// SESSION METHODS (Bound to frontend)
// =============================================================================

// GetSessions returns sessions for an agent
func (a *App) GetSessions(agentID string) ([]types.Session, error) {
	if a.rt == nil {
		return nil, fmt.Errorf("runtime not initialized")
	}

	sessions := a.rt.GetSessionsForAgent(agentID)
	result := make([]types.Session, 0, len(sessions))
	for _, s := range sessions {
		// Skip subagent sessions (format: agent-{short-id})
		// These are quick task executions, not main conversations
		if strings.HasPrefix(s.SessionID, "agent-") {
			continue
		}

		result = append(result, types.Session{
			ID:           s.SessionID,
			AgentID:      s.AgentID,
			Preview:      s.Preview,
			MessageCount: len(s.Messages),
			CreatedAt:    s.CreatedAt,
			UpdatedAt:    s.UpdatedAt,
		})
	}
	return result, nil
}

// GetConversation returns messages for a session
func (a *App) GetConversation(agentID, sessionID string) ([]types.Message, error) {
	if a.rt == nil {
		return nil, fmt.Errorf("runtime not initialized")
	}

	messages := a.rt.GetMessages(agentID, sessionID)
	if messages == nil {
		return []types.Message{}, nil
	}
	return messages, nil
}

// GetSubagentConversation returns messages from a subagent JSONL file
func (a *App) GetSubagentConversation(agentID, sessionID, subagentID string) ([]types.Message, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	return a.workspace.GetSubagentConversation(agent.Folder, sessionID, subagentID)
}

// SetActiveSession sets the currently active session for streaming updates
func (a *App) SetActiveSession(agentID, sessionID string) error {
	if a.rt == nil {
		return fmt.Errorf("runtime not initialized")
	}

	a.rt.SetActiveSession(agentID, sessionID)
	return nil
}

// ClearActiveSession clears the active session
func (a *App) ClearActiveSession() {
	if a.rt != nil {
		a.rt.ClearActiveSession()
	}
}

// MarkSessionViewed marks a session as viewed
func (a *App) MarkSessionViewed(agentID, sessionID string) error {
	// Get folder from agent
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	// Update persisted timestamp
	if a.sessions != nil {
		if err := a.sessions.SetLastViewed(agent.Folder, sessionID); err != nil {
			return err
		}
	}

	// Update runtime state
	if a.rt != nil {
		a.rt.MarkSessionViewed(agentID, sessionID)
		a.rt.EmitUnreadChanged(agentID, sessionID)
	}

	return nil
}

// =============================================================================
// UNREAD METHODS (Bound to frontend)
// =============================================================================

// GetUnreadCounts returns unread counts for all sessions in an agent
func (a *App) GetUnreadCounts(agentID string) map[string]int {
	if a.rt == nil {
		return make(map[string]int)
	}
	return a.rt.GetAllUnreadCounts(agentID)
}

// GetAgentTotalUnread returns total unread count for an agent
func (a *App) GetAgentTotalUnread(agentID string) int {
	if a.rt == nil {
		return 0
	}
	return a.rt.GetAgentTotalUnread(agentID)
}

// =============================================================================
// CLAUDE CODE METHODS (Bound to frontend)
// =============================================================================

// SendMessage sends a message to Claude Code
// If planMode is true, forces Claude into planning mode
func (a *App) SendMessage(agentID, sessionID, message string, planMode bool) error {
	if a.claude == nil {
		return fmt.Errorf("claude service not initialized")
	}
	if !providers.IsClaudeInstalled() {
		return fmt.Errorf("claude CLI not installed - please install Claude Code first")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	return a.claude.SendMessage(agent.Folder, sessionID, message, planMode)
}

// NewSession creates a new Claude Code session
func (a *App) NewSession(agentID string) (string, error) {
	fmt.Printf("[DEBUG] NewSession called for agentID: %s\n", agentID)

	if a.claude == nil {
		fmt.Printf("[DEBUG] NewSession error: claude service not initialized\n")
		return "", fmt.Errorf("claude service not initialized")
	}
	if !providers.IsClaudeInstalled() {
		fmt.Printf("[DEBUG] NewSession error: claude CLI not installed\n")
		return "", fmt.Errorf("claude CLI not installed - please install Claude Code first")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		fmt.Printf("[DEBUG] NewSession error: agent not found: %s\n", agentID)
		return "", fmt.Errorf("agent not found: %s", agentID)
	}

	fmt.Printf("[DEBUG] NewSession: calling claude.NewSession for folder: %s\n", agent.Folder)
	sessionId, err := a.claude.NewSession(agent.Folder)
	fmt.Printf("[DEBUG] NewSession result: sessionId=%s, err=%v\n", sessionId, err)
	return sessionId, err
}

// IsClaudeInstalled checks if the Claude Code CLI is available
func (a *App) IsClaudeInstalled() bool {
	return providers.IsClaudeInstalled()
}

// ReadPlanFile reads the contents of a plan file
func (a *App) ReadPlanFile(filePath string) (string, error) {
	if filePath == "" {
		return "", fmt.Errorf("filePath is required")
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read plan file: %w", err)
	}
	return string(data), nil
}

// GetPlanFilePath returns the active plan file path for a session
func (a *App) GetPlanFilePath(agentID, sessionID string) string {
	if a.rt == nil {
		return ""
	}
	return a.rt.GetPlanFilePath(agentID, sessionID)
}

// AnswerQuestion answers a pending AskUserQuestion by patching the JSONL and resuming the session.
// This enables interactive question handling even when Claude Code runs in --print mode.
func (a *App) AnswerQuestion(agentID, sessionID, toolUseID string, questions []map[string]any, answers map[string]string) error {
	if a.claude == nil {
		return fmt.Errorf("claude service not initialized")
	}
	if !providers.IsClaudeInstalled() {
		return fmt.Errorf("claude CLI not installed - please install Claude Code first")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	// Step 1: Patch the JSONL file to convert failed tool_result to success
	if err := workspace.PatchQuestionAnswer(agent.Folder, sessionID, toolUseID, questions, answers); err != nil {
		return fmt.Errorf("failed to patch JSONL: %w", err)
	}

	// Step 2: Reload session cache from the patched JSONL file
	// This ensures GetMessages returns fresh data with is_error=false
	if a.watcher != nil {
		if err := a.watcher.ReloadSession(agent.Folder, sessionID); err != nil {
			fmt.Printf("[WARN] Failed to reload session after patch: %v\n", err)
			// Continue anyway - the data is on disk, worst case user refreshes
		}
	}

	// Step 3: Resume the session with "question answered" to trigger Claude continuation
	return a.claude.SendMessage(agent.Folder, sessionID, "question answered", false)
}

// =============================================================================
// SESSION NAMING METHODS (Bound to frontend)
// =============================================================================

// GetSessionName returns the custom name for a session
func (a *App) GetSessionName(agentID, sessionID string) string {
	if a.sessions == nil {
		return ""
	}
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return ""
	}
	return a.sessions.GetSessionName(agent.Folder, sessionID)
}

// SetSessionName sets a custom name for a session
func (a *App) SetSessionName(agentID, sessionID, name string) error {
	if a.sessions == nil {
		return fmt.Errorf("session manager not initialized")
	}
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}
	return a.sessions.SetSessionName(agent.Folder, sessionID, name)
}

// GetAllSessionNames returns all session names for an agent
func (a *App) GetAllSessionNames(agentID string) map[string]string {
	if a.sessions == nil {
		return make(map[string]string)
	}
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return make(map[string]string)
	}
	return a.sessions.GetAllSessionNames(agent.Folder)
}

// =============================================================================
// VERSION METHODS (Bound to frontend)
// =============================================================================

// GetVersion returns the application version from the VERSION file
func (a *App) GetVersion() string {
	// Try to read embedded version file, fall back to reading from disk
	versionFile := "VERSION"
	data, err := os.ReadFile(versionFile)
	if err != nil {
		// Try relative to executable
		return "0.0.0"
	}
	return strings.TrimSpace(string(data))
}

// =============================================================================
// UTILITY METHODS (Bound to frontend)
// =============================================================================

// ReadImageAsDataURL reads an image file and returns it as a base64 data URL
func (a *App) ReadImageAsDataURL(filePath string) (string, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read image: %w", err)
	}

	// Determine MIME type from file extension
	ext := strings.ToLower(filepath.Ext(filePath))
	mimeType := "image/jpeg" // default
	switch ext {
	case ".png":
		mimeType = "image/png"
	case ".gif":
		mimeType = "image/gif"
	case ".webp":
		mimeType = "image/webp"
	case ".svg":
		mimeType = "image/svg+xml"
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, encoded), nil
}
