package mcpserver

import (
	"fmt"
	"log"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// InboxMessage represents a message sent to an agent's inbox
type InboxMessage struct {
	ID            string    `json:"id"`
	FromAgentID   string    `json:"fromAgentId,omitempty"` // May be empty if from unknown/external
	FromAgentName string    `json:"fromAgentName"`         // Display name or slug
	ToAgentID     string    `json:"toAgentId"`
	Message       string    `json:"message"`
	Priority      string    `json:"priority"` // "normal" or "high"
	Timestamp     time.Time `json:"timestamp"`
	Read          bool      `json:"read"`
}

// InboxManager manages inbox state with per-agent SQLite persistence.
// Each agent gets its own database at {configPath}/agents/{agent_id}.db.
type InboxManager struct {
	stores     map[string]*InboxStore // agentID → store
	configPath string                 // ~/.claudefu/inbox
	mu         sync.RWMutex
}

// NewInboxManager creates a new inbox manager with the given config path
func NewInboxManager(configPath string) *InboxManager {
	return &InboxManager{
		stores:     make(map[string]*InboxStore),
		configPath: configPath,
	}
}

// LoadAgents opens per-agent SQLite databases for the given agent IDs.
func (im *InboxManager) LoadAgents(agentIDs []string) error {
	im.mu.Lock()
	defer im.mu.Unlock()

	// Close all existing stores
	for id, store := range im.stores {
		store.Close()
		delete(im.stores, id)
	}

	// Open a store for each agent
	for _, agentID := range agentIDs {
		if agentID == "" {
			continue
		}
		dbPath := filepath.Join(im.configPath, "agents", agentID+".db")
		store, err := NewInboxStore(dbPath)
		if err != nil {
			log.Printf("Failed to open inbox DB for agent %s: %v", agentID, err)
			continue
		}
		im.stores[agentID] = store
	}

	return nil
}

// getStoreOrOpen returns the store for an agent, opening it if not already loaded.
// Caller must hold im.mu.Lock() (write lock).
func (im *InboxManager) getStoreOrOpen(agentID string) *InboxStore {
	if store, ok := im.stores[agentID]; ok {
		return store
	}

	// Lazy open
	dbPath := filepath.Join(im.configPath, "agents", agentID+".db")
	store, err := NewInboxStore(dbPath)
	if err != nil {
		log.Printf("Failed to lazy-open inbox DB for agent %s: %v", agentID, err)
		return nil
	}
	im.stores[agentID] = store
	return store
}

// Close closes all SQLite databases
func (im *InboxManager) Close() error {
	im.mu.Lock()
	defer im.mu.Unlock()

	for id, store := range im.stores {
		store.Close()
		delete(im.stores, id)
	}
	return nil
}

// AddMessage adds a message to an agent's inbox
func (im *InboxManager) AddMessage(toAgentID string, fromAgentID, fromAgentName, message, priority string) InboxMessage {
	im.mu.Lock()
	defer im.mu.Unlock()

	if priority == "" {
		priority = "normal"
	}

	msg := InboxMessage{
		ID:            uuid.New().String(),
		FromAgentID:   fromAgentID,
		FromAgentName: fromAgentName,
		ToAgentID:     toAgentID,
		Message:       message,
		Priority:      priority,
		Timestamp:     time.Now(),
		Read:          false,
	}

	store := im.getStoreOrOpen(toAgentID)
	if store != nil {
		if err := store.AddMessage(msg); err != nil {
			fmt.Printf("[MCP:Inbox] FAILED to persist message %s to agent %s: %v\n", msg.ID, toAgentID, err)
		} else {
			fmt.Printf("[MCP:Inbox] Persisted message %s from '%s' to agent %s\n", msg.ID, fromAgentName, toAgentID)
		}
	} else {
		fmt.Printf("[MCP:Inbox] WARNING: Could not open store for agent %s, message %s NOT persisted\n", toAgentID, msg.ID)
	}

	return msg
}

// GetMessages returns all messages for an agent
func (im *InboxManager) GetMessages(agentID string) []InboxMessage {
	im.mu.Lock()
	defer im.mu.Unlock()

	store := im.getStoreOrOpen(agentID)
	if store == nil {
		return []InboxMessage{}
	}

	msgs, err := store.GetMessages(agentID)
	if err != nil {
		fmt.Printf("[MCP:Inbox] FAILED to get messages for agent %s: %v\n", agentID, err)
		return []InboxMessage{}
	}
	return msgs
}

// GetUnreadCount returns the number of unread messages for an agent
func (im *InboxManager) GetUnreadCount(agentID string) int {
	im.mu.Lock()
	defer im.mu.Unlock()

	store := im.getStoreOrOpen(agentID)
	if store == nil {
		return 0
	}

	count, err := store.GetUnreadCount(agentID)
	if err != nil {
		log.Printf("Failed to get unread count: %v", err)
		return 0
	}
	return count
}

// GetTotalCount returns the total number of messages for an agent
func (im *InboxManager) GetTotalCount(agentID string) int {
	im.mu.Lock()
	defer im.mu.Unlock()

	store := im.getStoreOrOpen(agentID)
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

// MarkRead marks a specific message as read
func (im *InboxManager) MarkRead(agentID, messageID string) bool {
	im.mu.Lock()
	defer im.mu.Unlock()

	store := im.getStoreOrOpen(agentID)
	if store == nil {
		return false
	}

	marked, err := store.MarkRead(agentID, messageID)
	if err != nil {
		log.Printf("Failed to mark message as read: %v", err)
		return false
	}
	return marked
}

// MarkAllRead marks all messages for an agent as read
func (im *InboxManager) MarkAllRead(agentID string) {
	im.mu.Lock()
	defer im.mu.Unlock()

	store := im.getStoreOrOpen(agentID)
	if store == nil {
		return
	}

	if err := store.MarkAllRead(agentID); err != nil {
		log.Printf("Failed to mark all messages as read: %v", err)
	}
}

// DeleteMessage removes a specific message from an agent's inbox
func (im *InboxManager) DeleteMessage(agentID, messageID string) bool {
	im.mu.Lock()
	defer im.mu.Unlock()

	store := im.getStoreOrOpen(agentID)
	if store == nil {
		return false
	}

	deleted, err := store.DeleteMessage(agentID, messageID)
	if err != nil {
		log.Printf("Failed to delete message: %v", err)
		return false
	}
	return deleted
}

// Clear removes all messages for an agent
func (im *InboxManager) Clear(agentID string) {
	im.mu.Lock()
	defer im.mu.Unlock()

	store := im.getStoreOrOpen(agentID)
	if store == nil {
		return
	}

	if err := store.Clear(agentID); err != nil {
		log.Printf("Failed to clear agent inbox: %v", err)
	}
}

// ClearAll removes all messages for all loaded agents
func (im *InboxManager) ClearAll() {
	im.mu.Lock()
	defer im.mu.Unlock()

	for _, store := range im.stores {
		if err := store.ClearAll(); err != nil {
			log.Printf("Failed to clear inbox store: %v", err)
		}
	}
}

// GetMessage returns a specific message by ID
func (im *InboxManager) GetMessage(agentID, messageID string) *InboxMessage {
	im.mu.Lock()
	defer im.mu.Unlock()

	store := im.getStoreOrOpen(agentID)
	if store == nil {
		return nil
	}

	msg, err := store.GetMessage(agentID, messageID)
	if err != nil {
		log.Printf("Failed to get message: %v", err)
		return nil
	}
	return msg
}
