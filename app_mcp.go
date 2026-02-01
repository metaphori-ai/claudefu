package main

import (
	"fmt"

	"claudefu/internal/mcpserver"
)

// =============================================================================
// MCP TOOL INSTRUCTIONS METHODS (Bound to frontend)
// =============================================================================

// GetMCPToolInstructions returns the current MCP tool instructions
func (a *App) GetMCPToolInstructions() mcpserver.ToolInstructions {
	if a.mcpServer == nil {
		return *mcpserver.DefaultToolInstructions()
	}
	tim := a.mcpServer.GetToolInstructions()
	if tim == nil {
		return *mcpserver.DefaultToolInstructions()
	}
	return tim.GetInstructions()
}

// SaveMCPToolInstructions saves MCP tool instructions and restarts the server
func (a *App) SaveMCPToolInstructions(ti mcpserver.ToolInstructions) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	tim := a.mcpServer.GetToolInstructions()
	if tim == nil {
		return fmt.Errorf("tool instructions manager not initialized")
	}

	// Save the instructions
	if err := tim.SaveInstructions(ti); err != nil {
		return fmt.Errorf("failed to save instructions: %w", err)
	}

	// Restart the MCP server to pick up new instructions
	if err := a.mcpServer.Restart(); err != nil {
		return fmt.Errorf("failed to restart MCP server: %w", err)
	}

	return nil
}

// ResetMCPToolInstructions resets tool instructions to defaults and restarts server
func (a *App) ResetMCPToolInstructions() error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	tim := a.mcpServer.GetToolInstructions()
	if tim == nil {
		return fmt.Errorf("tool instructions manager not initialized")
	}

	// Reset to defaults
	if err := tim.ResetToDefaults(); err != nil {
		return fmt.Errorf("failed to reset instructions: %w", err)
	}

	// Restart the MCP server to pick up new instructions
	if err := a.mcpServer.Restart(); err != nil {
		return fmt.Errorf("failed to restart MCP server: %w", err)
	}

	return nil
}

// GetDefaultMCPToolInstructions returns the default MCP tool instructions
func (a *App) GetDefaultMCPToolInstructions() mcpserver.ToolInstructions {
	return *mcpserver.DefaultToolInstructions()
}

// =============================================================================
// MCP ASK USER QUESTION METHODS (Bound to frontend)
// =============================================================================

// MCPPendingQuestion represents a pending question for the frontend
type MCPPendingQuestion struct {
	ID        string           `json:"id"`
	AgentSlug string           `json:"agentSlug"`
	Questions []map[string]any `json:"questions"`
	CreatedAt string           `json:"createdAt"`
}

// AnswerMCPQuestion sends an answer to a pending MCP question
func (a *App) AnswerMCPQuestion(questionID string, answers map[string]string) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	pqm := a.mcpServer.GetPendingQuestions()
	if pqm == nil {
		return fmt.Errorf("pending questions manager not initialized")
	}
	return pqm.Answer(questionID, answers)
}

// SkipMCPQuestion skips a pending MCP question
func (a *App) SkipMCPQuestion(questionID string) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	pqm := a.mcpServer.GetPendingQuestions()
	if pqm == nil {
		return fmt.Errorf("pending questions manager not initialized")
	}
	return pqm.Skip(questionID)
}

