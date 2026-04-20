// Package session provides direct session file management for ClaudeFu.
// This enables instant session creation without waiting for Claude CLI.
package session

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Service provides session management primitives.
type Service struct {
	claudeProjectsPath string
}

// NewService creates a new SessionService.
func NewService() *Service {
	home, _ := os.UserHomeDir()
	return &Service{
		claudeProjectsPath: filepath.Join(home, ".claude", "projects"),
	}
}

// Fixed starter messages for instant session creation
const (
	starterUserMessage      = "Starting a new session with Claude."
	starterAssistantMessage = "I'm ready for action, what would you like to do first?"
)

// CreateSession creates a session instantly without invoking Claude CLI.
// Writes a JSONL file with a starter exchange. Claude CLI's --resume picks it up.
func (s *Service) CreateSession(folder string) (string, error) {
	sessionID := uuid.New().String()
	userMsgID := uuid.New().String()
	assistantMsgID := uuid.New().String()
	encodedFolder := encodeFolder(folder)
	projectDir := filepath.Join(s.claudeProjectsPath, encodedFolder)
	now := time.Now().UTC()

	// Ensure directory exists
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		return "", fmt.Errorf("create project dir: %w", err)
	}

	// Create JSONL file with initial content
	jsonlPath := filepath.Join(projectDir, sessionID+".jsonl")
	f, err := os.Create(jsonlPath)
	if err != nil {
		return "", fmt.Errorf("create jsonl: %w", err)
	}
	defer f.Close()

	// Get git branch (best effort)
	gitBranch := getGitBranch(folder)

	// Write file-history-snapshot entry (Claude expects this)
	snapshot := FileHistorySnapshot{
		Type:      "file-history-snapshot",
		MessageID: userMsgID,
		Snapshot: SnapshotData{
			MessageID:          userMsgID,
			TrackedFileBackups: map[string]interface{}{},
			Timestamp:          now.Format(time.RFC3339Nano),
		},
		IsSnapshotUpdate: false,
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return "", fmt.Errorf("marshal snapshot: %w", err)
	}
	if _, err := f.Write(append(snapshotJSON, '\n')); err != nil {
		return "", fmt.Errorf("write snapshot: %w", err)
	}

	// Write user message entry
	userMsg := UserMessage{
		ParentUUID:  nil,
		IsSidechain: false,
		UserType:    "external",
		CWD:         folder,
		SessionID:   sessionID,
		Version:     "2.1.19",
		GitBranch:   gitBranch,
		Type:        "user",
		Message: MessageContent{
			Role:    "user",
			Content: starterUserMessage,
		},
		UUID:      userMsgID,
		Timestamp: now.Format(time.RFC3339Nano),
		ThinkingMetadata: ThinkingMetadata{
			MaxThinkingTokens: 31999,
		},
		Todos:          []interface{}{},
		PermissionMode: "default",
	}
	userMsgJSON, err := json.Marshal(userMsg)
	if err != nil {
		return "", fmt.Errorf("marshal user message: %w", err)
	}
	if _, err := f.Write(append(userMsgJSON, '\n')); err != nil {
		return "", fmt.Errorf("write user message: %w", err)
	}

	// Write assistant response (completes the turn)
	assistantMsg := AssistantMessage{
		ParentUUID:  userMsgID,
		IsSidechain: false,
		UserType:    "external",
		CWD:         folder,
		SessionID:   sessionID,
		Version:     "2.1.19",
		GitBranch:   gitBranch,
		Message: AssistantMessageBody{
			Model: "claude-opus-4-5-20251101",
			ID:    "msg_claudefu_starter",
			Type:  "message",
			Role:  "assistant",
			Content: []ContentBlock{
				{Type: "text", Text: starterAssistantMessage},
			},
			StopReason:   "stop_sequence",
			StopSequence: nil,
			Usage: &UsageInfo{
				InputTokens:  10,
				OutputTokens: 15,
			},
		},
		RequestID: "req_claudefu_starter",
		Type:      "assistant",
		UUID:      assistantMsgID,
		Timestamp: now.Add(time.Millisecond).Format(time.RFC3339Nano),
	}
	assistantMsgJSON, err := json.Marshal(assistantMsg)
	if err != nil {
		return "", fmt.Errorf("marshal assistant message: %w", err)
	}
	if _, err := f.Write(append(assistantMsgJSON, '\n')); err != nil {
		return "", fmt.Errorf("write assistant message: %w", err)
	}

	return sessionID, nil
}

