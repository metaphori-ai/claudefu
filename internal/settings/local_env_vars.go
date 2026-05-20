package settings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// LocalEnvVars is the on-disk shape of ~/.claudefu/env-vars-{hostname}.json.
// One file per machine — each machine writes only its own file (named by its
// sanitized hostname), so simultaneous saves on two machines can never produce
// a Syncthing conflict file. The files DO replicate across machines (they're
// in the synced root, not in local/), but each machine reads only its own.
//
// Why a separate file instead of a hostname-keyed subtree in settings.json:
// settings.json is read+written by many subsystems and contains general app
// settings (theme, defaults, etc.). Touching it from multiple machines invites
// conflict files even if the per-machine subtree is logically isolated. A
// dedicated file with hostname in the FILENAME means each machine never
// writes the same path as any other.
type LocalEnvVars struct {
	Hostname         string            `json:"hostname"`         // identity of the machine that owns this file
	ClaudeCliCommand string            `json:"claudeCliCommand"` // custom claude binary path (default: "claude")
	EnvVars          map[string]string `json:"envVars"`          // env vars passed to every Claude CLI invocation
}

// envVarsHostnameSanitizer keeps filename-friendly characters only. Anything
// else (spaces, apostrophes, slashes, accented chars, etc.) becomes a dash.
// macOS lets users set hostnames like "Jasdeep's MacBook Pro" — without this,
// we'd produce filenames that break shell-quoting and Syncthing selective sync.
var envVarsHostnameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

// sanitizeHostnameForFilename returns a hostname suitable for embedding in a
// filename. Falls back to "unknown-host" when os.Hostname() fails or returns
// empty (rare, but well-defined behavior beats panicking).
func sanitizeHostnameForFilename(raw string) string {
	if raw == "" {
		return "unknown-host"
	}
	sanitized := envVarsHostnameSanitizer.ReplaceAllString(raw, "-")
	// Collapse runs of dashes and trim — "Jasdeep's MBP" → "Jasdeep-s-MBP" → "Jasdeep-s-MBP".
	sanitized = strings.Trim(sanitized, "-")
	if sanitized == "" {
		return "unknown-host"
	}
	return sanitized
}

// localEnvVarsFilename returns the basename of the current machine's file,
// e.g. "env-vars-Jasdeep-MBP.json".
func localEnvVarsFilename() string {
	host, _ := os.Hostname()
	return fmt.Sprintf("env-vars-%s.json", sanitizeHostnameForFilename(host))
}

// LocalEnvVarsFilePath returns the absolute path to the current machine's
// env-vars file. Useful for diagnostics + the UI's "(machine-local: $path)"
// hint that tells the user exactly which file they're editing.
func (m *Manager) LocalEnvVarsFilePath() string {
	return filepath.Join(m.configPath, localEnvVarsFilename())
}

// GetLocalEnvVars returns the env-vars file for the current machine.
// Missing-file is not an error — returns an empty LocalEnvVars whose
// ClaudeCliCommand defaults to "claude" once written. Mismatched hostnames
// (file says "laptop" but we're on "desktop") log a warning but still use
// the values; this lets developers copy a file across machines for setup.
func (m *Manager) GetLocalEnvVars() LocalEnvVars {
	host, _ := os.Hostname()
	path := m.LocalEnvVarsFilePath()

	data, err := os.ReadFile(path)
	if err != nil {
		// Missing file → empty struct. Hostname filled in so a subsequent
		// Save writes a self-identifying file.
		return LocalEnvVars{Hostname: host, EnvVars: map[string]string{}}
	}

	var lev LocalEnvVars
	if err := json.Unmarshal(data, &lev); err != nil {
		// Corrupted file — treat as empty rather than crash. The next save
		// overwrites with a clean copy.
		return LocalEnvVars{Hostname: host, EnvVars: map[string]string{}}
	}

	if lev.EnvVars == nil {
		lev.EnvVars = map[string]string{}
	}
	if lev.Hostname != "" && lev.Hostname != host {
		fmt.Printf("[settings] WARNING: env-vars file hostname=%q does not match this machine=%q (file at %s)\n",
			lev.Hostname, host, path)
	}
	return lev
}

// SaveLocalEnvVars persists env vars for the current machine.
// Always stamps the file with this machine's hostname so the body and the
// filename agree.
func (m *Manager) SaveLocalEnvVars(lev LocalEnvVars) error {
	host, _ := os.Hostname()
	lev.Hostname = host
	if lev.EnvVars == nil {
		lev.EnvVars = map[string]string{}
	}
	return m.writeJSON(localEnvVarsFilename(), lev)
}

// MigrateEnvVarsFromSettings moves env vars + cli command from settings.json
// into the machine-local file IF the new file does not yet exist. Idempotent:
// once the local file is on disk, future calls do nothing.
//
// Triggered eagerly at Manager init (see NewManager) so settings.json is
// cleansed the first time the new ClaudeFu version starts — no more
// machine-specific values riding along with theme/defaults across Syncthing.
func (m *Manager) MigrateEnvVarsFromSettings() error {
	path := m.LocalEnvVarsFilePath()
	if _, err := os.Stat(path); err == nil {
		// New file exists — already migrated (or user already saved on this
		// machine post-upgrade). Don't touch settings.json again.
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	s := m.settings
	hasEnvVars := len(s.ClaudeEnvVars) > 0
	hasCmd := strings.TrimSpace(s.ClaudeCodeCommand) != ""
	if !hasEnvVars && !hasCmd {
		// Nothing to migrate. Don't create an empty local file either —
		// GetLocalEnvVars handles the absence cleanly.
		return nil
	}

	// Copy values across.
	host, _ := os.Hostname()
	lev := LocalEnvVars{
		Hostname:         host,
		ClaudeCliCommand: s.ClaudeCodeCommand,
		EnvVars:          map[string]string{},
	}
	for k, v := range s.ClaudeEnvVars {
		lev.EnvVars[k] = v
	}

	if err := m.writeJSON(localEnvVarsFilename(), lev); err != nil {
		return fmt.Errorf("migrate env vars: write local file: %w", err)
	}

	// Clear from settings.json and rewrite.
	s.ClaudeEnvVars = nil
	s.ClaudeCodeCommand = ""
	if err := m.writeJSON(SettingsFile, s); err != nil {
		return fmt.Errorf("migrate env vars: rewrite settings.json: %w", err)
	}
	fmt.Printf("[settings] migrated %d env var(s) + cli command from settings.json to %s\n",
		len(lev.EnvVars), path)
	return nil
}
