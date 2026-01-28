package terminal

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

// TerminalInfo is the public metadata for a terminal session
type TerminalInfo struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Folder string `json:"folder"`
}

// Session represents a running PTY session
type Session struct {
	ID     string
	Label  string
	Folder string
	pty    *os.File
	cmd    *exec.Cmd
	cancel context.CancelFunc
}

// Manager manages multiple PTY sessions
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	emitFunc func(string, ...any)
	counter  int
}

// NewManager creates a new terminal manager
func NewManager(emitFunc func(string, ...any)) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		emitFunc: emitFunc,
	}
}

// Create spawns a new PTY session in the given folder
func (m *Manager) Create(folder string) (*TerminalInfo, error) {
	m.mu.Lock()
	m.counter++
	label := fmt.Sprintf("Terminal %d", m.counter)
	m.mu.Unlock()

	// Determine shell
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, shell, "-l")
	cmd.Dir = folder
	cmd.Env = os.Environ()

	// Start PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start pty: %w", err)
	}

	id := fmt.Sprintf("term-%d", m.counter)

	sess := &Session{
		ID:     id,
		Label:  label,
		Folder: folder,
		pty:    ptmx,
		cmd:    cmd,
		cancel: cancel,
	}

	m.mu.Lock()
	m.sessions[id] = sess
	m.mu.Unlock()

	// Start output reader goroutine
	go m.readOutput(sess, ctx)

	info := &TerminalInfo{
		ID:     id,
		Label:  label,
		Folder: folder,
	}
	return info, nil
}

// readOutput reads PTY output and emits it as base64-encoded events
func (m *Manager) readOutput(sess *Session, ctx context.Context) {
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, err := sess.pty.Read(buf)
		if n > 0 {
			encoded := base64.StdEncoding.EncodeToString(buf[:n])
			m.emitFunc("terminal:output", map[string]any{
				"id":   sess.ID,
				"data": encoded,
			})
		}
		if err != nil {
			if err != io.EOF {
				// Unexpected error
				_ = err
			}
			// Terminal exited
			m.emitFunc("terminal:exit", map[string]any{
				"id": sess.ID,
			})
			return
		}
	}
}

// Write sends data to a terminal's PTY stdin
func (m *Manager) Write(id string, data []byte) error {
	m.mu.RLock()
	sess, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %s not found", id)
	}
	_, err := sess.pty.Write(data)
	return err
}

// Resize changes the PTY window size
func (m *Manager) Resize(id string, cols, rows uint16) error {
	m.mu.RLock()
	sess, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %s not found", id)
	}
	return pty.Setsize(sess.pty, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
}

// Close terminates a terminal session
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("terminal %s not found", id)
	}
	delete(m.sessions, id)
	m.mu.Unlock()

	sess.cancel()
	sess.pty.Close()
	if sess.cmd.Process != nil {
		sess.cmd.Process.Kill()
	}
	return nil
}

// List returns metadata for all active terminals
func (m *Manager) List() []TerminalInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]TerminalInfo, 0, len(m.sessions))
	for _, sess := range m.sessions {
		list = append(list, TerminalInfo{
			ID:     sess.ID,
			Label:  sess.Label,
			Folder: sess.Folder,
		})
	}
	return list
}

// Shutdown closes all terminal sessions
func (m *Manager) Shutdown() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	for _, id := range ids {
		m.Close(id)
	}
}
