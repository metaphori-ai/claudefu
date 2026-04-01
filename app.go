package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"

	"claudefu/internal/auth"
	"claudefu/internal/defaults"
	"claudefu/internal/mcpserver"
	"claudefu/internal/providers"
	"claudefu/internal/proxy"
	"claudefu/internal/runtime"
	"claudefu/internal/session"
	"claudefu/internal/settings"
	"claudefu/internal/terminal"
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
	workspaceState   *workspace.WorkspaceState // Per-machine runtime state (local/workspace-state/)
	mcpServer        *mcpserver.MCPService
	proxy            *proxy.Service   // Cache fix reverse proxy
	sessionService   *session.Service // Instant session creation (no CLI wait)
	terminalManager  *terminal.Manager
	cliArgs          *CLIArgs         // CLI arguments (e.g., `claudefu .`)
	reconciledIDs    map[string]string // oldAgentID → newAgentID from registry reconciliation

	// Self-update state
	updateReady   bool   // True when update is downloaded and staged
	updateVersion string // Version that's staged (e.g., "0.5.10")
	updateMu      sync.Mutex
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

	// Step 5b: Restore per-agent session file watches from persisted SelectedSessionID
	a.restoreAgentSessionWatches()

	// Step 6: Initialize Claude CLI
	a.emitLoadingStatus("Initializing Claude CLI...")
	a.initializeClaude()

	// Step 7: Initialize cache fix proxy (before MCP, after Claude CLI)
	a.emitLoadingStatus("Starting cache fix proxy...")
	a.initializeProxy()

	// Step 8: Initialize MCP server for inter-agent communication
	a.emitLoadingStatus("Starting MCP server...")
	a.initializeMCPServer()

	// Step 8: Initialize terminal manager
	a.terminalManager = terminal.NewManager(func(eventType string, args ...any) {
		if len(args) > 0 {
			wailsrt.EventsEmit(a.ctx, eventType, args[0])
		}
	})

	// Step 9: Emit initial state to frontend
	a.emitInitialState()

	// Step 9: Refresh menu now that workspace is loaded
	a.RefreshMenu()

	// Step 10: Process CLI arguments (e.g., `claudefu .` to add folder as agent)
	a.processStartupArgs()

	wailsrt.LogInfo(ctx, fmt.Sprintf("ClaudeFu initialized. Config path: %s", a.settings.GetConfigPath()))
}

// processStartupArgs handles CLI arguments like `claudefu /path/to/folder`.
// Workspace selection already happened in the terminal (before GUI started).
func (a *App) processStartupArgs() {
	if a.cliArgs == nil || a.cliArgs.Folder == "" {
		return
	}

	folder := a.cliArgs.Folder

	// Switch workspace if the CLI-selected one differs from current
	if a.cliArgs.WorkspaceID != "" && (a.currentWorkspace == nil || a.currentWorkspace.ID != a.cliArgs.WorkspaceID) {
		if _, err := a.SwitchWorkspace(a.cliArgs.WorkspaceID); err != nil {
			wailsrt.LogError(a.ctx, fmt.Sprintf("Failed to switch workspace: %v", err))
			return
		}
	}

	// Check if folder already exists as agent in current workspace
	if a.currentWorkspace != nil {
		for _, agent := range a.currentWorkspace.Agents {
			if agent.Folder == folder {
				// Already an agent — just select it
				if a.rt != nil {
					a.rt.Emit("agent:select", agent.ID, "", map[string]any{
						"agentId": agent.ID,
					})
				}
				return
			}
		}
	}

	// Add as new agent (derive name from folder basename)
	name := filepath.Base(folder)
	agent, err := a.AddAgent(name, folder)
	if err != nil {
		wailsrt.LogError(a.ctx, fmt.Sprintf("Failed to add agent from CLI: %v", err))
		return
	}

	// Select the newly added agent
	if a.rt != nil {
		a.rt.Emit("agent:select", agent.ID, "", map[string]any{
			"agentId": agent.ID,
		})
	}
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

	// Ensure local/ directory structure exists (for per-machine runtime state)
	if err := a.workspace.EnsureLocalDirs(); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to create local dirs: %v", err))
	}

	// Initialize session service (instant session creation)
	a.sessionService = session.NewService()

	// Ensure default templates exist (UPSERT: create if missing, never overwrite)
	a.ensureDefaultTemplates()
}

