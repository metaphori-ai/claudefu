package workspace

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// PatchQuestionAnswer patches a failed AskUserQuestion tool_result with a successful answer.
// This enables ClaudeFu to handle interactive questions even when Claude Code runs in --print mode.
//
// The function:
// 1. Finds the JSONL line with the failed tool_result matching toolUseID
// 2. Rewrites it with the success format (no is_error, formatted content, object toolUseResult)
// 3. Deletes stale assistant messages that followed the failed tool_result
// 4. Writes the modified file back
func PatchQuestionAnswer(folder, sessionID, toolUseID string, questions []map[string]any, answers map[string]string) error {
	// Build JSONL path
	encodedName := encodeProjectPath(folder)
	sessionPath := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")

	// Read all lines
	data, err := os.ReadFile(sessionPath)
	if err != nil {
		return fmt.Errorf("failed to read session file: %w", err)
	}

	lines := strings.Split(string(data), "\n")
	found := false
	patchedLineIdx := -1

	// Find and patch the line with matching tool_use_id
	for i, line := range lines {
		if line == "" {
			continue
		}

		// Quick check for tool_use_id match
		if !strings.Contains(line, toolUseID) {
			continue
		}

		// Parse the line to verify and modify
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		// Only process user events
		if event["type"] != "user" {
			continue
		}

		// Get the message.content to find the tool_result
		message, ok := event["message"].(map[string]any)
		if !ok {
			continue
		}

		content, ok := message["content"].([]any)
		if !ok {
			continue
		}

		// Find and patch the tool_result block
		patched := false
		for j, block := range content {
			blockMap, ok := block.(map[string]any)
			if !ok {
				continue
			}

			if blockMap["type"] != "tool_result" {
				continue
			}

			if blockMap["tool_use_id"] != toolUseID {
				continue
			}

			// Found the matching tool_result - patch it
			// 1. Set is_error to false (explicitly, not delete - more reliable)
			blockMap["is_error"] = false

			// 2. Set content to formatted answer string
			blockMap["content"] = formatAnswerContent(questions, answers)

			fmt.Printf("[PATCH] Patched tool_result %s: is_error=false, content set\n", toolUseID)

			// Update the block in the content array
			content[j] = blockMap
			patched = true
			break
		}

		if !patched {
			continue
		}

		// Update message.content
		message["content"] = content
		event["message"] = message

		// 3. Set toolUseResult to success format (object with questions and answers)
		event["toolUseResult"] = map[string]any{
			"questions": questions,
			"answers":   answers,
		}

		// Marshal back to JSON
		patchedLine, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("failed to marshal patched event: %w", err)
		}

		lines[i] = string(patchedLine)
		patchedLineIdx = i
		found = true
		break
	}

	if !found {
		return fmt.Errorf("tool_use_id not found in session: %s", toolUseID)
	}

	// 4. Delete stale assistant messages after the patched line
	// These are Claude's responses to what it thought was a failed tool call
	lines = deleteStaleAssistantMessages(lines, patchedLineIdx)

	// Write the modified file back
	output := strings.Join(lines, "\n")
	if err := os.WriteFile(sessionPath, []byte(output), 0644); err != nil {
		return fmt.Errorf("failed to write patched session file: %w", err)
	}

	fmt.Printf("[PATCH] Successfully wrote patched JSONL to %s\n", sessionPath)
	return nil
}

