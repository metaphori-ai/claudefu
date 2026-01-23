package main

import (
	"fmt"

	"claudefu/internal/permissions"
	"claudefu/internal/types"
	"claudefu/internal/workspace"
)

// =============================================================================
// AGENT METHODS (Bound to frontend)
// =============================================================================

// getAgentByID finds an agent by ID in the current workspace
func (a *App) getAgentByID(agentID string) *workspace.Agent {
	if a.currentWorkspace == nil {
		return nil
	}
	for i := range a.currentWorkspace.Agents {
		if a.currentWorkspace.Agents[i].ID == agentID {
			return &a.currentWorkspace.Agents[i]
		}
	}
	return nil
}

// AddAgent adds a new agent to the current workspace
func (a *App) AddAgent(name, folder string) (*workspace.Agent, error) {
	if a.currentWorkspace == nil {
		return nil, fmt.Errorf("no workspace loaded")
	}

	agent := workspace.Agent{
		ID:        workspace.GenerateAgentID(),
		Name:      name,
		Folder:    folder,
		WatchMode: types.WatchModeFile,
	}

	a.currentWorkspace.Agents = append(a.currentWorkspace.Agents, agent)

	if err := a.workspace.SaveWorkspace(a.currentWorkspace); err != nil {
		return nil, err
	}

	// Copy global ClaudeFu permissions to the new agent
	a.copyGlobalPermissionsToAgent(folder)

	// Also apply legacy default permission sets (writes to Claude's settings.local.json)
	// This maintains backward compatibility for users who also use Claude CLI directly
	a.applyDefaultPermissionSets(folder)

	// Start watching the new agent
	if a.watcher != nil && a.rt != nil {
		var lastViewedMap map[string]int64
		if a.sessions != nil {
			lastViewedMap = a.sessions.GetAllLastViewed(folder)
		}
		a.watcher.StartWatchingAgent(agent.ID, folder, lastViewedMap)
	}

	// Emit agent:added event
	if a.rt != nil {
		a.rt.Emit("agent:added", agent.ID, "", map[string]any{
			"agent": agent,
		})
	}

	return &agent, nil
}

// copyGlobalPermissionsToAgent copies global ClaudeFu permissions to a new agent's folder
// This creates {folder}/.claude/claudefu.permissions.json
func (a *App) copyGlobalPermissionsToAgent(folder string) {
	mgr, err := permissions.NewManager()
	if err != nil {
		fmt.Printf("Warning: failed to create permissions manager: %v\n", err)
		return
	}

	if err := mgr.CopyGlobalToAgent(folder); err != nil {
		fmt.Printf("Warning: failed to copy global permissions to agent: %v\n", err)
		return
	}

	fmt.Printf("Copied global permissions to %s/.claude/claudefu.permissions.json\n", folder)
}

// applyDefaultPermissionSets applies the user's default permission sets to a new agent
// LEGACY: This writes to Claude's settings.local.json for backward compatibility
func (a *App) applyDefaultPermissionSets(folder string) {
	// Get default permission sets from settings
	defaults := a.GetDefaultPermissionSets()
	if len(defaults) == 0 {
		return
	}

	// Get all built-in permission sets
	builtInSets := permissions.BuiltInSets()

	// Collect all permissions from enabled sets
	var allowList []string
	for setID, levelStr := range defaults {
		set, exists := builtInSets[setID]
		if !exists {
			continue
		}

		// Convert level string to RiskLevel
		var level permissions.RiskLevel
		switch levelStr {
		case "common":
			level = permissions.RiskCommon
		case "common+permissive":
			level = permissions.RiskPermissive
		case "all":
			level = permissions.RiskYOLO
		default:
			continue
		}

		// Get all permissions up to the specified level
		perms := set.GetAllPermissions(level)
		allowList = append(allowList, perms...)
	}

	if len(allowList) == 0 {
		return
	}

	// Get existing permissions (if any) to preserve them
	existing, _ := a.GetClaudePermissions(folder)

	// Merge with existing allow list (avoiding duplicates)
	seen := make(map[string]bool)
	var finalAllowList []string

	// Add existing permissions first
	for _, p := range existing.Allow {
		if !seen[p] {
			seen[p] = true
			finalAllowList = append(finalAllowList, p)
		}
	}

	// Add new permissions from defaults
	for _, p := range allowList {
		if !seen[p] {
			seen[p] = true
			finalAllowList = append(finalAllowList, p)
		}
	}

	// Save the merged permissions
	if err := a.SaveClaudePermissions(folder, finalAllowList, existing.Deny, existing.AdditionalDirectories); err != nil {
		// Log but don't fail - agent creation should still succeed
		fmt.Printf("Warning: failed to apply default permissions to %s: %v\n", folder, err)
	}
}

// RemoveAgent removes an agent from the current workspace
func (a *App) RemoveAgent(agentID string) error {
	if a.currentWorkspace == nil {
		return fmt.Errorf("no workspace loaded")
	}

	// Find and remove the agent
	var folder string
	for i, agent := range a.currentWorkspace.Agents {
		if agent.ID == agentID {
			folder = agent.Folder
			a.currentWorkspace.Agents = append(a.currentWorkspace.Agents[:i], a.currentWorkspace.Agents[i+1:]...)
			break
		}
	}

	if folder == "" {
		return fmt.Errorf("agent not found: %s", agentID)
	}

	if err := a.workspace.SaveWorkspace(a.currentWorkspace); err != nil {
		return err
	}

	// Stop watching the agent
	if a.watcher != nil {
		a.watcher.StopWatchingAgent(agentID, folder)
	}

	// Emit agent:removed event
	if a.rt != nil {
		a.rt.Emit("agent:removed", agentID, "", map[string]any{
			"agentId": agentID,
		})
	}

	return nil
}

// UpdateAgent updates an existing agent
func (a *App) UpdateAgent(agent workspace.Agent) error {
	if a.currentWorkspace == nil {
		return fmt.Errorf("no workspace loaded")
	}

	for i := range a.currentWorkspace.Agents {
		if a.currentWorkspace.Agents[i].ID == agent.ID {
			a.currentWorkspace.Agents[i] = agent
			return a.workspace.SaveWorkspace(a.currentWorkspace)
		}
	}

	return fmt.Errorf("agent not found: %s", agent.ID)
}

// GetAgent returns an agent by ID
func (a *App) GetAgent(agentID string) (*workspace.Agent, error) {
	agent := a.getAgentByID(agentID)
	if agent == nil {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}
	return agent, nil
}
