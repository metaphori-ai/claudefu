package mcpserver

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// PlanReviewAnswer represents the user's response to a plan review request
type PlanReviewAnswer struct {
	Accepted bool   `json:"accepted"`
	Feedback string `json:"feedback"` // Optional feedback on rejection
	Skipped  bool   `json:"skipped"`
}

// PendingPlanReview represents a plan review waiting for user response
type PendingPlanReview struct {
	ID         string               `json:"id"`
	AgentSlug  string               `json:"agentSlug"`
	ResponseCh chan *PlanReviewAnswer `json:"-"`
	CreatedAt  time.Time            `json:"createdAt"`
}

// PendingPlanReviewManager manages plan reviews waiting for user responses
type PendingPlanReviewManager struct {
	pending map[string]*PendingPlanReview
	mu      sync.RWMutex
	timeout time.Duration
}

// NewPendingPlanReviewManager creates a new manager with default 10 minute timeout
func NewPendingPlanReviewManager() *PendingPlanReviewManager {
	return &PendingPlanReviewManager{
		pending: make(map[string]*PendingPlanReview),
		timeout: 10 * time.Minute,
	}
}

// Create creates a new pending plan review and returns it
func (m *PendingPlanReviewManager) Create(agentSlug string) *PendingPlanReview {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := uuid.New().String()
	pr := &PendingPlanReview{
		ID:         id,
		AgentSlug:  agentSlug,
		ResponseCh: make(chan *PlanReviewAnswer, 1),
		CreatedAt:  time.Now(),
	}

	m.pending[id] = pr
	fmt.Printf("[MCP:ExitPlanMode] Created pending plan review %s from agent %s\n", id[:8], agentSlug)
	return pr
}

// Get retrieves a pending plan review by ID
func (m *PendingPlanReviewManager) Get(id string) *PendingPlanReview {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pending[id]
}

// GetAll returns all pending plan reviews
func (m *PendingPlanReviewManager) GetAll() []*PendingPlanReview {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*PendingPlanReview, 0, len(m.pending))
	for _, pr := range m.pending {
		result = append(result, pr)
	}
	return result
}

// Accept sends an acceptance to a pending plan review
func (m *PendingPlanReviewManager) Accept(id string) error {
	m.mu.Lock()
	pr, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("plan review %s not found", id)
	}
	delete(m.pending, id)
	m.mu.Unlock()

	select {
	case pr.ResponseCh <- &PlanReviewAnswer{Accepted: true}:
		fmt.Printf("[MCP:ExitPlanMode] Accepted plan review %s\n", id[:8])
	default:
		fmt.Printf("[MCP:ExitPlanMode] Warning: plan review %s response channel full\n", id[:8])
	}

	return nil
}

// Reject sends a rejection with feedback to a pending plan review
func (m *PendingPlanReviewManager) Reject(id string, feedback string) error {
	m.mu.Lock()
	pr, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("plan review %s not found", id)
	}
	delete(m.pending, id)
	m.mu.Unlock()

	select {
	case pr.ResponseCh <- &PlanReviewAnswer{Accepted: false, Feedback: feedback}:
		fmt.Printf("[MCP:ExitPlanMode] Rejected plan review %s\n", id[:8])
	default:
		fmt.Printf("[MCP:ExitPlanMode] Warning: plan review %s response channel full\n", id[:8])
	}

	return nil
}

// Skip sends a skip signal to a pending plan review
func (m *PendingPlanReviewManager) Skip(id string) error {
	m.mu.Lock()
	pr, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("plan review %s not found", id)
	}
	delete(m.pending, id)
	m.mu.Unlock()

	select {
	case pr.ResponseCh <- &PlanReviewAnswer{Skipped: true}:
		fmt.Printf("[MCP:ExitPlanMode] Skipped plan review %s\n", id[:8])
	default:
		fmt.Printf("[MCP:ExitPlanMode] Warning: plan review %s response channel full\n", id[:8])
	}

	return nil
}

// Cancel cancels a pending plan review
func (m *PendingPlanReviewManager) Cancel(id string) {
	m.mu.Lock()
	pr, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return
	}
	delete(m.pending, id)
	m.mu.Unlock()

	close(pr.ResponseCh)
	fmt.Printf("[MCP:ExitPlanMode] Cancelled plan review %s\n", id[:8])
}

// CancelAll cancels all pending plan reviews
func (m *PendingPlanReviewManager) CancelAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, pr := range m.pending {
		close(pr.ResponseCh)
		fmt.Printf("[MCP:ExitPlanMode] Cancelled plan review %s\n", id[:8])
	}
	m.pending = make(map[string]*PendingPlanReview)
}

// GetTimeout returns the configured timeout duration
func (m *PendingPlanReviewManager) GetTimeout() time.Duration {
	return m.timeout
}