// deleteStaleAssistantMessages removes assistant messages that come after the patched
// tool_result line. These are Claude's responses to the original failed AskUserQuestion,
// which are now invalid since we patched it to be successful.
// Stops when it hits a real user message (not just a tool_result carrier).
func deleteStaleAssistantMessages(lines []string, patchedIdx int) []string {
	if patchedIdx < 0 || patchedIdx >= len(lines)-1 {
		return lines
	}

	// Find lines to delete (assistant messages until we hit a real user message)
	deleteStart := -1
	deleteEnd := -1

	for i := patchedIdx + 1; i < len(lines); i++ {
		line := lines[i]
		if line == "" {
			continue
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		eventType, _ := event["type"].(string)

		switch eventType {
		case "assistant":
			// Mark assistant messages for deletion
			if deleteStart == -1 {
				deleteStart = i
			}
			deleteEnd = i
			fmt.Printf("[PATCH] Marking stale assistant message at line %d for deletion\n", i)

		case "user":
			// Check if this is a real user message or just a tool_result carrier
			if isRealUserMessage(event) {
				// Stop - this is the user's actual message after answering
				goto done
			}
			// Tool result carrier - continue looking

		case "queue-operation":
			// These can be deleted along with assistant messages
			if deleteStart != -1 {
				deleteEnd = i
			}

		default:
			// Unknown type - stop to be safe
			goto done
		}
	}

done:
	// Remove the marked lines
	if deleteStart != -1 && deleteEnd >= deleteStart {
		fmt.Printf("[PATCH] Deleting lines %d-%d (stale responses)\n", deleteStart, deleteEnd)
		lines = append(lines[:deleteStart], lines[deleteEnd+1:]...)
	}

	return lines
}

// isRealUserMessage checks if a user event contains actual user content
// (not just tool_result blocks which are auto-generated)
func isRealUserMessage(event map[string]any) bool {
	message, ok := event["message"].(map[string]any)
	if !ok {
		return false
	}

	content := message["content"]

	// String content = real user message
	if _, ok := content.(string); ok {
		return true
	}

	// Array content - check if it has text blocks (real user content)
	contentArr, ok := content.([]any)
	if !ok {
		return false
	}

	for _, block := range contentArr {
		blockMap, ok := block.(map[string]any)
		if !ok {
			continue
		}
		if blockMap["type"] == "text" {
			return true
		}
	}

	return false
}

// formatAnswerContent creates the formatted answer content for the tool_result.
// Returns a JSON string with both a human-readable message and structured answers
// that the frontend can parse to highlight selected options.
func formatAnswerContent(questions []map[string]any, answers map[string]string) string {
	// Build human-readable parts for Claude
	var parts []string
	for _, q := range questions {
		questionText, ok := q["question"].(string)
		if !ok {
			continue
		}
		answer, exists := answers[questionText]
		if !exists {
			continue
		}
		parts = append(parts, fmt.Sprintf("\"%s\"=\"%s\"", questionText, answer))
	}

	message := "User has answered your questions. You can now continue."
	if len(parts) > 0 {
		message = fmt.Sprintf("User has answered your questions: %s. You can now continue with the user's answers in mind.", strings.Join(parts, ", "))
	}

	// Return JSON with both message and structured answers for frontend parsing
	result := map[string]any{
		"message": message,
		"answers": answers,
	}

	jsonBytes, err := json.Marshal(result)
	if err != nil {
		// Fallback to plain string if JSON fails
		return message
	}

	return string(jsonBytes)
}

// AppendCancellationMarker appends a user message to the JSONL file indicating
// the response was cancelled. This provides context for both the user and Claude.
// The message uses a special prefix that the frontend can detect for styling.
func AppendCancellationMarker(folder, sessionID string) error {
	// Build JSONL path
	encodedName := encodeProjectPath(folder)
	sessionPath := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")

	// Create the cancellation marker message
	// Use a prefix that frontend can detect: [CANCELLED]
	event := map[string]any{
		"type":      "user",
		"uuid":      uuid.New().String(),
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"message": map[string]any{
			"role":    "user",
			"content": "[CANCELLED] Response interrupted by user.",
		},
	}

	// Marshal to JSON
	jsonBytes, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal cancellation marker: %w", err)
	}

	// Append to file (with newline)
	f, err := os.OpenFile(sessionPath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open session file: %w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(string(jsonBytes) + "\n"); err != nil {
		return fmt.Errorf("failed to append cancellation marker: %w", err)
	}

	fmt.Printf("[DEBUG] AppendCancellationMarker: wrote marker to %s\n", sessionPath)
	return nil
}
