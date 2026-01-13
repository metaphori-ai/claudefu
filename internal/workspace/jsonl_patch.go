package workspace

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// PatchQuestionAnswer patches a failed AskUserQuestion tool_result with a successful answer.
// This enables ClaudeFu to handle interactive questions even when Claude Code runs in --print mode.
//
// The function:
// 1. Finds the JSONL line with the failed tool_result matching toolUseID
// 2. Rewrites it with the success format (no is_error, formatted content, object toolUseResult)
// 3. Writes the modified file back
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
			// 1. Remove is_error field
			delete(blockMap, "is_error")

			// 2. Set content to formatted answer string
			blockMap["content"] = formatAnswerContent(questions, answers)

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
		found = true
		break
	}

	if !found {
		return fmt.Errorf("tool_use_id not found in session: %s", toolUseID)
	}

	// Write the modified file back
	output := strings.Join(lines, "\n")
	if err := os.WriteFile(sessionPath, []byte(output), 0644); err != nil {
		return fmt.Errorf("failed to write patched session file: %w", err)
	}

	return nil
}

// formatAnswerContent creates the formatted answer string for the tool_result content.
// Format: "User has answered your questions: \"<question>\"=\"<answer>\". You can now continue with the user's answers in mind."
func formatAnswerContent(questions []map[string]any, answers map[string]string) string {
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

	if len(parts) == 0 {
		return "User has answered your questions. You can now continue."
	}

	return fmt.Sprintf("User has answered your questions: %s. You can now continue with the user's answers in mind.", strings.Join(parts, ", "))
}
