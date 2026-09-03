package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"claudefu/internal/oauthkeys"
	"claudefu/internal/providers"
	"claudefu/internal/types"
	"claudefu/internal/workspace"
)

// parseClaudeCLIError walks the raw stderr/stdout from Claude CLI looking for
// the structured JSON lines the CLI emits on error. Returns the HTTP status code
// (e.g., 429), the human-readable result message, and the resolved model from
// the system:init event. Any field that can't be parsed returns zero value.
//
// Claude CLI error output looks like:
//   {"type":"system","subtype":"init",...,"model":"claude-sonnet-4-6[1m]",...}
//   {"type":"rate_limit_event",...}
//   {"type":"assistant","message":{...}}
//   {"type":"result","subtype":"success","is_error":true,"api_error_status":429,"result":"API Error: ..."}
//
// We scan for type=system/init (for model) and type=result with is_error=true
// (for status + message).
func parseClaudeCLIError(rawOutput string) (status int, result, resolvedModel string) {
	for _, line := range strings.Split(rawOutput, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "{") {
			continue
		}
		var probe struct {
			Type    string `json:"type"`
			Subtype string `json:"subtype"`
			IsError bool   `json:"is_error"`
			Status  int    `json:"api_error_status"`
			Result  string `json:"result"`
			Model   string `json:"model"`
		}
		if err := json.Unmarshal([]byte(line), &probe); err != nil {
			continue
		}
		if probe.Type == "system" && probe.Subtype == "init" && probe.Model != "" {
			resolvedModel = probe.Model
		}
		if probe.Type == "result" && probe.IsError {
			if probe.Status != 0 {
				status = probe.Status
			}
			if probe.Result != "" {
				result = probe.Result
			}
		}
	}
	return
}

// =============================================================================
// CLAUDE CODE METHODS (Bound to frontend)
// =============================================================================

// emitResponseComplete emits the response_complete event and checks for auth/API errors.
// userModel is what the user selected in the frontend (may be empty = Empty/Default).
func (a *App) emitResponseComplete(agentID, sessionID, userModel string, err error) {
	a.emitResponseCompleteWithInfo(agentID, sessionID, userModel, err, "")
}

// emitResponseCompleteWithInfo is emitResponseComplete with an optional extra
// result block appended to the claude:api-error message — used by OAuth key
// rotation to render the per-key reset table when every rotation key is limited.
func (a *App) emitResponseCompleteWithInfo(agentID, sessionID, userModel string, err error, extraResult string) {
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
			a.rt.Emit("response_complete", agentID, sessionID, payload)
			return
		}

		// Parse structured CLI error from stderr JSON (status code, result, resolved model).
		// ALL Claude CLI errors — rate limits, 1M context disabled, auth, etc. — flow
		// through claude:api-error. The frontend dialog adapts its content based on
		// status code and result message; one code path, one dialog.
		status, result, resolvedModel := parseClaudeCLIError(errStr)
		if extraResult != "" {
			if result != "" {
				result += "\n\n"
			}
			result += extraResult
		}
		if status != 0 || result != "" {
			a.rt.Emit("claude:api-error", agentID, sessionID, map[string]any{
				"status":        status,
				"result":        result,
				"resolvedModel": resolvedModel,
				"userModel":     userModel,
			})
		}
	}
	a.rt.Emit("response_complete", agentID, sessionID, payload)
}

// resolveOAuthEnv resolves the OAuth key pool for a send. Returns the selected
// key ID, the per-spawn env override carrying its token, and the send mode
// (none/auto/pinned). ModeNone (no pool participation) preserves the legacy
// LocalEnvVars CLAUDE_CODE_OAUTH_TOKEN behavior untouched.
func (a *App) resolveOAuthEnv(sessionID, spec string) (keyID string, extraEnv map[string]string, mode string) {
	if a.oauthKeys == nil {
		return "", nil, oauthkeys.ModeNone
	}
	keyID, token, mode := a.oauthKeys.ResolveForSend(sessionID, spec)
	if token == "" {
		return "", nil, oauthkeys.ModeNone
	}
	return keyID, map[string]string{"CLAUDE_CODE_OAUTH_TOKEN": token}, mode
}

