// Package oauthkeys manages a pool of Claude Code OAuth tokens (one per
// subscription account) with automatic rotation on rate limits.
//
// Storage follows the established synced-config / machine-local-state split:
//   - ~/.claudefu/oauth-keys.json          — key list + rotation membership (synced)
//   - ~/.claudefu/local/oauth-key-state.json — per-key limit state (machine-local;
//     written on every 429, so it must never be a Syncthing surface)
//
// Selection doctrine (differs from ta-bench's round-robin): ClaudeFu is
// cache-greedy — a session sticks to one key until that key hits a limit, so
// the 1h prompt cache survives. Rotation happens only on 429. When picking a
// fresh key, sort by nearest weekly reset (use-it-or-lose-it: quota that
// refreshes Tuesday is perishable by Tuesday), then by nearest session reset.
package oauthkeys

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	// resetBuffer is added to every parsed reset clock so we never race the
	// actual reset (per user spec: +2 minutes).
	resetBuffer = 2 * time.Minute

	// unparseableCooldown is the conservative fallback when a limit message
	// carries no parseable reset clock. Self-heals: a retry after this window
	// either succeeds or re-records with a fresh (hopefully parseable) message.
	unparseableCooldown = 30 * time.Minute

	// DefaultAutoContinuePrompt is what gets sent to the rotated-to key so the
	// turn resumes — mirrors the user's long-standing manual practice.
	DefaultAutoContinuePrompt = "Anthropic api flapped, continue."
)

// Limit types recorded per key (decision #4: session and weekly are separate states).
const (
	LimitSession = "session"
	LimitWeekly  = "weekly"
	LimitModel   = "model" // model-tier limit (e.g. "Fable limit") — session-scoped block
)

// OAuthKey is one subscription account's long-lived OAuth token.
// WeeklyResetDay/Time are hand-set (machine-local wall clock), matching the
// ta-bench doctrine — weekly resets are known per account, not probed.
type OAuthKey struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Token           string `json:"token"`
	InRotation      bool   `json:"inRotation"`
	WeeklyResetDay  int    `json:"weeklyResetDay"`  // 0=Sunday .. 6=Saturday
	WeeklyResetTime string `json:"weeklyResetTime"` // "15:04" 24h, machine-local time
}

// Config is the synced file shape (~/.claudefu/oauth-keys.json).
type Config struct {
	Keys               []OAuthKey `json:"keys"`
	AutoContinuePrompt string     `json:"autoContinuePrompt"`
}

// KeyState is the machine-local runtime state for one key.
type KeyState struct {
	SessionLimitedUntil *time.Time `json:"sessionLimitedUntil,omitempty"`
	WeeklyLimitedUntil  *time.Time `json:"weeklyLimitedUntil,omitempty"`
	LastLimitType       string     `json:"lastLimitType,omitempty"`
	LastLimitAt         *time.Time `json:"lastLimitAt,omitempty"`
	LastUsedAt          *time.Time `json:"lastUsedAt,omitempty"`
}

// stickyEntry records which key a session is riding and whether the user
// pinned it. Pinned keys survive leaving rotation (explicit choice); auto
// picks are dropped once the key exits rotation.
type stickyEntry struct {
	keyID  string
	pinned bool
}

// Manager owns the key pool, limit state, and per-session stickiness.
type Manager struct {
	configPath string // ~/.claudefu

	mu     sync.RWMutex
	config Config
	state  map[string]*KeyState    // keyID → state
	sticky map[string]stickyEntry // sessionID → riding key (in-memory; cache-greedy stickiness)
}

// Send modes returned by ResolveForSend.
const (
	ModeNone   = "none"   // no pool participation — legacy env behavior
	ModeAuto   = "auto"   // pool-selected key, rotation on limit permitted
	ModePinned = "pinned" // user pinned a key — no auto-rotation on limit
)

// SpecAuto is the explicit-Auto spec sent by the key selector. Unlike ""
// (inherit — used by queued/answer/inject sends that must not change the
// session's riding key), SpecAuto demotes a pinned sticky back to a rotation
// candidate: same key keeps riding for cache continuity, but auto-rotation on
// 429 is re-enabled. Key IDs are UUIDs, so "auto" can never collide.
const SpecAuto = "auto"

