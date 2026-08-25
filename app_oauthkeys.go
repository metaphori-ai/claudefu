package main

import (
	"fmt"
	"strings"
	"time"

	"claudefu/internal/oauthkeys"
)

// =============================================================================
// OAUTH KEY POOL (Bound to frontend)
// =============================================================================

// OAuthKeyView is the frontend-safe projection of a pool key. The full token
// never round-trips to the UI — only a short preview; the token input is
// paste-to-replace (empty on update = keep existing).
type OAuthKeyView struct {
	ID                  string `json:"id"`
	Label               string `json:"label"`
	TokenPreview        string `json:"tokenPreview"`
	InRotation          bool   `json:"inRotation"`
	WeeklyResetDay      int    `json:"weeklyResetDay"`  // 0=Sunday .. 6=Saturday
	WeeklyResetTime     string `json:"weeklyResetTime"` // "15:04" machine-local
	SessionLimitedUntil string `json:"sessionLimitedUntil"` // RFC3339 or "" when free
	WeeklyLimitedUntil  string `json:"weeklyLimitedUntil"`  // RFC3339 or "" when free
	LastLimitType       string `json:"lastLimitType"`
	LastUsedAt          string `json:"lastUsedAt"`
	Available           bool   `json:"available"`
}

func tokenPreview(token string) string {
	t := strings.TrimPrefix(token, "sk-ant-oat01-")
	t = strings.TrimPrefix(t, "sk-ant-")
	if len(t) > 6 {
		t = t[:6]
	}
	if t == "" {
		return ""
	}
	return t + "… — paste to replace"
}

func (a *App) oauthKeyView(k oauthkeys.OAuthKey) OAuthKeyView {
	v := OAuthKeyView{
		ID:              k.ID,
		Label:           k.Label,
		TokenPreview:    tokenPreview(k.Token),
		InRotation:      k.InRotation,
		WeeklyResetDay:  k.WeeklyResetDay,
		WeeklyResetTime: k.WeeklyResetTime,
		Available:       true,
	}
	st := a.oauthKeys.GetState(k.ID)
	now := time.Now()
	if st.SessionLimitedUntil != nil && st.SessionLimitedUntil.After(now) {
		v.SessionLimitedUntil = st.SessionLimitedUntil.Format(time.RFC3339)
		v.Available = false
	}
	if st.WeeklyLimitedUntil != nil && st.WeeklyLimitedUntil.After(now) {
		v.WeeklyLimitedUntil = st.WeeklyLimitedUntil.Format(time.RFC3339)
		v.Available = false
	}
	v.LastLimitType = st.LastLimitType
	if st.LastUsedAt != nil {
		v.LastUsedAt = st.LastUsedAt.Format(time.RFC3339)
	}
	return v
}

// GetOAuthKeys returns all pool keys with masked tokens and limit state.
func (a *App) GetOAuthKeys() []OAuthKeyView {
	if a.oauthKeys == nil {
		return []OAuthKeyView{}
	}
	keys := a.oauthKeys.GetKeys()
	views := make([]OAuthKeyView, 0, len(keys))
	for _, k := range keys {
		views = append(views, a.oauthKeyView(k))
	}
	return views
}

// AddOAuthKey adds a key to the pool (in rotation by default).
func (a *App) AddOAuthKey(label, token string, weeklyResetDay int, weeklyResetTime string) (OAuthKeyView, error) {
	if a.oauthKeys == nil {
		return OAuthKeyView{}, fmt.Errorf("oauth key manager not initialized")
	}
	k, err := a.oauthKeys.AddKey(label, token, weeklyResetDay, weeklyResetTime)
	if err != nil {
		return OAuthKeyView{}, err
	}
	return a.oauthKeyView(k), nil
}

// UpdateOAuthKey updates a key. Empty token = keep existing (paste-to-replace).
func (a *App) UpdateOAuthKey(id, label, token string, inRotation bool, weeklyResetDay int, weeklyResetTime string) error {
	if a.oauthKeys == nil {
		return fmt.Errorf("oauth key manager not initialized")
	}
	return a.oauthKeys.UpdateKey(id, label, token, inRotation, weeklyResetDay, weeklyResetTime)
}

// DeleteOAuthKey removes a key from the pool entirely.
func (a *App) DeleteOAuthKey(id string) error {
	if a.oauthKeys == nil {
		return fmt.Errorf("oauth key manager not initialized")
	}
	return a.oauthKeys.DeleteKey(id)
}

// ClearOAuthKeyLimits manually clears a key's session/weekly limit state
// (e.g., after the user verifies the reset actually happened).
func (a *App) ClearOAuthKeyLimits(id string) error {
	if a.oauthKeys == nil {
		return fmt.Errorf("oauth key manager not initialized")
	}
	a.oauthKeys.ClearLimits(id)
	return nil
}

// GetOAuthAutoContinuePrompt returns the prompt sent to a rotated-to key.
func (a *App) GetOAuthAutoContinuePrompt() string {
	if a.oauthKeys == nil {
		return oauthkeys.DefaultAutoContinuePrompt
	}
	return a.oauthKeys.GetAutoContinuePrompt()
}

// SetOAuthAutoContinuePrompt updates the auto-continue prompt (empty = default).
func (a *App) SetOAuthAutoContinuePrompt(prompt string) error {
	if a.oauthKeys == nil {
		return fmt.Errorf("oauth key manager not initialized")
	}
	return a.oauthKeys.SetAutoContinuePrompt(prompt)
}

// ImportOAuthKeysFromEnv seeds the pool from this machine's LocalEnvVars —
// any env var whose value looks like a Claude Code OAuth token
// (sk-ant-oat...) becomes a pool key, with the weekly reset parsed from the
// user's naming convention (e.g. "3_TA--Tu-2AM" → Tuesday 02:00). Returns the
// number of keys imported (dedup by token value; CLAUDE_CODE_OAUTH_TOKEN
// itself is skipped as the manually-rotated duplicate).
func (a *App) ImportOAuthKeysFromEnv() (int, error) {
	if a.oauthKeys == nil {
		return 0, fmt.Errorf("oauth key manager not initialized")
	}
	if a.settings == nil {
		return 0, fmt.Errorf("settings manager not initialized")
	}
	lev := a.settings.GetLocalEnvVars()
	return a.oauthKeys.ImportFromEnvVars(lev.EnvVars), nil
}
