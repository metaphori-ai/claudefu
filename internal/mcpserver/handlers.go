package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"claudefu/internal/providers"
	"claudefu/internal/types"
	"claudefu/internal/workspace"

	"github.com/gorilla/websocket"
	"github.com/mark3labs/mcp-go/mcp"
)

// findMCPEnabledAgent finds an agent by slug or name, only if MCP is enabled for it
func (s *MCPService) findMCPEnabledAgent(identifier string) *workspace.Agent {
	ws := s.workspace()
	if ws == nil {
		fmt.Printf("[MCP:findAgent] No workspace loaded\n")
		return nil
	}

	identifier = strings.ToLower(identifier)
	for i := range ws.Agents {
		agent := &ws.Agents[i]
		if !agent.GetMCPEnabled() {
			continue // Skip agents with MCP disabled
		}
		// Match by slug (custom or derived) or case-insensitive name
		agentSlug := strings.ToLower(agent.GetSlug())
		if agentSlug == identifier || strings.EqualFold(agent.Name, identifier) {
			fmt.Printf("[MCP:findAgent] Found '%s' -> %s (ID: %s)\n", identifier, agent.Name, agent.ID)
			return agent
		}
	}
	fmt.Printf("[MCP:findAgent] No match for '%s' in %d agents\n", identifier, len(ws.Agents))
	return nil
}

// getAvailableAgentSlugs returns slugs of all MCP-enabled agents
func (s *MCPService) getAvailableAgentSlugs() []string {
	ws := s.workspace()
	if ws == nil {
		return nil
	}

	var slugs []string
	for _, agent := range ws.Agents {
		if agent.GetMCPEnabled() {
			slugs = append(slugs, agent.GetSlug())
		}
	}
	return slugs
}