func NewManager(configPath string) *Manager {
	m := &Manager{
		configPath: configPath,
		state:      make(map[string]*KeyState),
		sticky:     make(map[string]stickyEntry),
	}
	m.load()
	return m
}

func (m *Manager) configFile() string {
	return filepath.Join(m.configPath, "oauth-keys.json")
}

func (m *Manager) stateFile() string {
	return filepath.Join(m.configPath, "local", "oauth-key-state.json")
}

func (m *Manager) load() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if data, err := os.ReadFile(m.configFile()); err == nil {
		_ = json.Unmarshal(data, &m.config)
	}
	if m.config.AutoContinuePrompt == "" {
		m.config.AutoContinuePrompt = DefaultAutoContinuePrompt
	}
	if data, err := os.ReadFile(m.stateFile()); err == nil {
		_ = json.Unmarshal(data, &m.state)
	}
	if m.state == nil {
		m.state = make(map[string]*KeyState)
	}
}

// saveConfigLocked persists the synced key file. Tokens are secrets — 0600.
func (m *Manager) saveConfigLocked() error {
	data, err := json.MarshalIndent(m.config, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.configFile() + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, m.configFile())
}

func (m *Manager) saveStateLocked() error {
	if err := os.MkdirAll(filepath.Dir(m.stateFile()), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m.state, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.stateFile() + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, m.stateFile())
}

// =============================================================================
// CRUD
// =============================================================================

func (m *Manager) GetKeys() []OAuthKey {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]OAuthKey, len(m.config.Keys))
	copy(out, m.config.Keys)
	return out
}

func (m *Manager) GetKey(id string) *OAuthKey {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if k := m.findByIDLocked(id); k != nil {
		cp := *k
		return &cp
	}
	return nil
}

func (m *Manager) findByIDLocked(id string) *OAuthKey {
	for i := range m.config.Keys {
		if m.config.Keys[i].ID == id {
			return &m.config.Keys[i]
		}
	}
	return nil
}

func (m *Manager) AddKey(label, token string, weeklyResetDay int, weeklyResetTime string) (OAuthKey, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := OAuthKey{
		ID:              uuid.New().String(),
		Label:           strings.TrimSpace(label),
		Token:           strings.TrimSpace(token),
		InRotation:      true,
		WeeklyResetDay:  weeklyResetDay,
		WeeklyResetTime: weeklyResetTime,
	}
	if k.Label == "" {
		return OAuthKey{}, fmt.Errorf("label is required")
	}
	if k.WeeklyResetTime == "" {
		k.WeeklyResetTime = "00:00"
	}
	m.config.Keys = append(m.config.Keys, k)
	return k, m.saveConfigLocked()
}

// UpdateKey updates a key. An empty token means "keep the existing token"
// (paste-to-replace semantics — the UI never round-trips the full secret).
func (m *Manager) UpdateKey(id, label, token string, inRotation bool, weeklyResetDay int, weeklyResetTime string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := m.findByIDLocked(id)
	if k == nil {
		return fmt.Errorf("key not found: %s", id)
	}
	if strings.TrimSpace(label) != "" {
		k.Label = strings.TrimSpace(label)
	}
	if strings.TrimSpace(token) != "" {
		k.Token = strings.TrimSpace(token)
	}
	k.InRotation = inRotation
	k.WeeklyResetDay = weeklyResetDay
	if weeklyResetTime != "" {
		k.WeeklyResetTime = weeklyResetTime
	}
	return m.saveConfigLocked()
}

func (m *Manager) DeleteKey(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.config.Keys {
		if m.config.Keys[i].ID == id {
			m.config.Keys = append(m.config.Keys[:i], m.config.Keys[i+1:]...)
			delete(m.state, id)
			for sid, entry := range m.sticky {
				if entry.keyID == id {
					delete(m.sticky, sid)
				}
			}
			_ = m.saveStateLocked()
			return m.saveConfigLocked()
		}
	}
	return fmt.Errorf("key not found: %s", id)
}

func (m *Manager) GetAutoContinuePrompt() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.config.AutoContinuePrompt
}

func (m *Manager) SetAutoContinuePrompt(prompt string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if strings.TrimSpace(prompt) == "" {
		prompt = DefaultAutoContinuePrompt
	}
	m.config.AutoContinuePrompt = prompt
	return m.saveConfigLocked()
}

