package mcpserver

import (
	"log"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// BacklogManager manages backlog state with SQLite persistence
type BacklogManager struct {
	store      *BacklogStore
	configPath string // ~/.claudefu/backlog
	mu         sync.RWMutex
}

// NewBacklogManager creates a new backlog manager with the given config path
func NewBacklogManager(configPath string) *BacklogManager {
	return &BacklogManager{
		configPath: configPath,
	}
}

// LoadWorkspace opens the SQLite database for the given workspace
func (bm *BacklogManager) LoadWorkspace(workspaceID string) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	// Close existing store if any
	if bm.store != nil {
		bm.store.Close()
		bm.store = nil
	}

	dbPath := filepath.Join(bm.configPath, workspaceID+".db")
	store, err := NewBacklogStore(dbPath)
	if err != nil {
		return err
	}

	bm.store = store
	log.Printf("Backlog loaded for workspace %s", workspaceID)
	return nil
}

// Close closes the SQLite database
func (bm *BacklogManager) Close() error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.store != nil {
		err := bm.store.Close()
		bm.store = nil
		return err
	}
	return nil
}

// AddItem creates a new backlog item with auto-generated UUID and sortOrder
func (bm *BacklogManager) AddItem(agentID, title, context, status, itemType, tags, createdBy, parentID string) BacklogItem {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if status == "" {
		status = "idea"
	}
	if itemType == "" {
		itemType = "feature_expansion"
	}

	now := time.Now().Unix()

	// Calculate sort_order: max of siblings + 1000
	sortOrder := 1000
	if bm.store != nil {
		maxOrder, err := bm.store.GetMaxSortOrder(agentID, parentID)
		if err != nil {
			log.Printf("Failed to get max sort order: %v", err)
		} else {
			sortOrder = maxOrder + 1000
		}
	}

	item := BacklogItem{
		ID:        uuid.New().String(),
		AgentID:   agentID,
		ParentID:  parentID,
		Title:     title,
		Context:   context,
		Status:    status,
		Type:      itemType,
		Tags:      tags,
		CreatedBy: createdBy,
		SortOrder: sortOrder,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if bm.store != nil {
		if err := bm.store.AddItem(item); err != nil {
			log.Printf("Failed to save backlog item: %v", err)
		}
	}

	return item
}

// GetItem returns a single backlog item by ID
func (bm *BacklogManager) GetItem(id string) *BacklogItem {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	if bm.store == nil {
		return nil
	}

	item, err := bm.store.GetItem(id)
	if err != nil {
		log.Printf("Failed to get backlog item: %v", err)
		return nil
	}
	return item
}

// UpdateItem updates an existing backlog item, returns true if found
func (bm *BacklogManager) UpdateItem(item BacklogItem) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.store == nil {
		return false
	}

	item.UpdatedAt = time.Now().Unix()
	if err := bm.store.UpdateItem(item); err != nil {
		log.Printf("Failed to update backlog item: %v", err)
		return false
	}
	return true
}

// DeleteItem removes a single backlog item (not children), returns true if removed
func (bm *BacklogManager) DeleteItem(id string) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.store == nil {
		return false
	}

	if err := bm.store.DeleteItem(id); err != nil {
		log.Printf("Failed to delete backlog item: %v", err)
		return false
	}
	return true
}

// DeleteWithChildren removes an item and all its descendants
func (bm *BacklogManager) DeleteWithChildren(id string) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.store == nil {
		return false
	}

	if err := bm.store.DeleteWithChildren(id); err != nil {
		log.Printf("Failed to delete backlog item with children: %v", err)
		return false
	}
	return true
}

// GetItemsByAgent returns all backlog items for a specific agent
func (bm *BacklogManager) GetItemsByAgent(agentID string) []BacklogItem {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	if bm.store == nil {
		return []BacklogItem{}
	}

	items, err := bm.store.GetItemsByAgent(agentID)
	if err != nil {
		log.Printf("Failed to get backlog items for agent %s: %v", agentID, err)
		return []BacklogItem{}
	}
	return items
}

// MoveItem handles reordering (within parent) and reparenting (to different parent)
// afterID is the item to place after (empty = first position)
func (bm *BacklogManager) MoveItem(id, newParentID, afterID string) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bm.store == nil {
		return false
	}

	item, err := bm.store.GetItem(id)
	if err != nil || item == nil {
		log.Printf("Failed to get item for move: %v", err)
		return false
	}

	agentID := item.AgentID

	// Get siblings in the target parent
	siblings, err := bm.store.GetItemsByParent(agentID, newParentID)
	if err != nil {
		log.Printf("Failed to get siblings for move: %v", err)
		return false
	}

	// Calculate new sort_order
	var newSortOrder int
	if afterID == "" {
		// Place first: half of first sibling's order, or 1000 if no siblings
		if len(siblings) > 0 && siblings[0].ID != id {
			newSortOrder = siblings[0].SortOrder / 2
		} else if len(siblings) > 1 && siblings[0].ID == id {
			newSortOrder = siblings[1].SortOrder / 2
		} else {
			newSortOrder = 1000
		}
	} else {
		// Place after afterID: midpoint between afterID and next sibling
		afterOrder := 0
		nextOrder := 0
		foundAfter := false
		for i, sib := range siblings {
			if sib.ID == id {
				continue // Skip the item being moved
			}
			if sib.ID == afterID {
				afterOrder = sib.SortOrder
				foundAfter = true
				// Find next sibling (skip the item being moved)
				for j := i + 1; j < len(siblings); j++ {
					if siblings[j].ID != id {
						nextOrder = siblings[j].SortOrder
						break
					}
				}
				break
			}
		}
		if !foundAfter {
			// afterID not found in siblings, place at end
			maxOrder, _ := bm.store.GetMaxSortOrder(agentID, newParentID)
			newSortOrder = maxOrder + 1000
		} else if nextOrder == 0 {
			// afterID is last, place after it
			newSortOrder = afterOrder + 1000
		} else {
			// Midpoint between after and next
			newSortOrder = (afterOrder + nextOrder) / 2
		}
	}

	// If gap is too small (< 2), reindex siblings first
	if newSortOrder <= 0 {
		if err := bm.store.ReindexSortOrder(agentID, newParentID); err != nil {
			log.Printf("Failed to reindex sort order: %v", err)
			return false
		}
		// Retry with fresh ordering
		maxOrder, _ := bm.store.GetMaxSortOrder(agentID, newParentID)
		newSortOrder = maxOrder + 1000
	}

	// Update the item
	item.ParentID = newParentID
	item.SortOrder = newSortOrder
	item.UpdatedAt = time.Now().Unix()
	if err := bm.store.UpdateItem(*item); err != nil {
		log.Printf("Failed to update moved item: %v", err)
		return false
	}

	return true
}

// GetTotalCount returns the total number of backlog items for an agent
func (bm *BacklogManager) GetTotalCount(agentID string) int {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	if bm.store == nil {
		return 0
	}

	count, err := bm.store.GetTotalCount(agentID)
	if err != nil {
		log.Printf("Failed to get total count: %v", err)
		return 0
	}
	return count
}

// GetNonDoneCount returns items for an agent that are not in "done" status
func (bm *BacklogManager) GetNonDoneCount(agentID string) int {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	if bm.store == nil {
		return 0
	}

	count, err := bm.store.GetNonDoneCount(agentID)
	if err != nil {
		log.Printf("Failed to get non-done count: %v", err)
		return 0
	}
	return count
}
