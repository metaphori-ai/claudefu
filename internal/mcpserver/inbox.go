package mcpserver

import (
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

// InboxManager manages inbox state for all agents with SQLite persistence
type InboxManager struct {
	store      *InboxStore
	configPath string // ~/.claudefu/inbox
	mu         sync.RWMutex
}

// NewInboxManager creates a new inbox manager with the given config path
func NewInboxManager(configPath string) *InboxManager {
	return &InboxManager{
		configPath: configPath,
	}
}

// LoadWorkspace opens the SQLite database for the given workspace
func (im *InboxManager) LoadWorkspace(workspaceID string) error {
	im.mu.Lock()
	defer im.mu.Unlock()

	// Close existing store if any
	if im.store != nil {
		im.store.Close()
		im.store = nil
	}

	dbPath := filepath.Join(im.configPath, workspaceID+".db")
	store, err := NewInboxStore(dbPath)
	if err != nil {
		return err
	}

	im.store = store
	log.Printf("Inbox loaded for workspace %s", workspaceID)
	return nil
}

// Close closes the SQLite database
func (im *InboxManager) Close() error {
	im.mu.Lock()
	defer im.mu.Unlock()

	if im.store != nil {
		err := im.store.Close()
		im.store = nil
		return err
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

	if im.store != nil {
		if err := im.store.AddMessage(msg); err != nil {
			log.Printf("Failed to save inbox message: %v", err)
		}
	}

	return msg
}

// GetMessages returns all messages for an agent
func (im *InboxManager) GetMessages(agentID string) []InboxMessage {
	im.mu.RLock()
	defer im.mu.RUnlock()

	if im.store == nil {
		return []InboxMessage{}
	}

	msgs, err := im.store.GetMessages(agentID)
	if err != nil {
		log.Printf("Failed to get inbox messages: %v", err)
		return []InboxMessage{}
	}
	return msgs
}

// GetUnreadCount returns the number of unread messages for an agent
func (im *InboxManager) GetUnreadCount(agentID string) int {
	im.mu.RLock()
	defer im.mu.RUnlock()

	if im.store == nil {
		return 0
	}

	count, err := im.store.GetUnreadCount(agentID)
	if err != nil {
		log.Printf("Failed to get unread count: %v", err)
		return 0
	}
	return count
}

// GetTotalCount returns the total number of messages for an agent
func (im *InboxManager) GetTotalCount(agentID string) int {
	im.mu.RLock()
	defer im.mu.RUnlock()

	if im.store == nil {
		return 0
	}

	count, err := im.store.GetTotalCount(agentID)
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

	if im.store == nil {
		return false
	}

	marked, err := im.store.MarkRead(agentID, messageID)
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

	if im.store == nil {
		return
	}

	if err := im.store.MarkAllRead(agentID); err != nil {
		log.Printf("Failed to mark all messages as read: %v", err)
	}
}

// DeleteMessage removes a specific message from an agent's inbox
func (im *InboxManager) DeleteMessage(agentID, messageID string) bool {
	im.mu.Lock()
	defer im.mu.Unlock()

	if im.store == nil {
		return false
	}

	deleted, err := im.store.DeleteMessage(agentID, messageID)
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

	if im.store == nil {
		return
	}

	if err := im.store.Clear(agentID); err != nil {
		log.Printf("Failed to clear agent inbox: %v", err)
	}
}

// ClearAll removes all messages for all agents (called on workspace switch)
func (im *InboxManager) ClearAll() {
	im.mu.Lock()
	defer im.mu.Unlock()

	if im.store == nil {
		return
	}

	if err := im.store.ClearAll(); err != nil {
		log.Printf("Failed to clear all inbox: %v", err)
	}
}

// GetMessage returns a specific message by ID
func (im *InboxManager) GetMessage(agentID, messageID string) *InboxMessage {
	im.mu.RLock()
	defer im.mu.RUnlock()

	if im.store == nil {
		return nil
	}

	msg, err := im.store.GetMessage(agentID, messageID)
	if err != nil {
		log.Printf("Failed to get message: %v", err)
		return nil
	}
	return msg
}