// =============================================================================
// LIMIT STATE
// =============================================================================

func (m *Manager) GetState(id string) KeyState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if st, ok := m.state[id]; ok {
		return *st
	}
	return KeyState{}
}

// RecordLimit marks a key limited until the given time. Weekly limits and
// session/model limits are tracked as separate states (decision #4: a weekly
// hit benches the key until its weekly reset, independent of session windows).
func (m *Manager) RecordLimit(id, limitType string, until time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, ok := m.state[id]
	if !ok {
		st = &KeyState{}
		m.state[id] = st
	}
	now := time.Now()
	if limitType == LimitWeekly {
		st.WeeklyLimitedUntil = &until
	} else {
		st.SessionLimitedUntil = &until
	}
	st.LastLimitType = limitType
	st.LastLimitAt = &now
	_ = m.saveStateLocked()
}

func (m *Manager) ClearLimits(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if st, ok := m.state[id]; ok {
		st.SessionLimitedUntil = nil
		st.WeeklyLimitedUntil = nil
		st.LastLimitType = ""
		_ = m.saveStateLocked()
	}
}

// ComputeLimitedUntil turns a parsed (or missing) reset clock into the
// not-before time for a key. resetAt nil falls back to the key's configured
// weekly reset (for weekly limits) or a conservative cooldown.
func (m *Manager) ComputeLimitedUntil(id, limitType string, resetAt *time.Time) time.Time {
	now := time.Now()
	if resetAt != nil {
		return resetAt.Add(resetBuffer)
	}
	if limitType == LimitWeekly {
		if k := m.GetKey(id); k != nil {
			return nextWeeklyOccurrence(k.WeeklyResetDay, k.WeeklyResetTime, now).Add(resetBuffer)
		}
	}
	return now.Add(unparseableCooldown)
}

// availableLocked: a key is usable when neither limit state is in the future.
func (m *Manager) availableLocked(id string, now time.Time) bool {
	st, ok := m.state[id]
	if !ok {
		return true
	}
	if st.SessionLimitedUntil != nil && now.Before(*st.SessionLimitedUntil) {
		return false
	}
	if st.WeeklyLimitedUntil != nil && now.Before(*st.WeeklyLimitedUntil) {
		return false
	}
	return true
}

// availableAtLocked returns when a currently-limited key frees up.
func (m *Manager) availableAtLocked(id string, now time.Time) time.Time {
	st, ok := m.state[id]
	if !ok {
		return now
	}
	at := now
	if st.SessionLimitedUntil != nil && st.SessionLimitedUntil.After(at) {
		at = *st.SessionLimitedUntil
	}
	if st.WeeklyLimitedUntil != nil && st.WeeklyLimitedUntil.After(at) {
		at = *st.WeeklyLimitedUntil
	}
	return at
}

func (m *Manager) markUsedLocked(id string) {
	st, ok := m.state[id]
	if !ok {
		st = &KeyState{}
		m.state[id] = st
	}
	now := time.Now()
	st.LastUsedAt = &now
	// Deliberately no saveState here — lastUsedAt is best-effort and persisted
	// alongside the next limit write to avoid a disk write per message.
}

// =============================================================================
// SELECTION
// =============================================================================

func (m *Manager) hasRotationLocked() bool {
	for i := range m.config.Keys {
		if m.config.Keys[i].InRotation {
			return true
		}
	}
	return false
}

// RotationSize returns the number of keys currently in rotation (used as the
// rotation-attempt cap so a misparse can never loop forever).
func (m *Manager) RotationSize() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	n := 0
	for i := range m.config.Keys {
		if m.config.Keys[i].InRotation {
			n++
		}
	}
	return n
}

