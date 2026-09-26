package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func instructionsLine(t *testing.T, changed bool, files map[string]string) string {
	t.Helper()
	fl := []map[string]string{}
	for p, c := range files {
		fl = append(fl, map[string]string{"path": p, "content": c, "type": "Project"})
	}
	att := map[string]any{"type": "instructions", "files": fl}
	if changed {
		att["changed"] = true
		att["reason"] = "session_start"
	}
	b, err := json.Marshal(map[string]any{"type": "attachment", "attachment": att, "timestamp": "2026-09-26T10:00:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestPendingIncludeInjection(t *testing.T) {
	const sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	dir := t.TempDir()
	core := filepath.Join(dir, "core.md")
	plan := filepath.Join(dir, "plan.md")
	gone := filepath.Join(dir, "gone.md")
	os.WriteFile(core, []byte("core v1"), 0644)
	os.WriteFile(plan, []byte("plan v1"), 0644)

	t.Run("no instructions attachment -> not available", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			`{"type":"user","uuid":"u1","message":{"role":"user","content":"hi"}}`,
		})
		got, err := PendingIncludeInjection(folder, sid)
		if err != nil || got.Available {
			t.Fatalf("expected unavailable, got %+v err=%v", got, err)
		}
	})

	t.Run("unchanged disk -> nothing pending, floor counted", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			instructionsLine(t, false, map[string]string{core: "core v1", plan: "plan v1"}),
		})
		got, err := PendingIncludeInjection(folder, sid)
		if err != nil {
			t.Fatal(err)
		}
		if !got.Available || got.IncludedFiles != 2 || got.IncludedBytes != 14 || len(got.ChangedFiles) != 0 || got.Copies != 1 {
			t.Fatalf("unexpected: %+v", got)
		}
	})

	t.Run("edited file -> pending; only that file", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			instructionsLine(t, false, map[string]string{core: "core v1", plan: "plan v1"}),
		})
		os.WriteFile(plan, []byte("plan v2 longer"), 0644)
		defer os.WriteFile(plan, []byte("plan v1"), 0644)
		got, err := PendingIncludeInjection(folder, sid)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.ChangedFiles) != 1 || got.ChangedFiles[0].Path != plan || got.ChangedBytes != 14 {
			t.Fatalf("unexpected: %+v", got)
		}
		if got.ChangedTokensEst != 6 { // 14 / 2.35 = 5.96
			t.Fatalf("token est: %d", got.ChangedTokensEst)
		}
	})

	t.Run("changed attachment advances baseline; superseded copy counted", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			instructionsLine(t, false, map[string]string{core: "core v1", plan: "plan v0"}),
			instructionsLine(t, true, map[string]string{plan: "plan v1"}),
		})
		got, err := PendingIncludeInjection(folder, sid)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.ChangedFiles) != 0 {
			t.Fatalf("disk matches latest copy, expected nothing pending: %+v", got)
		}
		if got.Copies != 2 || got.DuplicateTokensEst != 3 { // "plan v0" = 7 bytes -> 3 tokens
			t.Fatalf("copies/dup: %+v", got)
		}
	})

	t.Run("post-compaction full set resets copies", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			instructionsLine(t, false, map[string]string{core: "core v0"}),
			instructionsLine(t, true, map[string]string{core: "core v0.5"}),
			`{"type":"system","subtype":"compact_boundary"}`,
			instructionsLine(t, false, map[string]string{core: "core v1", plan: "plan v1"}),
		})
		got, err := PendingIncludeInjection(folder, sid)
		if err != nil {
			t.Fatal(err)
		}
		if got.Copies != 1 || got.DuplicateTokensEst != 0 || len(got.ChangedFiles) != 0 || got.IncludedFiles != 2 {
			t.Fatalf("unexpected: %+v", got)
		}
	})

	t.Run("CLI trims content — trailing newline/space is not a change", func(t *testing.T) {
		// The CLI persists includes with surrounding whitespace trimmed; a raw
		// byte compare would flag every file that ends in "\n".
		folder := writeTestSession(t, sid, []string{
			instructionsLine(t, false, map[string]string{core: "core v1", plan: "line one\nline two"}),
		})
		os.WriteFile(core, []byte("core v1 \n"), 0644)
		os.WriteFile(plan, []byte("line one  \r\nline two\n\n"), 0644)
		defer os.WriteFile(core, []byte("core v1"), 0644)
		defer os.WriteFile(plan, []byte("plan v1"), 0644)
		got, err := PendingIncludeInjection(folder, sid)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.ChangedFiles) != 0 {
			t.Fatalf("whitespace-only differences must not be pending: %+v", got.ChangedFiles)
		}
	})

	t.Run("missing file counted but not pending", func(t *testing.T) {
		folder := writeTestSession(t, sid, []string{
			instructionsLine(t, false, map[string]string{core: "core v1", gone: "x"}),
		})
		got, err := PendingIncludeInjection(folder, sid)
		if err != nil {
			t.Fatal(err)
		}
		if got.IncludedFiles != 2 || got.IncludedBytes != 7 || len(got.ChangedFiles) != 0 {
			t.Fatalf("unexpected: %+v", got)
		}
	})
}
