package main

import (
	"claudefu/internal/proxy"
)

// =============================================================================
// PROXY METHODS (Bound to frontend)
// =============================================================================

// GetProxyStatus returns the current proxy status for the frontend
func (a *App) GetProxyStatus() proxy.Status {
	if a.proxy == nil {
		return proxy.Status{}
	}
	return a.proxy.GetStatus()
}

// GetProxyStats returns current proxy statistics
func (a *App) GetProxyStats() proxy.Stats {
	if a.proxy == nil {
		return proxy.Stats{}
	}
	return a.proxy.GetStats()
}
