package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const (
	ConfigDir     = ".claudefu"
	SettingsFile  = "settings.json"
	AuthFile      = "auth.json"
	AgentsFile    = "agents.json"
)

// Settings holds all application settings
type Settings struct {
	Theme               string `json:"theme"`               // "dark", "light", "system"
	EnterBehavior       string `json:"enterBehavior"`       // "send", "newline"
	DefaultWorkingDir   string `json:"defaultWorkingDir"`   // default working directory for agents
	DebugLogging        bool   `json:"debugLogging"`        // enable aggregated debug logging on frontend
}

// AuthConfig holds authentication configuration
type AuthConfig struct {
	// API Key authentication (direct Anthropic API)
	APIKey string `json:"apiKey,omitempty"`

	// Hyper authentication (Claude Pro/Max subscription via Charm)
	Hyper *HyperTokens `json:"hyper,omitempty"`

	// Which auth method to use: "api_key", "hyper", "none"
	AuthMethod string `json:"authMethod"`
}

// HyperTokens holds tokens for Claude Pro/Max subscription auth
type HyperTokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	ExpiresAt    int64  `json:"expires_at"`
}

// Manager handles all settings operations
type Manager struct {
	configPath string
	settings   *Settings
	auth       *AuthConfig
	mu         sync.RWMutex
}

// NewManager creates a new settings manager
func NewManager() (*Manager, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	configPath := filepath.Join(homeDir, ConfigDir)

	// Ensure config directory exists
	if err := os.MkdirAll(configPath, 0755); err != nil {
		return nil, err
	}

	m := &Manager{
		configPath: configPath,
		settings:   defaultSettings(),
		auth:       defaultAuth(),
	}

	// Load existing settings
	_ = m.loadSettings()
	_ = m.loadAuth()

	return m, nil
}

// GetConfigPath returns the path to the config directory
func (m *Manager) GetConfigPath() string {
	return m.configPath
}

// defaultSettings returns default settings
func defaultSettings() *Settings {
	return &Settings{
		Theme:         "dark",
		EnterBehavior: "send",
	}
}

// defaultAuth returns default auth config
func defaultAuth() *AuthConfig {
	return &AuthConfig{
		AuthMethod: "none",
	}
}

// GetSettings returns current settings
func (m *Manager) GetSettings() Settings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return *m.settings
}

// SaveSettings saves settings to disk
func (m *Manager) SaveSettings(s Settings) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.settings = &s
	return m.writeJSON(SettingsFile, s)
}

// GetAuth returns current auth config
func (m *Manager) GetAuth() AuthConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return *m.auth
}

// SaveAuth saves auth config to disk
func (m *Manager) SaveAuth(a AuthConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.auth = &a
	return m.writeJSON(AuthFile, a)
}

// IsAuthenticated returns true if the user has valid authentication
func (m *Manager) IsAuthenticated() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	switch m.auth.AuthMethod {
	case "api_key":
		return m.auth.APIKey != ""
	case "hyper":
		return m.auth.Hyper != nil && m.auth.Hyper.AccessToken != ""
	default:
		return false
	}
}

// ClearAuth clears all authentication data
func (m *Manager) ClearAuth() error {
	return m.SaveAuth(*defaultAuth())
}

// loadSettings loads settings from disk
func (m *Manager) loadSettings() error {
	return m.readJSON(SettingsFile, m.settings)
}

// loadAuth loads auth from disk
func (m *Manager) loadAuth() error {
	return m.readJSON(AuthFile, m.auth)
}

// writeJSON writes data as JSON to a file
func (m *Manager) writeJSON(filename string, data interface{}) error {
	path := filepath.Join(m.configPath, filename)

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, jsonData, 0600) // Restrictive permissions for sensitive data
}

// readJSON reads JSON from a file
func (m *Manager) readJSON(filename string, target interface{}) error {
	path := filepath.Join(m.configPath, filename)

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // File doesn't exist, use defaults
		}
		return err
	}

	return json.Unmarshal(data, target)
}
