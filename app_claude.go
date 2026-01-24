package main

import (
	"fmt"
	"os"
	"time"

	"claudefu/internal/providers"
	"claudefu/internal/types"
	"claudefu/internal/workspace"
)

// =============================================================================
// CLAUDE CODE METHODS (Bound to frontend)
// =============================================================================

// SendMessage sends a message to Claude Code, optionally with image attachments.
// If attachments are provided, uses stdin with stream-json format.
// If planMode is true, forces Claude into planning mode.
// Emits "response_complete" event when the Claude CLI process exits.
func (a *App) SendMessage(agentID, sessionID, message string, attachments []types.Attachment, planMode bool) error {
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

	// Record send time BEFORE calling Claude - used to filter out historical context
	// that Claude Code writes when resuming a session (those have old timestamps)
	if a.rt != nil {
		a.rt.SetLastSendTime(agentID, sessionID, time.Now())
	}

	// Call Claude - BLOCKS until CLI process exits
	err := a.claude.SendMessage(agent.Folder, sessionID, message, attachments, planMode)

	// Emit response_complete event AFTER Claude finishes
	// This is the authoritative signal that the response is complete
	if a.rt != nil {
		wasCancelled := a.claude.WasCancelled(sessionID)
		payload := map[string]any{
			"success":   err == nil,
			"cancelled": wasCancelled,
		}
		if err != nil && !wasCancelled {
			payload["error"] = err.Error()
		}
		a.rt.Emit("response_complete", agentID, sessionID, payload)
	}

	return err
}

// NewSession creates a new Claude Code session
func (a *App) NewSession(agentID string) (string, error) {
	fmt.Printf("[DEBUG] NewSession called for agentID: %s\n", agentID)

	agent := a.getAgentByID(agentID)
	if agent == nil {
		fmt.Printf("[DEBUG] NewSession error: agent not found: %s\n", agentID)
		return "", fmt.Errorf("agent not found: %s", agentID)
	}

	// Use instant session creation - no Claude CLI wait!
	// Creates empty JSONL + updates sessions-index.json
	if a.sessionService == nil {
		return "", fmt.Errorf("session service not initialized")
	}

	sessionID, err := a.sessionService.CreateSession(agent.Folder)
	if err != nil {
		fmt.Printf("[DEBUG] NewSession error: %v\n", err)
		return "", err
	}

	fmt.Printf("[DEBUG] NewSession: created instant session %s for folder: %s\n", sessionID, agent.Folder)
	return sessionID, nil
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
// Emits "response_complete" event when the Claude CLI process exits.
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
		if err := a.watcher.ReloadSession(agentID, agent.Folder, sessionID); err != nil {
			fmt.Printf("[WARN] Failed to reload session after patch: %v\n", err)
			// Continue anyway - the data is on disk, worst case user refreshes
		}
	}

	// Step 3: Record send time for timestamp-based filtering
	if a.rt != nil {
		a.rt.SetLastSendTime(agentID, sessionID, time.Now())
	}

	// Step 4: Resume the session with "question answered" to trigger Claude continuation
	err := a.claude.SendMessage(agent.Folder, sessionID, "question answered", nil, false)

	// Emit response_complete event AFTER Claude finishes
	if a.rt != nil {
		wasCancelled := a.claude.WasCancelled(sessionID)
		payload := map[string]any{
			"success":   err == nil,
			"cancelled": wasCancelled,
		}
		if err != nil && !wasCancelled {
			payload["error"] = err.Error()
		}
		a.rt.Emit("response_complete", agentID, sessionID, payload)
	}

	return err
}

// CancelSession cancels a running Claude process for a session.
// This sends SIGINT to the process, allowing it to clean up gracefully.
// Returns nil if no process is running for that session.
func (a *App) CancelSession(agentID, sessionID string) error {
	if a.claude == nil {
		return fmt.Errorf("claude service not initialized")
	}

	// Validate agent exists
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	fmt.Printf("[DEBUG] CancelSession: agentID=%s sessionID=%s\n", agentID, sessionID)
	return a.claude.CancelSession(sessionID)
}

// AppendCancellationMarker adds a cancellation marker to the session JSONL.
// This should be called after CancelSession to record the interruption.
func (a *App) AppendCancellationMarker(agentID, sessionID string) error {
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	return workspace.AppendCancellationMarker(agent.Folder, sessionID)
}
