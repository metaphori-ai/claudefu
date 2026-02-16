package mcpserver

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// BacklogItem represents a single backlog entry with hierarchical support
type BacklogItem struct {
	ID        string `json:"id"`
	AgentID   string `json:"agentId"`
	ParentID  string `json:"parentId,omitempty"`
	Title     string `json:"title"`
	Context   string `json:"context,omitempty"`
	Status    string `json:"status"`
	Tags      string `json:"tags,omitempty"`
	CreatedBy string `json:"createdBy,omitempty"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

// BacklogStore handles SQLite persistence for backlog items
type BacklogStore struct {
	db   *sql.DB
	path string
}

// NewBacklogStore opens or creates a SQLite database at the given path
func NewBacklogStore(dbPath string) (*BacklogStore, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create backlog directory: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open backlog database: %w", err)
	}

	if err := createBacklogSchema(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create backlog schema: %w", err)
	}

	return &BacklogStore{
		db:   db,
		path: dbPath,
	}, nil
}

func createBacklogSchema(db *sql.DB) error {
	schema := `
		CREATE TABLE IF NOT EXISTS backlog_items (
			id TEXT PRIMARY KEY,
			agent_id TEXT NOT NULL DEFAULT '',
			parent_id TEXT DEFAULT '',
			title TEXT NOT NULL,
			context TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'idea',
			tags TEXT DEFAULT '',
			created_by TEXT DEFAULT '',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_agent ON backlog_items(agent_id);
		CREATE INDEX IF NOT EXISTS idx_parent ON backlog_items(agent_id, parent_id);
		CREATE INDEX IF NOT EXISTS idx_status ON backlog_items(agent_id, status);
		CREATE INDEX IF NOT EXISTS idx_sort ON backlog_items(agent_id, parent_id, sort_order);
	`
	_, err := db.Exec(schema)
	return err
}

// Close closes the database connection
func (s *BacklogStore) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// AddItem inserts a new backlog item
func (s *BacklogStore) AddItem(item BacklogItem) error {
	_, err := s.db.Exec(`
		INSERT INTO backlog_items (id, agent_id, parent_id, title, context, status, tags, created_by, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, item.ID, item.AgentID, item.ParentID, item.Title, item.Context, item.Status, item.Tags, item.CreatedBy, item.SortOrder, item.CreatedAt, item.UpdatedAt)
	return err
}

// GetItem returns a single backlog item by ID, or nil if not found
func (s *BacklogStore) GetItem(id string) (*BacklogItem, error) {
	var item BacklogItem
	err := s.db.QueryRow(`
		SELECT id, agent_id, parent_id, title, context, status, tags, created_by, sort_order, created_at, updated_at
		FROM backlog_items
		WHERE id = ?
	`, id).Scan(&item.ID, &item.AgentID, &item.ParentID, &item.Title, &item.Context, &item.Status, &item.Tags, &item.CreatedBy, &item.SortOrder, &item.CreatedAt, &item.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// UpdateItem updates an existing backlog item
func (s *BacklogStore) UpdateItem(item BacklogItem) error {
	_, err := s.db.Exec(`
		UPDATE backlog_items
		SET agent_id = ?, parent_id = ?, title = ?, context = ?, status = ?, tags = ?, created_by = ?, sort_order = ?, updated_at = ?
		WHERE id = ?
	`, item.AgentID, item.ParentID, item.Title, item.Context, item.Status, item.Tags, item.CreatedBy, item.SortOrder, item.UpdatedAt, item.ID)
	return err
}

// DeleteItem removes a single backlog item (not its children)
func (s *BacklogStore) DeleteItem(id string) error {
	_, err := s.db.Exec(`DELETE FROM backlog_items WHERE id = ?`, id)
	return err
}

// GetItemsByAgent returns all backlog items for an agent, ordered by parent_id, sort_order
func (s *BacklogStore) GetItemsByAgent(agentID string) ([]BacklogItem, error) {
	rows, err := s.db.Query(`
		SELECT id, agent_id, parent_id, title, context, status, tags, created_by, sort_order, created_at, updated_at
		FROM backlog_items
		WHERE agent_id = ?
		ORDER BY parent_id, sort_order
	`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBacklogItems(rows)
}

// GetItemsByParent returns children of a given parent within an agent, ordered by sort_order
func (s *BacklogStore) GetItemsByParent(agentID, parentID string) ([]BacklogItem, error) {
	rows, err := s.db.Query(`
		SELECT id, agent_id, parent_id, title, context, status, tags, created_by, sort_order, created_at, updated_at
		FROM backlog_items
		WHERE agent_id = ? AND parent_id = ?
		ORDER BY sort_order
	`, agentID, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBacklogItems(rows)
}

// GetItemsByStatus returns items for an agent with a given status, ordered by sort_order
func (s *BacklogStore) GetItemsByStatus(agentID, status string) ([]BacklogItem, error) {
	rows, err := s.db.Query(`
		SELECT id, agent_id, parent_id, title, context, status, tags, created_by, sort_order, created_at, updated_at
		FROM backlog_items
		WHERE agent_id = ? AND status = ?
		ORDER BY parent_id, sort_order
	`, agentID, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBacklogItems(rows)
}

// DeleteWithChildren removes an item and all its descendants recursively
func (s *BacklogStore) DeleteWithChildren(id string) error {
	// Collect all descendant IDs via iterative BFS
	toDelete := []string{id}
	queue := []string{id}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		rows, err := s.db.Query(`SELECT id FROM backlog_items WHERE parent_id = ?`, current)
		if err != nil {
			return err
		}
		for rows.Next() {
			var childID string
			if err := rows.Scan(&childID); err != nil {
				rows.Close()
				return err
			}
			toDelete = append(toDelete, childID)
			queue = append(queue, childID)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}

	// Delete all collected IDs in a transaction
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, deleteID := range toDelete {
		if _, err := tx.Exec(`DELETE FROM backlog_items WHERE id = ?`, deleteID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetMaxSortOrder returns the highest sort_order among siblings of a parent within an agent
func (s *BacklogStore) GetMaxSortOrder(agentID, parentID string) (int, error) {
	var maxOrder sql.NullInt64
	err := s.db.QueryRow(`
		SELECT MAX(sort_order) FROM backlog_items WHERE agent_id = ? AND parent_id = ?
	`, agentID, parentID).Scan(&maxOrder)
	if err != nil {
		return 0, err
	}
	if !maxOrder.Valid {
		return 0, nil
	}
	return int(maxOrder.Int64), nil
}

// ReindexSortOrder reassigns sort_order values with 1000 gaps for an agent's parent's children
func (s *BacklogStore) ReindexSortOrder(agentID, parentID string) error {
	rows, err := s.db.Query(`
		SELECT id FROM backlog_items WHERE agent_id = ? AND parent_id = ? ORDER BY sort_order
	`, agentID, parentID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().Unix()
	for i, id := range ids {
		newOrder := (i + 1) * 1000
		if _, err := tx.Exec(`UPDATE backlog_items SET sort_order = ?, updated_at = ? WHERE id = ?`, newOrder, now, id); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetTotalCount returns the total number of backlog items for an agent
func (s *BacklogStore) GetTotalCount(agentID string) (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM backlog_items WHERE agent_id = ?`, agentID).Scan(&count)
	return count, err
}

// GetNonDoneCount returns items for an agent that are not in "done" status
func (s *BacklogStore) GetNonDoneCount(agentID string) (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM backlog_items WHERE agent_id = ? AND status != 'done'`, agentID).Scan(&count)
	return count, err
}

// scanBacklogItems scans rows into a BacklogItem slice, returning empty slice (not nil) when no rows
func scanBacklogItems(rows *sql.Rows) ([]BacklogItem, error) {
	var items []BacklogItem
	for rows.Next() {
		var item BacklogItem
		if err := rows.Scan(&item.ID, &item.AgentID, &item.ParentID, &item.Title, &item.Context, &item.Status, &item.Tags, &item.CreatedBy, &item.SortOrder, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if items == nil {
		return []BacklogItem{}, nil
	}
	return items, rows.Err()
}
