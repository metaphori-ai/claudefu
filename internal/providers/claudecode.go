package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"claudefu/internal/permissions"
	"claudefu/internal/types"
)

var (
	claudePath     string
	claudePathOnce sync.Once
)

// findClaudeBinary searches for the claude binary in common locations
// macOS GUI apps have a limited PATH, so we check common install locations
func findClaudeBinary() string {
	// Try standard PATH first
	if path, err := exec.LookPath("claude"); err == nil {
		return path
	}

	// Get home directory for ~ expansion
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.Getenv("HOME")
	}

	// Common installation locations on macOS
	locations := []string{
		filepath.Join(home, ".claude/local/claude"), // Claude Code default install location
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude", // Apple Silicon Homebrew
		filepath.Join(home, ".local/bin/claude"),
		filepath.Join(home, ".npm-global/bin/claude"),
		filepath.Join(home, "bin/claude"),
	}

	for _, loc := range locations {
		if info, err := os.Stat(loc); err == nil {
			// Verify it's executable
			if info.Mode()&0111 != 0 {
				return loc
			}
		}
	}

	return ""
}

// GetClaudePath returns the path to the claude binary (cached)
func GetClaudePath() string {
	claudePathOnce.Do(func() {
		claudePath = findClaudeBinary()
	})
	return claudePath
}

// ClaudeCodeService provides interaction with the Claude Code CLI
type ClaudeCodeService struct {
	ctx       context.Context
	mcpConfig string // JSON config for --mcp-config flag (empty = disabled)

	// Custom environment variables for Claude CLI (e.g., ANTHROPIC_BASE_URL for proxies)
	envVars   map[string]string
	envVarsMu sync.RWMutex

	// Process tracking for cancellation support
	activeProcs   map[string]*exec.Cmd // sessionID -> running command
	activeProcsMu sync.RWMutex

	// Cancellation tracking - distinguishes user cancellation from errors
	cancelledSessions   map[string]bool
	cancelledSessionsMu sync.RWMutex

	// Event emission for debug info (CLI command, etc.)
	emitFunc func(eventType string, data map[string]any)
}

// NewClaudeCodeService creates a new Claude Code service
func NewClaudeCodeService(ctx context.Context) *ClaudeCodeService {
	return &ClaudeCodeService{
		ctx:               ctx,
		activeProcs:       make(map[string]*exec.Cmd),
		cancelledSessions: make(map[string]bool),
	}
}

// SetContext updates the context (called from OnStartup)
func (s *ClaudeCodeService) SetContext(ctx context.Context) {
	s.ctx = ctx
}

// SetMCPServerPort configures the MCP server URL for inter-agent communication
// When set, all spawned Claude processes will include --mcp-config with this server
func (s *ClaudeCodeService) SetMCPServerPort(port int) {
	if port <= 0 {
		s.mcpConfig = ""
		return
	}
	// Generate inline JSON config for SSE transport
	// Format: {"mcpServers":{"name":{"type":"sse","url":"..."}}}
	s.mcpConfig = fmt.Sprintf(`{"mcpServers":{"claudefu":{"type":"sse","url":"http://localhost:%d/sse"}}}`, port)
}

// ClearMCPConfig disables MCP config injection
func (s *ClaudeCodeService) ClearMCPConfig() {
	s.mcpConfig = ""
}

// SetEnvironment sets custom environment variables to be passed to Claude CLI processes.
// These are merged with the parent process environment (custom vars take precedence).
// Use this for proxies (ANTHROPIC_BASE_URL), custom API keys, or other env-based config.
func (s *ClaudeCodeService) SetEnvironment(vars map[string]string) {
	s.envVarsMu.Lock()
	defer s.envVarsMu.Unlock()
	s.envVars = vars
}

// SetEmitFunc sets the function to emit events (for debug info like CLI commands)
func (s *ClaudeCodeService) SetEmitFunc(emitFunc func(eventType string, data map[string]any)) {
	s.emitFunc = emitFunc
}

