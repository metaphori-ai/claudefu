package auth

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const (
	// Claude Code's keychain entry name
	ClaudeCodeKeychainService = "Claude Code-credentials"
)

// ClaudeCodeCredentials represents the structure stored in macOS Keychain
type ClaudeCodeCredentials struct {
	ClaudeAiOauth *ClaudeAiOauth `json:"claudeAiOauth"`
}

// ClaudeAiOauth contains the OAuth tokens from Claude Code
type ClaudeAiOauth struct {
	AccessToken      string   `json:"accessToken"`      // sk-ant-oat01-...
	RefreshToken     string   `json:"refreshToken"`     // sk-ant-ort01-...
	ExpiresAt        int64    `json:"expiresAt"`        // Unix timestamp in milliseconds
	Scopes           []string `json:"scopes"`           // ["user:inference", "user:profile", ...]
	SubscriptionType string   `json:"subscriptionType"` // "pro" or "max"
	RateLimitTier    string   `json:"rateLimitTier"`    // "default_claude_max_20x"
}

// GetClaudeCodeCredentials reads Claude Code's OAuth tokens from macOS Keychain
// Returns nil if not found or not on macOS
func GetClaudeCodeCredentials() (*ClaudeCodeCredentials, error) {
	if runtime.GOOS != "darwin" {
		return nil, fmt.Errorf("keychain access only supported on macOS")
	}

	// Use security command to read from keychain
	cmd := exec.Command("security", "find-generic-password",
		"-s", ClaudeCodeKeychainService,
		"-w", // Output password only
	)

	output, err := cmd.Output()
	if err != nil {
		// Check if it's a "not found" error
		if exitErr, ok := err.(*exec.ExitError); ok {
			if exitErr.ExitCode() == 44 {
				return nil, fmt.Errorf("Claude Code credentials not found in keychain - run 'claude login' first")
			}
		}
		return nil, fmt.Errorf("failed to read keychain: %w", err)
	}

	// Parse JSON
	var creds ClaudeCodeCredentials
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(output))), &creds); err != nil {
		return nil, fmt.Errorf("failed to parse credentials: %w", err)
	}

	return &creds, nil
}

// IsClaudeCodeLoggedIn checks if Claude Code has valid credentials
func IsClaudeCodeLoggedIn() bool {
	creds, err := GetClaudeCodeCredentials()
	if err != nil {
		return false
	}
	return creds.ClaudeAiOauth != nil && creds.ClaudeAiOauth.AccessToken != ""
}

// GetClaudeCodeAccessToken returns the access token from Claude Code's keychain
// Returns error if not logged in or token expired
func GetClaudeCodeAccessToken() (string, error) {
	creds, err := GetClaudeCodeCredentials()
	if err != nil {
		return "", err
	}

	if creds.ClaudeAiOauth == nil {
		return "", fmt.Errorf("no OAuth credentials found")
	}

	// Check if token is expired (expiresAt is in milliseconds)
	if creds.ClaudeAiOauth.ExpiresAt > 0 {
		expiresAt := time.UnixMilli(creds.ClaudeAiOauth.ExpiresAt)
		if time.Now().After(expiresAt) {
			return "", fmt.Errorf("token expired - run 'claude login' to refresh")
		}
	}

	return creds.ClaudeAiOauth.AccessToken, nil
}

// GetClaudeCodeSubscriptionInfo returns subscription details
func GetClaudeCodeSubscriptionInfo() (*SubscriptionInfo, error) {
	creds, err := GetClaudeCodeCredentials()
	if err != nil {
		return nil, err
	}

	if creds.ClaudeAiOauth == nil {
		return nil, fmt.Errorf("no OAuth credentials found")
	}

	return &SubscriptionInfo{
		Type:          creds.ClaudeAiOauth.SubscriptionType,
		RateLimitTier: creds.ClaudeAiOauth.RateLimitTier,
		Scopes:        creds.ClaudeAiOauth.Scopes,
		ExpiresAt:     time.UnixMilli(creds.ClaudeAiOauth.ExpiresAt),
	}, nil
}

// SubscriptionInfo contains human-readable subscription details
type SubscriptionInfo struct {
	Type          string    // "pro" or "max"
	RateLimitTier string
	Scopes        []string
	ExpiresAt     time.Time
}

// String returns a formatted subscription info string
func (s *SubscriptionInfo) String() string {
	return fmt.Sprintf("Claude %s (expires %s)",
		strings.Title(s.Type),
		s.ExpiresAt.Format("Jan 2, 2006 3:04 PM"))
}
