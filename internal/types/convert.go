// Package types provides conversion from classified JSONL events to displayable Messages.
// This is the single source of truth for event → Message conversion, eliminating
// duplication between watcher.go and workspace.go.
package types

import (
	"regexp"
	"strings"
)

// imageRefPattern matches duplicate image reference messages that should be filtered out.
var imageRefPattern = regexp.MustCompile(`^\s*\[Image: source: [^\]]+\]\s*$`)

// =============================================================================
// MAIN CONVERSION ENTRY POINT
// =============================================================================

// ConvertToMessage converts a classified JSONL event to a displayable Message.
// Returns nil for events that shouldn't be displayed (system, metadata, etc.)
func ConvertToMessage(classified *ClassifiedJSONLEvent) *Message {
	if classified == nil {
		return nil
	}

	switch classified.EventType {
	case JSONLEventSummary:
		return convertSummaryToMessage(classified.Summary)
	case JSONLEventUser:
		return convertUserToMessage(classified.User)
	case JSONLEventAssistant:
		return convertAssistantToMessage(classified.Assistant)
	default:
		// Skip system, file-history-snapshot, queue-operation
		return nil
	}
}

// =============================================================================
// SUMMARY EVENT CONVERSION
// =============================================================================

func convertSummaryToMessage(event *SummaryEvent) *Message {
	if event == nil || event.Summary == "" {
		return nil
	}

	return &Message{
		Type:              "summary",
		Content:           event.Summary,
		Timestamp:         "", // Summary events don't have timestamp
		UUID:              event.LeafUUID,
		IsCompaction:      true,
		CompactionPreview: "Context Compaction Summary",
	}
}

// =============================================================================
// USER EVENT CONVERSION
// =============================================================================

func convertUserToMessage(event *UserEvent) *Message {
	if event == nil {
		return nil
	}

	// Skip metadata events
	if event.IsMeta || event.IsVisibleInTranscriptOnly {
		return nil
	}

	// Extract content and content blocks from the message
	content, contentBlocks := extractUserContent(event.Message.Content)

	// Skip if only tool_result blocks (no actual user content)
	// BUT return a special carrier message so frontend can use tool results
	if !hasUserContent(content, contentBlocks) {
		// If there are tool_result blocks, return them as a carrier (not displayed as user message)
		if hasToolResultBlocks(contentBlocks) {
			return &Message{
				Type:          "tool_result_carrier",
				ContentBlocks: contentBlocks,
				Timestamp:     event.Timestamp,
				UUID:          event.UUID,
			}
		}
		return nil
	}

	// Skip duplicate image reference messages
	if shouldSkipImageRefMessage(content, contentBlocks) {
		return nil
	}

	// Skip empty messages
	if content == "" && len(contentBlocks) == 0 {
		return nil
	}

	// Detect context compaction in user messages
	isCompaction := false
	compactionPreview := ""
	if strings.HasPrefix(content, "This session is being continued") {
		isCompaction = true
		compactionPreview = "Context Compaction Summary"
	}

	return &Message{
		Type:              "user",
		Content:           content,
		ContentBlocks:     contentBlocks,
		Timestamp:         event.Timestamp,
		UUID:              event.UUID,
		IsCompaction:      isCompaction,
		CompactionPreview: compactionPreview,
	}
}

// extractUserContent extracts text content and content blocks from user message content.
// Content can be a string or []any (array of content blocks).
func extractUserContent(rawContent any) (string, []ContentBlock) {
	content := ""
	var contentBlocks []ContentBlock

	switch c := rawContent.(type) {
	case string:
		content = c
		contentBlocks = []ContentBlock{{Type: "text", Text: c}}

	case []any:
		// Note: []any and []interface{} are the same type in Go
		// JSON unmarshal may produce map[string]interface{} inside the array
		for _, block := range c {
			var blockMap map[string]any

			// Try map[string]any first (direct match)
			if bm, ok := block.(map[string]any); ok {
				blockMap = bm
			} else if bm, ok := block.(map[string]interface{}); ok {
				// Convert map[string]interface{} to map[string]any
				blockMap = make(map[string]any, len(bm))
				for k, v := range bm {
					blockMap[k] = v
				}
			}

			if blockMap != nil {
				extractedBlock := extractContentBlock(blockMap)
				if extractedBlock != nil {
					contentBlocks = append(contentBlocks, *extractedBlock)
					if extractedBlock.Type == "text" {
						content += extractedBlock.Text
					}
				}
			}
		}
	}

	return content, contentBlocks
}

