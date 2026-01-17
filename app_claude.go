package main

import (
	"fmt"
	"os"

	"claudefu/internal/providers"
	"claudefu/internal/workspace"
)

// =============================================================================
// CLAUDE CODE METHODS (Bound to frontend)
// =============================================================================

// SendMessage sends a message to Claude Code
// If planMode is true, forces Claude into planning mode
func (a *App) SendMessage(agentID, sessionID, message string, planMode bool) error {
	if a.claude == nil {
		return fmt.Errorf("claude service not initialized")
	}
	if !providers.IsClaudeInstalled() {
		return fmt.Errorf("claude CLI not installed - please install Claude Code first")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	return a.claude.SendMessage(agent.Folder, sessionID, message, planMode)
}

// NewSession creates a new Claude Code session
func (a *App) NewSession(agentID string) (string, error) {
	fmt.Printf("[DEBUG] NewSession called for agentID: %s\n", agentID)

	if a.claude == nil {
		fmt.Printf("[DEBUG] NewSession error: claude service not initialized\n")
		return "", fmt.Errorf("claude service not initialized")
	}
	if !providers.IsClaudeInstalled() {
		fmt.Printf("[DEBUG] NewSession error: claude CLI not installed\n")
		return "", fmt.Errorf("claude CLI not installed - please install Claude Code first")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		fmt.Printf("[DEBUG] NewSession error: agent not found: %s\n", agentID)
		return "", fmt.Errorf("agent not found: %s", agentID)
	}

	fmt.Printf("[DEBUG] NewSession: calling claude.NewSession for folder: %s\n", agent.Folder)
	sessionId, err := a.claude.NewSession(agent.Folder)
	fmt.Printf("[DEBUG] NewSession result: sessionId=%s, err=%v\n", sessionId, err)
	return sessionId, err
}

// IsClaudeInstalled checks if the Claude Code CLI is available
func (a *App) IsClaudeInstalled() bool {
	return providers.IsClaudeInstalled()
}

// ReadPlanFile reads the contents of a plan file
func (a *App) ReadPlanFile(filePath string) (string, error) {
	if filePath == "" {
		return "", fmt.Errorf("filePath is required")
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read plan file: %w", err)
	}
	return string(data), nil
}

// GetPlanFilePath returns the active plan file path for a session
func (a *App) GetPlanFilePath(agentID, sessionID string) string {
	if a.rt == nil {
		return ""
	}
	return a.rt.GetPlanFilePath(agentID, sessionID)
}

// AnswerQuestion answers a pending AskUserQuestion by patching the JSONL and resuming the session.
// This enables interactive question handling even when Claude Code runs in --print mode.
func (a *App) AnswerQuestion(agentID, sessionID, toolUseID string, questions []map[string]any, answers map[string]string) error {
	if a.claude == nil {
		return fmt.Errorf("claude service not initialized")
	}
	if !providers.IsClaudeInstalled() {
		return fmt.Errorf("claude CLI not installed - please install Claude Code first")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	// Step 1: Patch the JSONL file to convert failed tool_result to success
	if err := workspace.PatchQuestionAnswer(agent.Folder, sessionID, toolUseID, questions, answers); err != nil {
		return fmt.Errorf("failed to patch JSONL: %w", err)
	}

	// Step 2: Reload session cache from the patched JSONL file
	// This ensures GetMessages returns fresh data with is_error=false
	if a.watcher != nil {
		if err := a.watcher.ReloadSession(agent.Folder, sessionID); err != nil {
			fmt.Printf("[WARN] Failed to reload session after patch: %v\n", err)
			// Continue anyway - the data is on disk, worst case user refreshes
		}
	}

	// Step 3: Resume the session with "question answered" to trigger Claude continuation
	return a.claude.SendMessage(agent.Folder, sessionID, "question answered", false)
}
