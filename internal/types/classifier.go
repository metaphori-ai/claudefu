// Package types provides event classification using the Discriminated Union pattern.
// The `type` field in each JSON event acts as the discriminator (tag) that determines
// which concrete Go type should be used for full parsing.
package types

import (
	"encoding/json"
	"fmt"
)

// =============================================================================
// JSONL EVENT CLASSIFIER
// =============================================================================

// JSONLEventType represents the classified type of a JSONL event.
type JSONLEventType int

const (
	JSONLEventUnknown JSONLEventType = iota
	JSONLEventUser
	JSONLEventAssistant
	JSONLEventSystem
	JSONLEventSummary
	JSONLEventFileHistorySnapshot
	JSONLEventQueueOperation
)

// String returns a human-readable name for the event type.
func (t JSONLEventType) String() string {
	switch t {
	case JSONLEventUser:
		return "user"
	case JSONLEventAssistant:
		return "assistant"
	case JSONLEventSystem:
		return "system"
	case JSONLEventSummary:
		return "summary"
	case JSONLEventFileHistorySnapshot:
		return "file-history-snapshot"
	case JSONLEventQueueOperation:
		return "queue-operation"
	default:
		return "unknown"
	}
}

// ClassifiedJSONLEvent holds the parsed JSONL event with its classified type.
// Only ONE of the event pointers will be non-nil based on EventType.
type ClassifiedJSONLEvent struct {
	EventType JSONLEventType
	Raw       json.RawMessage // Preserved for re-parsing if needed

	// Only ONE of these will be non-nil based on EventType
	User                *UserEvent
	Assistant           *AssistantEvent
	System              *SystemEvent
	Summary             *SummaryEvent
	FileHistorySnapshot *FileHistorySnapshotEvent
	QueueOperation      *QueueOperationEvent
}

// ClassifyJSONLEvent parses a JSONL line and returns a classified event.
// It uses two-pass parsing: first extracting the discriminator, then parsing
// into the correct concrete type.
func ClassifyJSONLEvent(line string) (*ClassifiedJSONLEvent, error) {
	if line == "" {
		return nil, fmt.Errorf("empty line")
	}

	// First pass: extract discriminator
	var discriminator struct {
		Type    string `json:"type"`
		Subtype string `json:"subtype,omitempty"`
	}
	if err := json.Unmarshal([]byte(line), &discriminator); err != nil {
		return nil, fmt.Errorf("failed to parse discriminator: %w", err)
	}

	result := &ClassifiedJSONLEvent{
		Raw: json.RawMessage(line),
	}

	// Second pass: parse into correct type based on discriminator
	switch discriminator.Type {
	case EventTypeUser:
		result.EventType = JSONLEventUser
		var event UserEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse user event: %w", err)
		}
		result.User = &event

	case EventTypeAssistant:
		result.EventType = JSONLEventAssistant
		var event AssistantEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse assistant event: %w", err)
		}
		result.Assistant = &event

	case EventTypeSystem:
		result.EventType = JSONLEventSystem
		var event SystemEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse system event: %w", err)
		}
		result.System = &event

	case EventTypeSummary:
		result.EventType = JSONLEventSummary
		var event SummaryEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse summary event: %w", err)
		}
		result.Summary = &event

	case EventTypeFileHistorySnapshot:
		result.EventType = JSONLEventFileHistorySnapshot
		var event FileHistorySnapshotEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse file-history-snapshot event: %w", err)
		}
		result.FileHistorySnapshot = &event

	case EventTypeQueueOperation:
		result.EventType = JSONLEventQueueOperation
		var event QueueOperationEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse queue-operation event: %w", err)
		}
		result.QueueOperation = &event

	default:
		result.EventType = JSONLEventUnknown
	}

	return result, nil
}

// =============================================================================
// STREAMING EVENT CLASSIFIER
// =============================================================================

// StreamingEventType represents the classified type of a streaming event.
type StreamingEventType int

const (
	StreamingEventUnknown StreamingEventType = iota
	StreamingEventSystemInit
	StreamingEventAssistant
	StreamingEventUser
	StreamingEventResultSuccess
	StreamingEventResultError
)

// String returns a human-readable name for the streaming event type.
func (t StreamingEventType) String() string {
	switch t {
	case StreamingEventSystemInit:
		return "system:init"
	case StreamingEventAssistant:
		return "assistant"
	case StreamingEventUser:
		return "user"
	case StreamingEventResultSuccess:
		return "result:success"
	case StreamingEventResultError:
		return "result:error"
	default:
		return "unknown"
	}
}

