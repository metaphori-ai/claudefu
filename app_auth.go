package main

import (
	"fmt"

	wailsrt "github.com/wailsapp/wails/v2/pkg/runtime"

	"claudefu/internal/auth"
)

// =============================================================================
// AUTH METHODS (Bound to frontend)
// =============================================================================

// GetAuthStatus returns current authentication status
func (a *App) GetAuthStatus() auth.AuthStatus {
	if a.auth == nil {
		return auth.AuthStatus{}
	}
	return a.auth.GetAuthStatus()
}

// SetAPIKey sets the Anthropic API key for authentication
func (a *App) SetAPIKey(apiKey string) error {
	if a.auth == nil {
		return fmt.Errorf("auth service not initialized")
	}
	return a.auth.SetAPIKey(apiKey)
}

// ClearAPIKey removes the stored API key
func (a *App) ClearAPIKey() error {
	if a.auth == nil {
		return fmt.Errorf("auth service not initialized")
	}
	return a.auth.ClearAPIKey()
}

// StartHyperLogin initiates Claude Pro/Max device auth flow
func (a *App) StartHyperLogin() (*auth.DeviceAuthInfo, error) {
	if a.auth == nil {
		return nil, fmt.Errorf("auth service not initialized")
	}

	info, err := a.auth.StartHyperLogin(a.ctx)
	if err != nil {
		return nil, err
	}

	wailsrt.BrowserOpenURL(a.ctx, info.VerificationURL)
	return info, nil
}

// CompleteHyperLogin polls for auth completion
func (a *App) CompleteHyperLogin(deviceCode string, expiresIn int) error {
	if a.auth == nil {
		return fmt.Errorf("auth service not initialized")
	}
	return a.auth.CompleteHyperLogin(a.ctx, deviceCode, expiresIn)
}

// Logout clears all authentication data
func (a *App) Logout() error {
	if a.auth == nil {
		return fmt.Errorf("auth service not initialized")
	}
	return a.auth.Logout()
}