// oauthKeyLabel returns a key's display label (falls back to the ID).
func (a *App) oauthKeyLabel(id string) string {
	if a.oauthKeys != nil {
		if k := a.oauthKeys.GetKey(id); k != nil {
			return k.Label
		}
	}
	return id
}

// isServerRetryable returns true for transient server errors that warrant
// backoff + retry (the API is overloaded or briefly unhealthy). Rate limits
// (429) are handled by the OAuth rotation, not by retries. The text fallback
// catches an overloaded_error whose status field didn't make it into the
// result line.
func isServerRetryable(status int, result string) bool {
	switch status {
	case 408, 500, 502, 503, 504, 529:
		return true
	}
	if status == 0 {
		lower := strings.ToLower(result)
		return strings.Contains(lower, "overloaded") || strings.Contains(lower, "529")
	}
	return false
}

// retryBackoffDelay returns the delay for a server-error retry attempt.
// Exponential: 2, 4, 8, 16, 32, 64, 128, 256, 256, 256, ... (capped at 256s).
func retryBackoffDelay(attempt int) time.Duration {
	secs := 1 << attempt // attempt 1 → 2, 2 → 4, ..., 8 → 256
	if secs > 256 {
		secs = 256
	}
	return time.Duration(secs) * time.Second
}

// emitRetryStatus sends the retry:status event for the inline indicator.
func (a *App) emitRetryStatus(agentID, sessionID, status string, attempt int, delaySec int) {
	if a.rt == nil {
		return
	}
	a.rt.Emit("retry:status", agentID, sessionID, map[string]any{
		"status":   status, // "waiting" | "retrying" | "cleared"
		"attempt":  attempt,
		"delaySec": delaySec,
	})
}

// registerRetryCancel creates a per-session cancel channel for the
// server-error retry backoff. CancelSession closes it to abort the sleep.
func (a *App) registerRetryCancel(sessionID string) chan struct{} {
	a.retryCancelMu.Lock()
	defer a.retryCancelMu.Unlock()
	ch := make(chan struct{})
	a.retryCancels[sessionID] = ch
	return ch
}

// unregisterRetryCancel removes the channel — only if it is still ours, so a
// newer concurrent send for the same session keeps its own registration.
func (a *App) unregisterRetryCancel(sessionID string, ch chan struct{}) {
	a.retryCancelMu.Lock()
	defer a.retryCancelMu.Unlock()
	if a.retryCancels[sessionID] == ch {
		delete(a.retryCancels, sessionID)
	}
}

func (a *App) signalRetryCancel(sessionID string) {
	a.retryCancelMu.RLock()
	ch, ok := a.retryCancels[sessionID]
	a.retryCancelMu.RUnlock()
	if ok {
		select {
		case <-ch: // already closed
		default:
			close(ch)
		}
	}
}