// buildEnvironment creates the environment slice for exec.Cmd.
// It merges the parent process environment with custom vars (custom vars override).
// Returns nil if no custom vars are set (uses Go's default behavior of inheriting parent env).
func (s *ClaudeCodeService) buildEnvironment() []string {
	s.envVarsMu.RLock()
	defer s.envVarsMu.RUnlock()

	if len(s.envVars) == 0 {
		return nil // Use default behavior (inherit parent env)
	}

	// Start with parent environment
	env := os.Environ()

	// Append custom vars (these override existing vars with same name)
	for key, value := range s.envVars {
		env = append(env, fmt.Sprintf("%s=%s", key, value))
	}

	return env
}

// trackProcess stores a running command for potential cancellation
func (s *ClaudeCodeService) trackProcess(sessionID string, cmd *exec.Cmd) {
	s.activeProcsMu.Lock()
	defer s.activeProcsMu.Unlock()
	s.activeProcs[sessionID] = cmd
}

// untrackProcess removes a command from the tracking map
func (s *ClaudeCodeService) untrackProcess(sessionID string) {
	s.activeProcsMu.Lock()
	defer s.activeProcsMu.Unlock()
	delete(s.activeProcs, sessionID)
}

// CancelSession sends SIGINT to the running Claude process for a session
// Returns nil if no process is running for that session (already finished)
func (s *ClaudeCodeService) CancelSession(sessionID string) error {
	s.activeProcsMu.RLock()
	cmd, ok := s.activeProcs[sessionID]
	s.activeProcsMu.RUnlock()

	if !ok {
		// No running process - already finished or never started
		return nil
	}

	if cmd.Process == nil {
		return nil
	}

	// Mark as cancelled BEFORE sending signal (so WasCancelled knows it was intentional)
	s.cancelledSessionsMu.Lock()
	s.cancelledSessions[sessionID] = true
	s.cancelledSessionsMu.Unlock()

	// Send SIGINT for graceful termination (like Ctrl+C in terminal)
	// This allows Claude CLI to clean up properly
	fmt.Printf("[DEBUG] CancelSession: sending SIGINT to session %s (PID %d)\n", sessionID, cmd.Process.Pid)
	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		// Process may have already exited
		fmt.Printf("[DEBUG] CancelSession: signal error (process may have exited): %v\n", err)
		return nil
	}

	return nil
}

// WasCancelled checks if a session was cancelled via CancelSession.
// This is used to distinguish user-initiated cancellation from errors.
// Calling this method clears the cancelled flag (single-use check).
func (s *ClaudeCodeService) WasCancelled(sessionID string) bool {
	s.cancelledSessionsMu.Lock()
	defer s.cancelledSessionsMu.Unlock()
	wasCancelled := s.cancelledSessions[sessionID]
	delete(s.cancelledSessions, sessionID) // Clear after checking
	return wasCancelled
}

// getMCPArgs returns ONLY the --mcp-config arg if MCP is configured.
// MCP tool allow/disallow is handled by buildPermissionArgs to avoid duplicate flags.
func (s *ClaudeCodeService) getMCPArgs() []string {
	if s.mcpConfig == "" {
		return nil
	}
	return []string{
		"--mcp-config", s.mcpConfig,
	}
}

