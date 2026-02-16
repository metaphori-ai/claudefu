package main

import (
	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"

	"claudefu/internal/mcpserver"
	"claudefu/internal/types"
)

// =============================================================================
// BACKLOG METHODS (Bound to frontend) — Per-agent backlog
// =============================================================================

// GetBacklogItems returns all backlog items for the given agent
func (a *App) GetBacklogItems(agentID string) []mcpserver.BacklogItem {
	if a.mcpServer == nil {
		return []mcpserver.BacklogItem{}
	}
	return a.mcpServer.GetBacklog().GetItemsByAgent(agentID)
}

// GetBacklogItem returns a single backlog item by ID
func (a *App) GetBacklogItem(id string) *mcpserver.BacklogItem {
	if a.mcpServer == nil {
		return nil
	}
	return a.mcpServer.GetBacklog().GetItem(id)
}

// AddBacklogItem creates a new backlog item for the given agent and emits a change event
func (a *App) AddBacklogItem(agentID, title, context, status, tags, parentID string) *mcpserver.BacklogItem {
	if a.mcpServer == nil {
		return nil
	}
	item := a.mcpServer.GetBacklog().AddItem(agentID, title, context, status, tags, "user", parentID)
	a.emitBacklogChanged(agentID)
	return &item
}

// UpdateBacklogItem updates an existing backlog item and emits a change event
func (a *App) UpdateBacklogItem(item mcpserver.BacklogItem) bool {
	if a.mcpServer == nil {
		return false
	}
	ok := a.mcpServer.GetBacklog().UpdateItem(item)
	if ok {
		a.emitBacklogChanged(item.AgentID)
	}
	return ok
}

// DeleteBacklogItem removes a backlog item and all its children, emits a change event
func (a *App) DeleteBacklogItem(agentID, id string) bool {
	if a.mcpServer == nil {
		return false
	}
	ok := a.mcpServer.GetBacklog().DeleteWithChildren(id)
	if ok {
		a.emitBacklogChanged(agentID)
	}
	return ok
}

// MoveBacklogItem reorders or reparents a backlog item, emits a change event
func (a *App) MoveBacklogItem(agentID, id, newParentID, afterID string) bool {
	if a.mcpServer == nil {
		return false
	}
	ok := a.mcpServer.GetBacklog().MoveItem(id, newParentID, afterID)
	if ok {
		a.emitBacklogChanged(agentID)
	}
	return ok
}

// GetBacklogCount returns the number of non-done backlog items for an agent (for badge)
func (a *App) GetBacklogCount(agentID string) int {
	if a.mcpServer == nil {
		return 0
	}
	return a.mcpServer.GetBacklog().GetNonDoneCount(agentID)
}

// emitBacklogChanged emits a backlog:changed event with counts for a specific agent
func (a *App) emitBacklogChanged(agentID string) {
	if a.mcpServer == nil {
		return
	}
	wailsrt.EventsEmit(a.ctx, "backlog:changed", types.EventEnvelope{
		AgentID:   agentID,
		EventType: "backlog:changed",
		Payload: map[string]any{
			"totalCount":   a.mcpServer.GetBacklog().GetTotalCount(agentID),
			"nonDoneCount": a.mcpServer.GetBacklog().GetNonDoneCount(agentID),
		},
	})
}
