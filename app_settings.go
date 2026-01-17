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