// selectAutoLocked implements the sort: nearest weekly reset first
// (use-it-or-lose-it), then nearest known session reset; never-limited keys
// (no session data) sort last within the same weekly bucket.
func (m *Manager) selectAutoLocked(now time.Time) *OAuthKey {
	var cands []*OAuthKey
	for i := range m.config.Keys {
		k := &m.config.Keys[i]
		if k.InRotation && m.availableLocked(k.ID, now) {
			cands = append(cands, k)
		}
	}
	if len(cands) == 0 {
		// All limited: fall back to the key that frees up soonest and try it
		// anyway — our +2min buffer is conservative, and a stale limit
		// self-heals on the next 429.
		var best *OAuthKey
		var bestAt time.Time
		for i := range m.config.Keys {
			k := &m.config.Keys[i]
			if !k.InRotation {
				continue
			}
			at := m.availableAtLocked(k.ID, now)
			if best == nil || at.Before(bestAt) {
				best, bestAt = k, at
			}
		}
		return best
	}
	m.sortCandidatesLocked(cands, now)
	return cands[0]
}

// sortCandidatesLocked applies the canonical auto sort: nearest weekly reset
// first, then nearest known session reset (never-limited keys last).
func (m *Manager) sortCandidatesLocked(cands []*OAuthKey, now time.Time) {
	farFuture := now.Add(100 * 365 * 24 * time.Hour)
	sessionKey := func(k *OAuthKey) time.Time {
		if st, ok := m.state[k.ID]; ok && st.SessionLimitedUntil != nil {
			return *st.SessionLimitedUntil
		}
		return farFuture
	}
	sort.SliceStable(cands, func(a, b int) bool {
		wa := nextWeeklyOccurrence(cands[a].WeeklyResetDay, cands[a].WeeklyResetTime, now)
		wb := nextWeeklyOccurrence(cands[b].WeeklyResetDay, cands[b].WeeklyResetTime, now)
		if !wa.Equal(wb) {
			return wa.Before(wb)
		}
		return sessionKey(cands[a]).Before(sessionKey(cands[b]))
	})
}

// ResolveForSend resolves which token a send should use.
//
//	spec == ""       → Inherit: session's riding key (pinned or auto), else
//	                   auto-select. Used by queue/answer/inject sends.
//	spec == "auto"   → Explicit Auto: demote a pinned sticky to a rotation
//	                   candidate, then behave like inherit.
//	spec == keyID    → Pinned: always that key, even if marked limited (the
//	                   user's explicit choice wins); no auto-rotation on limit.
//
// ModeNone (no pool participation, legacy env behavior) is returned when no
// keys are in rotation and nothing is sticky/pinned.
func (m *Manager) ResolveForSend(sessionID, spec string) (keyID, token, mode string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()

	if spec == SpecAuto {
		if entry, ok := m.sticky[sessionID]; ok && entry.pinned {
			m.sticky[sessionID] = stickyEntry{keyID: entry.keyID, pinned: false}
		}
		spec = ""
	}

	if spec != "" {
		k := m.findByIDLocked(spec)
		if k == nil {
			return "", "", ModeNone
		}
		m.sticky[sessionID] = stickyEntry{keyID: k.ID, pinned: true}
		m.markUsedLocked(k.ID)
		return k.ID, k.Token, ModePinned
	}

	// Cache-greedy stickiness: keep riding the session's current key until it
	// is limited. A previously PINNED key is honored even out of rotation
	// (queued sends pass "" but must not silently switch accounts); an
	// auto-picked key is dropped once it leaves rotation.
	if entry, ok := m.sticky[sessionID]; ok {
		if k := m.findByIDLocked(entry.keyID); k != nil &&
			(entry.pinned || k.InRotation) && m.availableLocked(k.ID, now) {
			m.markUsedLocked(k.ID)
			mode := ModeAuto
			if entry.pinned {
				mode = ModePinned
			}
			return k.ID, k.Token, mode
		}
	}

	if !m.hasRotationLocked() {
		return "", "", ModeNone
	}

	k := m.selectAutoLocked(now)
	if k == nil {
		return "", "", ModeNone
	}
	m.sticky[sessionID] = stickyEntry{keyID: k.ID, pinned: false}
	m.markUsedLocked(k.ID)
	return k.ID, k.Token, ModeAuto
}

// SelectNextAfterLimit picks the next strictly-available key after the current
// one was just limited (its fresh limit state excludes it naturally).
// Returns ok=false when every rotation key is limited.
func (m *Manager) SelectNextAfterLimit(sessionID string) (keyID, token string, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()

	var cands []*OAuthKey
	for i := range m.config.Keys {
		k := &m.config.Keys[i]
		if k.InRotation && m.availableLocked(k.ID, now) {
			cands = append(cands, k)
		}
	}
	if len(cands) == 0 {
		return "", "", false
	}
	m.sortCandidatesLocked(cands, now)
	best := cands[0]
	m.sticky[sessionID] = stickyEntry{keyID: best.ID, pinned: false}
	m.markUsedLocked(best.ID)
	return best.ID, best.Token, true
}

