package permissions

import (
	"reflect"
	"testing"
)

func TestRenameBuiltinTools(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{"task_to_agent", []string{"Task"}, []string{"Agent"}},
		{"todowrite_to_quartet", []string{"TodoWrite"},
			[]string{"TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop"}},
		{"drop_killshell_taskoutput", []string{"Read", "KillShell", "TaskOutput", "Glob"},
			[]string{"Read", "Glob"}},
		{"dedup_task_and_agent", []string{"Task", "Agent"}, []string{"Agent"}},
		{"unknown_passthrough", []string{"Read", "SomeFutureTool"}, []string{"Read", "SomeFutureTool"}},
		{"order_preserved", []string{"Write", "Task", "Edit"}, []string{"Write", "Agent", "Edit"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := renameBuiltinTools(c.in)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("renameBuiltinTools(%v) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestMigrateRenamedBuiltinTools(t *testing.T) {
	perms := &ClaudeFuPermissions{
		Version: 2,
		ToolPermissions: map[string]ToolPermission{
			"claude-builtin": {
				Common:     []string{"Read", "TodoWrite", "KillShell", "TaskOutput"},
				Permissive: []string{"Edit", "Task", "Skill"},
				YOLO:       []string{"Bash"},
			},
			// A non-builtin set must be left untouched.
			"git": {Common: []string{"Bash(git status:*)"}},
		},
	}
	MigrateRenamedBuiltinTools(perms)

	cb := perms.ToolPermissions["claude-builtin"]
	wantCommon := []string{"Read", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop"}
	if !reflect.DeepEqual(cb.Common, wantCommon) {
		t.Errorf("Common = %v, want %v", cb.Common, wantCommon)
	}
	wantPermissive := []string{"Edit", "Agent", "Skill"}
	if !reflect.DeepEqual(cb.Permissive, wantPermissive) {
		t.Errorf("Permissive = %v, want %v", cb.Permissive, wantPermissive)
	}
	if git := perms.ToolPermissions["git"]; !reflect.DeepEqual(git.Common, []string{"Bash(git status:*)"}) {
		t.Errorf("git set mutated: %v", git.Common)
	}
}
