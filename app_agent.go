package main

import (
	"fmt"

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
