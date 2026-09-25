package types_test

import (
	"bufio"
	"encoding/json"
	"os"
	"testing"

	"claudefu/internal/types"
)

// TestRealSessionParses feeds a real Claude Code session file through the
// classifier and fails if ANY user/assistant record is rejected by the typed
// unmarshal. Run it against a fresh session after a Claude Code upgrade:
//
//	CLAUDEFU_JSONL=~/.claude/projects/<folder>/<session>.jsonl go test ./internal/types -run RealSession -v
//
// Skips when the env var is unset so CI stays hermetic.
func TestRealSessionParses(t *testing.T) {
	path := os.Getenv("CLAUDEFU_JSONL")
	if path == "" {
		t.Skip("CLAUDEFU_JSONL not set")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	total, failed, userMsgs, images := 0, 0, 0, 0
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		total++
		c, err := types.ClassifyJSONLEvent(line)
		if err != nil {
			failed++
			continue
		}
		if m := types.ConvertToMessage(c); m != nil && m.Type == "user" {
			userMsgs++
			for _, b := range m.ContentBlocks {
				if b.Type == "image" {
					images++
				}
			}
		}
	}
	t.Logf("lines=%d classify_failures=%d user_messages=%d image_blocks=%d", total, failed, userMsgs, images)
	if failed > 0 {
		t.Fatalf("%d records failed typed unmarshal — Claude Code schema drift", failed)
	}
}

// TestImagePasteIDsRegression pins the exact drift: with the pre-fix []string
// field, a 2.1.280+ record fails to unmarshal at all.
func TestImagePasteIDsRegression(t *testing.T) {
	line := `{"type":"user","message":{"role":"user","content":"x"},"imagePasteIds":[1]}`
	var legacy struct {
		ImagePasteIDs []string `json:"imagePasteIds"`
	}
	if err := json.Unmarshal([]byte(line), &legacy); err == nil {
		t.Fatal("expected the legacy []string shape to reject numeric imagePasteIds")
	}
	if _, err := types.ClassifyJSONLEvent(line); err != nil {
		t.Fatalf("current UserEvent must accept numeric imagePasteIds: %v", err)
	}
}
