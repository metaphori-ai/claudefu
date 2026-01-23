package main

import (
	"fmt"

	"claudefu/internal/permissions"
	"claudefu/internal/settings"
)

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

// SaveSettings saves application settings and applies runtime changes
func (a *App) SaveSettings(s settings.Settings) error {
	if a.settings == nil {
		return fmt.Errorf("settings manager not initialized")
	}

	// Save to disk
	if err := a.settings.SaveSettings(s); err != nil {
		return err
	}

	// Apply runtime changes: update Claude CLI environment variables
	if a.claude != nil {
		a.claude.SetEnvironment(s.ClaudeEnvVars)
	}

	return nil
}

// GetConfigPath returns the path to the config directory (~/.claudefu)
func (a *App) GetConfigPath() string {
	if a.settings == nil {
		return ""
	}
	return a.settings.GetConfigPath()
}

// =============================================================================
// PERMISSION SETS METHODS (Bound to frontend)
// =============================================================================

// GetPermissionSets returns all built-in permission sets
func (a *App) GetPermissionSets() map[string]permissions.PermissionSet {
	return permissions.BuiltInSets()
}

// GetDefaultPermissionSets returns the user's default permission set configuration
func (a *App) GetDefaultPermissionSets() map[string]string {
	if a.settings == nil {
		return map[string]string{"git": "common"} // Fallback default
	}
	s := a.settings.GetSettings()
	if s.DefaultPermissionSets == nil {
		return map[string]string{"git": "common"} // Fallback default
	}
	return s.DefaultPermissionSets
}

// SaveDefaultPermissionSets saves the user's default permission set configuration
func (a *App) SaveDefaultPermissionSets(defaults map[string]string) error {
	if a.settings == nil {
		return fmt.Errorf("settings manager not initialized")
	}

	s := a.settings.GetSettings()
	s.DefaultPermissionSets = defaults
	return a.settings.SaveSettings(s)
}

// PermissionSetMatch represents a matched permission set for a command
type PermissionSetMatch struct {
	Set         *permissions.PermissionSet `json:"set"`
	BaseCommand string                     `json:"baseCommand"`
}

// GetSetByCommand finds a permission set that matches the given bash command
func (a *App) GetSetByCommand(command string) *PermissionSetMatch {
	set, baseCmd := permissions.GetSetByCommand(command)
	if set == nil {
		return nil
	}
	return &PermissionSetMatch{
		Set:         set,
		BaseCommand: baseCmd,
	}
}
