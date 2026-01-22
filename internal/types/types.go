// Package types provides shared type definitions for ClaudeFu.
// These types are used across workspace, watcher, and runtime packages.
package types

import "time"

// =============================================================================
// MESSAGE TYPES (from JSONL parsing)
// =============================================================================

// Message represents a parsed chat message from Claude Code JSONL files.
type Message struct {
	UUID              string           `json:"uuid"`
	Type              string           `json:"type"` // user, assistant, summary
	Content           string           `json:"content"`
	ContentBlocks     []ContentBlock   `json:"contentBlocks,omitempty"`
	Timestamp         string           `json:"timestamp"`
	IsCompaction      bool             `json:"isCompaction,omitempty"`
	CompactionPreview string           `json:"compactionPreview,omitempty"`
	PendingQuestion   *PendingQuestion `json:"pendingQuestion,omitempty"` // Non-nil if AskUserQuestion failed (interactive mode)
	IsSynthetic       bool             `json:"isSynthetic,omitempty"`     // True if model="<synthetic>" (e.g., "No response requested.")
	StopReason        string           `json:"stopReason,omitempty"`      // "stop_sequence" when complete (JSONL), "end_turn" (streaming), null when tools pending
}

// PendingQuestion tracks a failed AskUserQuestion tool call that needs user interaction.
// When Claude Code runs with --print, AskUserQuestion auto-fails. ClaudeFu detects this
// and presents an interactive UI to the user, then patches the JSONL with the answer.
type PendingQuestion struct {
	ToolUseID string                   `json:"toolUseId"` // The tool_use block ID to patch
	Questions []map[string]interface{} `json:"questions"` // The questions from AskUserQuestion input
}

// ContentBlock represents a single content block within a message.
// Claude messages can contain multiple blocks: text, tool_use, tool_result, image, thinking.
// Field names align with Claude Code API schema for direct parsing.
type ContentBlock struct {
	Type string `json:"type"` // text, tool_use, tool_result, image, thinking

	// Text block fields
	Text string `json:"text,omitempty"`

	// Tool use block fields (type: "tool_use")
	ID    string `json:"id,omitempty"`    // Tool use ID (e.g., "toolu_01abc...")
	Name  string `json:"name,omitempty"`  // Tool name (e.g., "Read", "Bash", "Edit")
	Input any    `json:"input,omitempty"` // Tool input parameters

	// Tool result block fields (type: "tool_result")
	ToolUseID string `json:"tool_use_id,omitempty"` // References the tool_use block ID
	Content   any    `json:"content,omitempty"`     // Result content (string or structured)
	IsError   bool   `json:"is_error"`    // True if tool execution failed (must not use omitempty!)

	// Image block fields (type: "image")
	Source *ImageSource `json:"source,omitempty"` // Image source data

	// Thinking block fields (type: "thinking") - Extended thinking mode
	Thinking  string `json:"thinking,omitempty"`  // The thinking content
	Signature string `json:"signature,omitempty"` // Cryptographic signature for verification
}

// ImageSource contains image data for image content blocks.
type ImageSource struct {
	Type      string `json:"type"`       // "base64"
	MediaType string `json:"media_type"` // "image/png", "image/jpeg", etc.
	Data      string `json:"data"`       // Base64-encoded image data
}

// =============================================================================
// INPUT TYPES (for sending messages with attachments)
// =============================================================================

// Attachment represents an image or file attachment sent with a user message.
// For images: Frontend base64-encodes images and passes them to SendMessage.
// For files: Frontend reads file content via ReadFileContent and passes raw text.
// Supported image media types: image/png, image/jpeg, image/gif, image/webp
type Attachment struct {
	Type      string `json:"type"`                 // "image" or "file"
	MediaType string `json:"media_type"`           // MIME type
	Data      string `json:"data"`                 // Base64 for images, raw content for files
	// File-specific fields
	FilePath  string `json:"filePath,omitempty"`   // Absolute path for file attachments
	FileName  string `json:"fileName,omitempty"`   // Display name
	Extension string `json:"extension,omitempty"`  // File extension (e.g., "tsx", "go")
}

// =============================================================================
// EVENT TYPES (for frontend communication)
// =============================================================================

// EventEnvelope wraps all events with routing information.
// All events emitted to the frontend use this envelope pattern.
type EventEnvelope struct {
	WorkspaceID string      `json:"workspaceId"`           // Always present
	AgentID     string      `json:"agentId,omitempty"`     // Present for agent/session events
	SessionID   string      `json:"sessionId,omitempty"`   // Present for session events
	EventType   string      `json:"eventType"`             // The event name
	Payload     any `json:"payload"` // Event-specific data
}

// =============================================================================
// SESSION TYPES
// =============================================================================

// Session represents metadata about a Claude Code session.
// The actual messages are stored in SessionState.
type Session struct {
	ID           string    `json:"id"`           // Session UUID (from JSONL filename)
	AgentID      string    `json:"agentId"`      // Parent agent UUID
	Preview      string    `json:"preview"`      // First user message preview
	MessageCount int       `json:"messageCount"` // Total messages in session
	CreatedAt    time.Time `json:"createdAt"`    // From first message timestamp
	UpdatedAt    time.Time `json:"updatedAt"`    // From last message timestamp
}

// =============================================================================
// SUBAGENT TYPES
// =============================================================================

// SubagentState tracks a Task agent execution within a session.
// Subagent files are stored in: {session_id}/subagents/agent-{short_id}.jsonl
type SubagentState struct {
	ID              string    `json:"id"`              // Short ID from filename (e.g., "a010d99")
	SessionID       string    `json:"sessionId"`       // Parent session
	AgentID         string    `json:"agentId"`         // Parent agent
	FilePath        string    `json:"-"`               // Internal: path to JSONL file
	TaskDescription string    `json:"taskDescription"` // Extracted from Task tool invocation
	Status          string    `json:"status"`          // running, completed, failed
	Messages        []Message `json:"-"`               // Internal: loaded messages
	FilePosition    int64     `json:"-"`               // Internal: for delta reads
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// SubagentStatus constants
const (
	SubagentStatusRunning   = "running"
	SubagentStatusCompleted = "completed"
	SubagentStatusFailed    = "failed"
)

// =============================================================================
// WATCH MODE
// =============================================================================

// WatchMode constants for agent configuration
const (
	WatchModeFile   = "file"   // Watch JSONL files via fsnotify
	WatchModeStream = "stream" // Parse CLI streaming output directly
)

// =============================================================================
// UNREAD TRACKING
// =============================================================================

// UnreadCounts holds unread message counts for sessions within an agent.
type UnreadCounts struct {
	AgentID    string         `json:"agentId"`
	AgentTotal int            `json:"agentTotal"`           // Sum of all session unreads
	Sessions   map[string]int `json:"sessions"`             // sessionID -> unread count
}
