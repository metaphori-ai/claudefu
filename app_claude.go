package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"claudefu/internal/providers"
	"claudefu/internal/types"
	"claudefu/internal/workspace"
)

// =============================================================================
// CLAUDE CODE METHODS (Bound to frontend)
// =============================================================================

// emitResponseComplete emits the response_complete event and checks for auth errors.
func (a *App) emitResponseComplete(agentID, sessionID string, err error) {
	if a.rt == nil {
		return
	}
	wasCancelled := a.claude.WasCancelled(sessionID)
	payload := map[string]any{
		"success":   err == nil,
		"cancelled": wasCancelled,
	}
	if err != nil && !wasCancelled {
		errStr := err.Error()
		payload["error"] = errStr
		// Detect OAuth token expiry and emit auth:expired for frontend modal
		if strings.Contains(errStr, "authentication_failed") || strings.Contains(errStr, "OAuth token has expired") {
			a.rt.Emit("auth:expired", agentID, sessionID, map[string]any{
				"error": errStr,
			})
		}
		// Detect rate limit and emit rate:limited for frontend modal
		if strings.Contains(errStr, "hit your limit") || strings.Contains(errStr, "rate_limit") {
			// Extract reset time from message like "resets 10am (America/Los_Angeles)"
			resetTime := ""
			if idx := strings.Index(errStr, "resets "); idx >= 0 {
				resetTime = errStr[idx+7:] // everything after "resets "
				// Trim trailing quotes/whitespace
				resetTime = strings.TrimRight(resetTime, "\" \n\r")
			}
			a.rt.Emit("rate:limited", agentID, sessionID, map[string]any{
				"error":     errStr,
				"resetTime": resetTime,
			})
		}
	}
	a.rt.Emit("response_complete", agentID, sessionID, payload)
}

// SendMessage sends a message to Claude Code, optionally with image attachments.
// If attachments are provided, uses stdin with stream-json format.
// If planMode is true, forces Claude into planning mode.
// The model parameter (alias or full ID, e.g. "opus[1m]" or "claude-sonnet-4-6[1m]") is passed
// to --model verbatim; empty = omit the flag (use CLI default).
// The effort parameter (low|medium|high|xhigh|max|auto) is passed to --effort; empty = omit.
// Emits "response_complete" event when the Claude CLI process exits.
func (a *App) SendMessage(agentID, sessionID, message string, attachments []types.Attachment, planMode bool, model, effort string) error {
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
	err := a.claude.SendMessage(agent.Folder, sessionID, message, attachments, planMode, model, effort)

	// Emit response_complete event AFTER Claude finishes
	// This is the authoritative signal that the response is complete
	a.emitResponseComplete(agentID, sessionID, err)

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
	// Writes a JSONL starter exchange that --resume picks up.
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

// TouchPlanFile creates the plan file if it doesn't exist and returns its path.
// Uses the session slug to derive: ~/.claude/plans/{slug}.md
func (a *App) TouchPlanFile(agentID, sessionID string) (string, error) {
	planPath := a.GetPlanFilePath(agentID, sessionID)
	if planPath == "" {
		fmt.Printf("[DEBUG] TouchPlanFile: GetPlanFilePath returned empty for agent=%s session=%s\n", agentID, sessionID)
		return "", fmt.Errorf("no plan file path available (session may not have a slug yet)")
	}

	// Ensure directory exists
	dir := filepath.Dir(planPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create plans directory: %w", err)
	}

	// Touch the file (create if not exists, don't truncate if exists)
	f, err := os.OpenFile(planPath, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return "", fmt.Errorf("failed to create plan file: %w", err)
	}
	f.Close()

	return planPath, nil
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

	// Step 4: Resume the session with "question answered" to trigger Claude continuation.
	// No model/effort override — the agent's configured default (if any) applies via the CLI.
	err := a.claude.SendMessage(agent.Folder, sessionID, "question answered", nil, false, "", "")

	// Emit response_complete event AFTER Claude finishes
	a.emitResponseComplete(agentID, sessionID, err)

	return err
}

// RunSlashCommand executes a Claude CLI slash command (e.g., /context, /compact, /memory)
// and returns the output. These are local CLI commands, not conversation messages.
// For /compact, it also triggers a session reload since compaction rewrites the JSONL.
func (a *App) RunSlashCommand(agentID, sessionID, command string) (string, error) {
	if a.claude == nil {
		return "", fmt.Errorf("claude service not initialized")
	}
	if !providers.IsClaudeInstalled() {
		return "", fmt.Errorf("claude CLI not installed")
	}

	agent := a.getAgentByID(agentID)
	if agent == nil {
		return "", fmt.Errorf("agent not found: %s", agentID)
	}

	// Validate: only allow known slash commands
	allowed := map[string]bool{"/context": true, "/compact": true}
	if !allowed[command] {
		return "", fmt.Errorf("unsupported slash command: %s", command)
	}

	// Run the slash command via Claude CLI
	output, err := a.claude.RunSlashCommand(agent.Folder, sessionID, command)
	if err != nil {
		return "", fmt.Errorf("slash command failed: %w", err)
	}

	// For /compact, reload the session since it rewrites the JSONL file
	if command == "/compact" && a.watcher != nil {
		if reloadErr := a.watcher.ReloadSession(agentID, agent.Folder, sessionID); reloadErr != nil {
			fmt.Printf("[WARN] Failed to reload session after /compact: %v\n", reloadErr)
		}
	}

	return output, nil
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
