package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"claudefu/internal/settings"
)

const (
	// Charm Hyper endpoints for Claude Pro/Max subscription auth
	HyperBaseURL       = "https://console.charm.land"
	DeviceAuthEndpoint = "/device/auth"
	TokenExchangeURL   = "/token/exchange"
	TokenIntrospectURL = "/token/introspect"
	LLMAPIURL          = "/api/v1/fantasy" // /{model}/stream or /{model}/generate
)

// DeviceAuthResponse from /device/auth
type DeviceAuthResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURL string `json:"verification_url"`
	ExpiresIn       int    `json:"expires_in"`
}

// HyperToken represents the OAuth token from Charm Hyper
type HyperToken struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	ExpiresAt    int64  `json:"expires_at"`
}

// HyperService handles Claude Pro/Max subscription authentication
type HyperService struct {
	settings   *settings.Manager
	httpClient *http.Client
}

// NewHyperService creates a new Hyper auth service
func NewHyperService(sm *settings.Manager) *HyperService {
	return &HyperService{
		settings: sm,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// StartDeviceAuth initiates the device authorization flow
// Returns the verification URL and user code for the user to complete auth
func (h *HyperService) StartDeviceAuth(ctx context.Context) (*DeviceAuthResponse, error) {
	url := HyperBaseURL + DeviceAuthEndpoint

	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to initiate device auth: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("device auth failed with status %d: %s", resp.StatusCode, string(body))
	}

	var authResp DeviceAuthResponse
	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &authResp, nil
}

// PollForToken polls the device auth endpoint until the user completes authentication
// or the device code expires
func (h *HyperService) PollForToken(ctx context.Context, deviceCode string, expiresIn int) (string, error) {
	url := HyperBaseURL + DeviceAuthEndpoint + "/" + deviceCode

	pollInterval := 5 * time.Second
	timeout := time.Duration(expiresIn) * time.Second
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(pollInterval):
		}

		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return "", fmt.Errorf("failed to create poll request: %w", err)
		}

		resp, err := h.httpClient.Do(req)
		if err != nil {
			continue // Network error, keep polling
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			// User completed auth, response contains refresh token
			var result struct {
				RefreshToken string `json:"refresh_token"`
			}
			if err := json.Unmarshal(body, &result); err == nil && result.RefreshToken != "" {
				return result.RefreshToken, nil
			}
		}

		// Status 202 = still pending, keep polling
		// Status 400/410 = expired or invalid
		if resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusGone {
			return "", fmt.Errorf("device code expired or invalid")
		}
	}

	return "", fmt.Errorf("authentication timed out")
}

// ExchangeToken exchanges a refresh token for an access token
func (h *HyperService) ExchangeToken(ctx context.Context, refreshToken string) (*HyperToken, error) {
	url := HyperBaseURL + TokenExchangeURL

	payload := map[string]string{
		"refresh_token": refreshToken,
	}
	jsonPayload, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonPayload))
	if err != nil {
		return nil, fmt.Errorf("failed to create exchange request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to exchange token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token exchange failed with status %d: %s", resp.StatusCode, string(body))
	}

	var token HyperToken
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("failed to decode token: %w", err)
	}

	// Calculate expires_at if not provided
	if token.ExpiresAt == 0 && token.ExpiresIn > 0 {
		token.ExpiresAt = time.Now().Unix() + int64(token.ExpiresIn)
	}

	return &token, nil
}

// IntrospectToken checks if a token is still valid
func (h *HyperService) IntrospectToken(ctx context.Context, accessToken string) (bool, error) {
	url := HyperBaseURL + TokenIntrospectURL

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", accessToken) // Raw token, not Bearer

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	resp.Body.Close()

	return resp.StatusCode == http.StatusOK, nil
}

// RefreshAccessToken refreshes an expired access token using the refresh token
func (h *HyperService) RefreshAccessToken(ctx context.Context) (*HyperToken, error) {
	auth := h.settings.GetAuth()
	if auth.Hyper == nil || auth.Hyper.RefreshToken == "" {
		return nil, fmt.Errorf("no refresh token available")
	}

	return h.ExchangeToken(ctx, auth.Hyper.RefreshToken)
}

// GetValidAccessToken returns a valid access token, refreshing if necessary
func (h *HyperService) GetValidAccessToken(ctx context.Context) (string, error) {
	auth := h.settings.GetAuth()
	if auth.Hyper == nil {
		return "", fmt.Errorf("not authenticated with Claude Pro/Max")
	}

	// Check if token is expired (with 5 minute buffer)
	if auth.Hyper.ExpiresAt > 0 && time.Now().Unix() > auth.Hyper.ExpiresAt-300 {
		// Token expired or expiring soon, refresh it
		newToken, err := h.RefreshAccessToken(ctx)
		if err != nil {
			return "", fmt.Errorf("failed to refresh token: %w", err)
		}

		// Save the new token
		auth.Hyper = &settings.HyperTokens{
			AccessToken:  newToken.AccessToken,
			RefreshToken: newToken.RefreshToken,
			ExpiresIn:    newToken.ExpiresIn,
			ExpiresAt:    newToken.ExpiresAt,
		}
		if err := h.settings.SaveAuth(auth); err != nil {
			return "", fmt.Errorf("failed to save refreshed token: %w", err)
		}

		return newToken.AccessToken, nil
	}

	return auth.Hyper.AccessToken, nil
}

// SaveTokens saves the Hyper tokens to settings
func (h *HyperService) SaveTokens(token *HyperToken) error {
	auth := h.settings.GetAuth()
	auth.Hyper = &settings.HyperTokens{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ExpiresIn:    token.ExpiresIn,
		ExpiresAt:    token.ExpiresAt,
	}
	auth.AuthMethod = "hyper"
	return h.settings.SaveAuth(auth)
}

// ClearTokens removes Hyper tokens
func (h *HyperService) ClearTokens() error {
	auth := h.settings.GetAuth()
	auth.Hyper = nil
	if auth.AuthMethod == "hyper" {
		auth.AuthMethod = "none"
	}
	return h.settings.SaveAuth(auth)
}

// GetAPIEndpoint returns the LLM API endpoint for a given model
func GetAPIEndpoint(model string, stream bool) string {
	suffix := "/generate"
	if stream {
		suffix = "/stream"
	}
	return HyperBaseURL + LLMAPIURL + "/" + model + suffix
}
