package workspace

import (
	"bufio"
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

// WritePlanReviewResult appends a synthetic JSONL entry that matches Claude Code's
// built-in ExitPlanMode toolUseResult format. This tricks the plan mode tracker
// into recognizing the state transition (accept/reject).
//
// For ACCEPT: writes toolUseResult: {plan, isAgent, filePath}
// For REJECT: writes toolUseResult: "Error: ..." (string, not object)
func WritePlanReviewResult(folder, sessionID, toolUseID, assistantUUID, slug string, accepted bool, plan, planFilePath, feedback string) error {
	encodedName := encodeProjectPath(folder)
	sessionPath := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")

	// Common metadata fields matching Claude Code's native format.
	// Missing parentUuid/isSidechain/sessionId causes Claude Code to reject
	// the conversation chain and reset context.
	commonFields := map[string]any{
		"type":                    "user",
		"uuid":                    uuid.New().String(),
		"timestamp":               time.Now().UTC().Format(time.RFC3339Nano),
		"parentUuid":              assistantUUID,
		"isSidechain":             false,
		"sessionId":               sessionID,
		"sourceToolAssistantUUID": assistantUUID,
		"userType":                "external",
		"cwd":                     folder,
	}
	if slug != "" {
		commonFields["slug"] = slug
	}

	var event map[string]any

	if accepted {
		// Build content string matching built-in ExitPlanMode accept format
		content := "User has approved your plan. You can now start coding. Start with updating your todo list if applicable\n\nYour plan has been saved to: " + planFilePath + "\nYou can refer back to it if needed during implementation."

		// Add alignment feedback if provided
		if feedback != "" {
			content += "\n\nADDITIONAL ALIGNMENT FEEDBACK: " + feedback
		}

		content += "\n\n## Approved Plan:\n" + plan

		event = commonFields
		event["message"] = map[string]any{
			"role": "user",
			"content": []any{
				map[string]any{
					"type":        "tool_result",
					"content":     content,
					"tool_use_id": toolUseID,
				},
			},
		}
		event["toolUseResult"] = map[string]any{
			"plan":     plan,
			"isAgent":  false,
			"filePath": planFilePath,
		}
	} else {
		// Reject format
		rejectContent := "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:"
		if feedback != "" {
			rejectContent += "\nUSER REJECTION FEEDBACK: " + feedback
		} else {
			rejectContent += "\nUser rejected the plan without specific feedback."
		}

		rejectToolResult := "Error: " + rejectContent

		event = commonFields
		event["message"] = map[string]any{
			"role": "user",
			"content": []any{
				map[string]any{
					"type":        "tool_result",
					"content":     rejectContent,
					"is_error":    true,
					"tool_use_id": toolUseID,
				},
			},
		}
		event["toolUseResult"] = rejectToolResult
	}

	jsonBytes, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal plan review result: %w", err)
	}

	f, err := os.OpenFile(sessionPath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open session file for plan review result: %w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(string(jsonBytes) + "\n"); err != nil {
		return fmt.Errorf("failed to append plan review result: %w", err)
	}

	action := "ACCEPTED"
	if !accepted {
		action = "REJECTED"
	}
	fmt.Printf("[PATCH] WritePlanReviewResult: %s plan, wrote synthetic entry to %s\n", action, sessionPath)
	return nil
}

// FindLatestToolUseID scans a session JSONL backwards to find the most recent
// tool_use block with the given tool name, returning its id and the assistant message UUID.
// The assistant UUID is needed as the parentUuid for synthetic JSONL entries.
// This is needed because the MCP CallToolRequest doesn't expose the tool_use_id
// that Claude assigned when calling our MCP tool.
func FindLatestToolUseID(folder, sessionID, toolName string) (toolID string, assistantUUID string, err error) {
	encodedName := encodeProjectPath(folder)
	sessionPath := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")

	f, err := os.Open(sessionPath)
	if err != nil {
		return "", "", fmt.Errorf("failed to open session file: %w", err)
	}
	defer f.Close()

	// Read all lines (we need to scan backwards)
	var lines []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024) // 10MB max line
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		return "", "", fmt.Errorf("failed to read session file: %w", err)
	}

	// Scan backwards for the latest assistant message with tool_use matching toolName
	for i := len(lines) - 1; i >= 0; i-- {
		line := lines[i]
		if line == "" {
			continue
		}

		// Quick check - must contain the tool name
		if !strings.Contains(line, toolName) {
			continue
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		if event["type"] != "assistant" {
			continue
		}

		// Extract the assistant message UUID (becomes parentUuid for our synthetic entry)
		msgUUID, _ := event["uuid"].(string)

		message, ok := event["message"].(map[string]any)
		if !ok {
			continue
		}

		content, ok := message["content"].([]any)
		if !ok {
			continue
		}

		// Look for tool_use block with matching name
		for _, block := range content {
			blockMap, ok := block.(map[string]any)
			if !ok {
				continue
			}
			if blockMap["type"] != "tool_use" {
				continue
			}
			if blockMap["name"] != toolName {
				continue
			}
			tid, ok := blockMap["id"].(string)
			if !ok {
				continue
			}
			fmt.Printf("[PATCH] FindLatestToolUseID: found %s → %s (assistant uuid=%s)\n", toolName, tid, msgUUID)
			return tid, msgUUID, nil
		}
	}

	return "", "", fmt.Errorf("no tool_use block found for %s in session %s", toolName, sessionID)
}