// AllLimitedSummary renders the per-key reset table shown in the api-error
// dialog when every rotation key is limited.
func (m *Manager) AllLimitedSummary() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	now := time.Now()
	var b strings.Builder
	b.WriteString("All rotation keys are limited:\n")
	var soonest *OAuthKey
	var soonestAt time.Time
	for i := range m.config.Keys {
		k := &m.config.Keys[i]
		if !k.InRotation {
			continue
		}
		st := m.state[k.ID]
		parts := []string{}
		if st != nil && st.SessionLimitedUntil != nil && st.SessionLimitedUntil.After(now) {
			parts = append(parts, "session until "+st.SessionLimitedUntil.Format("Mon 3:04 PM"))
		}
		if st != nil && st.WeeklyLimitedUntil != nil && st.WeeklyLimitedUntil.After(now) {
			parts = append(parts, "weekly until "+st.WeeklyLimitedUntil.Format("Mon 3:04 PM"))
		}
		if len(parts) == 0 {
			parts = append(parts, "available")
		}
		b.WriteString("  " + k.Label + " — " + strings.Join(parts, " · ") + "\n")
		at := m.availableAtLocked(k.ID, now)
		if soonest == nil || at.Before(soonestAt) {
			soonest, soonestAt = k, at
		}
	}
	if soonest != nil {
		b.WriteString("Soonest available: " + soonest.Label + " at " + soonestAt.Format("Mon 3:04 PM"))
	}
	return b.String()
}

// =============================================================================
// LIMIT MESSAGE PARSING
// =============================================================================

// resetClockRe matches the CLI's limit result, e.g.:
//
//	"You've hit your session limit · resets 3:20pm (America/Los_Angeles)"
//	"You've hit your weekly limit · resets Tue 2:00am (America/Los_Angeles)"
var resetClockRe = regexp.MustCompile(`(?i)resets\s+(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*\(([^)]+)\))?`)

var limitPhraseRe = regexp.MustCompile(`(?i)(hit your [^.\n]{0,40}limit|usage limit reached|limit reached|reached your [^.\n]{0,40}limit)`)

var weekdayIndex = map[string]int{
	"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6,
}

// ParseLimitInfo inspects a parsed CLI error (status + result message) and
// returns whether it's a rate/usage limit, its type, and the reset clock if
// one was present in the message. resetAt is nil when unparseable.
func ParseLimitInfo(status int, result string) (limitType string, resetAt *time.Time, isLimit bool) {
	lower := strings.ToLower(result)
	isLimit = status == 429 || limitPhraseRe.MatchString(result)
	if !isLimit {
		return "", nil, false
	}

	switch {
	case strings.Contains(lower, "weekly"):
		limitType = LimitWeekly
	case strings.Contains(lower, "session"):
		limitType = LimitSession
	case strings.Contains(lower, "fable") || strings.Contains(lower, "opus") ||
		strings.Contains(lower, "sonnet") || strings.Contains(lower, "model"):
		limitType = LimitModel
	default:
		limitType = LimitSession
	}

	resetAt = parseResetClock(result, time.Now())
	return limitType, resetAt, true
}

