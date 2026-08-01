package workspace

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Verifies SaveWorkspace skips byte-identical rewrites. loadCurrentWorkspace()
// saves on every app open and workspace switch, and the atomic tmp+rename replaces
// the file (new inode, fresh mtime) even when nothing changed — which Syncthing
// records as a modification on each machine independently, forking a
// .sync-conflict-* copy when two machines that merely OPENED the app reconnect.
// A no-op save must therefore leave the file completely untouched, while a real
// change must still be persisted.
func TestSaveWorkspaceSkipsIdenticalWrite(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)

	ws := &Workspace{
		ID:     "ws-test-1",
		Name:   "TrueArchitect",
		Agents: []Agent{{ID: "agent-a"}, {ID: "agent-b"}},
	}
	if err := m.SaveWorkspace(ws); err != nil {
		t.Fatalf("first save: %v", err)
	}

	wsPath := filepath.Join(dir, "workspaces", "ws-test-1.json")
	first, err := os.Stat(wsPath)
	if err != nil {
		t.Fatalf("stat after first save: %v", err)
	}

	// Backdate so any rewrite is unambiguously detectable as an mtime change.
	old := first.ModTime().Add(-time.Hour)
	if err := os.Chtimes(wsPath, old, old); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	// Identical content — must not touch the file at all.
	if err := m.SaveWorkspace(ws); err != nil {
		t.Fatalf("second save: %v", err)
	}
	after, err := os.Stat(wsPath)
	if err != nil {
		t.Fatalf("stat after no-op save: %v", err)
	}
	if !after.ModTime().Equal(old) {
		t.Errorf("no-op save rewrote the file: mtime moved %v -> %v", old, after.ModTime())
	}

	// A real change must still be written through.
	ws.Agents = append(ws.Agents, Agent{ID: "agent-c"})
	if err := m.SaveWorkspace(ws); err != nil {
		t.Fatalf("changed save: %v", err)
	}
	changed, err := os.Stat(wsPath)
	if err != nil {
		t.Fatalf("stat after changed save: %v", err)
	}
	if changed.ModTime().Equal(old) {
		t.Error("changed save did not rewrite the file")
	}

	reloaded, err := m.LoadWorkspace("ws-test-1")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if len(reloaded.Agents) != 3 {
		t.Errorf("expected 3 agents persisted, got %d", len(reloaded.Agents))
	}
}

// Verifies GetAllWorkspaces ignores Syncthing conflict copies. Such a copy still
// ends in .json and keeps the SAME inner "id", so a suffix-only filter surfaced it
// as an extra workspace sharing that ID — N duplicate rows in the workspace menu,
// every one matching currentWorkspaceId and so every one rendering highlighted.
func TestGetAllWorkspacesIgnoresSyncConflictCopies(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)

	ws := &Workspace{ID: "ws-real", Name: "TrueArchitect"}
	if err := m.SaveWorkspace(ws); err != nil {
		t.Fatalf("save: %v", err)
	}

	canonical, err := os.ReadFile(filepath.Join(dir, "workspaces", "ws-real.json"))
	if err != nil {
		t.Fatalf("read canonical: %v", err)
	}

	// Conflict copies carry identical bytes — including the inner id.
	for _, name := range []string{
		"ws-real.sync-conflict-20260713-171515-3YRV5YX.json",
		"ws-real.sync-conflict-20260727-102432-AFJD47X.json",
	} {
		if err := os.WriteFile(filepath.Join(dir, "workspaces", name), canonical, 0644); err != nil {
			t.Fatalf("write conflict copy: %v", err)
		}
	}
	// A stray whose filename disagrees with its inner id must also be rejected.
	if err := os.WriteFile(filepath.Join(dir, "workspaces", "ws-backup.json"), canonical, 0644); err != nil {
		t.Fatalf("write stray: %v", err)
	}

	list, err := m.GetAllWorkspaces()
	if err != nil {
		t.Fatalf("GetAllWorkspaces: %v", err)
	}
	if len(list) != 1 {
		names := make([]string, len(list))
		for i, w := range list {
			names[i] = w.ID
		}
		t.Fatalf("expected exactly 1 workspace, got %d: %v", len(list), names)
	}
	if list[0].ID != "ws-real" {
		t.Errorf("expected ws-real, got %s", list[0].ID)
	}
}
