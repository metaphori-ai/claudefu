package mcpserver

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// UserAnswer represents the user's response to a question
type UserAnswer struct {
	Answers map[string]string `json:"answers"` // question -> answer
	Skipped bool              `json:"skipped"`
}

// PendingUserQuestion represents a question waiting for user response
type PendingUserQuestion struct {
	ID         string                   `json:"id"`
	AgentSlug  string                   `json:"agentSlug"`  // Which agent asked
	Questions  []map[string]any `json:"questions"`  // Raw questions from Claude
	ResponseCh chan *UserAnswer         `json:"-"`          // Channel for response
	CreatedAt  time.Time                `json:"createdAt"`
}

// PendingQuestionManager manages questions waiting for user responses
type PendingQuestionManager struct {
	pending map[string]*PendingUserQuestion
	mu      sync.RWMutex
	timeout time.Duration
}

// NewPendingQuestionManager creates a new manager with default 10 minute timeout
func NewPendingQuestionManager() *PendingQuestionManager {
	return &PendingQuestionManager{
		pending: make(map[string]*PendingUserQuestion),
		timeout: 10 * time.Minute,
	}
}

// Create creates a new pending question and returns its ID
func (m *PendingQuestionManager) Create(agentSlug string, questions []map[string]any) *PendingUserQuestion {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := uuid.New().String()
	pq := &PendingUserQuestion{
		ID:         id,
		AgentSlug:  agentSlug,
		Questions:  questions,
		ResponseCh: make(chan *UserAnswer, 1),
		CreatedAt:  time.Now(),
	}

	m.pending[id] = pq
	fmt.Printf("[MCP:AskUser] Created pending question %s from agent %s\n", id[:8], agentSlug)
	return pq
}

// Get retrieves a pending question by ID
func (m *PendingQuestionManager) Get(id string) *PendingUserQuestion {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pending[id]
}

// GetAll returns all pending questions (for UI state recovery)
func (m *PendingQuestionManager) GetAll() []*PendingUserQuestion {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*PendingUserQuestion, 0, len(m.pending))
	for _, pq := range m.pending {
		result = append(result, pq)
	}
	return result
}

// Answer sends an answer to a pending question
func (m *PendingQuestionManager) Answer(id string, answers map[string]string) error {
	m.mu.Lock()
	pq, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("question %s not found", id)
	}
	delete(m.pending, id)
	m.mu.Unlock()

	// Send answer (non-blocking with buffer)
	select {
	case pq.ResponseCh <- &UserAnswer{Answers: answers, Skipped: false}:
		fmt.Printf("[MCP:AskUser] Answered question %s\n", id[:8])
	default:
		fmt.Printf("[MCP:AskUser] Warning: question %s response channel full\n", id[:8])
	}

	return nil
}

// Skip sends a skip signal to a pending question
func (m *PendingQuestionManager) Skip(id string) error {
	m.mu.Lock()
	pq, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("question %s not found", id)
	}
	delete(m.pending, id)
	m.mu.Unlock()

	// Send skip (non-blocking with buffer)
	select {
	case pq.ResponseCh <- &UserAnswer{Skipped: true}:
		fmt.Printf("[MCP:AskUser] Skipped question %s\n", id[:8])
	default:
		fmt.Printf("[MCP:AskUser] Warning: question %s response channel full\n", id[:8])
	}

	return nil
}

// Cancel cancels a pending question (e.g., on navigation away)
func (m *PendingQuestionManager) Cancel(id string) {
	m.mu.Lock()
	pq, exists := m.pending[id]
	if !exists {
		m.mu.Unlock()
		return
	}
	delete(m.pending, id)
	m.mu.Unlock()

	// Close the channel to unblock any waiting goroutine
	close(pq.ResponseCh)
	fmt.Printf("[MCP:AskUser] Cancelled question %s\n", id[:8])
}

// CancelAll cancels all pending questions (e.g., on workspace switch)
func (m *PendingQuestionManager) CancelAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, pq := range m.pending {
		close(pq.ResponseCh)
		fmt.Printf("[MCP:AskUser] Cancelled question %s\n", id[:8])
	}
	m.pending = make(map[string]*PendingUserQuestion)
}

// GetTimeout returns the configured timeout duration
func (m *PendingQuestionManager) GetTimeout() time.Duration {
	return m.timeout
}
