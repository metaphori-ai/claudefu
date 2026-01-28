package main

import (
	"encoding/base64"
	"fmt"

	"claudefu/internal/terminal"
)

// CreateTerminal spawns a new PTY terminal in the given folder
func (a *App) CreateTerminal(folder string) (*terminal.TerminalInfo, error) {
	if a.terminalManager == nil {
		return nil, fmt.Errorf("terminal manager not initialized")
	}
	return a.terminalManager.Create(folder)
}

// WriteTerminal sends base64-encoded data to a terminal's PTY
func (a *App) WriteTerminal(id string, data string) error {
	if a.terminalManager == nil {
		return fmt.Errorf("terminal manager not initialized")
	}
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return fmt.Errorf("failed to decode data: %w", err)
	}
	return a.terminalManager.Write(id, decoded)
}

// ResizeTerminal changes the PTY window size
func (a *App) ResizeTerminal(id string, cols, rows int) error {
	if a.terminalManager == nil {
		return fmt.Errorf("terminal manager not initialized")
	}
	return a.terminalManager.Resize(id, uint16(cols), uint16(rows))
}

// CloseTerminal terminates a terminal session
func (a *App) CloseTerminal(id string) error {
	if a.terminalManager == nil {
		return fmt.Errorf("terminal manager not initialized")
	}
	return a.terminalManager.Close(id)
}

// GetTerminals returns metadata for all active terminals
func (a *App) GetTerminals() []terminal.TerminalInfo {
	if a.terminalManager == nil {
		return nil
	}
	return a.terminalManager.List()
}
