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
		// Hide/Show/Quit are automatically added by macOS
	}

	// Edit menu (standard - needed for copy/paste to work)
	editMenu := appMenu.AddSubmenu("Edit")
	editMenu.AddText("Undo", keys.CmdOrCtrl("z"), func(_ *menu.CallbackData) {
		// Standard edit operations are handled by the webview
	})
	editMenu.AddText("Redo", keys.Combo("z", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
	})
	editMenu.AddSeparator()
	editMenu.AddText("Cut", keys.CmdOrCtrl("x"), func(_ *menu.CallbackData) {
	})
	editMenu.AddText("Copy", keys.CmdOrCtrl("c"), func(_ *menu.CallbackData) {
	})
	editMenu.AddText("Paste", keys.CmdOrCtrl("v"), func(_ *menu.CallbackData) {
	})
	editMenu.AddSeparator()
	editMenu.AddText("Select All", keys.CmdOrCtrl("a"), func(_ *menu.CallbackData) {
	})

	// Workspace menu (dynamic)
	workspaceMenu := appMenu.AddSubmenu("Workspace")
	a.populateWorkspaceMenu(workspaceMenu)

	// Agent menu
	agentMenu := appMenu.AddSubmenu("Agent")
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
	for _, ws := range workspaces {
		wsID := ws.ID // Capture for closure
		wsName := ws.Name
		isSelected := ws.ID == currentID

		item := workspaceMenu.AddRadio(wsName, isSelected, nil, func(_ *menu.CallbackData) {
			fmt.Printf("[Menu] Switching to workspace: %s\n", wsID)
			a.SwitchWorkspace(wsID)
			a.RefreshMenu() // Update radio selection
		})
		_ = item
	}

	workspaceMenu.AddSeparator()
	workspaceMenu.AddText("New Workspace...", nil, func(_ *menu.CallbackData) {
		a.emitMenuAction("menu:new-workspace")
	})
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
