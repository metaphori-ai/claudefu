package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"claudefu/internal/permissions"
	"claudefu/internal/providers"
	"claudefu/internal/proxy"
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

	// Apply runtime changes: update Claude CLI environment variables and command
	providers.SetClaudeCommand(s.ClaudeCodeCommand)

	// Apply proxy changes
	a.applyProxySettings(s)

	return nil
}

// applyProxySettings manages proxy lifecycle based on settings.
// When proxy is enabled, it auto-injects ANTHROPIC_BASE_URL into Claude CLI env.
func (a *App) applyProxySettings(s settings.Settings) {
	if s.ProxyEnabled {
		port := s.ProxyPort
		if port == 0 {
			port = 9350
		}

		// Determine upstream
		upstream := "https://api.anthropic.com"
		if userURL, ok := s.ClaudeEnvVars["ANTHROPIC_BASE_URL"]; ok && userURL != "" {
			upstream = userURL
		}

		logDir := s.ProxyLogDir
		if logDir == "" && a.settings != nil {
			logDir = filepath.Join(a.settings.GetConfigPath(), "proxy-logs")
		} else if strings.HasPrefix(logDir, "~/") {
			if home, err := os.UserHomeDir(); err == nil {
				logDir = filepath.Join(home, logDir[2:])
			}
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

		if a.proxy != nil && a.proxy.IsRunning() {
			// Restart with new config
			if err := a.proxy.Restart(config); err != nil {
				fmt.Printf("[proxy] Failed to restart proxy: %v\n", err)
			}
		} else {
			// Start fresh
			a.proxy = proxy.NewService(config)
			if err := a.proxy.Start(); err != nil {
				fmt.Printf("[proxy] Failed to start proxy: %v\n", err)
			}
		}

		// Inject ANTHROPIC_BASE_URL pointing to our proxy
		if a.claude != nil {
			proxyURL := fmt.Sprintf("http://localhost:%d", port)
			envVars := make(map[string]string)
			for k, v := range s.ClaudeEnvVars {
				envVars[k] = v
			}
			envVars["ANTHROPIC_BASE_URL"] = proxyURL
			a.claude.SetEnvironment(envVars)
		}
	} else {
		// Proxy disabled — stop if running
		if a.proxy != nil && a.proxy.IsRunning() {
			a.proxy.Stop()
		}

		// Apply env vars without proxy override
		if a.claude != nil {
			a.claude.SetEnvironment(s.ClaudeEnvVars)
		}
	}
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
