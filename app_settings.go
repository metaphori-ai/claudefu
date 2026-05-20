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

// SaveSettings saves application settings and applies runtime changes.
//
// NOTE on per-machine fields (v0.5.46+):
//   - Proxy settings are saved separately via SaveMachineProxySettings.
//   - Env vars + ClaudeCliCommand live in env-vars-{hostname}.json (see
//     SaveLocalEnvVars). The Settings struct's ClaudeEnvVars / ClaudeCodeCommand
//     fields are retained for back-compat but are no longer the source of
//     truth — anything written to them through SaveSettings is ignored at
//     runtime (the local file wins).
func (a *App) SaveSettings(s settings.Settings) error {
	if a.settings == nil {
		return fmt.Errorf("settings manager not initialized")
	}

	// Save to disk
	if err := a.settings.SaveSettings(s); err != nil {
		return err
	}

	// Apply runtime changes from the machine-local env vars file.
	lev := a.settings.GetLocalEnvVars()
	providers.SetClaudeCommand(lev.ClaudeCliCommand)

	// Apply proxy changes (reads machine-specific settings)
	mps := a.settings.GetMachineProxySettings()
	a.applyMachineProxySettings(mps)

	return nil
}

// GetLocalEnvVars returns the env vars + custom CLI command for the CURRENT
// machine. File: ~/.claudefu/env-vars-{sanitized-hostname}.json. Each machine
// reads only its own file even though the file syncs across machines via
// Syncthing — this prevents OAuth tokens (and other machine-specific values)
// from being clobbered when two machines edit at the same time.
func (a *App) GetLocalEnvVars() settings.LocalEnvVars {
	if a.settings == nil {
		return settings.LocalEnvVars{EnvVars: map[string]string{}}
	}
	return a.settings.GetLocalEnvVars()
}

// SaveLocalEnvVars persists the env vars + custom CLI command for THIS
// machine, then applies them to the running Claude CLI service so subsequent
// invocations pick them up without an app restart.
func (a *App) SaveLocalEnvVars(lev settings.LocalEnvVars) error {
	if a.settings == nil {
		return fmt.Errorf("settings manager not initialized")
	}
	if err := a.settings.SaveLocalEnvVars(lev); err != nil {
		return err
	}

	// Apply runtime changes.
	providers.SetClaudeCommand(lev.ClaudeCliCommand)

	// Reapply proxy settings so ANTHROPIC_BASE_URL gets re-injected on top of
	// the latest env vars (or removed if proxy is off and user just cleared
	// the value).
	mps := a.settings.GetMachineProxySettings()
	a.applyMachineProxySettings(mps)
	return nil
}

// LocalEnvVarsFilePath returns the absolute path to this machine's env-vars
// file. Bound so the GlobalSettingsDialog can display it in the UI hint.
func (a *App) LocalEnvVarsFilePath() string {
	if a.settings == nil {
		return ""
	}
	return a.settings.LocalEnvVarsFilePath()
}

// GetHostname returns the current machine's hostname.
func (a *App) GetHostname() string {
	hostname, _ := os.Hostname()
	return hostname
}

// GetMachineProxySettings returns the resolved proxy settings for this machine.
func (a *App) GetMachineProxySettings() settings.MachineProxySettings {
	if a.settings == nil {
		return settings.MachineProxySettings{ProxyPort: 9350, ProxyCacheFix: true, ProxyCacheTTL: "5m"}
	}
	return a.settings.GetMachineProxySettings()
}

// SaveMachineProxySettings saves proxy settings for this machine and applies them.
func (a *App) SaveMachineProxySettings(mps settings.MachineProxySettings) error {
	if a.settings == nil {
		return fmt.Errorf("settings manager not initialized")
	}
	if err := a.settings.SaveMachineProxySettings(mps); err != nil {
		return err
	}
	a.applyMachineProxySettings(mps)
	return nil
}

// applyMachineProxySettings manages proxy lifecycle based on machine-specific
// settings. When the proxy is enabled, it auto-injects ANTHROPIC_BASE_URL into
// Claude CLI env on top of the machine-local env vars.
//
// v0.5.46+: reads env vars from LocalEnvVars (machine-local file) instead of
// settings.json's ClaudeEnvVars field. Keeps OAuth tokens etc. on the machine
// that owns them.
func (a *App) applyMachineProxySettings(mps settings.MachineProxySettings) {
	lev := a.settings.GetLocalEnvVars()

	if mps.ProxyEnabled {
		port := mps.ProxyPort
		if port == 0 {
			port = 9350
		}

		// Determine upstream
		upstream := "https://api.anthropic.com"
		if userURL, ok := lev.EnvVars["ANTHROPIC_BASE_URL"]; ok && userURL != "" {
			upstream = userURL
		}

		logDir := mps.ProxyLogDir
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
			CacheFixEnabled: mps.ProxyCacheFix,
			CacheTTL:        mps.ProxyCacheTTL,
			LoggingEnabled:  mps.ProxyLogging,
			LogDir:          logDir,
			UpstreamURL:     upstream,
		}

		if a.proxy != nil && a.proxy.IsRunning() {
			if err := a.proxy.Restart(config); err != nil {
				fmt.Printf("[proxy] Failed to restart proxy: %v\n", err)
			}
		} else {
			a.proxy = proxy.NewService(config)
			if err := a.proxy.Start(); err != nil {
				fmt.Printf("[proxy] Failed to start proxy: %v\n", err)
			}
		}

		// Inject ANTHROPIC_BASE_URL pointing to our proxy (overlaid on local vars)
		if a.claude != nil {
			proxyURL := fmt.Sprintf("http://localhost:%d", port)
			envVars := make(map[string]string)
			for k, v := range lev.EnvVars {
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
			a.claude.SetEnvironment(lev.EnvVars)
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