// pruneFailedUserMessage removes the user message Claude CLI wrote for the
// send that just failed, so the retry doesn't append a duplicate. It ONLY
// prunes an entry it can prove is ours: written after sentAt (a historical
// entry can never carry a fresh timestamp — the CLI rewrites resume context
// with OLD timestamps), or, when the timestamp is unusable, an exact text
// match with what we sent. Anything else is left alone — a failure that
// never reached the JSONL write means there is nothing to prune, and the
// retry is safe as-is. Returns true if pruned.
func (a *App) pruneFailedUserMessage(agentID, folder, sessionID, sentText string, sentAt time.Time) bool {
	last := workspace.FindLastUserMessage(folder, sessionID)
	if last == nil {
		return false
	}

	textMatches := strings.TrimSpace(last.Text) == strings.TrimSpace(sentText)
	isOurs := false
	switch {
	case !last.Timestamp.IsZero():
		// Fresh timestamp → written by this send. 2s slack covers clock granularity.
		isOurs = last.Timestamp.After(sentAt.Add(-2 * time.Second))
	default:
		isOurs = textMatches && sentText != ""
	}
	if !isOurs {
		fmt.Printf("[RETRY] last user entry %s is NOT the failed send (ts=%s textMatch=%v) — nothing to prune\n",
			last.UUID, last.Timestamp.Format(time.RFC3339), textMatches)
		return false
	}
	if !textMatches {
		fmt.Printf("[RETRY] note: pruning by timestamp; text differs from sent (attachments-only or CLI reformatting)\n")
	}

	removed, err := workspace.DeleteFromMessage(folder, sessionID, last.UUID)
	if err != nil {
		fmt.Printf("[RETRY] prune failed: %v\n", err)
		return false
	}
	fmt.Printf("[RETRY] pruned %d lines (uuid=%s)\n", removed, last.UUID)
	if a.watcher != nil {
		if err := a.watcher.ReloadSession(agentID, folder, sessionID); err != nil {
			fmt.Printf("[RETRY] session reload after prune: %v\n", err)
		}
	}
	return true
}