// parseResetClock resolves "resets [Tue ]3:20pm (America/Los_Angeles)" to the
// NEXT occurrence of that wall-clock time in the given timezone. Handles the
// today-or-tomorrow ambiguity by always rolling forward past now.
func parseResetClock(result string, now time.Time) *time.Time {
	match := resetClockRe.FindStringSubmatch(result)
	if match == nil {
		return nil
	}
	dayStr, hourStr, minStr, ampm, tz := match[1], match[2], match[3], strings.ToLower(match[4]), match[5]

	loc := now.Location()
	if tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}

	hour := atoi(hourStr)
	min := atoi(minStr)
	if hour == 12 {
		hour = 0
	}
	if ampm == "pm" {
		hour += 12
	}

	nowLoc := now.In(loc)
	candidate := time.Date(nowLoc.Year(), nowLoc.Month(), nowLoc.Day(), hour, min, 0, 0, loc)

	if dayStr != "" {
		target := weekdayIndex[strings.ToLower(dayStr)]
		daysAhead := (target - int(candidate.Weekday()) + 7) % 7
		candidate = candidate.AddDate(0, 0, daysAhead)
		if !candidate.After(nowLoc) {
			candidate = candidate.AddDate(0, 0, 7)
		}
	} else if !candidate.After(nowLoc) {
		candidate = candidate.AddDate(0, 0, 1)
	}
	return &candidate
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// nextWeeklyOccurrence computes the next occurrence of (weekday, "HH:MM") in
// local time from now. Unparseable time strings sort far-future so keys with
// no configured weekly reset land last in the auto sort.
func nextWeeklyOccurrence(day int, hhmm string, now time.Time) time.Time {
	t, err := time.Parse("15:04", strings.TrimSpace(hhmm))
	if err != nil || day < 0 || day > 6 {
		return now.Add(100 * 365 * 24 * time.Hour)
	}
	candidate := time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
	daysAhead := (day - int(now.Weekday()) + 7) % 7
	candidate = candidate.AddDate(0, 0, daysAhead)
	if !candidate.After(now) {
		candidate = candidate.AddDate(0, 0, 7)
	}
	return candidate
}

// =============================================================================
// ENV VAR IMPORT
// =============================================================================

// weeklyLabelRe parses the user's env-var naming convention, e.g.
// "3_TA--Tu-2AM", "ALAN_1--SU-12PM": the suffix after "--" encodes the weekly
// reset as {Day}-{Hour}{AM|PM}.
var weeklyLabelRe = regexp.MustCompile(`(?i)--(su|m|tu|w|th|f|sa)-(\d{1,2})(am|pm)$`)

var shortDayIndex = map[string]int{
	"su": 0, "m": 1, "tu": 2, "w": 3, "th": 4, "f": 5, "sa": 6,
}

// ParseWeeklyFromLabel extracts (weekday, "HH:MM") from a reset-encoded label.
// Returns ok=false when the label doesn't follow the convention.
func ParseWeeklyFromLabel(label string) (day int, hhmm string, ok bool) {
	match := weeklyLabelRe.FindStringSubmatch(strings.TrimSpace(label))
	if match == nil {
		return 0, "", false
	}
	day = shortDayIndex[strings.ToLower(match[1])]
	hour := atoi(match[2])
	if hour == 12 {
		hour = 0
	}
	if strings.EqualFold(match[3], "pm") {
		hour += 12
	}
	return day, fmt.Sprintf("%02d:00", hour), true
}

// ImportFromEnvVars seeds the pool from existing env vars whose values look
// like Claude Code OAuth tokens (sk-ant-oat...). CLAUDE_CODE_OAUTH_TOKEN
// itself is skipped (it's the manually-rotated duplicate of a named key), and
// tokens already in the pool are deduped by value.
func (m *Manager) ImportFromEnvVars(envVars map[string]string) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing := make(map[string]bool)
	for i := range m.config.Keys {
		existing[m.config.Keys[i].Token] = true
	}

	// Deterministic import order: sort names so repeat imports are stable.
	names := make([]string, 0, len(envVars))
	for name := range envVars {
		names = append(names, name)
	}
	sort.Strings(names)

	imported := 0
	for _, name := range names {
		value := strings.TrimSpace(envVars[name])
		if name == "CLAUDE_CODE_OAUTH_TOKEN" {
			continue
		}
		if !strings.HasPrefix(value, "sk-ant-oat") {
			continue
		}
		if existing[value] {
			continue
		}
		day, hhmm, ok := ParseWeeklyFromLabel(name)
		if !ok {
			day, hhmm = 1, "00:00" // Monday midnight default; user adjusts in UI
		}
		m.config.Keys = append(m.config.Keys, OAuthKey{
			ID:              uuid.New().String(),
			Label:           name,
			Token:           value,
			InRotation:      true,
			WeeklyResetDay:  day,
			WeeklyResetTime: hhmm,
		})
		existing[value] = true
		imported++
	}
	if imported > 0 {
		_ = m.saveConfigLocked()
	}
	return imported
}
