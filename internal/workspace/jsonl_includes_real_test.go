package workspace

import (
	"os"
	"strings"
	"testing"
)

// Opt-in smoke test against a real session on this machine:
//   CLAUDEFU_REAL_SESSION=/path/to/session.jsonl go test ./internal/workspace -run TestPendingIncludeInjectionReal -v
func TestPendingIncludeInjectionReal(t *testing.T) {
	p := os.Getenv("CLAUDEFU_REAL_SESSION")
	if p == "" {
		// Fallback: a path written to /tmp/claudefu_real_session.txt
		if b, err := os.ReadFile("/tmp/claudefu_real_session.txt"); err == nil {
			p = strings.TrimSpace(string(b))
		}
	}
	if p == "" {
		t.Skip("CLAUDEFU_REAL_SESSION not set")
	}
	got, err := pendingIncludeInjectionFromFile(p)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("available=%v files=%d includedBytes=%d includedTok=%d copies=%d dupTok=%d changed=%d changedBytes=%d changedTok=%d",
		got.Available, got.IncludedFiles, got.IncludedBytes, got.IncludedTokensEst, got.Copies, got.DuplicateTokensEst,
		len(got.ChangedFiles), got.ChangedBytes, got.ChangedTokensEst)
	for _, f := range got.ChangedFiles {
		t.Logf("  changed: %s %dB ~%d tok", IncludeDisplayName(f.Path), f.Bytes, f.TokensEst)
	}
}
