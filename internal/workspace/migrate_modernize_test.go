package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"claudefu/internal/permissions"
)

// Verifies migration 12 modernizes an existing (pre-rename) global permissions
// file on disk: renames apply, removed tools drop, WaitForMcpServers is seeded,
// other sets are untouched, the output is valid, and a second run is a no-op.
func TestMigrateModernizeGlobalBuiltinTools(t *testing.T) {
	dir := t.TempDir()
	old := `{
	  "version": 2,
	  "toolPermissions": {
	    "claude-builtin": {
	      "common": ["Read","Glob","TodoWrite","TaskOutput","KillShell"],
	      "permissive": ["Write","Edit","Task","Skill"],
	      "yolo": []
	    },
	    "git": { "common": ["Bash(git status:*)"], "permissive": [], "yolo": [] }
	  },
	  "additionalDirectories": []
	}`
	path := filepath.Join(dir, permissions.GlobalPermissionsFile)
	if err := os.WriteFile(path, []byte(old), 0644); err != nil {
		t.Fatal(err)
	}

	if err := migrateModernizeGlobalBuiltinTools(dir, nil); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	load := func() permissions.ClaudeFuPermissions {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var p permissions.ClaudeFuPermissions
		if err := json.Unmarshal(data, &p); err != nil {
			t.Fatalf("output not valid JSON: %v", err)
		}
		return p
	}
	has := func(set []string, name string) bool {
		for _, s := range set {
			if s == name {
				return true
			}
		}
		return false
	}

	cb := load().ToolPermissions["claude-builtin"]

	for _, want := range []string{"Read", "Glob", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "WaitForMcpServers"} {
		if !has(cb.Common, want) {
			t.Errorf("Common missing %q: %v", want, cb.Common)
		}
	}
	for _, gone := range []string{"TodoWrite", "TaskOutput", "KillShell"} {
		if has(cb.Common, gone) {
			t.Errorf("Common should have dropped %q: %v", gone, cb.Common)
		}
	}
	if !has(cb.Permissive, "Agent") || has(cb.Permissive, "Task") {
		t.Errorf("Permissive want Agent not Task: %v", cb.Permissive)
	}

	if git := load().ToolPermissions["git"]; len(git.Common) != 1 || git.Common[0] != "Bash(git status:*)" {
		t.Errorf("git set was mutated: %v", git.Common)
	}

	// Idempotent — a second run must not duplicate WaitForMcpServers.
	before := len(cb.Common)
	if err := migrateModernizeGlobalBuiltinTools(dir, nil); err != nil {
		t.Fatal(err)
	}
	if after := len(load().ToolPermissions["claude-builtin"].Common); after != before {
		t.Errorf("second run changed Common length %d -> %d", before, after)
	}
}
