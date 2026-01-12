package providers

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

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
	ctx context.Context
}

// NewClaudeCodeService creates a new Claude Code service
func NewClaudeCodeService(ctx context.Context) *ClaudeCodeService {
	return &ClaudeCodeService{ctx: ctx}
}

// SetContext updates the context (called from OnStartup)
func (s *ClaudeCodeService) SetContext(ctx context.Context) {
	s.ctx = ctx
}

// SendMessage sends a message to Claude Code in the specified folder/session
// It uses --resume to continue an existing session
// Returns when the command completes (Claude writes to session file, watcher picks it up)
func (s *ClaudeCodeService) SendMessage(folder, sessionId, message string) error {
	if folder == "" {
		return fmt.Errorf("folder is required")
	}
	if sessionId == "" {
		return fmt.Errorf("sessionId is required")
	}
	if message == "" {
		return fmt.Errorf("message is required")
	}

	// Get claude binary path
	path := GetClaudePath()
	if path == "" {
		return fmt.Errorf("claude CLI not found in PATH or common locations")
	}

	// Build command: claude --resume {sessionId} -p "{message}"
	// --print flag ensures output goes to stdout (not interactive)
	cmd := exec.CommandContext(s.ctx, path,
		"--print",
		"--resume", sessionId,
		"-p", message)
	cmd.Dir = folder

	// Run the command - Claude will write to the session file
	// The file watcher will pick up changes and emit events to frontend
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("claude command failed: %w, output: %s", err, string(output))
	}

	return nil
}

// NewSession creates a new Claude Code session in the specified folder
// Returns the session ID of the newly created session
func (s *ClaudeCodeService) NewSession(folder string) (string, error) {
	if folder == "" {
		return "", fmt.Errorf("folder is required")
	}

	// Get claude binary path
	path := GetClaudePath()
	if path == "" {
		return "", fmt.Errorf("claude CLI not found in PATH or common locations")
	}

	// Start a new session with a simple prompt
	// Use --output-format stream-json to parse the session ID from output
	cmd := exec.CommandContext(s.ctx, path,
		"--print",
		"--output-format", "stream-json",
		"-p", "Hello! Starting a new session.")
	cmd.Dir = folder

	// Get stdout to parse session ID
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start claude: %w", err)
	}

	// Parse streaming JSON output to find session ID using the classifier
	// The session_id is in the first system:init event
	var sessionId string
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// Classify the streaming event
		classified, err := types.ClassifyStreamingEvent(line)
		if err != nil {
			continue
		}

		// Extract session_id from any event type
		if sid := classified.GetSessionID(); sid != "" {
			sessionId = sid
			// Don't break - continue reading to drain stdout
		}

		// Stop on result event (success or error)
		if classified.EventType == types.StreamingEventResultSuccess ||
			classified.EventType == types.StreamingEventResultError {
			break
		}
	}

	// Wait for command to complete
	if err := cmd.Wait(); err != nil {
		// Command may have been cancelled or failed, but we might still have session ID
		if sessionId == "" {
			return "", fmt.Errorf("claude command failed: %w", err)
		}
	}

	if sessionId == "" {
		return "", fmt.Errorf("could not parse session ID from claude output")
	}

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