// handleAgentQuery handles the AgentQuery tool call
// Spawns a stateless claude --print query in the target agent's folder
func (s *MCPService) handleAgentQuery(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("AgentQuery") {
		return mcp.NewToolResultError("AgentQuery tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	targetAgent, err := req.RequireString("target_agent")
	if err != nil {
		return mcp.NewToolResultError("target_agent is required"), nil
	}

	query, err := req.RequireString("query")
	if err != nil {
		return mcp.NewToolResultError("query is required"), nil
	}

	// Find the target agent (must be MCP-enabled)
	agent := s.findMCPEnabledAgent(targetAgent)
	if agent == nil {
		available := s.getAvailableAgentSlugs()
		return mcp.NewToolResultError(fmt.Sprintf(
			"Agent '%s' not found or MCP disabled. Available agents: %s",
			targetAgent, strings.Join(available, ", "),
		)), nil
	}

	// Get claude binary path
	claudePath := providers.GetClaudePath()
	if claudePath == "" {
		return mcp.NewToolResultError("claude CLI not found"), nil
	}

	// Get system prompt from configurable instructions
	systemPrompt := s.toolInstructions.GetInstructions().AgentQuerySystemPrompt

	// Build command args
	// NOTE: We intentionally do NOT pass --mcp-config to the child Claude.
	// Passing MCP config caused "tool_use ids must be unique" API errors because
	// both parent and child Claude would connect to the same MCP SSE server.
	// The child is a stateless query - it doesn't need inter-agent tools.
	// We also disallow Task to prevent spawning subagents (causes concurrent API conflicts).
	// Prepend "AgentQuery: " so session list shows these as queries, not regular sessions.
	args := []string{
		"--print",
		"--disallowed-tools", "Task",
		"-p", "AgentQuery: " + query,
	}

	// Only append system prompt if configured
	if systemPrompt != "" {
		args = append(args, "--append-system-prompt", systemPrompt)
	}

	// Retry logic for transient API concurrency errors
	var output []byte
	var cmdErr error
	maxRetries := 3

	for attempt := 1; attempt <= maxRetries; attempt++ {
		cmd := exec.CommandContext(ctx, claudePath, args...)
		cmd.Dir = agent.Folder

		output, cmdErr = cmd.CombinedOutput()
		if cmdErr == nil {
			break // Success
		}

		// Check if it's a transient concurrency error worth retrying
		outputStr := string(output)
		isTransient := strings.Contains(outputStr, "concurrency issues") ||
			strings.Contains(outputStr, "tool_use ids must be unique")

		if !isTransient || attempt == maxRetries {
			// Log full command for debugging on final failure
			fmt.Printf("[MCP:AgentQuery] FAILED (attempt %d/%d) - reproduce with:\n  cd %q && %s %s\n",
				attempt, maxRetries, agent.Folder, claudePath, strings.Join(args, " "))
			fmt.Printf("[MCP:AgentQuery] Error: %v\n", cmdErr)
			fmt.Printf("[MCP:AgentQuery] Output: %s\n", outputStr)
			return mcp.NewToolResultError(fmt.Sprintf("Query failed: %v\nOutput: %s", cmdErr, outputStr)), nil
		}

		// Transient error - wait and retry
		fmt.Printf("[MCP:AgentQuery] Transient API error (attempt %d/%d), retrying in %dms...\n",
			attempt, maxRetries, attempt*500)
		time.Sleep(time.Duration(attempt*500) * time.Millisecond)
	}

	return mcp.NewToolResultText(string(output)), nil
}

// handleSelfQuery handles the SelfQuery tool call
// Spawns a stateless claude --print query in the caller's OWN folder (not a target's)
// This gives the spawned Claude access to CLAUDE.md and all includes (TDAs, SVML)
func (s *MCPService) handleSelfQuery(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("SelfQuery") {
		return mcp.NewToolResultError("SelfQuery tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	// from_agent is REQUIRED for SelfQuery - we need it to identify the caller's folder
	fromAgent, err := req.RequireString("from_agent")
	if err != nil {
		return mcp.NewToolResultError("from_agent is required - tell me your agent slug"), nil
	}

	query, err := req.RequireString("query")
	if err != nil {
		return mcp.NewToolResultError("query is required"), nil
	}

	// Find the caller's agent (must be MCP-enabled)
	agent := s.findMCPEnabledAgent(fromAgent)
	if agent == nil {
		available := s.getAvailableAgentSlugs()
		return mcp.NewToolResultError(fmt.Sprintf(
			"Agent '%s' not found or MCP disabled. Available agents: %s",
			fromAgent, strings.Join(available, ", "),
		)), nil
	}

	// Get claude binary path
	claudePath := providers.GetClaudePath()
	if claudePath == "" {
		return mcp.NewToolResultError("claude CLI not found"), nil
	}

	// Get system prompt from configurable instructions (SelfQuery has its own)
	systemPrompt := s.toolInstructions.GetInstructions().SelfQuerySystemPrompt

	// Build command args - same as AgentQuery but runs in caller's own folder
	// NOTE: We intentionally do NOT pass --mcp-config to the child Claude.
	// Passing MCP config caused "tool_use ids must be unique" API errors because
	// both parent and child Claude would connect to the same MCP SSE server.
	// The child is a stateless query - it doesn't need inter-agent tools.
	// We also disallow Task to prevent spawning subagents (causes concurrent API conflicts).
	// Prepend "SelfQuery: " so session list shows these as self-queries, not regular sessions.
	args := []string{
		"--print",
		"--disallowed-tools", "Task",
		"-p", "SelfQuery: " + query,
	}

	// Only append system prompt if configured
	if systemPrompt != "" {
		args = append(args, "--append-system-prompt", systemPrompt)
	}

	// Retry logic for transient API concurrency errors
	var output []byte
	var cmdErr error
	maxRetries := 3

	for attempt := 1; attempt <= maxRetries; attempt++ {
		cmd := exec.CommandContext(ctx, claudePath, args...)
		cmd.Dir = agent.Folder // Run in CALLER'S folder (key difference from AgentQuery)

		output, cmdErr = cmd.CombinedOutput()
		if cmdErr == nil {
			break // Success
		}

		// Check if it's a transient concurrency error worth retrying
		outputStr := string(output)
		isTransient := strings.Contains(outputStr, "concurrency issues") ||
			strings.Contains(outputStr, "tool_use ids must be unique")

		if !isTransient || attempt == maxRetries {
			// Log full command for debugging on final failure
			fmt.Printf("[MCP:SelfQuery] FAILED (attempt %d/%d) - reproduce with:\n  cd %q && %s %s\n",
				attempt, maxRetries, agent.Folder, claudePath, strings.Join(args, " "))
			fmt.Printf("[MCP:SelfQuery] Error: %v\n", cmdErr)
			fmt.Printf("[MCP:SelfQuery] Output: %s\n", outputStr)
			return mcp.NewToolResultError(fmt.Sprintf("SelfQuery failed: %v\nOutput: %s", cmdErr, outputStr)), nil
		}

		// Transient error - wait and retry
		fmt.Printf("[MCP:SelfQuery] Transient API error (attempt %d/%d), retrying in %dms...\n",
			attempt, maxRetries, attempt*500)
		time.Sleep(time.Duration(attempt*500) * time.Millisecond)
	}

	return mcp.NewToolResultText(string(output)), nil
}

// handleAgentMessage handles the AgentMessage tool call
// Sends a message to one or more specific agents' inboxes
func (s *MCPService) handleAgentMessage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("AgentMessage") {
		fmt.Println("[MCP:AgentMessage] Tool is disabled")
		return mcp.NewToolResultError("AgentMessage tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	// Accept BOTH target_agent (singular) and target_agents (plural) for flexibility
	// Claude sometimes uses singular even though schema says plural
	targetAgents, err := req.RequireString("target_agents")
	if err != nil {
		// Try singular form as fallback
		targetAgents, err = req.RequireString("target_agent")
		if err != nil {
			fmt.Println("[MCP:AgentMessage] Error: neither target_agents nor target_agent provided")
			return mcp.NewToolResultError("target_agents is required (target_agent also accepted)"), nil
		}
	}

	message, err := req.RequireString("message")
	if err != nil {
		fmt.Println("[MCP:AgentMessage] Error: message is required")
		return mcp.NewToolResultError("message is required"), nil
	}

	// Optional fields
	fromAgent, _ := req.RequireString("from_agent")
	priority, _ := req.RequireString("priority")
	if priority == "" {
		priority = "normal"
	}

	fmt.Printf("[MCP:AgentMessage] From: %s, To: %s, Priority: %s\n", fromAgent, targetAgents, priority)

	// Parse comma-separated agent list
	agentIdentifiers := strings.Split(targetAgents, ",")
	var sentTo []string
	var notFound []string

	for _, identifier := range agentIdentifiers {
		identifier = strings.TrimSpace(identifier)
		if identifier == "" {
			continue
		}

		// Find specific agent (must be MCP-enabled)
		agent := s.findMCPEnabledAgent(identifier)
		if agent == nil {
			fmt.Printf("[MCP:AgentMessage] Agent not found: %s\n", identifier)
			notFound = append(notFound, identifier)
			continue
		}

		// Add to inbox
		fmt.Printf("[MCP:AgentMessage] Adding message to inbox for agent: %s (ID: %s)\n", agent.GetSlug(), agent.ID)
		s.inbox.AddMessage(agent.ID, "", fromAgent, message, priority)
		s.emitInboxUpdate(agent.ID)
		sentTo = append(sentTo, agent.GetSlug())
	}

	// Build response
	if len(sentTo) == 0 {
		available := s.getAvailableAgentSlugs()
		errMsg := fmt.Sprintf("No valid agents found. Requested: %s. Available agents: %s",
			targetAgents, strings.Join(available, ", "))
		fmt.Printf("[MCP:AgentMessage] Error: %s\n", errMsg)
		return mcp.NewToolResultError(errMsg), nil
	}

	response := fmt.Sprintf("Message sent to: %s", strings.Join(sentTo, ", "))
	if len(notFound) > 0 {
		response += fmt.Sprintf(" (not found: %s)", strings.Join(notFound, ", "))
	}

	fmt.Printf("[MCP:AgentMessage] Success: %s\n", response)
	return mcp.NewToolResultText(response), nil
}

// handleAgentBroadcast handles the AgentBroadcast tool call
// Broadcasts a message to ALL agents' inboxes in the workspace
func (s *MCPService) handleAgentBroadcast(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("AgentBroadcast") {
		fmt.Println("[MCP:AgentBroadcast] Tool is disabled")
		return mcp.NewToolResultError("AgentBroadcast tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	message, err := req.RequireString("message")
	if err != nil {
		fmt.Println("[MCP:AgentBroadcast] Error: message is required")
		return mcp.NewToolResultError("message is required"), nil
	}

	// Optional fields
	fromAgent, _ := req.RequireString("from_agent")
	priority, _ := req.RequireString("priority")
	if priority == "" {
		priority = "normal"
	}

	fmt.Printf("[MCP:AgentBroadcast] From: %s, Priority: %s\n", fromAgent, priority)

	// Get workspace
	ws := s.workspace()
	if ws == nil {
		fmt.Println("[MCP:AgentBroadcast] Error: no workspace loaded")
		return mcp.NewToolResultError("no workspace loaded"), nil
	}

	// Broadcast to ALL MCP-enabled agents
	count := 0
	var sentTo []string
	for _, agent := range ws.Agents {
		if !agent.GetMCPEnabled() {
			continue // Skip agents with MCP disabled
		}
		s.inbox.AddMessage(agent.ID, "", fromAgent, message, priority)
		s.emitInboxUpdate(agent.ID)
		sentTo = append(sentTo, agent.GetSlug())
		count++
	}

	if count == 0 {
		fmt.Println("[MCP:AgentBroadcast] Error: No MCP-enabled agents found")
		return mcp.NewToolResultError("No MCP-enabled agents found in workspace"), nil
	}

	response := fmt.Sprintf("Broadcast sent to %d agents: %s", count, strings.Join(sentTo, ", "))
	fmt.Printf("[MCP:AgentBroadcast] Success: %s\n", response)
	return mcp.NewToolResultText(response), nil
}

// handleNotifyUser handles the NotifyUser tool call
// Emits an event to show a notification in the ClaudeFu UI
func (s *MCPService) handleNotifyUser(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("NotifyUser") {
		return mcp.NewToolResultError("NotifyUser tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	message, err := req.RequireString("message")
	if err != nil {
		return mcp.NewToolResultError("message is required"), nil
	}

	notifType, err := req.RequireString("type")
	if err != nil {
		return mcp.NewToolResultError("type is required"), nil
	}

	// Validate type
	validTypes := map[string]bool{"info": true, "success": true, "warning": true, "question": true}
	if !validTypes[notifType] {
		return mcp.NewToolResultError("type must be one of: info, success, warning, question"), nil
	}

	// Optional fields
	title, _ := req.RequireString("title")
	fromAgent, _ := req.RequireString("from_agent")

	// Emit notification event
	s.emitFunc(types.EventEnvelope{
		EventType: "mcp:notification",
		Payload: map[string]any{
			"type":       notifType,
			"message":    message,
			"title":      title,
			"from_agent": fromAgent,
		},
	})

	return mcp.NewToolResultText("Notification sent"), nil
}

// emitInboxUpdate emits an inbox update event for the given agent
func (s *MCPService) emitInboxUpdate(agentID string) {
	s.emitFunc(types.EventEnvelope{
		AgentID:   agentID,
		EventType: "mcp:inbox",
		Payload: map[string]any{
			"unreadCount": s.inbox.GetUnreadCount(agentID),
		},
	})
}

// handleAskUserQuestion handles the AskUserQuestion tool call
// This blocks until the user answers or skips the question
func (s *MCPService) handleAskUserQuestion(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("AskUserQuestion") {
		return mcp.NewToolResultError("AskUserQuestion tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	// Get the raw arguments - they come as a map[string]any
	args, ok := req.Params.Arguments.(map[string]any)
	if !ok {
		return mcp.NewToolResultError("invalid arguments format"), nil
	}

	// Extract questions array
	questionsRaw, exists := args["questions"]
	if !exists || questionsRaw == nil {
		return mcp.NewToolResultError("questions parameter is required"), nil
	}

	// Convert to []map[string]any via JSON round-trip for safety
	var questions []map[string]any
	questionsJSON, err := json.Marshal(questionsRaw)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("invalid questions format: %v", err)), nil
	}
	if err := json.Unmarshal(questionsJSON, &questions); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("invalid questions format: %v", err)), nil
	}

	if len(questions) == 0 {
		return mcp.NewToolResultError("at least one question is required"), nil
	}

	// Optional: get from_agent for logging
	fromAgent, _ := args["from_agent"].(string)
	if fromAgent == "" {
		fromAgent = "unknown"
	}

	fmt.Printf("[MCP:AskUser] Received question from agent %s with %d questions\n", fromAgent, len(questions))

	// Create pending question with response channel
	pq := s.pendingQuestions.Create(fromAgent, questions)

	// Emit event to frontend to show dialog
	s.emitFunc(types.EventEnvelope{
		EventType: "mcp:askuser",
		Payload: map[string]any{
			"id":        pq.ID,
			"agentSlug": pq.AgentSlug,
			"questions": pq.Questions,
			"createdAt": pq.CreatedAt.Format(time.RFC3339),
		},
	})

	// Block waiting for response, timeout, or context cancellation
	timeout := s.pendingQuestions.GetTimeout()
	select {
	case answer, ok := <-pq.ResponseCh:
		if !ok {
			// Channel was closed (cancelled)
			return mcp.NewToolResultError("Question was cancelled"), nil
		}
		if answer.Skipped {
			return mcp.NewToolResultError("User skipped the question"), nil
		}
		// Return answer as JSON
		result := map[string]any{
			"questions": questions,
			"answers":   answer.Answers,
		}
		resultJSON, _ := json.Marshal(result)
		fmt.Printf("[MCP:AskUser] Returning answer for question %s\n", pq.ID[:8])
		return mcp.NewToolResultText(string(resultJSON)), nil

	case <-ctx.Done():
		// Context cancelled (e.g., Claude disconnected)
		s.pendingQuestions.Cancel(pq.ID)
		return mcp.NewToolResultError("Request cancelled"), nil

	case <-s.ctx.Done():
		// Server shutting down
		s.pendingQuestions.Cancel(pq.ID)
		return mcp.NewToolResultError("Server shutting down"), nil

	case <-time.After(timeout):
		// Timeout
		s.pendingQuestions.Cancel(pq.ID)
		return mcp.NewToolResultError(fmt.Sprintf("Question timed out after %v", timeout)), nil
	}
}

// handleBrowserAgent handles the BrowserAgent tool call
// Connects to Claude in Browser via a WebSocket bridge for visual/DOM/CSS investigation
func (s *MCPService) handleBrowserAgent(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("BrowserAgent") {
		return mcp.NewToolResultError("BrowserAgent is disabled. Enable in MCP Settings > Tool Availability (requires password)."), nil
	}

	// Get the raw arguments
	args, ok := req.Params.Arguments.(map[string]any)
	if !ok {
		return mcp.NewToolResultError("invalid arguments format"), nil
	}

	// Parse required prompt parameter
	prompt, ok := args["prompt"].(string)
	if !ok || prompt == "" {
		return mcp.NewToolResultError("prompt is required"), nil
	}

	// Parse optional timeout (default: 600 seconds = 10 minutes)
	timeout := 600
	if t, ok := args["timeout"].(float64); ok && t > 0 {
		timeout = int(t)
	}

	// Optional from_agent for logging
	fromAgent := "unknown"
	if fa, ok := args["from_agent"].(string); ok && fa != "" {
		fromAgent = fa
	}

	fmt.Printf("[MCP:BrowserAgent] Request from %s, timeout: %ds\n", fromAgent, timeout)

	// Check bridge health
	healthClient := &http.Client{Timeout: 5 * time.Second}
	resp, err := healthClient.Get("http://localhost:9320/health")
	if err != nil {
		return mcp.NewToolResultError("Browser bridge not available. Ensure Chrome extension bridge is running on localhost:9320."), nil
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return mcp.NewToolResultError(fmt.Sprintf("Browser bridge health check failed: %d", resp.StatusCode)), nil
	}

	// Connect to WebSocket
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	conn, _, err := dialer.DialContext(ctx, "ws://localhost:9320/ws", nil)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Failed to connect to browser bridge: %v", err)), nil
	}
	defer conn.Close()

	// Generate unique request ID
	requestID := fmt.Sprintf("claudefu-%d", time.Now().UnixNano())

	// Build report instructions that tell Claude in Browser where to submit findings
	reportURL := fmt.Sprintf("http://localhost:9320/report/%s", requestID)
	reportInstructions := fmt.Sprintf(`

---
When you've completed your investigation:
Navigate to %s and submit your findings in the form.
---`, reportURL)

	// Send request to bridge
	request := map[string]any{
		"type":       "tool_request",
		"request_id": requestID,
		"tool":       "ask_browser_claude",
		"args": map[string]any{
			"prompt":  prompt + reportInstructions,
			"timeout": timeout,
		},
	}

	if err := conn.WriteJSON(request); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Failed to send request to bridge: %v", err)), nil
	}

	fmt.Printf("[MCP:BrowserAgent] Request %s sent, waiting for response...\n", requestID[:16])

	// Wait for response with timeout (+30 seconds buffer for response transmission)
	conn.SetReadDeadline(time.Now().Add(time.Duration(timeout+30) * time.Second))

	var response struct {
		Type      string `json:"type"`
		RequestID string `json:"request_id"`
		Content   string `json:"content"`
		IsError   bool   `json:"is_error"`
	}

	if err := conn.ReadJSON(&response); err != nil {
		if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
			return mcp.NewToolResultError("Browser bridge connection closed"), nil
		}
		return mcp.NewToolResultError(fmt.Sprintf("Timeout waiting for browser findings (waited %ds)", timeout)), nil
	}

	fmt.Printf("[MCP:BrowserAgent] Received response for %s (is_error: %v)\n", requestID[:16], response.IsError)

	if response.IsError {
		return mcp.NewToolResultError(response.Content), nil
	}

	return mcp.NewToolResultText(response.Content), nil
}

// handleRequestToolPermission handles the RequestToolPermission tool call
// This blocks until the user grants/denies the permission
func (s *MCPService) handleRequestToolPermission(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("RequestToolPermission") {
		return mcp.NewToolResultError("RequestToolPermission tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	permission, err := req.RequireString("permission")
	if err != nil {
		return mcp.NewToolResultError("permission is required"), nil
	}

	reason, err := req.RequireString("reason")
	if err != nil {
		return mcp.NewToolResultError("reason is required"), nil
	}

	// Optional: get from_agent for logging
	args, _ := req.Params.Arguments.(map[string]any)
	fromAgent, _ := args["from_agent"].(string)
	if fromAgent == "" {
		fromAgent = "unknown"
	}

	fmt.Printf("[MCP:RequestToolPermission] Request from %s for '%s': %s\n", fromAgent, permission, reason)

	// Create pending permission request with response channel
	pr := s.pendingPermissions.Create(fromAgent, permission, reason)

	// Emit event to frontend to show dialog
	s.emitFunc(types.EventEnvelope{
		EventType: "mcp:permission-request",
		Payload: map[string]any{
			"id":         pr.ID,
			"agentSlug":  pr.AgentSlug,
			"permission": pr.Permission,
			"reason":     pr.Reason,
			"createdAt":  pr.CreatedAt.Format(time.RFC3339),
		},
	})

	// Block waiting for response, timeout, or context cancellation
	timeout := s.pendingPermissions.GetTimeout()
	select {
	case response, ok := <-pr.ResponseCh:
		if !ok {
			// Channel was closed (cancelled)
			return mcp.NewToolResultError("Permission request was cancelled"), nil
		}
		if !response.Granted {
			msg := "Permission denied by user"
			if response.DenyReason != "" {
				msg += ": " + response.DenyReason
			}
			return mcp.NewToolResultError(msg), nil
		}
		// Permission granted
		result := map[string]any{
			"granted":   true,
			"permanent": response.Permanent,
			"message":   fmt.Sprintf("Permission '%s' granted", permission),
		}
		if response.Permanent {
			result["message"] = fmt.Sprintf("Permission '%s' granted and added to allow list", permission)
		}
		resultJSON, _ := json.Marshal(result)
		fmt.Printf("[MCP:RequestToolPermission] Permission granted for %s: permanent=%v\n", permission, response.Permanent)
		return mcp.NewToolResultText(string(resultJSON)), nil

	case <-ctx.Done():
		// Context cancelled (e.g., Claude disconnected)
		s.pendingPermissions.Cancel(pr.ID)
		return mcp.NewToolResultError("Request cancelled"), nil

	case <-s.ctx.Done():
		// Server shutting down
		s.pendingPermissions.Cancel(pr.ID)
		return mcp.NewToolResultError("Server shutting down"), nil

	case <-time.After(timeout):
		// Timeout
		s.pendingPermissions.Cancel(pr.ID)
		return mcp.NewToolResultError(fmt.Sprintf("Permission request timed out after %v", timeout)), nil
	}
}

// handleExitPlanMode handles the ExitPlanMode tool call
// This replaces Claude's built-in ExitPlanMode which fails in non-interactive CLI mode
func (s *MCPService) handleExitPlanMode(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	// Check tool availability
	if !s.toolAvailability.IsEnabled("ExitPlanMode") {
		return mcp.NewToolResultError("ExitPlanMode tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	// Get the raw arguments
	args, _ := req.Params.Arguments.(map[string]any)

	// Optional: get from_agent for logging
	fromAgent := "unknown"
	if args != nil {
		if fa, ok := args["from_agent"].(string); ok && fa != "" {
			fromAgent = fa
		}
	}

	fmt.Printf("[MCP:ExitPlanMode] Received plan review request from agent %s\n", fromAgent)

	// Create pending plan review with response channel
	pr := s.pendingPlanReviews.Create(fromAgent)

	// Emit event to frontend to show plan review UI
	s.emitFunc(types.EventEnvelope{
		EventType: "mcp:planreview",
		Payload: map[string]any{
			"id":        pr.ID,
			"agentSlug": pr.AgentSlug,
			"createdAt": pr.CreatedAt.Format(time.RFC3339),
		},
	})

	// Block waiting for response, timeout, or context cancellation
	timeout := s.pendingPlanReviews.GetTimeout()
	select {
	case answer, ok := <-pr.ResponseCh:
		if !ok {
			// Channel was closed (cancelled)
			return mcp.NewToolResultError("Plan review was cancelled"), nil
		}
		if answer.Skipped {
			return mcp.NewToolResultError("User skipped the plan review"), nil
		}
		if answer.Accepted {
			fmt.Printf("[MCP:ExitPlanMode] Plan accepted for review %s\n", pr.ID[:8])
			return mcp.NewToolResultText("Plan approved by user. You can now proceed with implementation."), nil
		}
		// Rejected with feedback
		feedback := answer.Feedback
		if feedback == "" {
			feedback = "User rejected the plan without specific feedback."
		}
		fmt.Printf("[MCP:ExitPlanMode] Plan rejected for review %s: %s\n", pr.ID[:8], feedback)
		return mcp.NewToolResultText(fmt.Sprintf("Plan rejected by user. Feedback: %s\n\nPlease revise your plan based on this feedback and try ExitPlanMode again when ready.", feedback)), nil

	case <-ctx.Done():
		// Context cancelled (e.g., Claude disconnected)
		s.pendingPlanReviews.Cancel(pr.ID)
		return mcp.NewToolResultError("Request cancelled"), nil

	case <-s.ctx.Done():
		// Server shutting down
		s.pendingPlanReviews.Cancel(pr.ID)
		return mcp.NewToolResultError("Server shutting down"), nil

	case <-time.After(timeout):
		// Timeout
		s.pendingPlanReviews.Cancel(pr.ID)
		return mcp.NewToolResultError(fmt.Sprintf("Plan review timed out after %v", timeout)), nil
	}
}

// =============================================================================
// BACKLOG TOOL HANDLERS
// =============================================================================

// handleBacklogAdd handles the BacklogAdd tool call
func (s *MCPService) handleBacklogAdd(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.toolAvailability.IsEnabled("BacklogAdd") {
		return mcp.NewToolResultError("BacklogAdd tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	title, err := req.RequireString("title")
	if err != nil {
		return mcp.NewToolResultError("title is required"), nil
	}

	// Optional parameters
	contextStr := getOptionalString(req, "context")
	status := getOptionalString(req, "status")
	itemType := getOptionalString(req, "type")
	tags := getOptionalString(req, "tags")
	parentID := getOptionalString(req, "parent_id")
	fromAgent := getOptionalString(req, "from_agent")

	// Resolve agent ID from from_agent slug
	agentID := s.resolveAgentID(fromAgent)
	if agentID == "" {
		return mcp.NewToolResultError("from_agent is required to identify which agent's backlog to add to. Available agents: " + strings.Join(s.getAvailableAgentSlugs(), ", ")), nil
	}

	if status == "" {
		status = "idea"
	}
	if itemType == "" {
		itemType = "feature_expansion"
	}

	createdBy := fromAgent
	if createdBy == "" {
		createdBy = "agent"
	}

	item := s.backlog.AddItem(agentID, title, contextStr, status, itemType, tags, createdBy, parentID)

	// Emit change event
	s.emitBacklogChanged(agentID)

	return mcp.NewToolResultText(fmt.Sprintf("Created backlog item: %s (id: %s, status: %s, type: %s)", item.Title, item.ID, item.Status, item.Type)), nil
}

// handleBacklogUpdate handles the BacklogUpdate tool call
func (s *MCPService) handleBacklogUpdate(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.toolAvailability.IsEnabled("BacklogUpdate") {
		return mcp.NewToolResultError("BacklogUpdate tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	id, err := req.RequireString("id")
	if err != nil {
		return mcp.NewToolResultError("id is required"), nil
	}

	item := s.backlog.GetItem(id)
	if item == nil {
		return mcp.NewToolResultError(fmt.Sprintf("Backlog item not found: %s", id)), nil
	}

	// Apply updates only for provided fields
	if title := getOptionalString(req, "title"); title != "" {
		item.Title = title
	}
	if status := getOptionalString(req, "status"); status != "" {
		item.Status = status
	}
	if itemType := getOptionalString(req, "type"); itemType != "" {
		item.Type = itemType
	}
	if tags := getOptionalString(req, "tags"); tags != "" {
		item.Tags = tags
	}

	// Context: support "append:" prefix
	if contextStr := getOptionalString(req, "context"); contextStr != "" {
		if strings.HasPrefix(contextStr, "append:") {
			appendContent := strings.TrimPrefix(contextStr, "append:")
			if item.Context != "" {
				item.Context = item.Context + "\n" + appendContent
			} else {
				item.Context = appendContent
			}
		} else {
			item.Context = contextStr
		}
	}

	ok := s.backlog.UpdateItem(*item)
	if !ok {
		return mcp.NewToolResultError("Failed to update backlog item"), nil
	}

	// Emit change event (use item's agentID)
	s.emitBacklogChanged(item.AgentID)

	return mcp.NewToolResultText(fmt.Sprintf("Updated backlog item: %s (id: %s, status: %s, type: %s)", item.Title, item.ID, item.Status, item.Type)), nil
}

// handleBacklogList handles the BacklogList tool call
func (s *MCPService) handleBacklogList(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if !s.toolAvailability.IsEnabled("BacklogList") {
		return mcp.NewToolResultError("BacklogList tool is disabled. Enable in MCP Settings > Tool Availability."), nil
	}

	statusFilter := getOptionalString(req, "status")
	typeFilter := getOptionalString(req, "type")
	tagFilter := getOptionalString(req, "tag")
	includeContext := getOptionalString(req, "include_context") == "true"
	fromAgent := getOptionalString(req, "from_agent")

	// Resolve agent ID from from_agent slug
	agentID := s.resolveAgentID(fromAgent)
	if agentID == "" {
		return mcp.NewToolResultError("from_agent is required to identify which agent's backlog to list. Available agents: " + strings.Join(s.getAvailableAgentSlugs(), ", ")), nil
	}

	items := s.backlog.GetItemsByAgent(agentID)

	// Filter by status if specified
	if statusFilter != "" {
		filtered := make([]BacklogItem, 0)
		for _, item := range items {
			if item.Status == statusFilter {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	// Filter by type if specified
	if typeFilter != "" {
		filtered := make([]BacklogItem, 0)
		for _, item := range items {
			if item.Type == typeFilter {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	// Filter by tag if specified
	if tagFilter != "" {
		filtered := make([]BacklogItem, 0)
		for _, item := range items {
			if strings.Contains(strings.ToLower(item.Tags), strings.ToLower(tagFilter)) {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	if len(items) == 0 {
		return mcp.NewToolResultText("No backlog items found."), nil
	}

	// Format results as XML for clean parsing by Claude
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<backlog count=\"%d\">\n", len(items)))

	for _, item := range items {
		// Build item attributes
		attrs := fmt.Sprintf("id=\"%s\" status=\"%s\" type=\"%s\"", item.ID, item.Status, item.Type)
		if item.ParentID != "" {
			attrs += fmt.Sprintf(" parent_id=\"%s\"", item.ParentID)
		}
		if item.Tags != "" {
			attrs += fmt.Sprintf(" tags=\"%s\"", item.Tags)
		}
		if item.CreatedBy != "" {
			attrs += fmt.Sprintf(" created_by=\"%s\"", item.CreatedBy)
		}
		sb.WriteString(fmt.Sprintf("<item %s>\n", attrs))
		sb.WriteString(fmt.Sprintf("  <title>%s</title>\n", item.Title))

		if includeContext && item.Context != "" {
			sb.WriteString(fmt.Sprintf("  <context>\n%s\n  </context>\n", item.Context))
		} else if !includeContext && item.Context != "" {
			// Truncate to 100 chars
			ctxStr := item.Context
			if len(ctxStr) > 100 {
				ctxStr = ctxStr[:100] + "..."
			}
			sb.WriteString(fmt.Sprintf("  <context>%s</context>\n", ctxStr))
		}
		sb.WriteString("</item>\n")
	}

	sb.WriteString("</backlog>")
	return mcp.NewToolResultText(sb.String()), nil
}

// resolveAgentID resolves an agent slug/name to an agent UUID
func (s *MCPService) resolveAgentID(identifier string) string {
	if identifier == "" {
		return ""
	}
	agent := s.findMCPEnabledAgent(identifier)
	if agent == nil {
		return ""
	}
	return agent.ID
}

// emitBacklogChanged emits a backlog:changed event for a specific agent via the MCP emitter
func (s *MCPService) emitBacklogChanged(agentID string) {
	if s.emitFunc == nil {
		return
	}
	s.emitFunc(types.EventEnvelope{
		AgentID:   agentID,
		EventType: "backlog:changed",
		Payload: map[string]any{
			"totalCount":   s.backlog.GetTotalCount(agentID),
			"nonDoneCount": s.backlog.GetNonDoneCount(agentID),
		},
	})
}

// getOptionalString extracts an optional string parameter from a tool request
func getOptionalString(req mcp.CallToolRequest, key string) string {
	args, ok := req.Params.Arguments.(map[string]any)
	if !ok || args == nil {
		return ""
	}
	val, ok := args[key]
	if !ok {
		return ""
	}
	str, ok := val.(string)
	if !ok {
		return ""
	}
	return str
}
