package main

import (
	"fmt"
	"os"
	"path/filepath"

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
	ws = a.workspace.MigrateWorkspace(ws)
	if a.workspace.Registry != nil {
		a.reconciledIDs = a.workspace.Registry.ReconcileWorkspace(ws)
		if len(a.reconciledIDs) > 0 {
			fmt.Printf("[INFO] SwitchWorkspace: Reconciled %d agent IDs\n", len(a.reconciledIDs))
			if ws.SelectedSession != nil {
				if newID, ok := a.reconciledIDs[ws.SelectedSession.AgentID]; ok {
					ws.SelectedSession.AgentID = newID
				}
			}
		}
	}
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

	// Step 9: Restart MCP server and load inbox/backlog for new workspace
	if a.mcpServer != nil {
		a.mcpServer.Restart()
		if err := a.mcpServer.LoadInbox(ws.ID); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load inbox for workspace: %v", err))
		}

		// Migrate inbox agent IDs if reconciliation changed any
		if len(a.reconciledIDs) > 0 {
			a.mcpServer.MigrateInboxAgentIDs(a.reconciledIDs)
		}

		// Migrate old per-workspace backlog DB to per-agent DBs (one-time)
		backlogPath := filepath.Join(a.settings.GetConfigPath(), "backlog")
		if err := mcpserver.MigrateFromWorkspaceDB(backlogPath, ws.ID, a.reconciledIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Backlog migration warning: %v", err))
		}

		// Load per-agent backlog databases
		agentIDs := make([]string, len(ws.Agents))
		for i, agent := range ws.Agents {
			agentIDs[i] = agent.ID
		}
		if err := a.mcpServer.LoadBacklog(agentIDs); err != nil {
			wailsrt.LogWarning(a.ctx, fmt.Sprintf("Failed to load backlog: %v", err))
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

	// Clean up MCP inbox database (ignore errors if doesn't exist)
	if a.settings != nil {
		inboxPath := filepath.Join(a.settings.GetConfigPath(), "inbox", workspaceID+".db")
		os.Remove(inboxPath) // Ignore error if file doesn't exist
	}

	return nil
}

// SelectWorkspaceFolder opens folder picker and returns selected path
func (a *App) SelectWorkspaceFolder() (string, error) {
	return wailsrt.OpenDirectoryDialog(a.ctx, wailsrt.OpenDialogOptions{
		Title:                "Select Project Folder",
		CanCreateDirectories: true,
	})
}