// buildPermissionArgs compiles ClaudeFu permissions into CLI flags for spawning Claude.
// This is the key integration point where our permission system controls Claude's behavior.
//
// Flag semantics:
//   - --tools: Which built-in tools are AVAILABLE (the pool/universe)
//   - --allowedTools: Which tools/patterns are AUTO-APPROVED (no permission prompt)
//   - --disallowedTools: Patterns to BLOCK
//   - --add-dir: Additional directories to allow access to
//
// Note: We intentionally omit --setting-sources to allow Claude's global settings
// to still apply. Our explicit flags take precedence.
func (s *ClaudeCodeService) buildPermissionArgs(folder string) []string {
	if folder == "" {
		return nil
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		fmt.Printf("[DEBUG] buildPermissionArgs: failed to create permissions manager: %v\n", err)
		return nil
	}

	perms, err := mgr.GetAgentPermissionsOrGlobal(folder)
	if err != nil {
		fmt.Printf("[DEBUG] buildPermissionArgs: failed to load permissions: %v\n", err)
		return nil
	}

	if perms == nil {
		fmt.Printf("[DEBUG] buildPermissionArgs: no permissions found, using defaults\n")
		return nil
	}

	var args []string

	// 1. --tools: Set which built-in tools are AVAILABLE (the pool)
	availableTools := mgr.CompileAvailableTools(perms)
	if len(availableTools) > 0 {
		args = append(args, "--tools", strings.Join(availableTools, ","))
	}

	// 2. --allowedTools: Auto-approve these (no permission prompt)
	// This includes enabled built-in tools + Bash patterns from sets
	allowedPatterns := mgr.CompileAllowList(perms)

	// Add MCP tools to allowed list if MCP is configured
	if s.mcpConfig != "" {
		mcpTools := []string{
			"mcp__claudefu__AgentBroadcast",
			"mcp__claudefu__AgentMessage",
			"mcp__claudefu__AgentQuery",
			"mcp__claudefu__NotifyUser",
			"mcp__claudefu__AskUserQuestion",
			"mcp__claudefu__SelfQuery",
			"mcp__claudefu__BrowserAgent",
			"mcp__claudefu__ExitPlanMode",
			"mcp__claudefu__RequestToolPermission",
			"mcp__claudefu__BacklogAdd",
			"mcp__claudefu__BacklogUpdate",
			"mcp__claudefu__BacklogList",
		}
		allowedPatterns = append(allowedPatterns, mcpTools...)
	}

	if len(allowedPatterns) > 0 {
		args = append(args, "--allowedTools", strings.Join(allowedPatterns, ","))
	}

	// 3. --disallowedTools: Always deny these
	// NOTE: We only pass this if there are explicit deny patterns.
	// Passing empty doesn't override settings.local.json deny list.
	// If settings.local.json has a deny list that conflicts, user must either:
	// - Clear it via "Sync to settings.local" in Permissions dialog
	// - Or manually edit settings.local.json
	denyPatterns := mgr.CompileDenyList(perms)

	// Add built-in tools to deny list when MCP is configured
	// This forces Claude to use our MCP versions instead of built-in
	if s.mcpConfig != "" {
		denyPatterns = append(denyPatterns, "AskUserQuestion", "ExitPlanMode")
	}
	if len(denyPatterns) > 0 {
		args = append(args, "--disallowedTools", strings.Join(denyPatterns, ","))
	}

	// 4. --add-dir: Additional directories (union of global + agent dirs)
	dirs, err := mgr.CompileDirectories(folder)
	if err == nil {
		for _, dir := range dirs {
			args = append(args, "--add-dir", dir)
		}
	}

	if len(args) > 0 {
		fmt.Printf("[DEBUG] buildPermissionArgs: generated %d permission args\n", len(args))
	}

	return args
}

