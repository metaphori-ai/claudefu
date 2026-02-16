package mcpserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"claudefu/internal/defaults"
)

const (
	ToolInstructionsFile = "mcp_tool_instructions.json"
)

// ToolInstructions holds the configurable instructions for each MCP tool
type ToolInstructions struct {
	AgentQuery              string `json:"agentQuery"`
	AgentQuerySystemPrompt  string `json:"agentQuerySystemPrompt"`  // System prompt appended to AgentQuery calls
	AgentMessage            string `json:"agentMessage"`
	AgentBroadcast          string `json:"agentBroadcast"`
	NotifyUser              string `json:"notifyUser"`
	AskUserQuestion         string `json:"askUserQuestion"`
	SelfQuery               string `json:"selfQuery"`
	SelfQuerySystemPrompt   string `json:"selfQuerySystemPrompt"`   // System prompt appended to SelfQuery calls
	BrowserAgent            string `json:"browserAgent"`            // BrowserAgent tool description
	RequestToolPermission   string `json:"requestToolPermission"`   // RequestToolPermission tool description
	ExitPlanMode            string `json:"exitPlanMode"`            // ExitPlanMode tool description
	CompactionPrompt        string `json:"compactionPrompt"`        // Compaction summary prompt (not yet wired)
	CompactionContinuation  string `json:"compactionContinuation"`  // Post-compaction continuation message (not yet wired)
	BacklogAdd              string `json:"backlogAdd"`              // BacklogAdd tool description
	BacklogUpdate           string `json:"backlogUpdate"`           // BacklogUpdate tool description
	BacklogList             string `json:"backlogList"`             // BacklogList tool description
}

// ToolInstructionsManager handles loading and saving tool instructions
type ToolInstructionsManager struct {
	configPath   string
	instructions *ToolInstructions
	mu           sync.RWMutex
}

// NewToolInstructionsManager creates a new manager for tool instructions
func NewToolInstructionsManager(configPath string) *ToolInstructionsManager {
	m := &ToolInstructionsManager{
		configPath:   configPath,
		instructions: DefaultToolInstructions(),
	}
	// Load existing instructions (if any)
	_ = m.load()
	return m
}

// DefaultToolInstructions returns the default instructions for all MCP tools.
// Defaults are loaded from the embedded default_tool_instructions.json file.
func DefaultToolInstructions() *ToolInstructions {
	var ti ToolInstructions
	if err := json.Unmarshal(defaults.ToolInstructionsJSON(), &ti); err != nil {
		// Should never happen with a valid embedded file
		panic("failed to unmarshal embedded default_tool_instructions.json: " + err.Error())
	}
	return &ti
}

// GetInstructions returns the current tool instructions
func (m *ToolInstructionsManager) GetInstructions() ToolInstructions {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return *m.instructions
}

// SaveInstructions saves tool instructions to disk
func (m *ToolInstructionsManager) SaveInstructions(ti ToolInstructions) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.instructions = &ti

	// Ensure directory exists
	if err := os.MkdirAll(m.configPath, 0755); err != nil {
		return err
	}

	path := filepath.Join(m.configPath, ToolInstructionsFile)
	data, err := json.MarshalIndent(ti, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// ResetToDefaults resets instructions to default values and saves
func (m *ToolInstructionsManager) ResetToDefaults() error {
	return m.SaveInstructions(*DefaultToolInstructions())
}

// load reads instructions from disk
func (m *ToolInstructionsManager) load() error {
	path := filepath.Join(m.configPath, ToolInstructionsFile)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// File doesn't exist, save defaults
			return m.SaveInstructions(*m.instructions)
		}
		return err
	}

	var ti ToolInstructions
	if err := json.Unmarshal(data, &ti); err != nil {
		return err
	}

	// Fill in any missing fields with defaults (for backward compatibility)
	defaults := DefaultToolInstructions()
	needsSave := false
	if ti.AgentQuery == "" {
		ti.AgentQuery = defaults.AgentQuery
		needsSave = true
	}
	if ti.AgentQuerySystemPrompt == "" {
		ti.AgentQuerySystemPrompt = defaults.AgentQuerySystemPrompt
		needsSave = true
	}
	if ti.AgentMessage == "" {
		ti.AgentMessage = defaults.AgentMessage
		needsSave = true
	}
	if ti.AgentBroadcast == "" {
		ti.AgentBroadcast = defaults.AgentBroadcast
		needsSave = true
	}
	if ti.NotifyUser == "" {
		ti.NotifyUser = defaults.NotifyUser
		needsSave = true
	}
	if ti.AskUserQuestion == "" {
		ti.AskUserQuestion = defaults.AskUserQuestion
		needsSave = true
	}
	if ti.SelfQuery == "" {
		ti.SelfQuery = defaults.SelfQuery
		needsSave = true
	}
	if ti.SelfQuerySystemPrompt == "" {
		ti.SelfQuerySystemPrompt = defaults.SelfQuerySystemPrompt
		needsSave = true
	}
	if ti.BrowserAgent == "" {
		ti.BrowserAgent = defaults.BrowserAgent
		needsSave = true
	}
	if ti.RequestToolPermission == "" {
		ti.RequestToolPermission = defaults.RequestToolPermission
		needsSave = true
	}
	if ti.ExitPlanMode == "" {
		ti.ExitPlanMode = defaults.ExitPlanMode
		needsSave = true
	}
	if ti.CompactionPrompt == "" {
		ti.CompactionPrompt = defaults.CompactionPrompt
		needsSave = true
	}
	if ti.CompactionContinuation == "" {
		ti.CompactionContinuation = defaults.CompactionContinuation
		needsSave = true
	}
	if ti.BacklogAdd == "" {
		ti.BacklogAdd = defaults.BacklogAdd
		needsSave = true
	}
	if ti.BacklogUpdate == "" {
		ti.BacklogUpdate = defaults.BacklogUpdate
		needsSave = true
	}
	if ti.BacklogList == "" {
		ti.BacklogList = defaults.BacklogList
		needsSave = true
	}

	m.instructions = &ti

	// Save back if we filled in defaults
	if needsSave {
		return m.SaveInstructions(ti)
	}

	return nil
}