// ensureDefaultTemplates creates ~/.claudefu/default-templates/ with default files if missing.
func (a *App) ensureDefaultTemplates() {
	if a.settings == nil {
		return
	}
	templatesDir := filepath.Join(a.settings.GetConfigPath(), "default-templates")
	if err := os.MkdirAll(templatesDir, 0755); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to create default-templates dir: %v", err))
		return
	}

	// CLAUDE.md template — only write if missing
	claudeMDPath := filepath.Join(templatesDir, "CLAUDE.md")
	if _, err := os.Stat(claudeMDPath); os.IsNotExist(err) {
		if err := os.WriteFile(claudeMDPath, []byte(defaults.ClaudeMDTemplate()), 0644); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to write default CLAUDE.md template: %v", err))
		}
	}

	// SIFU.md template — only write if missing
	sifuMDPath := filepath.Join(templatesDir, "SIFU.md")
	if _, err := os.Stat(sifuMDPath); os.IsNotExist(err) {
		if err := os.WriteFile(sifuMDPath, []byte(defaults.SifuMDTemplate()), 0644); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to write default SIFU.md template: %v", err))
		}
	}

	// SIFU_AGENT.md template — only write if missing
	sifuAgentMDPath := filepath.Join(templatesDir, "SIFU_AGENT.md")
	if _, err := os.Stat(sifuAgentMDPath); os.IsNotExist(err) {
		if err := os.WriteFile(sifuAgentMDPath, []byte(defaults.SifuAgentMDTemplate()), 0644); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to write default SIFU_AGENT.md template: %v", err))
		}
	}
}

// loadCurrentWorkspace loads the current workspace, migrates runtime fields to local/,
// and populates in-memory state from the workspace state file.
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
	ws = a.workspace.UpgradeWorkspaceSchema(ws)

	// Reconcile agent IDs against global registry (ensures same folder = same UUID)
	a.reconciledIDs = a.workspace.SyncAgentIDsFromRegistry(ws)
	if len(a.reconciledIDs) > 0 {
		fmt.Printf("[INFO] Reconciled %d agent IDs against global registry\n", len(a.reconciledIDs))
	}

	// Migrate runtime fields from workspace JSON to local/workspace-state/ (one-time).
	// This must happen AFTER reconciliation so extracted agent IDs are correct.
	a.workspace.ExtractRuntimeToStateFile(ws)

	// Save cleaned workspace JSON (runtime fields stripped by SaveWorkspace)
	if err := a.workspace.SaveWorkspace(ws); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to save migrated workspace: %v", err))
	}

	// Load per-machine runtime state from local/workspace-state/
	wsState := a.workspace.LoadWorkspaceState(wsID)

	// Reconcile agent IDs in workspace state if registry changed any
	if len(a.reconciledIDs) > 0 {
		reconcileWorkspaceState(wsState, a.reconciledIDs)
	}

	// Update LastOpened timestamp
	wsState.LastOpened = time.Now()
	if err := a.workspace.SaveWorkspaceState(wsID, wsState); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to save workspace state: %v", err))
	}

	// Populate in-memory workspace fields from state (for frontend emission and menu).
	// SaveWorkspace() strips these before writing to disk.
	populateWorkspaceFromState(ws, wsState)

	// Ensure Sifu agent if configured for this workspace
	if a.settings != nil {
		settings := a.settings.GetSettings()
		if err := a.workspace.EnsureSifuAgent(ws, settings.SifuEnabled, settings.SifuRootFolder); err != nil {
			fmt.Printf("[WARN] EnsureSifuAgent: %v\n", err)
		}
	}

	a.currentWorkspace = ws
	a.workspaceState = wsState
}

// populateWorkspaceFromState sets runtime fields on the in-memory workspace
// from the workspace state file. This ensures the frontend and menu see the
// correct selected session without any changes.
func populateWorkspaceFromState(ws *workspace.Workspace, state *workspace.WorkspaceState) {
	if state == nil {
		return
	}
	ws.SelectedSession = state.SelectedSession
	ws.LastOpened = state.LastOpened
	for i := range ws.Agents {
		if sessionID, ok := state.AgentSessions[ws.Agents[i].ID]; ok {
			ws.Agents[i].SelectedSessionID = sessionID
		}
	}
}

// reconcileWorkspaceState updates agent IDs in workspace state if the global
// registry reconciled any IDs (e.g., same folder got a different UUID).
func reconcileWorkspaceState(state *workspace.WorkspaceState, reconciledIDs map[string]string) {
	if state.SelectedSession != nil {
		if newID, ok := reconciledIDs[state.SelectedSession.AgentID]; ok {
			state.SelectedSession.AgentID = newID
		}
	}
	if len(state.AgentSessions) > 0 {
		newMap := make(map[string]string)
		for agentID, sessionID := range state.AgentSessions {
			if newID, ok := reconciledIDs[agentID]; ok {
				newMap[newID] = sessionID
			} else {
				newMap[agentID] = sessionID
			}
		}
		state.AgentSessions = newMap
	}
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
		a.emitLoadingStatus(fmt.Sprintf("Loading %s...", agent.GetSlug()))

		// Get last viewed timestamps for this agent's sessions
		var lastViewedMap map[string]int64
		if a.sessions != nil {
			lastViewedMap = a.sessions.GetAllLastViewed(agent.Folder)
		}

		if err := a.watcher.StartWatchingAgent(agent.ID, agent.Folder, lastViewedMap); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to start watching agent %s: %v", agent.GetSlug(), err))
		}
	}
}

