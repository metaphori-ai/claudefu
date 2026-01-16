package mcpserver

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// InboxStore handles SQLite persistence for inbox messages
type InboxStore struct {
	db   *sql.DB
	path string
}

// NewInboxStore opens or creates a SQLite database at the given path
func NewInboxStore(dbPath string) (*InboxStore, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create inbox directory: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open inbox database: %w", err)
	}

	// Create schema
	if err := createSchema(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create schema: %w", err)
	}

	return &InboxStore{
		db:   db,
		path: dbPath,
	}, nil
}

func createSchema(db *sql.DB) error {
	schema := `
		CREATE TABLE IF NOT EXISTS messages (
			id TEXT PRIMARY KEY,
			from_agent_id TEXT,
			from_agent_name TEXT NOT NULL,
			to_agent_id TEXT NOT NULL,
			message TEXT NOT NULL,
			priority TEXT DEFAULT 'normal',
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			read INTEGER DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS idx_to_agent ON messages(to_agent_id);
		CREATE INDEX IF NOT EXISTS idx_unread ON messages(to_agent_id, read);
	`
	_, err := db.Exec(schema)
	return err
}

// Close closes the database connection
func (s *InboxStore) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// AddMessage inserts a new message into the database
func (s *InboxStore) AddMessage(msg InboxMessage) error {
	_, err := s.db.Exec(`
		INSERT INTO messages (id, from_agent_id, from_agent_name, to_agent_id, message, priority, timestamp, read)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, msg.ID, msg.FromAgentID, msg.FromAgentName, msg.ToAgentID, msg.Message, msg.Priority, msg.Timestamp.Unix(), boolToInt(msg.Read))
	return err
}

// GetMessages returns all messages for an agent, ordered by timestamp descending
func (s *InboxStore) GetMessages(agentID string) ([]InboxMessage, error) {
	rows, err := s.db.Query(`
		SELECT id, from_agent_id, from_agent_name, to_agent_id, message, priority, timestamp, read
		FROM messages
		WHERE to_agent_id = ?
		ORDER BY timestamp DESC
	`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []InboxMessage
	for rows.Next() {
		var msg InboxMessage
		var readInt int
		var timestampRaw any
		if err := rows.Scan(&msg.ID, &msg.FromAgentID, &msg.FromAgentName, &msg.ToAgentID, &msg.Message, &msg.Priority, &timestampRaw, &readInt); err != nil {
			return nil, err
		}
		msg.Read = readInt != 0
		msg.Timestamp = parseTimestamp(timestampRaw)
		messages = append(messages, msg)
	}

	if messages == nil {
		return []InboxMessage{}, nil
	}
	return messages, rows.Err()
}

// GetMessage returns a specific message by ID
func (s *InboxStore) GetMessage(agentID, messageID string) (*InboxMessage, error) {
	var msg InboxMessage
	var readInt int
	var timestampRaw any

	err := s.db.QueryRow(`
		SELECT id, from_agent_id, from_agent_name, to_agent_id, message, priority, timestamp, read
		FROM messages
		WHERE to_agent_id = ? AND id = ?
	`, agentID, messageID).Scan(&msg.ID, &msg.FromAgentID, &msg.FromAgentName, &msg.ToAgentID, &msg.Message, &msg.Priority, &timestampRaw, &readInt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	msg.Read = readInt != 0
	msg.Timestamp = parseTimestamp(timestampRaw)
	return &msg, nil
}

// MarkRead marks a specific message as read
func (s *InboxStore) MarkRead(agentID, messageID string) (bool, error) {
	result, err := s.db.Exec(`
		UPDATE messages SET read = 1 WHERE to_agent_id = ? AND id = ?
	`, agentID, messageID)
	if err != nil {
		return false, err
	}
	affected, _ := result.RowsAffected()
	return affected > 0, nil
}

// MarkAllRead marks all messages for an agent as read
func (s *InboxStore) MarkAllRead(agentID string) error {
	_, err := s.db.Exec(`UPDATE messages SET read = 1 WHERE to_agent_id = ?`, agentID)
	return err
}

// DeleteMessage removes a specific message
func (s *InboxStore) DeleteMessage(agentID, messageID string) (bool, error) {
	result, err := s.db.Exec(`DELETE FROM messages WHERE to_agent_id = ? AND id = ?`, agentID, messageID)
	if err != nil {
		return false, err
	}
	affected, _ := result.RowsAffected()
	return affected > 0, nil
}

// Clear removes all messages for an agent
func (s *InboxStore) Clear(agentID string) error {
	_, err := s.db.Exec(`DELETE FROM messages WHERE to_agent_id = ?`, agentID)
	return err
}

// ClearAll removes all messages (used on workspace switch if needed)
func (s *InboxStore) ClearAll() error {
	_, err := s.db.Exec(`DELETE FROM messages`)
	return err
}

// GetUnreadCount returns the number of unread messages for an agent
func (s *InboxStore) GetUnreadCount(agentID string) (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM messages WHERE to_agent_id = ? AND read = 0`, agentID).Scan(&count)
	return count, err
}

// GetTotalCount returns the total number of messages for an agent
func (s *InboxStore) GetTotalCount(agentID string) (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM messages WHERE to_agent_id = ?`, agentID).Scan(&count)
	return count, err
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// parseTimestamp converts stored Unix timestamp to time.Time
func parseTimestamp(raw any) time.Time {
	switch v := raw.(type) {
	case int64:
		return time.Unix(v, 0)
	case float64:
		return time.Unix(int64(v), 0)
	}
	return time.Now()
}