// ClassifiedStreamingEvent holds the parsed streaming event with its classified type.
// Only ONE of the event pointers will be non-nil based on EventType.
type ClassifiedStreamingEvent struct {
	EventType StreamingEventType
	Raw       json.RawMessage // Preserved for re-parsing if needed

	// Only ONE of these will be non-nil based on EventType
	SystemInit *SystemInitEvent
	Assistant  *StreamingAssistantEvent
	User       *StreamingUserEvent
	Result     *ResultEvent
}

// ClassifyStreamingEvent parses a streaming JSON line and returns a classified event.
// It uses two-pass parsing: first extracting the discriminator, then parsing
// into the correct concrete type.
func ClassifyStreamingEvent(line string) (*ClassifiedStreamingEvent, error) {
	if line == "" {
		return nil, fmt.Errorf("empty line")
	}

	// First pass: extract discriminator
	var discriminator struct {
		Type    string `json:"type"`
		Subtype string `json:"subtype,omitempty"`
	}
	if err := json.Unmarshal([]byte(line), &discriminator); err != nil {
		return nil, fmt.Errorf("failed to parse discriminator: %w", err)
	}

	result := &ClassifiedStreamingEvent{
		Raw: json.RawMessage(line),
	}

	// Second pass: parse into correct type based on discriminator
	switch discriminator.Type {
	case "system":
		if discriminator.Subtype == SystemSubtypeInit {
			result.EventType = StreamingEventSystemInit
			var event SystemInitEvent
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				return nil, fmt.Errorf("failed to parse system:init event: %w", err)
			}
			result.SystemInit = &event
		}

	case "assistant":
		result.EventType = StreamingEventAssistant
		var event StreamingAssistantEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse assistant event: %w", err)
		}
		result.Assistant = &event

	case "user":
		result.EventType = StreamingEventUser
		var event StreamingUserEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse user event: %w", err)
		}
		result.User = &event

	case "result":
		if discriminator.Subtype == ResultSubtypeSuccess {
			result.EventType = StreamingEventResultSuccess
		} else if discriminator.Subtype == ResultSubtypeError {
			result.EventType = StreamingEventResultError
		}
		var event ResultEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			return nil, fmt.Errorf("failed to parse result event: %w", err)
		}
		result.Result = &event

	default:
		result.EventType = StreamingEventUnknown
	}

	return result, nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// IsUserMessage returns true if this is a displayable user message.
// Filters out tool_result-only events and metadata events.
func (c *ClassifiedJSONLEvent) IsUserMessage() bool {
	if c.EventType != JSONLEventUser || c.User == nil {
		return false
	}

	// Check if it's a metadata event
	if c.User.IsMeta || c.User.IsVisibleInTranscriptOnly {
		return false
	}

	return true
}

// IsAssistantMessage returns true if this is a displayable assistant message.
func (c *ClassifiedJSONLEvent) IsAssistantMessage() bool {
	if c.EventType != JSONLEventAssistant || c.Assistant == nil {
		return false
	}

	// Skip API error messages
	if c.Assistant.IsAPIErrorMessage {
		return false
	}

	return true
}

// GetSessionID extracts the session ID from any classified event.
func (c *ClassifiedJSONLEvent) GetSessionID() string {
	switch c.EventType {
	case JSONLEventUser:
		if c.User != nil {
			return c.User.SessionID
		}
	case JSONLEventAssistant:
		if c.Assistant != nil {
			return c.Assistant.SessionID
		}
	case JSONLEventSystem:
		if c.System != nil {
			return c.System.SessionID
		}
	}
	return ""
}

// GetSessionID extracts the session ID from a streaming event.
func (c *ClassifiedStreamingEvent) GetSessionID() string {
	switch c.EventType {
	case StreamingEventSystemInit:
		if c.SystemInit != nil {
			return c.SystemInit.SessionID
		}
	case StreamingEventAssistant:
		if c.Assistant != nil {
			return c.Assistant.SessionID
		}
	case StreamingEventUser:
		if c.User != nil {
			return c.User.SessionID
		}
	case StreamingEventResultSuccess, StreamingEventResultError:
		if c.Result != nil {
			return c.Result.SessionID
		}
	}
	return ""
}
