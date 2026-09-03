package oauthkeys

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Rotation log — ~/.claudefu/oauth-rotation-{hostname}.log
//
// Follows the env-vars-{hostname}.json precedent: the file lives in the synced
// config root so every machine's decisions are visible everywhere, but the
// hostname in the filename means exactly ONE writer per file — append-only
// with a single writer cannot produce a Syncthing conflict. Tokens are never
// written; labels, IDs (shortened), decisions, and raw 429 text only.

var hostnameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

func (m *Manager) logPath() string {
	host, _ := os.Hostname()
	if host == "" {
		host = "unknown"
	}
	return filepath.Join(m.configPath, "oauth-rotation-"+hostnameSanitizer.ReplaceAllString(host, "-")+".log")
}

// LogPath returns the absolute path of this machine's rotation log.
func (m *Manager) LogPath() string {
	return m.logPath()
}

// Log appends one UTC-timestamped line. Safe to call while holding m.mu
// (uses its own mutex). Failures are silent — logging must never break a send.
func (m *Manager) Log(format string, args ...any) {
	line := time.Now().UTC().Format(time.RFC3339) + "  " + fmt.Sprintf(format, args...) + "\n"
	m.logMu.Lock()
	defer m.logMu.Unlock()
	f, err := os.OpenFile(m.logPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	_, _ = f.WriteString(line)
	_ = f.Close()
}

// short returns the first 8 chars of an ID for log readability.
func short(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// describeLocked renders a key's label plus the state that drives selection.
func (m *Manager) describeLocked(k *OAuthKey, now time.Time) string {
	s := k.Label + "{weekly=" + WeekdayShort(k.WeeklyResetDay) + " " + k.WeeklyResetTime
	if st, ok := m.state[k.ID]; ok {
		if st.SessionLimitedUntil != nil && st.SessionLimitedUntil.After(now) {
			s += " S-until=" + st.SessionLimitedUntil.Format("Mon 15:04")
		}
		if st.WeeklyLimitedUntil != nil && st.WeeklyLimitedUntil.After(now) {
			s += " W-until=" + st.WeeklyLimitedUntil.Format("Mon 15:04")
		}
	}
	if !k.InRotation {
		s += " OUT"
	}
	return s + "}"
}

// WeekdayShort maps 0..6 → Sun..Sat.
func WeekdayShort(d int) string {
	names := []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
	if d >= 0 && d < 7 {
		return names[d]
	}
	return "?"
}
