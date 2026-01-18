package mcpserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const (
	ToolInstructionsFile = "mcp_tool_instructions.json"
)

// ToolInstructions holds the configurable instructions for each MCP tool
type ToolInstructions struct {
	AgentQuery             string `json:"agentQuery"`
	AgentQuerySystemPrompt string `json:"agentQuerySystemPrompt"` // System prompt appended to AgentQuery calls
	AgentMessage           string `json:"agentMessage"`
	AgentBroadcast         string `json:"agentBroadcast"`
	NotifyUser             string `json:"notifyUser"`
	AskUserQuestion        string `json:"askUserQuestion"`
	SelfQuery              string `json:"selfQuery"`
	SelfQuerySystemPrompt  string `json:"selfQuerySystemPrompt"` // System prompt appended to SelfQuery calls
	BrowserAgent           string `json:"browserAgent"`          // BrowserAgent tool description
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

// DefaultToolInstructions returns the default instructions for all MCP tools
func DefaultToolInstructions() *ToolInstructions {
	return &ToolInstructions{
		AgentQuery: `Send a stateless query to another agent in your workspace. Returns their response synchronously.

The target agent will receive your query with context that it's from another agent, and will respond concisely with facts only.

Use this when you need information from another agent's domain (e.g., asking the backend agent about an API endpoint signature).`,

		AgentQuerySystemPrompt: `You are responding to a query from another agent. Respond concisely with facts only. Do NOT offer to make changes or ask follow-up questions.`,

		AgentMessage: `Send a message to one or more specific agents' inboxes. The message will appear in ClaudeFu UI for the user to review and inject into that agent's conversation when ready.

Use this for:
- Notifying specific agents of changes (e.g., "API schema updated")
- Sharing information that doesn't need immediate response
- Coordinating across agents without blocking

The user controls when/if the message gets injected into the target agent's context.

You must specify which agent(s) to message. Use AgentBroadcast if you need to message ALL agents.`,

		AgentBroadcast: `Broadcast a message to ALL agents' inboxes in the workspace. This is rarely needed - prefer AgentMessage for targeted communication.

Use this ONLY when you need to notify every agent about something (e.g., major architectural changes affecting all agents).

The user controls when/if the message gets injected into each agent's context.`,

		NotifyUser: `Display a notification to the user in the ClaudeFu UI.

Use this for:
- Important status updates (e.g., "Build complete")
- Warnings that need user attention
- Success confirmations
- Questions that need user awareness (not blocking questions)`,

		AskUserQuestion: `Ask the user a question and wait for their response. This tool blocks until the user answers or skips the question.

Use this to:
- Get user preferences or decisions
- Clarify ambiguous requirements
- Offer choices about implementation direction

The question will appear as a dialog in ClaudeFu UI. You can provide multiple choice options for the user.`,

		SelfQuery: `Query your own codebase with full CLAUDE.md context. This spawns a stateless Claude that has access to all your project instructions.

Use this when you need:
- Deep codebase analysis with full architectural context
- Quick focused questions that benefit from project knowledge
- Sub-tasks that don't need their own session history

Unlike Task subagents, SelfQuery has access to CLAUDE.md and all includes.

IMPORTANT: You must provide your agent slug in from_agent so we can identify your folder.`,

		SelfQuerySystemPrompt: `You are responding to a self-query from the same agent. You have full access to CLAUDE.md and project context. Respond with precise, actionable information. Do NOT offer to make changes or ask follow-up questions.`,

		BrowserAgent: `Delegate visual/DOM/CSS investigation to Claude in Browser.

Use this when you need:
- CSS debugging (computed styles, layout issues)
- DOM inspection (rendered state, event listeners, a11y tree)
- Visual verification (screenshots, layout description)
- Runtime JS execution in browser context

Note: This tool requires the Chrome extension bridge to be running.
Timeout defaults to 10 minutes - complex investigations take time.`,
	}
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

	m.instructions = &ti

	// Save back if we filled in defaults
	if needsSave {
		return m.SaveInstructions(ti)
	}

	return nil
}