// hasUserContent checks if there's actual user content (not just tool results).
func hasUserContent(content string, blocks []ContentBlock) bool {
	if content != "" {
		return true
	}
	for _, block := range blocks {
		if block.Type == "text" || block.Type == "image" {
			return true
		}
	}
	return false
}

// hasToolResultBlocks checks if there are any tool_result blocks.
func hasToolResultBlocks(blocks []ContentBlock) bool {
	for _, block := range blocks {
		if block.Type == "tool_result" {
			return true
		}
	}
	return false
}

// shouldSkipImageRefMessage checks if this is a duplicate image reference message.
func shouldSkipImageRefMessage(content string, blocks []ContentBlock) bool {
	// If there's an actual image block, don't skip
	for _, block := range blocks {
		if block.Type == "image" {
			return false
		}
	}
	// Skip if content is just an image reference pattern
	return imageRefPattern.MatchString(content)
}

// =============================================================================
// ASSISTANT EVENT CONVERSION
// =============================================================================

func convertAssistantToMessage(event *AssistantEvent) *Message {
	if event == nil {
		return nil
	}

	// Skip API error messages
	if event.IsAPIErrorMessage {
		return nil
	}

	// Extract content and content blocks
	content := ""
	var contentBlocks []ContentBlock

	for _, block := range event.Message.Content {
		contentBlocks = append(contentBlocks, block)
		if block.Type == "text" {
			content += block.Text
		}
	}

	// Skip empty messages
	if content == "" && len(contentBlocks) == 0 {
		return nil
	}

	return &Message{
		Type:          "assistant",
		Content:       content,
		ContentBlocks: contentBlocks,
		Timestamp:     event.Timestamp,
		UUID:          event.UUID,
	}
}

// =============================================================================
// CONTENT BLOCK EXTRACTION HELPERS
// =============================================================================

// extractContentBlock extracts a ContentBlock from a raw map.
func extractContentBlock(blockMap map[string]any) *ContentBlock {
	blockType, _ := blockMap["type"].(string)

	switch blockType {
	case "text":
		text, _ := blockMap["text"].(string)
		return &ContentBlock{Type: "text", Text: text}

	case "tool_use":
		return &ContentBlock{
			Type:  "tool_use",
			ID:    getString(blockMap, "id"),
			Name:  getString(blockMap, "name"),
			Input: blockMap["input"],
		}

	case "tool_result":
		resultContent := extractToolResultContent(blockMap["content"])
		isError, _ := blockMap["is_error"].(bool)
		return &ContentBlock{
			Type:      "tool_result",
			ToolUseID: getString(blockMap, "tool_use_id"),
			Content:   resultContent,
			IsError:   isError,
		}

	case "image":
		source := extractImageSource(blockMap["source"])
		if source == nil {
			return nil
		}
		return &ContentBlock{Type: "image", Source: source}

	case "thinking":
		thinking, _ := blockMap["thinking"].(string)
		signature, _ := blockMap["signature"].(string)
		return &ContentBlock{
			Type:      "thinking",
			Thinking:  thinking,
			Signature: signature,
		}
	}

	return nil
}


// extractToolResultContent extracts the content from a tool result.
// Content can be a string or an array of content blocks.
func extractToolResultContent(rawContent any) string {
	switch c := rawContent.(type) {
	case string:
		return c
	case []any:
		var result string
		for _, item := range c {
			if itemMap, ok := item.(map[string]any); ok {
				if itemMap["type"] == "text" {
					if text, ok := itemMap["text"].(string); ok {
						result += text
					}
				}
			}
		}
		return result
	}
	return ""
}

// extractImageSource extracts an ImageSource from a raw source map.
func extractImageSource(rawSource any) *ImageSource {
	source, ok := rawSource.(map[string]any)
	if !ok {
		return nil
	}

	sourceType, _ := source["type"].(string)

	switch sourceType {
	case "base64":
		mediaType, _ := source["media_type"].(string)
		data, _ := source["data"].(string)
		if mediaType != "" && data != "" {
			return &ImageSource{Type: "base64", MediaType: mediaType, Data: data}
		}
	case "file":
		filePath, _ := source["file_path"].(string)
		if filePath != "" {
			return &ImageSource{Type: "file", Data: filePath}
		}
	case "url":
		url, _ := source["url"].(string)
		if url != "" {
			return &ImageSource{Type: "url", Data: url}
		}
	}

	return nil
}

// getString safely extracts a string from a map.
func getString(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}
