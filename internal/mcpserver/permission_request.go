package mcpserver

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// PermissionResponse represents the user's response to a permission request
type PermissionResponse struct {
	Granted    bool   `json:"granted"`
	Permanent  bool   `json:"permanent"`  // Add to allow list permanently
	DenyReason string `json:"denyReason"` // Optional reason if denied
}

// PendingPermissionRequest represents a permission request waiting for user response
type PendingPermissionRequest struct {
	ID         string                    `json:"id"`
	AgentSlug  string                    `json:"agentSlug"`  // Which agent is requesting
	Permission string                    `json:"permission"` // The permission being requested (e.g., "Bash(git push:*)")
	Reason     string                    `json:"reason"`     // Why the agent needs this permission
	ResponseCh chan *PermissionResponse  `json:"-"`          // Channel for response
	CreatedAt  time.Time                 `json:"createdAt"`
}

// PendingPermissionRequestManager manages permission requests waiting for user responses
type PendingPermissionRequestManager struct {
	pending map[string]*PendingPermissionRequest
	mu      sync.RWMutex
	timeout time.Duration
}

// NewPendingPermissionRequestManager creates a new manager with default 5 minute timeout
func NewPendingPermissionRequestManager() *PendingPermissionRequestManager {
	return &PendingPermissionRequestManager{
		pending: make(map[string]*PendingPermissionRequest),
		timeout: 5 * time.Minute,
	}
}

// Create creates a new pending permission request and returns it
func (m *PendingPermissionRequestManager) Create(agentSlug, permission, reason string) *PendingPermissionRequest {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := uuid.New().String()
	pr := &PendingPermissionRequest{
		ID:         id,
		AgentSlug:  agentSlug,
		Permission: permission,
		Reason:     reason,
		ResponseCh: make(chan *PermissionResponse, 1),
		CreatedAt:  time.Now(),
	}

	m.pending[id] = pr
	fmt.Printf("[MCP:PermissionRequest] Created pending request %s from agent %s for '%s'\n", id[:8], agentSlug, permission)
	return pr
}

// Get retrieves a pending permission request by ID
func (m *PendingPermissionRequestManager) Get(id string) *PendingPermissionRequest {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pending[id]
}

// GetAll returns all pending permission requests (for UI state recovery)
func (m *PendingPermissionRequestManager) GetAll() []*PendingPermissionRequest {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*PendingPermissionRequest, 0, len(m.pending))
	for _, pr := range m.pending {
		result = append(result, pr)
	}
	return result
}

// Respond sends a response to a pending permission request
func (m *PendingPermissionRequestManager) Respond(id string, granted, permanent bool, denyReason string) error {
	m.mu.Lock()
	pr, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("permission request %s not found", id)
	}
	delete(m.pending, id)
	m.mu.Unlock()

	// Send response (non-blocking with buffer)
	select {
	case pr.ResponseCh <- &PermissionResponse{Granted: granted, Permanent: permanent, DenyReason: denyReason}:
		fmt.Printf("[MCP:PermissionRequest] Responded to request %s: granted=%v, permanent=%v\n", id[:8], granted, permanent)
	default:
		fmt.Printf("[MCP:PermissionRequest] Warning: request %s response channel full\n", id[:8])
	}

	return nil
}

// Cancel cancels a pending permission request
func (m *PendingPermissionRequestManager) Cancel(id string) {
	m.mu.Lock()
	pr, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return
	}
	delete(m.pending, id)
	m.mu.Unlock()

	// Close the channel to unblock any waiting goroutine
	close(pr.ResponseCh)
	fmt.Printf("[MCP:PermissionRequest] Cancelled request %s\n", id[:8])
}

// CancelAll cancels all pending permission requests (e.g., on workspace switch)
func (m *PendingPermissionRequestManager) CancelAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, pr := range m.pending {
		close(pr.ResponseCh)
		fmt.Printf("[MCP:PermissionRequest] Cancelled request %s\n", id[:8])
	}
	m.pending = make(map[string]*PendingPermissionRequest)
}

// GetTimeout returns the configured timeout duration
func (m *PendingPermissionRequestManager) GetTimeout() time.Duration {
	return m.timeout
}
