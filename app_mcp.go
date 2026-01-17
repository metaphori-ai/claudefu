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
