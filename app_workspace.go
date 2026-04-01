package main

import (
	"fmt"
	"path/filepath"
	"time"

	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"

	"claudefu/internal/mcpserver"
	"claudefu/internal/workspace"
)

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

// GetCurrentWorkspace returns the currently loaded workspace without reloading.
// Use this on frontend startup instead of SwitchWorkspace to avoid duplicate initialization.
func (a *App) GetCurrentWorkspace() *workspace.Workspace {
	return a.currentWorkspace
}

// ReloadCurrentWorkspace reloads the current workspace from disk with fresh registry data.
// Called by frontend after saving to registries (meta dialog, MCP settings) to ensure
// all UIs see updated agent identity (name, slug, description from PopulateAgentsFromRegistry).
func (a *App) ReloadCurrentWorkspace() (*workspace.Workspace, error) {
	if a.workspace == nil || a.currentWorkspace == nil {
		return nil, fmt.Errorf("no workspace loaded")
	}
	ws, err := a.workspace.LoadWorkspace(a.currentWorkspace.ID)
	if err != nil {
		return nil, err
	}
	// Re-apply runtime state (selected sessions, last opened) from workspace state file
	populateWorkspaceFromState(ws, a.workspaceState)
	a.currentWorkspace = ws
	return ws, nil
}

// SwitchWorkspace performs a clean workspace switch with full state teardown
func (a *App) SwitchWorkspace(workspaceID string) (*workspace.Workspace, error) {
	fmt.Printf("[DEBUG] SwitchWorkspace called: workspaceID=%s\n", workspaceID)
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

	// Step 5: Migrate and reconcile agent IDs against global registry
	ws = a.workspace.UpgradeWorkspaceSchema(ws)
	a.reconciledIDs = a.workspace.SyncAgentIDsFromRegistry(ws)
	if len(a.reconciledIDs) > 0 {
		fmt.Printf("[INFO] SwitchWorkspace: Reconciled %d agent IDs\n", len(a.reconciledIDs))
	}

	// Step 5b: Migrate runtime fields from workspace JSON to local/ (one-time)
	a.workspace.ExtractRuntimeToStateFile(ws)

	// Save cleaned workspace JSON (runtime fields stripped by SaveWorkspace)
	if err := a.workspace.SaveWorkspace(ws); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to save migrated workspace: %v", err))
	}

	// Step 5c: Load per-machine runtime state and reconcile
	wsState := a.workspace.LoadWorkspaceState(workspaceID)
	if len(a.reconciledIDs) > 0 {
		reconcileWorkspaceState(wsState, a.reconciledIDs)
	}

	// Update LastOpened timestamp
	wsState.LastOpened = time.Now()
	if err := a.workspace.SaveWorkspaceState(workspaceID, wsState); err != nil {
		wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to save workspace state: %v", err))
	}

	// Populate in-memory workspace from state (for frontend/menu)
	populateWorkspaceFromState(ws, wsState)

	// Step 6: Set as current
	if err := a.workspace.SetCurrentWorkspace(workspaceID); err != nil {
		return nil, err
	}
	a.currentWorkspace = ws
	a.workspaceState = wsState

	// Step 7: Re-initialize runtime
	a.emitLoadingStatus("Setting up file watchers...")
	a.initializeRuntime()

	// Step 8: Start watching all agents (emits per-agent status internally)
	a.startWatchingAllAgents()

	// Step 8b: Restore per-agent session file watches from persisted SelectedSessionID
	a.restoreAgentSessionWatches()

	// Step 9: Restart MCP server and load inbox/backlog for new workspace
	if a.mcpServer != nil {
		a.mcpServer.Restart()

		agentIDs := make([]string, len(ws.Agents))
		for i, agent := range ws.Agents {
			agentIDs[i] = agent.ID
		}

		// Migrate old per-workspace inbox DB to per-agent DBs (one-time)
		inboxPath := filepath.Join(a.settings.GetConfigPath(), "inbox")
		if err := mcpserver.MigrateInboxFromWorkspaceDB(inboxPath, ws.ID, a.reconciledIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Inbox migration warning: %v", err))
		}

		// Load per-agent inbox databases
		if err := a.mcpServer.LoadInbox(agentIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load inbox: %v", err))
		}

		// Migrate old per-workspace backlog DB to per-agent DBs (one-time)
		backlogPath := filepath.Join(a.settings.GetConfigPath(), "backlog")
		if err := mcpserver.MigrateFromWorkspaceDB(backlogPath, ws.ID, a.reconciledIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Backlog migration warning: %v", err))
		}

		// Load per-agent backlog databases
		if err := a.mcpServer.LoadBacklog(agentIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load backlog: %v", err))
		}
	}

	// Step 10: Ensure Sifu agent if configured
	if a.settings != nil {
		settings := a.settings.GetSettings()
		if err := a.workspace.EnsureSifuAgent(ws, settings.SifuEnabled, settings.SifuRootFolder); err != nil {
			fmt.Printf("[WARN] EnsureSifuAgent on switch: %v\n", err)
		}
	}

	// Step 11: Emit initial state
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

// RenameWorkspace renames a workspace by ID
func (a *App) RenameWorkspace(workspaceID string, newName string) error {
	if a.workspace == nil {
		return fmt.Errorf("workspace manager not initialized")
	}
	return a.workspace.RenameWorkspace(workspaceID, newName)
}

// DeleteWorkspace removes a workspace by ID.
// If deleting the current workspace, switches to another first.
// Also cleans up the MCP inbox database for the deleted workspace.
func (a *App) DeleteWorkspace(workspaceID string) error {
	if a.workspace == nil {
		return fmt.Errorf("workspace manager not initialized")
	}

	// If deleting current workspace, switch to another first
	currentID, _ := a.GetCurrentWorkspaceID()
	if workspaceID == currentID {
		// Find another workspace to switch to
		workspaces, err := a.GetAllWorkspaces()
		if err != nil {
			return fmt.Errorf("failed to list workspaces: %w", err)
		}

		var targetWorkspace string
		for _, ws := range workspaces {
			if ws.ID != workspaceID {
				targetWorkspace = ws.ID
				break
			}
		}

		if targetWorkspace == "" {
			return fmt.Errorf("cannot delete the only workspace")
		}

		// Switch to another workspace first
		if _, err := a.SwitchWorkspace(targetWorkspace); err != nil {
			return fmt.Errorf("failed to switch before delete: %w", err)
		}
	}

	// Delete the workspace
	if err := a.workspace.DeleteWorkspace(workspaceID); err != nil {
		return err
	}

	// Note: inbox is now per-agent (not per-workspace), so no inbox cleanup needed here.
	// Agent inbox DBs persist at ~/.claudefu/inbox/agents/{agent_id}.db

	// Clean up local workspace state file
	a.workspace.DeleteWorkspaceState(workspaceID)

	return nil
}

// SelectWorkspaceFolder opens folder picker and returns selected path
func (a *App) SelectWorkspaceFolder() (string, error) {
	return wailsrt.OpenDirectoryDialog(a.ctx, wailsrt.OpenDialogOptions{
		Title:                "Select Project Folder",
		CanCreateDirectories: true,
	})
}