// FindToolUseInSubagents scans the subagents folder for the most recently modified JSONL
// that contains a tool_use block matching toolName. Returns the tool_use_id, assistant UUID,
// the subagent JSONL path, and any plan content extracted from the assistant's text blocks.
// This is used as a fallback when FindLatestToolUseID fails on the parent session JSONL,
// indicating the tool was called from a Plan/Task subagent.
func FindToolUseInSubagents(folder, sessionID, toolName string) (toolID, assistantUUID, subagentPath, planContent string, err error) {
	encodedName := encodeProjectPath(folder)
	subagentsDir := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID, "subagents")

	entries, err := os.ReadDir(subagentsDir)
	if err != nil {
		return "", "", "", "", fmt.Errorf("failed to read subagents dir: %w", err)
	}

	// Sort by modification time descending (most recent first)
	type fileEntry struct {
		path    string
		modTime time.Time
	}
	var jsonlFiles []fileEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		jsonlFiles = append(jsonlFiles, fileEntry{
			path:    filepath.Join(subagentsDir, e.Name()),
			modTime: info.ModTime(),
		})
	}
	// Sort most recent first
	for i := 0; i < len(jsonlFiles); i++ {
		for j := i + 1; j < len(jsonlFiles); j++ {
			if jsonlFiles[j].modTime.After(jsonlFiles[i].modTime) {
				jsonlFiles[i], jsonlFiles[j] = jsonlFiles[j], jsonlFiles[i]
			}
		}
	}

	// Check the 3 most recent subagent files (the caller is almost certainly the latest)
	limit := 3
	if len(jsonlFiles) < limit {
		limit = len(jsonlFiles)
	}

	for _, fe := range jsonlFiles[:limit] {
		tid, uuid, plan, scanErr := scanSubagentForToolUse(fe.path, toolName)
		if scanErr == nil && tid != "" {
			fmt.Printf("[PATCH] FindToolUseInSubagents: found %s in %s → %s\n", toolName, filepath.Base(fe.path), tid)
			return tid, uuid, fe.path, plan, nil
		}
	}

	return "", "", "", "", fmt.Errorf("no tool_use block found for %s in any recent subagent")
}

// scanSubagentForToolUse scans a single subagent JSONL backwards for a tool_use matching
// toolName. Also extracts text content from the same assistant message as plan content.
func scanSubagentForToolUse(jsonlPath, toolName string) (toolID, assistantUUID, planContent string, err error) {
	f, err := os.Open(jsonlPath)
	if err != nil {
		return "", "", "", err
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		return "", "", "", err
	}

	for i := len(lines) - 1; i >= 0; i-- {
		line := lines[i]
		if !strings.Contains(line, toolName) {
			continue
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}
		if event["type"] != "assistant" {
			continue
		}

		msgUUID, _ := event["uuid"].(string)
		message, ok := event["message"].(map[string]any)
		if !ok {
			continue
		}
		content, ok := message["content"].([]any)
		if !ok {
			continue
		}

		var foundToolID string
		var textParts []string

		for _, block := range content {
			blockMap, ok := block.(map[string]any)
			if !ok {
				continue
			}
			switch blockMap["type"] {
			case "tool_use":
				if blockMap["name"] == toolName {
					if tid, ok := blockMap["id"].(string); ok {
						foundToolID = tid
					}
				}
			case "text":
				if text, ok := blockMap["text"].(string); ok && text != "" {
					textParts = append(textParts, text)
				}
			}
		}

		if foundToolID != "" {
			return foundToolID, msgUUID, strings.Join(textParts, "\n"), nil
		}
	}

	return "", "", "", fmt.Errorf("not found in %s", filepath.Base(jsonlPath))
}

// DeleteFromMessage truncates a session JSONL file from the message with the given
// UUID and everything after it. The target message and all subsequent messages are removed.
// Always truncates downward — no parent_uuid patching needed.
// Returns the number of lines removed, or an error.
func DeleteFromMessage(folder, sessionID, messageUUID string) (int, error) {
	encodedName := encodeProjectPath(folder)
	sessionPath := filepath.Join(os.Getenv("HOME"), ".claude", "projects", encodedName, sessionID+".jsonl")

	data, err := os.ReadFile(sessionPath)
	if err != nil {
		return 0, fmt.Errorf("failed to read session file: %w", err)
	}

	lines := strings.Split(string(data), "\n")

	// Find the line with the matching UUID
	cutIndex := -1
	for i, line := range lines {
		if line == "" {
			continue
		}
		if !strings.Contains(line, messageUUID) {
			continue
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}

		if event["uuid"] == messageUUID {
			cutIndex = i
			break
		}
	}

	if cutIndex < 0 {
		return 0, fmt.Errorf("message not found: %s", messageUUID)
	}

	// Count non-empty lines being removed
	removed := 0
	for i := cutIndex; i < len(lines); i++ {
		if lines[i] != "" {
			removed++
		}
	}

	// Truncate: keep everything before cutIndex
	lines = lines[:cutIndex]

	// Write back
	output := strings.Join(lines, "\n")
	// Ensure file ends with a newline if there's content
	if len(output) > 0 && !strings.HasSuffix(output, "\n") {
		output += "\n"
	}

	if err := os.WriteFile(sessionPath, []byte(output), 0644); err != nil {
		return 0, fmt.Errorf("failed to write truncated session file: %w", err)
	}

	fmt.Printf("[PATCH] DeleteFromMessage: removed %d lines from %s (cut at line %d, uuid=%s)\n", removed, sessionPath, cutIndex, messageUUID)
	return removed, nil
}