// SendMessage sends a message to Claude Code, optionally with image attachments.
// If attachments are provided, uses stdin with stream-json format.
// If planMode is true, forces Claude into planning mode.
// The model parameter (alias or full ID, e.g. "opus[1m]" or "claude-sonnet-4-6[1m]") is passed
// to --model verbatim; empty = omit the flag (use CLI default).
// The effort parameter (low|medium|high|xhigh|max|auto) is passed to --effort; empty = omit.
// The oauthKey parameter selects an OAuth pool key: "" = Auto (rotation on 429
// when the pool has rotation keys, legacy env behavior otherwise); a key ID =
// pinned (that key always, no auto-rotation on limit).
// Emits "response_complete" event when the Claude CLI process exits.
//
// Two nested retry mechanisms:
//
// 1. Server-error retry (inner loop): 529/5xx/408 — prune the user message
//    Claude CLI already wrote to the JSONL, backoff 2→256s cap (unlimited
//    attempts until cancel), then retry with the original message+attachments.
//
// 2. OAuth rotation (outer loop): 429 usage limit — bench the key, pick the
//    next by nearest weekly reset, send auto-continue prompt (the original
//    message is already in the JSONL).
func (a *App) SendMessage(agentID, sessionID, message string, attachments []types.Attachment, planMode bool, model, effort, oauthKey string) error {
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

	retryCh := a.registerRetryCancel(sessionID)
	defer a.unregisterRetryCancel(sessionID, retryCh)

	curMsg, curAtt := message, attachments
	rotations := 0
	maxRotations := 0
	if a.oauthKeys != nil {
		maxRotations = a.oauthKeys.RotationSize()
	}
	var finalErr error
	extraResult := ""
	cancelled := false

rotationLoop:
	for {
		retryAttempt := 0

	retryLoop:
		for {
			sentAt := time.Now()
			if a.rt != nil {
				a.rt.SetLastSendTime(agentID, sessionID, sentAt)
			}

			keyID, extraEnv, mode := a.resolveOAuthEnv(sessionID, oauthKey)

			if retryAttempt > 0 {
				a.emitRetryStatus(agentID, sessionID, "retrying", retryAttempt, 0)
			}

			finalErr = a.claude.SendMessage(agent.Folder, sessionID, curMsg, curAtt, planMode, model, effort, extraEnv)

			if finalErr == nil {
				if retryAttempt > 0 {
					a.emitRetryStatus(agentID, sessionID, "cleared", 0, 0)
				}
				break rotationLoop
			}

			status, result, _ := parseClaudeCLIError(finalErr.Error())

			// --- Server-error retry (529/5xx/408): prune JSONL + backoff ---
			if isServerRetryable(status, result) {
				retryAttempt++
				delay := retryBackoffDelay(retryAttempt)
				fmt.Printf("[RETRY] attempt %d: status %d, backoff %v\n", retryAttempt, status, delay)

				a.pruneFailedUserMessage(agentID, agent.Folder, sessionID, curMsg, sentAt)
				a.emitRetryStatus(agentID, sessionID, "waiting", retryAttempt, int(delay.Seconds()))

				timer := time.NewTimer(delay)
				select {
				case <-timer.C:
					continue retryLoop
				case <-retryCh:
					timer.Stop()
					fmt.Printf("[RETRY] cancelled during backoff (attempt %d)\n", retryAttempt)
					a.emitRetryStatus(agentID, sessionID, "cleared", 0, 0)
					cancelled = true
					break rotationLoop
				}
			}

			if retryAttempt > 0 {
				a.emitRetryStatus(agentID, sessionID, "cleared", 0, 0)
			}

			// --- OAuth rotation (429 rate/usage limit) ---
			limitType, resetAt, isLimit := oauthkeys.ParseLimitInfo(status, result)
			if !isLimit {
				break rotationLoop
			}
			if keyID == "" {
				break rotationLoop
			}

			until := a.oauthKeys.ComputeLimitedUntil(keyID, limitType, resetAt)
			a.oauthKeys.RecordLimit(keyID, limitType, until)
			limitedLabel := a.oauthKeyLabel(keyID)
			fmt.Printf("[OAUTH] key %q hit %s limit, benched until %s\n", limitedLabel, limitType, until.Format(time.RFC3339))
			if a.rt != nil {
				a.rt.Emit("oauth:keys-changed", agentID, sessionID, map[string]any{
					"keyId":        keyID,
					"limitType":    limitType,
					"limitedUntil": until.UTC().Format(time.RFC3339),
				})
			}

			if mode == oauthkeys.ModePinned {
				break rotationLoop
			}
			if rotations >= maxRotations {
				break rotationLoop
			}

			nextID, _, ok := a.oauthKeys.SelectNextAfterLimit(sessionID)
			if !ok {
				extraResult = a.oauthKeys.AllLimitedSummary()
				break rotationLoop
			}
			rotations++
			nextLabel := a.oauthKeyLabel(nextID)
			fmt.Printf("[OAUTH] rotating %q -> %q, resuming with continue prompt\n", limitedLabel, nextLabel)
			if a.rt != nil {
				a.rt.Emit("mcp:notification", agentID, sessionID, map[string]any{
					"type":    "warning",
					"title":   "OAuth key rotated",
					"message": fmt.Sprintf("%s hit its %s limit (resets %s). Continuing with %s.", limitedLabel, limitType, until.Format("Mon 3:04 PM"), nextLabel),
				})
			}

			curMsg = a.oauthKeys.GetAutoContinuePrompt()
			curAtt = nil
			break retryLoop // back to rotationLoop with fresh key + continue prompt
		}
	}

	if cancelled {
		a.claude.MarkCancelled(sessionID)
	}

	a.emitResponseCompleteWithInfo(agentID, sessionID, model, finalErr, extraResult)

	return finalErr
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
	// The session's sticky OAuth pool key (if any) rides along so the resume
	// authenticates as the same account (cache continuity).
	_, extraEnv, _ := a.resolveOAuthEnv(sessionID, "")
	err := a.claude.SendMessage(agent.Folder, sessionID, "question answered", nil, false, "", "", extraEnv)

	// Emit response_complete event AFTER Claude finishes (no user-selected model in this path)
	a.emitResponseComplete(agentID, sessionID, "", err)

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
	// Ride the session's sticky OAuth pool key — /compact re-reads the whole
	// conversation, so running it on the account already holding the prompt
	// cache matters. Falls back to the pool default / legacy env when none.
	_, extraEnv, _ := a.resolveOAuthEnv(sessionID, "")
	output, err := a.claude.RunSlashCommand(agent.Folder, sessionID, command, extraEnv)
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

	// If the session is in a retry backoff sleep (no active process), signal
	// the cancel channel to abort the wait. This is harmless if no retry is
	// active (the channel doesn't exist or is already closed).
	a.signalRetryCancel(sessionID)

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
