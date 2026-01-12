// Package types provides tool result type definitions for Claude Code.
// These types represent the toolUseResult metadata attached to user events.
package types

// =============================================================================
// TOOL NAME CONSTANTS
// =============================================================================

// Tool names as they appear in tool_use blocks
const (
	ToolNameEdit           = "Edit"
	ToolNameBash           = "Bash"
	ToolNameRead           = "Read"
	ToolNameWrite          = "Write"
	ToolNameGrep           = "Grep"
	ToolNameGlob           = "Glob"
	ToolNameTask           = "Task"
	ToolNameTaskOutput     = "TaskOutput"
	ToolNameKillShell      = "KillShell"
	ToolNameAskUserQuestion = "AskUserQuestion"
	ToolNameTodoWrite      = "TodoWrite"
	ToolNameWebSearch      = "WebSearch"
	ToolNameWebFetch       = "WebFetch"
	ToolNameEnterPlanMode  = "EnterPlanMode"
	ToolNameExitPlanMode   = "ExitPlanMode"
	ToolNameNotebookEdit   = "NotebookEdit"
	ToolNameLSP            = "LSP"
	ToolNameSkill          = "Skill"
	ToolNameMCPSearch      = "MCPSearch"
)

// =============================================================================
// EDIT TOOL RESULT
// =============================================================================

// EditResult contains metadata from an Edit tool execution.
type EditResult struct {
	FilePath        string `json:"filePath"`
	OldString       string `json:"oldString"`
	NewString       string `json:"newString"`
	OriginalFile    string `json:"originalFile"`
	ReplaceAll      bool   `json:"replaceAll"`
	StructuredPatch string `json:"structuredPatch"`
	UserModified    bool   `json:"userModified,omitempty"`
}

// =============================================================================
// BASH TOOL RESULT
// =============================================================================

// BashResult contains metadata from a Bash tool execution.
type BashResult struct {
	Stdout           string `json:"stdout"`
	Stderr           string `json:"stderr"`
	Interrupted      bool   `json:"interrupted"`
	IsImage          bool   `json:"isImage"`
	BackgroundTaskID string `json:"backgroundTaskId,omitempty"`
}

// =============================================================================
// READ TOOL RESULT
// =============================================================================

// ReadResult contains metadata from a Read tool execution.
type ReadResult struct {
	File string `json:"file"`
	Type string `json:"type"` // "file" or other
}

// =============================================================================
// WRITE TOOL RESULT
// =============================================================================

// WriteResult contains metadata from a Write tool execution.
type WriteResult struct {
	FilePath        string `json:"filePath"`
	Content         string `json:"content"`
	OriginalFile    string `json:"originalFile,omitempty"`
	StructuredPatch string `json:"structuredPatch"`
	Type            string `json:"type"`
}

// =============================================================================
// GREP TOOL RESULT
// =============================================================================

// GrepResult contains metadata from a Grep tool execution.
type GrepResult struct {
	Content   string   `json:"content,omitempty"`
	Filenames []string `json:"filenames"`
	Mode      string   `json:"mode"` // files_with_matches, content, count
	NumFiles  int      `json:"numFiles"`
	NumLines  int      `json:"numLines,omitempty"`
}

// =============================================================================
// GLOB TOOL RESULT
// =============================================================================

// GlobResult contains metadata from a Glob tool execution.
type GlobResult struct {
	DurationMs int      `json:"durationMs"`
	Filenames  []string `json:"filenames"`
	NumFiles   int      `json:"numFiles"`
	Truncated  bool     `json:"truncated"`
}

// =============================================================================
// TASK (SUBAGENT) TOOL RESULT
// =============================================================================

// TaskResult contains metadata from a Task (subagent) tool execution.
type TaskResult struct {
	AgentID           string     `json:"agentId"` // Short ID (e.g., "a14bb3e") for resume
	Status            string     `json:"status"`  // completed, failed
	Prompt            string     `json:"prompt"`
	Content           []any      `json:"content"`
	TotalDurationMs   int        `json:"totalDurationMs"`
	TotalTokens       int        `json:"totalTokens"`
	TotalToolUseCount int        `json:"totalToolUseCount"`
	Usage             TokenUsage `json:"usage"`
}

// =============================================================================
// ASK USER QUESTION TOOL RESULT - CRITICAL FOR USER INTERACTION
// =============================================================================

// AskUserResult contains the questions and answers from an AskUserQuestion tool.
// This is critical for handling user interaction prompts in ClaudeFu.
type AskUserResult struct {
	Questions []AskUserQuestion `json:"questions"`
	Answers   map[string]string `json:"answers"`
}

// AskUserQuestion represents a single question presented to the user.
type AskUserQuestion struct {
	Question    string          `json:"question"`
	Header      string          `json:"header"`
	Options     []AskUserOption `json:"options"`
	MultiSelect bool            `json:"multiSelect"`
}

// AskUserOption represents a single option in a user question.
type AskUserOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

// =============================================================================
// TODO WRITE TOOL RESULT
// =============================================================================

// TodoWriteResult contains the before/after state of todo list changes.
type TodoWriteResult struct {
	NewTodos []Todo `json:"newTodos"`
	OldTodos []Todo `json:"oldTodos"`
}

// =============================================================================
// WEB SEARCH TOOL RESULT
// =============================================================================

// WebSearchResult contains metadata from a WebSearch tool execution.
type WebSearchResult struct {
	DurationSeconds float64 `json:"durationSeconds"`
	Query           string  `json:"query"`
	Results         []any   `json:"results"` // Search result objects
}

// =============================================================================
// WEB FETCH TOOL RESULT
// =============================================================================

// WebFetchResult contains metadata from a WebFetch tool execution.
type WebFetchResult struct {
	URL        string `json:"url"`
	Code       int    `json:"code"`     // HTTP status code
	CodeText   string `json:"codeText"` // Status text
	Bytes      int    `json:"bytes"`
	DurationMs int    `json:"durationMs"`
	Result     string `json:"result"` // Fetched content
}

// =============================================================================
// PLAN MODE TOOL RESULT
// =============================================================================

// PlanModeResult contains metadata from EnterPlanMode/ExitPlanMode tools.
type PlanModeResult struct {
	FilePath string `json:"filePath"`
	IsAgent  bool   `json:"isAgent"`
	Plan     string `json:"plan"`
}

// =============================================================================
// KILL SHELL TOOL RESULT
// =============================================================================

// KillShellResult contains metadata from a KillShell tool execution.
type KillShellResult struct {
	Message string `json:"message"`
	ShellID string `json:"shell_id"`
}

// =============================================================================
// LSP TOOL RESULT
// =============================================================================

// LSPResult contains metadata from an LSP tool execution.
type LSPResult struct {
	Operation string `json:"operation"`
	FilePath  string `json:"filePath"`
	Line      int    `json:"line"`
	Character int    `json:"character"`
	Result    any    `json:"result"` // Varies by operation
}

// =============================================================================
// NOTEBOOK EDIT TOOL RESULT
// =============================================================================

// NotebookEditResult contains metadata from a NotebookEdit tool execution.
type NotebookEditResult struct {
	NotebookPath string `json:"notebookPath"`
	CellID       string `json:"cellId,omitempty"`
	CellType     string `json:"cellType,omitempty"`
	EditMode     string `json:"editMode"` // replace, insert, delete
	NewSource    string `json:"newSource"`
}