// SendMessage sends a message to Claude Code in the specified folder/session.
// It uses --resume to continue an existing session.
// If attachments are provided, uses stdin with --input-format stream-json.
// If planMode is true, adds --permission-mode plan to force planning mode.
// Returns when the command completes (Claude writes to session file, watcher picks it up).
func (s *ClaudeCodeService) SendMessage(folder, sessionId, message string, attachments []types.Attachment, planMode bool) error {
	if folder == "" {
		return fmt.Errorf("folder is required")
	}
	if sessionId == "" {
		return fmt.Errorf("sessionId is required")
	}
	if message == "" && len(attachments) == 0 {
		return fmt.Errorf("message or attachments required")
	}

	// Get claude binary path
	path := GetClaudePath()
	if path == "" {
		return fmt.Errorf("claude CLI not found in PATH or common locations")
	}

	// Determine permission mode
	permissionMode := "acceptEdits"
	if planMode {
		permissionMode = "plan"
	}

	// If attachments provided, use stream-json input via stdin
	if len(attachments) > 0 {
		return s.sendWithAttachments(path, folder, sessionId, message, attachments, permissionMode)
	}

	// No attachments: use existing simpler -p approach
	args := []string{
		"--print",
		"--permission-mode", permissionMode,
		"--resume", sessionId,
		"-p", message,
	}

	// Add permission args (tools, allowedTools, disallowedTools, add-dir)
	args = append(args, s.buildPermissionArgs(folder)...)

	// Add MCP config if configured (enables inter-agent communication)
	args = append(args, s.getMCPArgs()...)

	cmd := exec.CommandContext(s.ctx, path, args...)
	cmd.Dir = folder
	cmd.Env = s.buildEnvironment() // Apply custom env vars (e.g., ANTHROPIC_BASE_URL for proxies)

	// Track the process for potential cancellation
	s.trackProcess(sessionId, cmd)
	defer s.untrackProcess(sessionId)

	// Capture output for error reporting
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Emit CLI command for debug display
	if s.emitFunc != nil {
		cmdStr := path + " " + strings.Join(args, " ")
		s.emitFunc("debug:cli-command", map[string]any{"command": cmdStr, "sessionId": sessionId})
	}

	// Start the command (non-blocking)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start claude: %w", err)
	}

	fmt.Printf("[DEBUG] SendMessage: started claude PID=%d for session %s\n", cmd.Process.Pid, sessionId)

	// Wait for command to complete (or be cancelled via CancelSession)
	if err := cmd.Wait(); err != nil {
		// Check if it was cancelled (context or signal)
		if s.ctx.Err() != nil {
			return fmt.Errorf("claude command cancelled: %w", s.ctx.Err())
		}
		// Include output in error for debugging
		output := stderr.String()
		if output == "" {
			output = stdout.String()
		}
		return fmt.Errorf("claude command failed: %w, output: %s", err, output)
	}

	return nil
}

