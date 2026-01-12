package auth

import (
	"context"
	"fmt"

	"claudefu/internal/settings"
)

// Service handles authentication operations
type Service struct {
	settings *settings.Manager
	hyper    *HyperService
}

// NewService creates a new auth service
func NewService(sm *settings.Manager) *Service {
	return &Service{
		settings: sm,
		hyper:    NewHyperService(sm),
	}
}

// GetAuthStatus returns the current authentication status
func (s *Service) GetAuthStatus() AuthStatus {
	auth := s.settings.GetAuth()

	// Check for Claude Code keychain credentials
	hasClaudeCode := IsClaudeCodeLoggedIn()
	var subscriptionType string
	if hasClaudeCode {
		if info, err := GetClaudeCodeSubscriptionInfo(); err == nil {
			subscriptionType = info.Type
		}
	}

	// Determine if authenticated (any method)
	isAuth := s.settings.IsAuthenticated() || hasClaudeCode

	// Determine active auth method
	authMethod := auth.AuthMethod
	if authMethod == "none" && hasClaudeCode {
		authMethod = "claude_code"
	}

	return AuthStatus{
		IsAuthenticated:        isAuth,
		AuthMethod:             authMethod,
		HasAPIKey:              auth.APIKey != "",
		HasHyper:               auth.Hyper != nil && auth.Hyper.AccessToken != "",
		HasClaudeCode:          hasClaudeCode,
		ClaudeCodeSubscription: subscriptionType,
	}
}

// AuthStatus represents current auth state
type AuthStatus struct {
	IsAuthenticated      bool   `json:"isAuthenticated"`
	AuthMethod           string `json:"authMethod"`
	HasAPIKey            bool   `json:"hasApiKey"`
	HasHyper             bool   `json:"hasHyper"`
	HasClaudeCode        bool   `json:"hasClaudeCode"`        // Claude Code keychain credentials
	ClaudeCodeSubscription string `json:"claudeCodeSubscription"` // "pro" or "max"
}

// ============================================================================
// API KEY METHODS
// ============================================================================

// SetAPIKey sets the Anthropic API key
func (s *Service) SetAPIKey(apiKey string) error {
	auth := s.settings.GetAuth()
	auth.APIKey = apiKey
	auth.AuthMethod = "api_key"
	return s.settings.SaveAuth(auth)
}

// GetAPIKey returns the stored API key (if any)
func (s *Service) GetAPIKey() string {
	return s.settings.GetAuth().APIKey
}

// ClearAPIKey removes the stored API key
func (s *Service) ClearAPIKey() error {
	auth := s.settings.GetAuth()
	auth.APIKey = ""
	if auth.AuthMethod == "api_key" {
		auth.AuthMethod = "none"
	}
	return s.settings.SaveAuth(auth)
}

// ============================================================================
// HYPER (CLAUDE PRO/MAX) METHODS
// ============================================================================

// DeviceAuthInfo contains info needed for user to complete device auth
type DeviceAuthInfo struct {
	DeviceCode      string `json:"deviceCode"`
	UserCode        string `json:"userCode"`
	VerificationURL string `json:"verificationUrl"`
	ExpiresIn       int    `json:"expiresIn"`
}

// StartHyperLogin initiates the Claude Pro/Max device auth flow
// Returns info for the user to complete authentication in browser
func (s *Service) StartHyperLogin(ctx context.Context) (*DeviceAuthInfo, error) {
	resp, err := s.hyper.StartDeviceAuth(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to start device auth: %w", err)
	}

	return &DeviceAuthInfo{
		DeviceCode:      resp.DeviceCode,
		UserCode:        resp.UserCode,
		VerificationURL: resp.VerificationURL,
		ExpiresIn:       resp.ExpiresIn,
	}, nil
}

// CompleteHyperLogin polls for auth completion and saves tokens
// This should be called after StartHyperLogin, passing the deviceCode
func (s *Service) CompleteHyperLogin(ctx context.Context, deviceCode string, expiresIn int) error {
	// Poll for refresh token
	refreshToken, err := s.hyper.PollForToken(ctx, deviceCode, expiresIn)
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	// Exchange for access token
	token, err := s.hyper.ExchangeToken(ctx, refreshToken)
	if err != nil {
		return fmt.Errorf("token exchange failed: %w", err)
	}

	// Save tokens
	if err := s.hyper.SaveTokens(token); err != nil {
		return fmt.Errorf("failed to save tokens: %w", err)
	}

	return nil
}

// GetHyperAccessToken returns a valid access token, refreshing if needed
func (s *Service) GetHyperAccessToken(ctx context.Context) (string, error) {
	return s.hyper.GetValidAccessToken(ctx)
}

// ClearHyper removes Hyper tokens
func (s *Service) ClearHyper() error {
	return s.hyper.ClearTokens()
}

// ============================================================================
// GENERAL METHODS
// ============================================================================

// Logout clears all authentication
func (s *Service) Logout() error {
	return s.settings.ClearAuth()
}

// GetActiveToken returns the active token based on auth method
// For API key: returns the API key
// For Hyper: returns the access token (refreshed if needed)
// For Claude Code: returns the access token from keychain
func (s *Service) GetActiveToken(ctx context.Context) (string, string, error) {
	auth := s.settings.GetAuth()

	switch auth.AuthMethod {
	case "api_key":
		if auth.APIKey == "" {
			return "", "", fmt.Errorf("no API key configured")
		}
		return auth.APIKey, "api_key", nil

	case "hyper":
		token, err := s.hyper.GetValidAccessToken(ctx)
		if err != nil {
			return "", "", err
		}
		return token, "hyper", nil

	case "claude_code":
		token, err := GetClaudeCodeAccessToken()
		if err != nil {
			return "", "", err
		}
		return token, "claude_code", nil

	default:
		// Check if Claude Code credentials are available as fallback
		if token, err := GetClaudeCodeAccessToken(); err == nil {
			return token, "claude_code", nil
		}
		return "", "", fmt.Errorf("not authenticated")
	}
}