// getGitBranch returns the current git branch for a folder (empty string if not a git repo)
func getGitBranch(folder string) string {
	cmd := exec.Command("git", "-C", folder, "rev-parse", "--abbrev-ref", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// FileHistorySnapshot matches Claude's file-history-snapshot JSONL entry
type FileHistorySnapshot struct {
	Type             string       `json:"type"`
	MessageID        string       `json:"messageId"`
	Snapshot         SnapshotData `json:"snapshot"`
	IsSnapshotUpdate bool         `json:"isSnapshotUpdate"`
}

// SnapshotData is the inner snapshot structure
type SnapshotData struct {
	MessageID          string                 `json:"messageId"`
	TrackedFileBackups map[string]interface{} `json:"trackedFileBackups"`
	Timestamp          string                 `json:"timestamp"`
}

// UserMessage matches Claude's user message JSONL entry
type UserMessage struct {
	ParentUUID       *string          `json:"parentUuid"`
	IsSidechain      bool             `json:"isSidechain"`
	UserType         string           `json:"userType"`
	CWD              string           `json:"cwd"`
	SessionID        string           `json:"sessionId"`
	Version          string           `json:"version"`
	GitBranch        string           `json:"gitBranch"`
	Type             string           `json:"type"`
	Message          MessageContent   `json:"message"`
	UUID             string           `json:"uuid"`
	Timestamp        string           `json:"timestamp"`
	ThinkingMetadata ThinkingMetadata `json:"thinkingMetadata"`
	Todos            []interface{}    `json:"todos"`
	PermissionMode   string           `json:"permissionMode"`
}

// MessageContent is the role/content structure
type MessageContent struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ThinkingMetadata holds thinking token limits
type ThinkingMetadata struct {
	MaxThinkingTokens int `json:"maxThinkingTokens"`
}

// AssistantMessage matches Claude's assistant message JSONL entry
type AssistantMessage struct {
	ParentUUID  string                 `json:"parentUuid"`
	IsSidechain bool                   `json:"isSidechain"`
	UserType    string                 `json:"userType"`
	CWD         string                 `json:"cwd"`
	SessionID   string                 `json:"sessionId"`
	Version     string                 `json:"version"`
	GitBranch   string                 `json:"gitBranch"`
	Message     AssistantMessageBody   `json:"message"`
	RequestID   string                 `json:"requestId"`
	Type        string                 `json:"type"`
	UUID        string                 `json:"uuid"`
	Timestamp   string                 `json:"timestamp"`
}

// AssistantMessageBody matches Claude's message structure
type AssistantMessageBody struct {
	Model        string         `json:"model"`
	ID           string         `json:"id"`
	Type         string         `json:"type"`
	Role         string         `json:"role"`
	Content      []ContentBlock `json:"content"`
	StopReason   string         `json:"stop_reason"`
	StopSequence *string        `json:"stop_sequence"`
	Usage        *UsageInfo     `json:"usage,omitempty"`
}

// ContentBlock is a text block in the content array
type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// UsageInfo contains token usage
type UsageInfo struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// encodeFolder converts folder path to Claude's encoded format.
// Claude CLI replaces every non-alphanumeric character with "-".
var nonAlphanumeric = regexp.MustCompile(`[^a-zA-Z0-9]`)

func encodeFolder(folder string) string {
	return nonAlphanumeric.ReplaceAllString(folder, "-")
}

// DuplicateSession copies an existing session JSONL to a new UUID file.
// Returns the new session ID.
func (s *Service) DuplicateSession(folder, sourceSessionID string) (string, error) {
	encodedFolder := encodeFolder(folder)
	projectDir := filepath.Join(s.claudeProjectsPath, encodedFolder)
	sourcePath := filepath.Join(projectDir, sourceSessionID+".jsonl")

	// Read source file
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return "", fmt.Errorf("read source session: %w", err)
	}

	// Generate new session ID and write copy
	newSessionID := uuid.New().String()
	newPath := filepath.Join(projectDir, newSessionID+".jsonl")

	if err := os.WriteFile(newPath, data, 0644); err != nil {
		return "", fmt.Errorf("write duplicated session: %w", err)
	}

	// Count messages for log output
	messageCount := 0
	for _, line := range strings.Split(string(data), "\n") {
		if line == "" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}
		eventType, _ := event["type"].(string)
		if eventType == "user" || eventType == "assistant" {
			messageCount++
		}
	}

	fmt.Printf("[SESSION] Duplicated %s → %s (%d messages)\n", sourceSessionID, newSessionID, messageCount)
	return newSessionID, nil
}
