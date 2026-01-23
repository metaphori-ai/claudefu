package main

import (
	"fmt"
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// buildMenu creates the application menu structure
func (a *App) buildMenu() *menu.Menu {
	appMenu := menu.NewMenu()

	// On macOS, add the app menu first (About, Settings, etc.)
	if runtime.GOOS == "darwin" {
		claudeFuMenu := appMenu.AddSubmenu("ClaudeFu")
		claudeFuMenu.AddText("About ClaudeFu", nil, func(_ *menu.CallbackData) {
			a.emitMenuAction("menu:about")
		})
		claudeFuMenu.AddText("How ClaudeFu Works", nil, func(_ *menu.CallbackData) {
			a.emitMenuAction("menu:how-it-works")
		})
		claudeFuMenu.AddSeparator()
		claudeFuMenu.AddText("Settings...", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
			a.emitMenuAction("menu:settings")
		})
		claudeFuMenu.AddText("Check for Updates...", nil, func(_ *menu.CallbackData) {
			a.emitMenuAction("menu:check-updates")
		})
		claudeFuMenu.AddSeparator()
		claudeFuMenu.AddText("Hide ClaudeFu", keys.CmdOrCtrl("h"), func(_ *menu.CallbackData) {
			wailsRuntime.Hide(a.ctx)
		})
		claudeFuMenu.AddText("Hide Others", keys.Combo("h", keys.CmdOrCtrlKey, keys.OptionOrAltKey), func(_ *menu.CallbackData) {
			// macOS handles this natively, but we add it for completeness
			wailsRuntime.Hide(a.ctx)
		})
		claudeFuMenu.AddSeparator()
		claudeFuMenu.AddText("Quit ClaudeFu", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
			wailsRuntime.Quit(a.ctx)
		})
	}

	// Edit menu - use Wails' built-in EditMenu for proper webview integration
	// This ensures CMD-A, CMD-C, CMD-V, CMD-X work correctly in text fields
	appMenu.Append(menu.EditMenu())

	// Workspace menu (dynamic)
	workspaceMenu := appMenu.AddSubmenu("Workspace")
	a.populateWorkspaceMenu(workspaceMenu)

	// Agent menu
	agentMenu := appMenu.AddSubmenu("Agent")
	a.populateAgentMenu(agentMenu)
	agentMenu.AddSeparator()
	agentMenu.AddText("New Session", keys.Combo("n", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:new-session")
	})
	agentMenu.AddText("Select Session...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:select-session")
	})
	agentMenu.AddSeparator()
	agentMenu.AddText("Rename Agent...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:rename-agent")
	})
	agentMenu.AddText("Remove Agent...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:remove-agent")
	})
	agentMenu.AddSeparator()
	agentMenu.AddText("Manage Agents...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:manage-agents")
	})

	// Window menu (standard macOS)
	if runtime.GOOS == "darwin" {
		windowMenu := appMenu.AddSubmenu("Window")
		windowMenu.AddText("Minimize", keys.CmdOrCtrl("m"), func(_ *menu.CallbackData) {
			wailsRuntime.WindowMinimise(a.ctx)
		})
		windowMenu.AddText("Zoom", nil, func(_ *menu.CallbackData) {
			wailsRuntime.WindowToggleMaximise(a.ctx)
		})
	}

	return appMenu
}

// populateWorkspaceMenu fills the workspace menu with available workspaces
func (a *App) populateWorkspaceMenu(workspaceMenu *menu.Menu) {
	// Get all workspaces
	workspaces, err := a.GetAllWorkspaces()
	if err != nil {
		fmt.Printf("[Menu] Error getting workspaces: %v\n", err)
		return
	}

	currentID, _ := a.GetCurrentWorkspaceID()

	// Add workspace items as radio buttons
	// NOTE: Menu only emits events - frontend handles state orchestration
	for _, ws := range workspaces {
		wsID := ws.ID // Capture for closure
		wsName := ws.Name
		isSelected := ws.ID == currentID

		item := workspaceMenu.AddRadio(wsName, isSelected, nil, func(_ *menu.CallbackData) {
			fmt.Printf("[Menu] Workspace selected: %s\n", wsID)
			// Emit event - let frontend handle the switch
			wailsRuntime.EventsEmit(a.ctx, "menu:switch-workspace", map[string]string{
				"workspaceId": wsID,
			})
		})
		_ = item
	}

	workspaceMenu.AddSeparator()
	workspaceMenu.AddText("Rename Workspace...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:rename-workspace")
	})
	workspaceMenu.AddText("Delete Workspace...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:delete-workspace")
	})
	workspaceMenu.AddSeparator()
	workspaceMenu.AddText("Manage Workspaces...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:manage-workspaces")
	})
	workspaceMenu.AddText("New Workspace...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:new-workspace")
	})
}

// populateAgentMenu fills the agent menu with agents from the current workspace
func (a *App) populateAgentMenu(agentMenu *menu.Menu) {
	if a.currentWorkspace == nil {
		return
	}

	// Get selected agent from workspace's selectedSession
	selectedAgentID := ""
	if a.currentWorkspace.SelectedSession != nil {
		selectedAgentID = a.currentWorkspace.SelectedSession.AgentID
	}

	// Add agent items as radio buttons (clicking switches to that agent)
	for _, agent := range a.currentWorkspace.Agents {
		agentID := agent.ID // Capture for closure
		agentName := agent.Name
		isSelected := agent.ID == selectedAgentID

		// Use AddRadio instead of AddText for checkmark
		agentMenu.AddRadio(agentName, isSelected, nil, func(_ *menu.CallbackData) {
			fmt.Printf("[Menu] Switching to agent: %s\n", agentID)
			// Emit event to frontend to switch agent
			wailsRuntime.EventsEmit(a.ctx, "menu:switch-agent", map[string]string{
				"agentId": agentID,
			})
		})
	}
}

// emitMenuAction sends a menu action event to the frontend
func (a *App) emitMenuAction(action string) {
	fmt.Printf("[Menu] Action: %s\n", action)
	wailsRuntime.EventsEmit(a.ctx, action)
}

// RefreshMenu rebuilds and updates the application menu
// Call this when workspaces or agents change
func (a *App) RefreshMenu() {
	if a.ctx == nil {
		return
	}
	newMenu := a.buildMenu()
	wailsRuntime.MenuSetApplicationMenu(a.ctx, newMenu)
	wailsRuntime.MenuUpdateApplicationMenu(a.ctx)
}

// GetMenu returns the initial menu for the app
func (a *App) GetMenu() *menu.Menu {
	return a.buildMenu()
}
