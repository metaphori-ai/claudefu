package main

import (
	"fmt"

	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"

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

	// Step 9: Restart MCP server and load inbox for new workspace
	if a.mcpServer != nil {
		a.mcpServer.Restart()
		if err := a.mcpServer.LoadInbox(ws.ID); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load inbox for workspace: %v", err))
		}
	}

	// Step 10: Emit initial state
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
		Title:                "Select Project Folder",
		CanCreateDirectories: true,
	})
}