// restoreAgentSessionWatches sets up file-level watches for each agent's persisted
// session selection. Reads from workspace state (local/) rather than workspace JSON.
// This ensures all agents' selected sessions are watched from startup, not just
// the one the user clicks on. Called after startWatchingAllAgents() which only
// sets up directory-level watchers.
func (a *App) restoreAgentSessionWatches() {
	if a.currentWorkspace == nil || a.watcher == nil || a.workspaceState == nil {
		return
	}

	for _, agent := range a.currentWorkspace.Agents {
		if sessionID, ok := a.workspaceState.AgentSessions[agent.ID]; ok && sessionID != "" {
			a.watcher.SetActiveSessionWatch(agent.ID, sessionID)
		}
	}
}

// initializeClaude initializes the Claude CLI integration
func (a *App) initializeClaude() {
	// Eagerly resolve the user's shell PATH (macOS GUI apps only get minimal launchd PATH)
	// Sources ~/.claudefu/bashrc if it exists, otherwise falls back to login shell
	if shellPATH := providers.GetShellPATH(); shellPATH != "" {
		wailsrt.LogInfo(a.ctx, fmt.Sprintf("Shell PATH resolved from %s", providers.GetShellPATHSource()))
	} else {
		wailsrt.LogWarning(a.ctx, "Could not resolve shell PATH — spawned processes may have limited PATH")
	}

	a.claude = providers.NewClaudeCodeService(a.ctx)

	// Apply custom environment variables and command from settings
	if a.settings != nil {
		s := a.settings.GetSettings()
		if len(s.ClaudeEnvVars) > 0 {
			a.claude.SetEnvironment(s.ClaudeEnvVars)
			wailsrt.LogInfo(a.ctx, fmt.Sprintf("Claude CLI environment configured with %d custom variable(s)", len(s.ClaudeEnvVars)))
		}
		if s.ClaudeCodeCommand != "" {
			providers.SetClaudeCommand(s.ClaudeCodeCommand)
			wailsrt.LogInfo(a.ctx, fmt.Sprintf("Claude CLI command: %s", s.ClaudeCodeCommand))
		}
	}

	// Set up emit function for debug info (CLI commands)
	a.claude.SetEmitFunc(func(eventType string, data map[string]any) {
		wailsrt.EventsEmit(a.ctx, eventType, data)
	})

	if providers.IsClaudeInstalled() {
		if version, err := providers.GetClaudeVersion(); err == nil {
			wailsrt.LogInfo(a.ctx, fmt.Sprintf("Claude Code CLI detected: %s", version))
		}
	} else {
		wailsrt.LogWarning(a.ctx, "Claude Code CLI not found in PATH - message sending will be disabled")
	}
}

// initializeProxy starts the cache fix proxy if enabled in settings.
// When running, it auto-injects ANTHROPIC_BASE_URL into Claude CLI env vars.
func (a *App) initializeProxy() {
	if a.settings == nil || a.claude == nil {
		return
	}

	s := a.settings.GetSettings()
	if !s.ProxyEnabled {
		return
	}

	port := s.ProxyPort
	if port == 0 {
		port = 9350
	}

	// Determine upstream: use user's ANTHROPIC_BASE_URL if set, otherwise Anthropic direct
	upstream := "https://api.anthropic.com"
	if userURL, ok := s.ClaudeEnvVars["ANTHROPIC_BASE_URL"]; ok && userURL != "" {
		// Chain through user's proxy (e.g., corporate mTLS proxy)
		upstream = userURL
	}

	// Determine log dir
	logDir := s.ProxyLogDir
	if logDir == "" {
		logDir = filepath.Join(a.settings.GetConfigPath(), "proxy-logs")
	}

	config := proxy.Config{
		Enabled:         true,
		Port:            port,
		CacheFixEnabled: s.ProxyCacheFix,
		CacheTTL:        s.ProxyCacheTTL,
		LoggingEnabled:  s.ProxyLogging,
		LogDir:          logDir,
		UpstreamURL:     upstream,
	}

	a.proxy = proxy.NewService(config)
	if err := a.proxy.Start(); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to start cache fix proxy: %v", err))
		return
	}

	wailsrt.LogInfo(a.ctx, fmt.Sprintf("Cache fix proxy started on :%d → %s (TTL: %s)", port, upstream, config.CacheTTL))

	// Auto-inject ANTHROPIC_BASE_URL pointing to our proxy
	proxyURL := fmt.Sprintf("http://localhost:%d", port)
	envVars := make(map[string]string)
	for k, v := range s.ClaudeEnvVars {
		envVars[k] = v
	}
	envVars["ANTHROPIC_BASE_URL"] = proxyURL
	a.claude.SetEnvironment(envVars)
}

