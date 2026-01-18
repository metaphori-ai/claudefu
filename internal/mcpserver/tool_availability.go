package mcpserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const (
	ToolAvailabilityFile = "mcp_tool_availability.json"
)

// ToolAvailability holds the enabled/disabled state for each MCP tool
type ToolAvailability struct {
	AgentQuery      bool `json:"agentQuery"`
	AgentMessage    bool `json:"agentMessage"`
	AgentBroadcast  bool `json:"agentBroadcast"`
	NotifyUser      bool `json:"notifyUser"`
	AskUserQuestion bool `json:"askUserQuestion"`
	SelfQuery       bool `json:"selfQuery"`
	BrowserAgent    bool `json:"browserAgent"` // Disabled by default, password-protected
}

// ToolAvailabilityManager handles loading and saving tool availability settings
type ToolAvailabilityManager struct {
	configPath   string
	availability *ToolAvailability
	mu           sync.RWMutex
}

// NewToolAvailabilityManager creates a new manager for tool availability
func NewToolAvailabilityManager(configPath string) *ToolAvailabilityManager {
	m := &ToolAvailabilityManager{
		configPath:   configPath,
		availability: DefaultToolAvailability(),
	}
	// Load existing settings (if any)
	_ = m.load()
	return m
}

// DefaultToolAvailability returns the default availability for all MCP tools
func DefaultToolAvailability() *ToolAvailability {
	return &ToolAvailability{
		AgentQuery:      true,
		AgentMessage:    true,
		AgentBroadcast:  true,
		NotifyUser:      true,
		AskUserQuestion: true,
		SelfQuery:       true,
		BrowserAgent:    false, // Disabled by default - requires password to enable
	}
}

// GetAvailability returns the current tool availability settings
func (m *ToolAvailabilityManager) GetAvailability() ToolAvailability {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return *m.availability
}

// IsEnabled checks if a specific tool is enabled
func (m *ToolAvailabilityManager) IsEnabled(toolName string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	switch toolName {
	case "AgentQuery":
		return m.availability.AgentQuery
	case "AgentMessage":
		return m.availability.AgentMessage
	case "AgentBroadcast":
		return m.availability.AgentBroadcast
	case "NotifyUser":
		return m.availability.NotifyUser
	case "AskUserQuestion":
		return m.availability.AskUserQuestion
	case "SelfQuery":
		return m.availability.SelfQuery
	case "BrowserAgent":
		return m.availability.BrowserAgent
	default:
		return false
	}
}

// SaveAvailability saves tool availability settings to disk
func (m *ToolAvailabilityManager) SaveAvailability(ta ToolAvailability) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.availability = &ta

	// Ensure directory exists
	if err := os.MkdirAll(m.configPath, 0755); err != nil {
		return err
	}

	path := filepath.Join(m.configPath, ToolAvailabilityFile)
	data, err := json.MarshalIndent(ta, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// ResetToDefaults resets availability to default values and saves
func (m *ToolAvailabilityManager) ResetToDefaults() error {
	return m.SaveAvailability(*DefaultToolAvailability())
}

// load reads availability settings from disk
func (m *ToolAvailabilityManager) load() error {
	path := filepath.Join(m.configPath, ToolAvailabilityFile)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// File doesn't exist, save defaults
			return m.SaveAvailability(*m.availability)
		}
		return err
	}

	var ta ToolAvailability
	if err := json.Unmarshal(data, &ta); err != nil {
		return err
	}

	m.availability = &ta
	return nil
}