// GetPendingMCPQuestions returns all pending MCP questions (for UI state recovery)
func (a *App) GetPendingMCPQuestions() []MCPPendingQuestion {
	if a.mcpServer == nil {
		return nil
	}
	pqm := a.mcpServer.GetPendingQuestions()
	if pqm == nil {
		return nil
	}

	pending := pqm.GetAll()
	result := make([]MCPPendingQuestion, len(pending))
	for i, pq := range pending {
		result[i] = MCPPendingQuestion{
			ID:        pq.ID,
			AgentSlug: pq.AgentSlug,
			Questions: pq.Questions,
			CreatedAt: pq.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}
	return result
}

// =============================================================================
// MCP TOOL AVAILABILITY METHODS (Bound to frontend)
// =============================================================================

// GetMCPToolAvailability returns the current MCP tool availability settings
func (a *App) GetMCPToolAvailability() mcpserver.ToolAvailability {
	if a.mcpServer == nil {
		return *mcpserver.DefaultToolAvailability()
	}
	tam := a.mcpServer.GetToolAvailability()
	if tam == nil {
		return *mcpserver.DefaultToolAvailability()
	}
	return tam.GetAvailability()
}

// SaveMCPToolAvailability saves MCP tool availability settings
// Note: Unlike tool instructions, we don't need to restart the server
// because availability is checked at handler runtime
func (a *App) SaveMCPToolAvailability(ta mcpserver.ToolAvailability) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	tam := a.mcpServer.GetToolAvailability()
	if tam == nil {
		return fmt.Errorf("tool availability manager not initialized")
	}
	return tam.SaveAvailability(ta)
}

// GetDefaultMCPToolAvailability returns the default MCP tool availability settings
func (a *App) GetDefaultMCPToolAvailability() mcpserver.ToolAvailability {
	return *mcpserver.DefaultToolAvailability()
}

// =============================================================================
// MCP PERMISSION REQUEST METHODS (Bound to frontend)
// =============================================================================

// MCPPendingPermission represents a pending permission request for the frontend
type MCPPendingPermission struct {
	ID         string `json:"id"`
	AgentSlug  string `json:"agentSlug"`
	Permission string `json:"permission"`
	Reason     string `json:"reason"`
	CreatedAt  string `json:"createdAt"`
}

// AnswerPermissionRequest responds to a pending MCP permission request
func (a *App) AnswerPermissionRequest(requestID string, granted bool, permanent bool, denyReason string) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	ppm := a.mcpServer.GetPendingPermissions()
	if ppm == nil {
		return fmt.Errorf("pending permissions manager not initialized")
	}
	return ppm.Respond(requestID, granted, permanent, denyReason)
}

// GetPendingPermissionRequests returns all pending MCP permission requests (for UI state recovery)
func (a *App) GetPendingPermissionRequests() []MCPPendingPermission {
	if a.mcpServer == nil {
		return nil
	}
	ppm := a.mcpServer.GetPendingPermissions()
	if ppm == nil {
		return nil
	}

	pending := ppm.GetAll()
	result := make([]MCPPendingPermission, len(pending))
	for i, pr := range pending {
		result[i] = MCPPendingPermission{
			ID:         pr.ID,
			AgentSlug:  pr.AgentSlug,
			Permission: pr.Permission,
			Reason:     pr.Reason,
			CreatedAt:  pr.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}
	return result
}

// =============================================================================
// MCP PLAN REVIEW METHODS (Bound to frontend)
// =============================================================================

// MCPPendingPlanReview represents a pending plan review for the frontend
type MCPPendingPlanReview struct {
	ID        string `json:"id"`
	AgentSlug string `json:"agentSlug"`
	CreatedAt string `json:"createdAt"`
}

// AcceptPlanReview accepts a pending MCP plan review
func (a *App) AcceptPlanReview(reviewID string) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	prm := a.mcpServer.GetPendingPlanReviews()
	if prm == nil {
		return fmt.Errorf("pending plan reviews manager not initialized")
	}
	return prm.Accept(reviewID)
}

// RejectPlanReview rejects a pending MCP plan review with optional feedback
func (a *App) RejectPlanReview(reviewID string, feedback string) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	prm := a.mcpServer.GetPendingPlanReviews()
	if prm == nil {
		return fmt.Errorf("pending plan reviews manager not initialized")
	}
	return prm.Reject(reviewID, feedback)
}

// SkipPlanReview skips a pending MCP plan review
func (a *App) SkipPlanReview(reviewID string) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP server not initialized")
	}
	prm := a.mcpServer.GetPendingPlanReviews()
	if prm == nil {
		return fmt.Errorf("pending plan reviews manager not initialized")
	}
	return prm.Skip(reviewID)
}