// sendWithAttachments sends a message with images via stdin using stream-json format.
// Required flags: --input-format stream-json, --output-format stream-json, --verbose
func (s *ClaudeCodeService) sendWithAttachments(claudePath, folder, sessionId, message string, attachments []types.Attachment, permissionMode string) error {
	fmt.Printf("[DEBUG] sendWithAttachments: folder=%s sessionId=%s message=%q attachments=%d\n", folder, sessionId, message, len(attachments))

	// Build content blocks array
	contentBlocks := make([]map[string]any, 0, len(attachments)+1)

	// Add text block if message is not empty
	if message != "" {
		contentBlocks = append(contentBlocks, map[string]any{
			"type": "text",
			"text": message,
		})
	}

	// Add attachment blocks (images or files)
	for i, att := range attachments {
		fmt.Printf("[DEBUG] sendWithAttachments: attachment[%d] type=%s mediaType=%s dataLen=%d\n", i, att.Type, att.MediaType, len(att.Data))

		if att.Type == "image" {
			// Image block - send as base64 image
			contentBlocks = append(contentBlocks, map[string]any{
				"type": "image",
				"source": map[string]any{
					"type":       "base64",
					"media_type": att.MediaType,
					"data":       att.Data,
				},
			})
		} else if att.Type == "file" {
			// File block - use unique XML-style delimiter (avoids collision with ``` in content)
			// Use filePath for the header, fallback to fileName
			displayPath := att.FilePath
			if displayPath == "" {
				displayPath = att.FileName
			}
			ext := att.Extension
			if ext == "" {
				ext = "txt"
			}
			// Format: <claudefu-file path="..." ext="...">content</claudefu-file>
			// This delimiter won't appear in normal file content
			fileContent := fmt.Sprintf("\n\n<claudefu-file path=\"%s\" ext=\"%s\">\n%s\n</claudefu-file>", displayPath, ext, att.Data)
			contentBlocks = append(contentBlocks, map[string]any{
				"type": "text",
				"text": fileContent,
			})
		}
	}

	// Build the user message payload (stream-json input format)
	payload := map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": contentBlocks,
		},
	}

	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	// Log first 500 chars of JSON for debugging (don't log full base64)
	jsonPreview := string(jsonBytes)
	if len(jsonPreview) > 500 {
		jsonPreview = jsonPreview[:500] + "..."
	}
	fmt.Printf("[DEBUG] sendWithAttachments: JSON payload preview: %s\n", jsonPreview)
	fmt.Printf("[DEBUG] sendWithAttachments: JSON payload total length: %d bytes\n", len(jsonBytes))

	// Build command args - stream-json input requires these flags
	args := []string{
		"--print",
		"--verbose",
		"--input-format", "stream-json",
		"--output-format", "stream-json",
		"--permission-mode", permissionMode,
		"--resume", sessionId,
	}

	// Add permission args (tools, allowedTools, disallowedTools, add-dir)
	args = append(args, s.buildPermissionArgs(folder)...)

	args = append(args, s.getMCPArgs()...)

	fmt.Printf("[DEBUG] sendWithAttachments: running command: %s %v\n", claudePath, args)

	cmd := exec.CommandContext(s.ctx, claudePath, args...)
	cmd.Dir = folder
	cmd.Env = s.buildEnvironment() // Apply custom env vars (e.g., ANTHROPIC_BASE_URL for proxies)
	cmd.Stdin = bytes.NewReader(jsonBytes)

	// Track the process for potential cancellation
	s.trackProcess(sessionId, cmd)
	defer s.untrackProcess(sessionId)

	// Capture output for error reporting
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	fmt.Printf("[DEBUG] sendWithAttachments: executing command...\n")

	// Emit CLI command for debug display (note: with attachments, stdin is piped so we note that)
	if s.emitFunc != nil {
		cmdStr := claudePath + " " + strings.Join(args, " ") + " < [stream-json stdin]"
		s.emitFunc("debug:cli-command", map[string]any{"command": cmdStr, "sessionId": sessionId})
	}

	// Start the command (non-blocking)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start claude: %w", err)
	}

	fmt.Printf("[DEBUG] sendWithAttachments: started claude PID=%d for session %s\n", cmd.Process.Pid, sessionId)

	// Wait for command to complete (or be cancelled via CancelSession)
	err = cmd.Wait()
	fmt.Printf("[DEBUG] sendWithAttachments: command completed, err=%v\n", err)

	if err != nil {
		// Check if it was cancelled (context or signal)
		if s.ctx.Err() != nil {
			fmt.Printf("[DEBUG] sendWithAttachments: CANCELLED\n")
			return fmt.Errorf("claude command cancelled: %w", s.ctx.Err())
		}
		output := stderr.String()
		if output == "" {
			output = stdout.String()
		}
		fmt.Printf("[DEBUG] sendWithAttachments: ERROR output: %s\n", output)
		return fmt.Errorf("claude command failed: %w, output: %s", err, output)
	}

	fmt.Printf("[DEBUG] sendWithAttachments: SUCCESS\n")
	return nil
}

