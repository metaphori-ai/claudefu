package mcpserver

import (
	"log"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// BacklogManager manages backlog state with per-agent SQLite persistence.
// Each agent gets its own database at {configPath}/agents/{agent_id}.db.
type BacklogManager struct {
	stores     map[string]*BacklogStore // agentID → store
	configPath string                   // ~/.claudefu/backlog
	mu         sync.RWMutex
}

// NewBacklogManager creates a new backlog manager with the given config path
func NewBacklogManager(configPath string) *BacklogManager {
	return &BacklogManager{
		stores:     make(map[string]*BacklogStore),
		configPath: configPath,
	}
}

// LoadAgents opens per-agent SQLite databases for the given agent IDs.
// This replaces the old LoadWorkspace(workspaceID) — now we open one DB per agent.
func (bm *BacklogManager) LoadAgents(agentIDs []string) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	// Close all existing stores
	for id, store := range bm.stores {
		store.Close()
		delete(bm.stores, id)
	}

	// Open a store for each agent
	for _, agentID := range agentIDs {
		if agentID == "" {
			continue
		}
		dbPath := filepath.Join(bm.configPath, "agents", agentID+".db")
		store, err := NewBacklogStore(dbPath)
		if err != nil {
			log.Printf("Failed to open backlog DB for agent %s: %v", agentID, err)
			continue
		}
		bm.stores[agentID] = store
		log.Printf("Backlog loaded for agent %s", agentID)
	}

	return nil
}

// getStoreOrOpen returns the store for an agent, opening it if not already loaded.
// Caller must hold bm.mu.Lock() (write lock).
func (bm *BacklogManager) getStoreOrOpen(agentID string) *BacklogStore {
	if store, ok := bm.stores[agentID]; ok {
		return store
	}

	// Lazy open
	dbPath := filepath.Join(bm.configPath, "agents", agentID+".db")
	store, err := NewBacklogStore(dbPath)
	if err != nil {
		log.Printf("Failed to lazy-open backlog DB for agent %s: %v", agentID, err)
		return nil
	}
	bm.stores[agentID] = store
	log.Printf("Backlog lazy-loaded for agent %s", agentID)
	return store
}

// Close closes all SQLite databases
func (bm *BacklogManager) Close() error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	var lastErr error
	for id, store := range bm.stores {
		if err := store.Close(); err != nil {
			lastErr = err
		}
		delete(bm.stores, id)
	}
	return lastErr
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

	store := bm.getStoreOrOpen(agentID)

	// Calculate sort_order: max of siblings + 1000
	sortOrder := 1000
	if store != nil {
		maxOrder, err := store.GetMaxSortOrder(agentID, parentID)
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

	if store != nil {
		if err := store.AddItem(item); err != nil {
			log.Printf("Failed to save backlog item: %v", err)
		}
	}

	return item
}

// GetItem returns a single backlog item by ID.
// Since we don't know which agent owns it, we search all open stores.
func (bm *BacklogManager) GetItem(id string) *BacklogItem {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	for _, store := range bm.stores {
		item, err := store.GetItem(id)
		if err != nil {
			log.Printf("Failed to get backlog item: %v", err)
			continue
		}
		if item != nil {
			return item
		}
	}
	return nil
}

// UpdateItem updates an existing backlog item, returns true if found
func (bm *BacklogManager) UpdateItem(item BacklogItem) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	store := bm.getStoreOrOpen(item.AgentID)
	if store == nil {
		return false
	}

	item.UpdatedAt = time.Now().Unix()
	if err := store.UpdateItem(item); err != nil {
		log.Printf("Failed to update backlog item: %v", err)
		return false
	}
	return true
}

// DeleteItem removes a single backlog item (not children), returns true if removed
func (bm *BacklogManager) DeleteItem(id string) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	// Search all stores since we don't know the agent
	for _, store := range bm.stores {
		item, _ := store.GetItem(id)
		if item != nil {
			if err := store.DeleteItem(id); err != nil {
				log.Printf("Failed to delete backlog item: %v", err)
				return false
			}
			return true
		}
	}
	return false
}

// DeleteWithChildren removes an item and all its descendants
func (bm *BacklogManager) DeleteWithChildren(id string) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	// Search all stores since we don't know the agent
	for _, store := range bm.stores {
		item, _ := store.GetItem(id)
		if item != nil {
			if err := store.DeleteWithChildren(id); err != nil {
				log.Printf("Failed to delete backlog item with children: %v", err)
				return false
			}
			return true
		}
	}
	return false
}

// GetItemsByAgent returns all backlog items for a specific agent
func (bm *BacklogManager) GetItemsByAgent(agentID string) []BacklogItem {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	store := bm.getStoreOrOpen(agentID)
	if store == nil {
		return []BacklogItem{}
	}

	items, err := store.GetItemsByAgent(agentID)
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

	// Find the item across stores
	var store *BacklogStore
	var item *BacklogItem
	for _, s := range bm.stores {
		it, _ := s.GetItem(id)
		if it != nil {
			store = s
			item = it
			break
		}
	}
	if store == nil || item == nil {
		log.Printf("Failed to get item for move: not found")
		return false
	}

	agentID := item.AgentID

	// Get siblings in the target parent
	siblings, err := store.GetItemsByParent(agentID, newParentID)
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
			maxOrder, _ := store.GetMaxSortOrder(agentID, newParentID)
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
		if err := store.ReindexSortOrder(agentID, newParentID); err != nil {
			log.Printf("Failed to reindex sort order: %v", err)
			return false
		}
		// Retry with fresh ordering
		maxOrder, _ := store.GetMaxSortOrder(agentID, newParentID)
		newSortOrder = maxOrder + 1000
	}

	// Update the item
	item.ParentID = newParentID
	item.SortOrder = newSortOrder
	item.UpdatedAt = time.Now().Unix()
	if err := store.UpdateItem(*item); err != nil {
		log.Printf("Failed to update moved item: %v", err)
		return false
	}

	return true
}

// GetTotalCount returns the total number of backlog items for an agent
func (bm *BacklogManager) GetTotalCount(agentID string) int {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	store := bm.getStoreOrOpen(agentID)
	if store == nil {
		return 0
	}

	count, err := store.GetTotalCount(agentID)
	if err != nil {
		log.Printf("Failed to get total count: %v", err)
		return 0
	}
	return count
}

// GetNonDoneCount returns items for an agent that are not in "done" status
func (bm *BacklogManager) GetNonDoneCount(agentID string) int {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	store := bm.getStoreOrOpen(agentID)
	if store == nil {
		return 0
	}

	count, err := store.GetNonDoneCount(agentID)
	if err != nil {
		log.Printf("Failed to get non-done count: %v", err)
		return 0
	}
	return count
}

// GetOldWorkspaceDBPath returns the path to the old per-workspace backlog DB.
// Used by migration code to detect and migrate old databases.
func (bm *BacklogManager) GetOldWorkspaceDBPath(workspaceID string) string {
	return filepath.Join(bm.configPath, workspaceID+".db")
}

// GetConfigPath returns the base config path for backlog storage
func (bm *BacklogManager) GetConfigPath() string {
	return bm.configPath
}
