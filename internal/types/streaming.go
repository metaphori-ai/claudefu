// Package types provides streaming event type definitions for Claude Code CLI.
// These types correspond to the schema documented in claude-code-streaming-events.tda.svml
// Command: claude --print --output-format stream-json --verbose -p "prompt"
package types

// =============================================================================
// STREAMING EVENT CONSTANTS
// =============================================================================

// Streaming result subtypes
const (
	ResultSubtypeSuccess = "success"
	ResultSubtypeError   = "error"
)

// =============================================================================
// SYSTEM INIT EVENT (First event - contains session_id)
// =============================================================================

// SystemInitEvent is the first streaming event, containing session initialization data.
// This is where we get the session_id for resuming sessions.
type SystemInitEvent struct {
	Type              string   `json:"type"`    // "system"
	Subtype           string   `json:"subtype"` // "init"
	SessionID         string   `json:"session_id"`
	UUID              string   `json:"uuid"`
	Cwd               string   `json:"cwd"`
	Model             string   `json:"model"`
	ClaudeCodeVersion string   `json:"claude_code_version"`
	PermissionMode    string   `json:"permissionMode"`
	OutputStyle       string   `json:"output_style"`
	APIKeySource      string   `json:"apiKeySource"`
	Tools             []string `json:"tools"`
	Agents            []string `json:"agents"`
	Skills            []string `json:"skills"`
	SlashCommands     []string `json:"slash_commands"`
	MCPServers        []string `json:"mcp_servers"`
	Plugins           []Plugin `json:"plugins"`
}

// Plugin represents a loaded plugin in the streaming init event.
type Plugin struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// =============================================================================
// STREAMING ASSISTANT EVENT
// =============================================================================

// StreamingAssistantEvent represents Claude's response in streaming output.
type StreamingAssistantEvent struct {
	Type              string                    `json:"type"` // "assistant"
	SessionID         string                    `json:"session_id"`
	UUID              string                    `json:"uuid"`
	ParentToolUseID   string                    `json:"parent_tool_use_id,omitempty"` // Set for subagent
	Message           StreamingAssistantMessage `json:"message"`
}

// StreamingAssistantMessage is the message content in a streaming assistant event.
type StreamingAssistantMessage struct {
	Model             string               `json:"model"`
	ID                string               `json:"id"`
	Type              string               `json:"type"` // "message"
	Role              string               `json:"role"` // "assistant"
	Content           []ContentBlock       `json:"content"`
	StopReason        string               `json:"stop_reason,omitempty"`
	StopSequence      string               `json:"stop_sequence,omitempty"`
	Usage             TokenUsage           `json:"usage"`
	ContextManagement *ContextManagement   `json:"context_management,omitempty"`
}

// ContextManagement contains context window management info.
type ContextManagement struct {
	// Fields vary - keeping as flexible type
	Data map[string]any `json:"-"`
}

// =============================================================================
// STREAMING USER EVENT (Tool results and subagent prompts)
// =============================================================================

// StreamingUserEvent represents user content in streaming output.
// This is typically tool results being returned to Claude.
type StreamingUserEvent struct {
	Type            string               `json:"type"` // "user"
	SessionID       string               `json:"session_id"`
	UUID            string               `json:"uuid"`
	ParentToolUseID string               `json:"parent_tool_use_id,omitempty"`
	Message         StreamingUserMessage `json:"message"`
	ToolUseResult   map[string]any       `json:"tool_use_result,omitempty"`
}

// StreamingUserMessage is the message content in a streaming user event.
type StreamingUserMessage struct {
	Role    string `json:"role"` // "user"
	Content any    `json:"content"` // string or []ContentBlock
}

// =============================================================================
// RESULT EVENT (Final event with costs and summary)
// =============================================================================

// ResultEvent is the final streaming event with completion info and costs.
type ResultEvent struct {
	Type              string                `json:"type"`    // "result"
	Subtype           string                `json:"subtype"` // "success" or "error"
	SessionID         string                `json:"session_id"`
	UUID              string                `json:"uuid"`
	IsError           bool                  `json:"is_error"`
	Result            string                `json:"result"`
	DurationMs        int                   `json:"duration_ms"`
	DurationAPIMs     int                   `json:"duration_api_ms"`
	NumTurns          int                   `json:"num_turns"`
	TotalCostUSD      float64               `json:"total_cost_usd"`
	Usage             AggregateUsage        `json:"usage"`
	ModelUsage        map[string]ModelUsage `json:"modelUsage"`
	PermissionDenials []string              `json:"permission_denials"`
}

// AggregateUsage contains aggregate token usage across all turns.
type AggregateUsage struct {
	InputTokens              int           `json:"input_tokens"`
	OutputTokens             int           `json:"output_tokens"`
	CacheCreationInputTokens int           `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int           `json:"cache_read_input_tokens"`
	ServiceTier              string        `json:"service_tier"`
	CacheCreation            *CacheCreation `json:"cache_creation,omitempty"`
	ServerToolUse            ServerToolUse `json:"server_tool_use"`
}

// ServerToolUse tracks server-side tool usage (web search, web fetch).
type ServerToolUse struct {
	WebSearchRequests int `json:"web_search_requests"`
	WebFetchRequests  int `json:"web_fetch_requests"`
}

// ModelUsage contains per-model token usage and cost.
type ModelUsage struct {
	InputTokens              int     `json:"inputTokens"`
	OutputTokens             int     `json:"outputTokens"`
	CacheReadInputTokens     int     `json:"cacheReadInputTokens"`
	CacheCreationInputTokens int     `json:"cacheCreationInputTokens"`
	WebSearchRequests        int     `json:"webSearchRequests"`
	CostUSD                  float64 `json:"costUSD"`
	ContextWindow            int     `json:"contextWindow"`
	MaxOutputTokens          int     `json:"maxOutputTokens"`
}