// NewSession creates a new Claude Code session in the specified folder
// Returns the session ID of the newly created session
func (s *ClaudeCodeService) NewSession(folder string) (string, error) {
	fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: folder=%s\n", folder)

	if folder == "" {
		return "", fmt.Errorf("folder is required")
	}

	// Get claude binary path
	path := GetClaudePath()
	if path == "" {
		return "", fmt.Errorf("claude CLI not found in PATH or common locations")
	}
	fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: claude path=%s\n", path)

	// Start a new session with a simple prompt
	// Use --output-format stream-json to parse the session ID from output
	// Use acceptEdits to auto-approve file edits in non-interactive mode
	// Note: --print with --output-format stream-json requires --verbose
	args := []string{
		"--print",
		"--verbose",
		"--permission-mode", "acceptEdits",
		"--output-format", "stream-json",
		"-p", "Hello! Starting a new session.",
	}

	// Add permission args (tools, allowedTools, disallowedTools, add-dir)
	args = append(args, s.buildPermissionArgs(folder)...)

	// Add MCP config if configured (enables inter-agent communication)
	args = append(args, s.getMCPArgs()...)

	cmd := exec.CommandContext(s.ctx, path, args...)
	cmd.Dir = folder
	cmd.Env = s.buildEnvironment() // Apply custom env vars (e.g., ANTHROPIC_BASE_URL for proxies)

	// Get stdout to parse session ID
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Get stderr for debugging
	stderr, err := cmd.StderrPipe()
	if err != nil {
		fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: failed to create stderr pipe: %v\n", err)
	}

	fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: starting claude CLI...\n")
	if err := cmd.Start(); err != nil {
		fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: failed to start: %v\n", err)
		return "", fmt.Errorf("failed to start claude: %w", err)
	}
	fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: claude CLI started, PID=%d\n", cmd.Process.Pid)

	// Read stderr in background
	go func() {
		stderrBytes, _ := io.ReadAll(stderr)
		if len(stderrBytes) > 0 {
			fmt.Printf("[DEBUG] ClaudeCodeService.NewSession stderr: %s\n", string(stderrBytes))
		}
	}()

	// Parse streaming JSON output to find session ID using the classifier
	// The session_id is in the first system:init event
	var sessionId string
	lineCount := 0
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		lineCount++
		if line == "" {
			continue
		}

		fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: line %d: %.100s...\n", lineCount, line)

		// Classify the streaming event
		classified, err := types.ClassifyStreamingEvent(line)
		if err != nil {
			fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: classify error: %v\n", err)
			continue
		}

		fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: event type=%s\n", classified.EventType)

		// Extract session_id from any event type
		if sid := classified.GetSessionID(); sid != "" {
			sessionId = sid
			fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: found sessionId=%s\n", sessionId)
			// Don't break - continue reading to drain stdout
		}

		// Stop on result event (success or error)
		if classified.EventType == types.StreamingEventResultSuccess ||
			classified.EventType == types.StreamingEventResultError {
			fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: got result event, stopping scan\n")
			break
		}
	}

	fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: finished scanning, read %d lines\n", lineCount)

	// Wait for command to complete
	if err := cmd.Wait(); err != nil {
		fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: cmd.Wait error: %v\n", err)
		// Command may have been cancelled or failed, but we might still have session ID
		if sessionId == "" {
			return "", fmt.Errorf("claude command failed: %w", err)
		}
	}

	if sessionId == "" {
		return "", fmt.Errorf("could not parse session ID from claude output")
	}

	fmt.Printf("[DEBUG] ClaudeCodeService.NewSession: returning sessionId=%s\n", sessionId)
	return sessionId, nil
}

// GetSessionIdFromFolder attempts to find the most recent session in a folder
// This is useful when we need to resume but don't know the session ID
func (s *ClaudeCodeService) GetLatestSessionId(folder string) (string, error) {
	// List sessions using claude CLI or by reading ~/.claude/projects directly
	// For now, return empty - the workspace manager handles this
	return "", fmt.Errorf("not implemented - use workspace.GetSessions instead")
}

// IsClaudeInstalled checks if the claude CLI is available
func IsClaudeInstalled() bool {
	return GetClaudePath() != ""
}

// GetClaudeVersion returns the installed claude CLI version
func GetClaudeVersion() (string, error) {
	path := GetClaudePath()
	if path == "" {
		return "", fmt.Errorf("claude not found")
	}
	cmd := exec.Command(path, "--version")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}
