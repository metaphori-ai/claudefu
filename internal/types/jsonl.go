// Package types provides JSONL event type definitions for Claude Code session files.
// These types correspond to the schema documented in claude-code-jsonl-schema.tda.svml
package types

// =============================================================================
// EVENT TYPE CONSTANTS
// =============================================================================

// JSONL event type discriminators
const (
	EventTypeUser                = "user"
	EventTypeAssistant           = "assistant"
	EventTypeSystem              = "system"
	EventTypeSummary             = "summary"
	EventTypeFileHistorySnapshot = "file-history-snapshot"
	EventTypeQueueOperation      = "queue-operation"
)

// System event subtypes
const (
	SystemSubtypeInit           = "init"
	SystemSubtypeTurnDuration   = "turn_duration"
	SystemSubtypeCompactBoundary = "compact_boundary"
)

// =============================================================================
// BASE EVENT TYPE
// =============================================================================

// JSONLEvent contains common fields present across most JSONL events.
type JSONLEvent struct {
	Type        string `json:"type"`
	UUID        string `json:"uuid,omitempty"`
	Timestamp   string `json:"timestamp"`
	SessionID   string `json:"sessionId,omitempty"`
	ParentUUID  string `json:"parentUuid,omitempty"`
	Version     string `json:"version,omitempty"`
	Cwd         string `json:"cwd,omitempty"`
	GitBranch   string `json:"gitBranch,omitempty"`
	IsSidechain bool   `json:"isSidechain,omitempty"`
	UserType    string `json:"userType,omitempty"`
}

// =============================================================================
// USER EVENT
// =============================================================================

// UserEvent represents a user input message in the JSONL session file.
type UserEvent struct {
	JSONLEvent
	Slug                       string         `json:"slug,omitempty"`
	Message                    UserMessage    `json:"message"`
	Todos                      []Todo         `json:"todos,omitempty"`
	ThinkingMetadata           *ThinkingMeta  `json:"thinkingMetadata,omitempty"`
	ImagePasteIDs              []string       `json:"imagePasteIds,omitempty"`
	IsCompactSummary           bool           `json:"isCompactSummary,omitempty"`
	IsVisibleInTranscriptOnly  bool           `json:"isVisibleInTranscriptOnly,omitempty"`
	IsMeta                     bool           `json:"isMeta,omitempty"`
	SourceToolAssistantUUID    string         `json:"sourceToolAssistantUUID,omitempty"`
	ToolUseResult              map[string]any `json:"toolUseResult,omitempty"` // Parsed separately based on tool
}

// UserMessage represents the message content in a user event.
type UserMessage struct {
	Role    string `json:"role"` // "user"
	Content any    `json:"content"` // string or []ContentBlock (for tool_result)
}

// Todo represents a task item in the todo list.
type Todo struct {
	Content    string `json:"content"`
	Status     string `json:"status"`     // pending, in_progress, completed
	ActiveForm string `json:"activeForm"`
}

// ThinkingMeta contains metadata about extended thinking mode.
type ThinkingMeta struct {
	Level    string   `json:"level"` // high, medium, low
	Disabled bool     `json:"disabled"`
	Triggers []string `json:"triggers"`
}

// =============================================================================
// ASSISTANT EVENT
// =============================================================================

// AssistantEvent represents Claude's response in the JSONL session file.
type AssistantEvent struct {
	JSONLEvent
	Slug              string           `json:"slug,omitempty"`
	RequestID         string           `json:"requestId,omitempty"`
	Message           AssistantMessage `json:"message"`
	IsCompactSummary  bool             `json:"isCompactSummary,omitempty"`
	IsAPIErrorMessage bool             `json:"isApiErrorMessage,omitempty"`
}

// AssistantMessage represents the message content in an assistant event.
type AssistantMessage struct {
	Model        string         `json:"model"`
	ID           string         `json:"id"`
	Type         string         `json:"type"` // "message"
	Role         string         `json:"role"` // "assistant"
	Content      []ContentBlock `json:"content"`
	StopReason   string         `json:"stop_reason,omitempty"`
	StopSequence string         `json:"stop_sequence,omitempty"`
	Usage        TokenUsage     `json:"usage"`
}

// TokenUsage contains token consumption statistics.
type TokenUsage struct {
	InputTokens              int            `json:"input_tokens"`
	OutputTokens             int            `json:"output_tokens"`
	CacheCreationInputTokens int            `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int            `json:"cache_read_input_tokens"`
	ServiceTier              string         `json:"service_tier,omitempty"`
	CacheCreation            *CacheCreation `json:"cache_creation,omitempty"`
}

// CacheCreation contains ephemeral cache token counts.
type CacheCreation struct {
	Ephemeral5mInputTokens int `json:"ephemeral_5m_input_tokens"`
	Ephemeral1hInputTokens int `json:"ephemeral_1h_input_tokens"`
}

// =============================================================================
// SYSTEM EVENT
// =============================================================================

// SystemEvent represents system metadata events in the JSONL session file.
type SystemEvent struct {
	JSONLEvent
	Subtype    string `json:"subtype"` // turn_duration, compact_boundary
	DurationMs int    `json:"durationMs,omitempty"`
	IsMeta     bool   `json:"isMeta,omitempty"`
}

// =============================================================================
// SUMMARY EVENT
// =============================================================================

// SummaryEvent represents a context compaction summary in the JSONL session file.
type SummaryEvent struct {
	Type     string `json:"type"` // "summary"
	Summary  string `json:"summary"`
	LeafUUID string `json:"leafUuid"`
}

// =============================================================================
// FILE HISTORY SNAPSHOT EVENT
// =============================================================================

// FileHistorySnapshotEvent captures file state at compaction points.
type FileHistorySnapshotEvent struct {
	Type             string   `json:"type"` // "file-history-snapshot"
	MessageID        string   `json:"messageId"`
	IsSnapshotUpdate bool     `json:"isSnapshotUpdate"`
	Snapshot         Snapshot `json:"snapshot"`
}

// Snapshot contains tracked file backup information.
type Snapshot struct {
	MessageID          string                `json:"messageId"`
	Timestamp          string                `json:"timestamp"`
	TrackedFileBackups map[string]FileBackup `json:"trackedFileBackups"`
}

// FileBackup contains backup metadata for a single file.
type FileBackup struct {
	BackupFileName string `json:"backupFileName,omitempty"`
	Version        int    `json:"version"`
	BackupTime     string `json:"backupTime"`
}

// =============================================================================
// QUEUE OPERATION EVENT
// =============================================================================

// QueueOperationEvent tracks message queue operations.
type QueueOperationEvent struct {
	Type      string `json:"type"` // "queue-operation"
	Operation string `json:"operation"`
	Timestamp string `json:"timestamp"`
	SessionID string `json:"sessionId"`
	Content   string `json:"content"`
}
