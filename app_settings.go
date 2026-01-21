package main

import (
	"fmt"

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
