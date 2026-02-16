package mcpserver

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// MigrateFromWorkspaceDB migrates backlog items from an old per-workspace DB
// to per-agent DBs. The oldToNew map remaps any reconciled agent IDs.
//
// Steps:
//  1. Open old workspace DB at {backlogPath}/{workspaceID}.db
//  2. Read all items, remap agent_id via oldToNew if needed
//  3. Insert into per-agent DBs at {backlogPath}/agents/{agent_id}.db
//  4. Rename old DB to {workspaceID}.db.migrated
//
// This is idempotent: if the old DB doesn't exist, nothing happens.
// If it's already been renamed to .migrated, nothing happens.
func MigrateFromWorkspaceDB(backlogPath, workspaceID string, oldToNew map[string]string) error {
	oldDBPath := filepath.Join(backlogPath, workspaceID+".db")

	// Check if old DB exists
	if _, err := os.Stat(oldDBPath); os.IsNotExist(err) {
		return nil // Nothing to migrate
	}

	log.Printf("Backlog migration: found old workspace DB at %s", oldDBPath)

	// Open old database
	oldDB, err := sql.Open("sqlite", oldDBPath)
	if err != nil {
		return fmt.Errorf("failed to open old backlog DB: %w", err)
	}
	defer oldDB.Close()

	// Read all items from old DB
	rows, err := oldDB.Query(`
		SELECT id, agent_id, parent_id, title, context, status, type, tags, created_by, sort_order, created_at, updated_at
		FROM backlog_items
	`)
	if err != nil {
		return fmt.Errorf("failed to query old backlog items: %w", err)
	}
	defer rows.Close()

	// Group items by (potentially remapped) agent ID
	itemsByAgent := make(map[string][]BacklogItem)
	var totalItems int

	for rows.Next() {
		var item BacklogItem
		if err := rows.Scan(
			&item.ID, &item.AgentID, &item.ParentID, &item.Title,
			&item.Context, &item.Status, &item.Type, &item.Tags,
			&item.CreatedBy, &item.SortOrder, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return fmt.Errorf("failed to scan backlog item: %w", err)
		}

		// Remap agent ID if it was reconciled
		if newID, ok := oldToNew[item.AgentID]; ok {
			item.AgentID = newID
		}

		itemsByAgent[item.AgentID] = append(itemsByAgent[item.AgentID], item)
		totalItems++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating old backlog items: %w", err)
	}

	if totalItems == 0 {
		log.Printf("Backlog migration: old DB is empty, renaming")
		return os.Rename(oldDBPath, oldDBPath+".migrated")
	}

	// Write items to per-agent DBs
	agentsDir := filepath.Join(backlogPath, "agents")
	for agentID, items := range itemsByAgent {
		agentDBPath := filepath.Join(agentsDir, agentID+".db")
		store, err := NewBacklogStore(agentDBPath)
		if err != nil {
			log.Printf("Backlog migration: failed to open agent DB %s: %v", agentID, err)
			continue
		}

		migrated := 0
		for _, item := range items {
			// Check if item already exists (idempotency)
			existing, _ := store.GetItem(item.ID)
			if existing != nil {
				continue
			}
			if err := store.AddItem(item); err != nil {
				log.Printf("Backlog migration: failed to insert item %s: %v", item.ID, err)
				continue
			}
			migrated++
		}

		store.Close()
		log.Printf("Backlog migration: migrated %d items to agent %s", migrated, agentID)
	}

	// Rename old DB to .migrated
	if err := os.Rename(oldDBPath, oldDBPath+".migrated"); err != nil {
		log.Printf("Backlog migration: failed to rename old DB: %v", err)
		// Non-fatal — items are already copied
	}

	log.Printf("Backlog migration complete: %d items across %d agents", totalItems, len(itemsByAgent))
	return nil
}