// initializeMCPServer initializes the MCP server for inter-agent communication
func (a *App) initializeMCPServer() {
	// Default port 9315 for MCP server
	port := 9315
	// Config path for tool instructions (~/.claudefu)
	configPath := a.settings.GetConfigPath()
	// Inbox databases stored in ~/.claudefu/inbox/
	inboxPath := filepath.Join(configPath, "inbox")
	// Backlog databases stored in ~/.claudefu/backlog/
	backlogPath := filepath.Join(configPath, "backlog")
	a.mcpServer = mcpserver.NewMCPService(port, configPath, inboxPath, backlogPath)

	// Set up dependencies
	a.mcpServer.SetClaudeService(a.claude)
	a.mcpServer.SetWorkspaceGetter(func() *workspace.Workspace {
		return a.currentWorkspace
	})

	// Set up workspace manager for cross-workspace slug/UUID resolution
	a.mcpServer.SetManager(a.workspace)

	// Set up active session getter for synthetic JSONL writes (ExitPlanMode)
	a.mcpServer.SetActiveSessionGetter(func(agentSlug string) (agentID, sessionID, folder, slug string) {
		if a.currentWorkspace == nil || a.rt == nil {
			return "", "", "", ""
		}
		// Find agent by slug in current workspace
		for _, agent := range a.currentWorkspace.Agents {
			if agent.GetSlug() == agentSlug || agent.GetSlug() == agentSlug {
				agentState := a.rt.GetAgentState(agent.ID)
				if agentState == nil {
					return agent.ID, "", agent.Folder, ""
				}
				// Find the active session for this agent
				activeAgentID, activeSessionID := a.rt.GetActiveSession()
				if activeAgentID == agent.ID && activeSessionID != "" {
					session := a.rt.GetSessionState(agent.ID, activeSessionID)
					if session != nil {
						return agent.ID, activeSessionID, agent.Folder, session.Slug
					}
					return agent.ID, activeSessionID, agent.Folder, ""
				}
				return agent.ID, "", agent.Folder, ""
			}
		}
		return "", "", "", ""
	})

	// Set up emit function to forward events to Wails
	a.mcpServer.SetEmitFunc(func(envelope types.EventEnvelope) {
		// Add workspace ID to envelope if available
		if a.currentWorkspace != nil {
			envelope.WorkspaceID = a.currentWorkspace.ID
		}
		wailsrt.EventsEmit(a.ctx, envelope.EventType, envelope)
	})

	// Start the server
	if err := a.mcpServer.Start(); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to start MCP server: %v", err))
	} else {
		wailsrt.LogInfo(a.ctx, fmt.Sprintf("MCP server started on port %d", port))
		// Configure ClaudeCodeService to inject MCP config into spawned processes
		a.claude.SetMCPServerPort(port)
	}

	// Load inbox and backlog for current workspace
	if a.currentWorkspace != nil {
		agentIDs := a.agentIDs()

		// Migrate old per-workspace inbox DB to per-agent DBs (one-time)
		inboxPath := filepath.Join(a.settings.GetConfigPath(), "inbox")
		if err := mcpserver.MigrateInboxFromWorkspaceDB(inboxPath, a.currentWorkspace.ID, a.reconciledIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Inbox migration warning: %v", err))
		}

		// Load per-agent inbox databases
		if err := a.mcpServer.LoadInbox(agentIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load inbox: %v", err))
		}

		// Migrate old per-workspace backlog DB to per-agent DBs (one-time)
		backlogPath := filepath.Join(a.settings.GetConfigPath(), "backlog")
		if err := mcpserver.MigrateFromWorkspaceDB(backlogPath, a.currentWorkspace.ID, a.reconciledIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Backlog migration warning: %v", err))
		}

		// Load per-agent backlog databases
		if err := a.mcpServer.LoadBacklog(agentIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load backlog: %v", err))
		}
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

// shutdown is called when the app is closing
func (a *App) shutdown(ctx context.Context) {
	// Stop terminal sessions
	if a.terminalManager != nil {
		a.terminalManager.Shutdown()
	}

	// Stop cache fix proxy
	if a.proxy != nil {
		a.proxy.Stop()
	}

	// Stop MCP server and close databases
	if a.mcpServer != nil {
		a.mcpServer.Stop()
		a.mcpServer.CloseStores()
	}

	// Stop file watchers
	if a.watcher != nil {
		a.watcher.StopAllWatchers()
	}
}
