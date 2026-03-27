package mcpserver

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// MigrateInboxFromWorkspaceDB migrates inbox messages from an old per-workspace DB
// to per-agent DBs. The oldToNew map remaps any reconciled agent IDs.
//
// Steps:
//  1. Open old workspace DB at {inboxPath}/{workspaceID}.db
//  2. Read all messages, remap to_agent_id and from_agent_id via oldToNew
//  3. Insert into per-agent DBs at {inboxPath}/agents/{agent_id}.db
//  4. Rename old DB to {workspaceID}.db.migrated
//
// This is idempotent: if the old DB doesn't exist, nothing happens.
// If it's already been renamed to .migrated, nothing happens.
func MigrateInboxFromWorkspaceDB(inboxPath, workspaceID string, oldToNew map[string]string) error {
	oldDBPath := filepath.Join(inboxPath, workspaceID+".db")

	// Check if old DB exists
	if _, err := os.Stat(oldDBPath); os.IsNotExist(err) {
		return nil // Nothing to migrate
	}

	log.Printf("Inbox migration: found old workspace DB at %s", oldDBPath)

	// Open old database
	oldDB, err := sql.Open("sqlite", oldDBPath)
	if err != nil {
		return fmt.Errorf("failed to open old inbox DB: %w", err)
	}
	defer oldDB.Close()

	// Read all messages from old DB
	rows, err := oldDB.Query(`
		SELECT id, from_agent_id, from_agent_name, to_agent_id, message, priority, timestamp, read
		FROM messages
	`)
	if err != nil {
		return fmt.Errorf("failed to query old inbox messages: %w", err)
	}
	defer rows.Close()

	// Group messages by (potentially remapped) to_agent_id
	msgsByAgent := make(map[string][]InboxMessage)
	var totalMsgs int

	for rows.Next() {
		var msg InboxMessage
		var readInt int
		var timestampRaw any
		if err := rows.Scan(
			&msg.ID, &msg.FromAgentID, &msg.FromAgentName, &msg.ToAgentID,
			&msg.Message, &msg.Priority, &timestampRaw, &readInt,
		); err != nil {
			return fmt.Errorf("failed to scan inbox message: %w", err)
		}
		msg.Read = readInt != 0
		msg.Timestamp = parseTimestamp(timestampRaw)

		// Remap agent IDs if reconciled
		if newID, ok := oldToNew[msg.ToAgentID]; ok {
			msg.ToAgentID = newID
		}
		if newID, ok := oldToNew[msg.FromAgentID]; ok {
			msg.FromAgentID = newID
		}

		msgsByAgent[msg.ToAgentID] = append(msgsByAgent[msg.ToAgentID], msg)
		totalMsgs++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating old inbox messages: %w", err)
	}

	if totalMsgs == 0 {
		log.Printf("Inbox migration: old DB is empty, renaming")
		return os.Rename(oldDBPath, oldDBPath+".migrated")
	}

	// Write messages to per-agent DBs
	agentsDir := filepath.Join(inboxPath, "agents")
	for agentID, msgs := range msgsByAgent {
		agentDBPath := filepath.Join(agentsDir, agentID+".db")
		store, err := NewInboxStore(agentDBPath)
		if err != nil {
			log.Printf("Inbox migration: failed to open agent DB %s: %v", agentID, err)
			continue
		}

		migrated := 0
		for _, msg := range msgs {
			// Check if message already exists (idempotency)
			existing, _ := store.GetMessage(msg.ToAgentID, msg.ID)
			if existing != nil {
				continue
			}
			if err := store.AddMessage(msg); err != nil {
				log.Printf("Inbox migration: failed to insert message %s: %v", msg.ID, err)
				continue
			}
			migrated++
		}

		store.Close()
		log.Printf("Inbox migration: migrated %d messages to agent %s", migrated, agentID)
	}

	// Rename old DB to .migrated
	if err := os.Rename(oldDBPath, oldDBPath+".migrated"); err != nil {
		log.Printf("Inbox migration: failed to rename old DB: %v", err)
		// Non-fatal — messages are already copied
	}

	log.Printf("Inbox migration complete: %d messages across %d agents", totalMsgs, len(msgsByAgent))
	return nil
}
