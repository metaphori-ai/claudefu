// Package scaffold ensures agent folders have the expected file structure.
// It checks what's missing and creates selected items on demand.
package scaffold

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// encodeProjectPath encodes a folder path like Claude Code does.
// Claude CLI replaces every non-alphanumeric character with "-".
var nonAlphanumeric = regexp.MustCompile(`[^a-zA-Z0-9]`)

func encodeProjectPath(path string) string {
	return nonAlphanumeric.ReplaceAllString(path, "-")
}

// ScaffoldCheck reports which agent setup items exist.
type ScaffoldCheck struct {
	HasProjectsDir bool `json:"hasProjectsDir"`
	HasSessions    bool `json:"hasSessions"`
	HasClaudeMD    bool `json:"hasClaudeMD"`
	HasPermissions bool `json:"hasPermissions"`
}

// NeedsScaffold returns true if any item is missing (excluding sessions which are informational).
func (c *ScaffoldCheck) NeedsScaffold() bool {
	return !c.HasProjectsDir || !c.HasClaudeMD || !c.HasPermissions
}

// ScaffoldOptions controls which items to create.
type ScaffoldOptions struct {
	ProjectsDir bool `json:"projectsDir"`
	ClaudeMD    bool `json:"claudeMD"`
	Permissions bool `json:"permissions"`
}

// CheckAgentSetup checks what exists for an agent folder without creating anything.
func CheckAgentSetup(folder string) (*ScaffoldCheck, error) {
	if folder == "" {
		return nil, fmt.Errorf("folder is empty")
	}

	check := &ScaffoldCheck{}

	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	// Projects dir + sessions-index.json
	encoded := encodeProjectPath(folder)
	projectDir := filepath.Join(home, ".claude", "projects", encoded)
	indexPath := filepath.Join(projectDir, "sessions-index.json")
	if _, err := os.Stat(indexPath); err == nil {
		check.HasProjectsDir = true
	}

	// Any .jsonl session files?
	if check.HasProjectsDir {
		entries, _ := os.ReadDir(projectDir)
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".jsonl") {
				check.HasSessions = true
				break
			}
		}
	}

	// CLAUDE.md
	if _, err := os.Stat(filepath.Join(folder, "CLAUDE.md")); err == nil {
		check.HasClaudeMD = true
	}

	// Permissions file
	if _, err := os.Stat(filepath.Join(folder, ".claude", "claudefu.permissions.json")); err == nil {
		check.HasPermissions = true
	}

	return check, nil
}

// AgentIdentity holds agent identity info for template replacement.
type AgentIdentity struct {
	ID   string // Agent UUID (from global registry)
	Slug string // Agent slug (for MCP tool calls)
}

// EnsureAgentSetup creates selected missing items for an agent folder.
// Safe to call multiple times — only creates files that don't exist.
func EnsureAgentSetup(folder, configPath string, identity AgentIdentity, opts ScaffoldOptions) error {
	if folder == "" {
		return fmt.Errorf("folder is empty")
	}

	if opts.ProjectsDir {
		if err := ensureClaudeProjectsDir(folder); err != nil {
			return fmt.Errorf("projects dir: %w", err)
		}
	}

	if opts.ClaudeMD {
		if err := ensureClaudeMD(folder, configPath, identity); err != nil {
			return fmt.Errorf("CLAUDE.md: %w", err)
		}
	}

	// Permissions are handled by the caller (app_agent.go) since they
	// need access to the permissions.Manager and App methods.

	return nil
}

// ensureClaudeProjectsDir creates ~/.claude/projects/{encoded-folder}/ and
// an empty sessions-index.json if they don't exist.
func ensureClaudeProjectsDir(folder string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	encoded := encodeProjectPath(folder)
	projectDir := filepath.Join(home, ".claude", "projects", encoded)

	if err := os.MkdirAll(projectDir, 0755); err != nil {
		return err
	}

	indexPath := filepath.Join(projectDir, "sessions-index.json")
	if _, err := os.Stat(indexPath); os.IsNotExist(err) {
		idx := map[string]any{
			"version": "1",
			"entries": []any{},
		}
		data, _ := json.MarshalIndent(idx, "", "  ")
		if err := os.WriteFile(indexPath, data, 0644); err != nil {
			return err
		}
	}

	return nil
}

// ensureClaudeMD copies the CLAUDE.md template to the agent folder if missing.
// Reads from ~/.claudefu/default-templates/CLAUDE.md (user-customizable).
// Replaces {PROJECT_NAME}, {AGENT_ID}, and {AGENT_SLUG} with actual values.
func ensureClaudeMD(folder, configPath string, identity AgentIdentity) error {
	target := filepath.Join(folder, "CLAUDE.md")
	if _, err := os.Stat(target); err == nil {
		return nil // Already exists — don't overwrite
	}

	templatePath := filepath.Join(configPath, "default-templates", "CLAUDE.md")
	tmpl, err := os.ReadFile(templatePath)
	if err != nil {
		// Template not available — skip silently
		return nil
	}

	projectName := filepath.Base(folder)
	content := strings.ReplaceAll(string(tmpl), "{PROJECT_NAME}", projectName)
	content = strings.ReplaceAll(content, "{AGENT_ID}", identity.ID)
	content = strings.ReplaceAll(content, "{AGENT_SLUG}", identity.Slug)

	return os.WriteFile(target, []byte(content), 0644)
}
