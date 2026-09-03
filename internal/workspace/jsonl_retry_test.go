package workspace

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeTestSession creates a session JSONL under a temp HOME and returns the folder.
func writeTestSession(t *testing.T, sessionID string, lines []string) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	folder := "/Users/test/project"
	dir := filepath.Join(home, ".claude", "projects", encodeProjectPath(folder))
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	content := ""
	for _, l := range lines {
		content += l + "\n"
	}
	if err := os.WriteFile(filepath.Join(dir, sessionID+".jsonl"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return folder
}

func TestFindLastUserMessage(t *testing.T) {
	const sid = "11111111-2222-3333-4444-555555555555"

	t.Run("block content with image — first text block wins, timestamp parsed", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			`{"type":"user","uuid":"u1","timestamp":"2026-09-01T10:00:00.000Z","message":{"role":"user","content":"old prompt"}}`,
			`{"type":"assistant","uuid":"a1","timestamp":"2026-09-01T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"text","text":"reply"}]}}`,
			`{"type":"user","uuid":"u2","timestamp":"2026-09-01T11:30:00.123Z","message":{"role":"user","content":[{"type":"image","source":{"type":"base64"}},{"type":"text","text":"fix the bug"},{"type":"text","text":"<claudefu-file path=\"x\">…</claudefu-file>"}]}}`,
		})
		got := FindLastUserMessage(folder, sid)
		if got == nil {
			t.Fatal("expected a user message")
		}
		if got.UUID != "u2" || got.Text != "fix the bug" {
			t.Errorf("got uuid=%s text=%q", got.UUID, got.Text)
		}
		want := time.Date(2026, 9, 1, 11, 30, 0, 123000000, time.UTC)
		if !got.Timestamp.Equal(want) {
			t.Errorf("timestamp = %s, want %s", got.Timestamp, want)
		}
	})

	t.Run("string content", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			`{"type":"user","uuid":"u1","timestamp":"2026-09-01T10:00:00Z","message":{"role":"user","content":"plain string prompt"}}`,
		})
		got := FindLastUserMessage(folder, sid)
		if got == nil || got.Text != "plain string prompt" || got.UUID != "u1" {
			t.Errorf("got %+v", got)
		}
	})

	t.Run("no user entries returns nil", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			`{"type":"summary","summary":"x"}`,
			`{"type":"assistant","uuid":"a1","message":{"content":[]}}`,
		})
		if got := FindLastUserMessage(folder, sid); got != nil {
			t.Errorf("expected nil, got %+v", got)
		}
	})

	t.Run("missing timestamp leaves zero time", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			`{"type":"user","uuid":"u1","message":{"content":"no ts"}}`,
		})
		got := FindLastUserMessage(folder, sid)
		if got == nil || !got.Timestamp.IsZero() {
			t.Errorf("expected zero timestamp, got %+v", got)
		}
	})

	t.Run("prune round trip removes only the last user entry and after", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			`{"type":"user","uuid":"u1","timestamp":"2026-09-01T10:00:00Z","message":{"content":"keep me"}}`,
			`{"type":"assistant","uuid":"a1","timestamp":"2026-09-01T10:00:05Z","message":{"content":[{"type":"text","text":"reply"}]}}`,
			`{"type":"user","uuid":"u2","timestamp":"2026-09-01T11:00:00Z","message":{"content":"failed send"}}`,
		})
		last := FindLastUserMessage(folder, sid)
		removed, err := DeleteFromMessage(folder, sid, last.UUID)
		if err != nil || removed != 1 {
			t.Fatalf("removed=%d err=%v", removed, err)
		}
		after := FindLastUserMessage(folder, sid)
		if after == nil || after.UUID != "u1" || after.Text != "keep me" {
			t.Errorf("history damaged: %+v", after)
		}
	})
}
