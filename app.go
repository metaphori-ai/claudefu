package main

import (
	"context"
	"fmt"
	"path/filepath"

	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"

	"claudefu/internal/auth"
	"claudefu/internal/mcpserver"
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
	mcpServer        *mcpserver.MCPService
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

	// Step 7: Initialize MCP server for inter-agent communication
	a.emitLoadingStatus("Starting MCP server...")
	a.initializeMCPServer()

	// Step 8: Emit initial state to frontend
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

	// DEBUG: Check if selectedSession was loaded
	if ws.SelectedSession != nil {
		fmt.Printf("[DEBUG] loadCurrentWorkspace: LOADED selectedSession agentId=%s sessionId=%s folder=%s\n",
			ws.SelectedSession.AgentID, ws.SelectedSession.SessionID, ws.SelectedSession.Folder)
	} else {
		fmt.Printf("[DEBUG] loadCurrentWorkspace: selectedSession is nil after LoadWorkspace\n")
	}

	// Migrate workspace to latest version (adds UUIDs to agents)
	ws = a.workspace.MigrateWorkspace(ws)

	// DEBUG: Check after migration
	if ws.SelectedSession != nil {
		fmt.Printf("[DEBUG] loadCurrentWorkspace: AFTER MIGRATE selectedSession agentId=%s sessionId=%s\n",
			ws.SelectedSession.AgentID, ws.SelectedSession.SessionID)
	} else {
		fmt.Printf("[DEBUG] loadCurrentWorkspace: selectedSession is nil AFTER MigrateWorkspace\n")
	}

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

// initializeMCPServer initializes the MCP server for inter-agent communication
func (a *App) initializeMCPServer() {
	// Default port 9315 for MCP server
	port := 9315
	// Config path for tool instructions (~/.claudefu)
	configPath := a.settings.GetConfigPath()
	// Inbox databases stored in ~/.claudefu/inbox/
	inboxPath := filepath.Join(configPath, "inbox")
	a.mcpServer = mcpserver.NewMCPService(port, configPath, inboxPath)

	// Set up dependencies
	a.mcpServer.SetClaudeService(a.claude)
	a.mcpServer.SetWorkspaceGetter(func() *workspace.Workspace {
		return a.currentWorkspace
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

	// Load inbox for current workspace
	if a.currentWorkspace != nil {
		if err := a.mcpServer.LoadInbox(a.currentWorkspace.ID); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load inbox: %v", err))
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
	// Stop MCP server
	if a.mcpServer != nil {
		a.mcpServer.Stop()
	}

	// Stop file watchers
	if a.watcher != nil {
		a.watcher.StopAllWatchers()
	}
}
