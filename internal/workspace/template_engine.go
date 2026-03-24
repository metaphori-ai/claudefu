package workspace

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ProcessTemplate replaces {{ KEY }} placeholders with values from the provided map.
// Pattern: {{ KEY }} — double curly braces, space-padded, ALL_CAPS key.
func ProcessTemplate(template string, values map[string]string) string {
	result := template
	for key, value := range values {
		placeholder := "{{ " + key + " }}"
		result = strings.ReplaceAll(result, placeholder, value)
	}
	return result
}

// ParseAtReferences extracts @/absolute/path references from CLAUDE.md content.
// Go port of the frontend's parseAtReferences logic in ReferencesPane.tsx.
// Returns a list of absolute file paths (without the leading @).
func ParseAtReferences(content string) []string {
	var refs []string
	pattern := regexp.MustCompile(`^@(/[^\s]+)$`)

	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if matches := pattern.FindStringSubmatch(trimmed); len(matches) > 1 {
			refs = append(refs, matches[1])
		}
	}
	return refs
}

// GenerateSifuClaudeMD generates the Sifu agent's CLAUDE.md from templates.
// Pipeline: Load SIFU.md + SIFU_AGENT.md → process per-agent → substitute → write.
func (m *Manager) GenerateSifuClaudeMD(ws *Workspace, sifuFolder string) error {
	// Load templates from user-editable location
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home dir: %w", err)
	}
	templateDir := filepath.Join(home, ".claudefu", "default-templates")

	sifuTemplate, err := os.ReadFile(filepath.Join(templateDir, "SIFU.md"))
	if err != nil {
		return fmt.Errorf("failed to read SIFU.md template: %w", err)
	}

	sifuAgentTemplate, err := os.ReadFile(filepath.Join(templateDir, "SIFU_AGENT.md"))
	if err != nil {
		return fmt.Errorf("failed to read SIFU_AGENT.md template: %w", err)
	}

	// Collect workspace meta values
	wsValues := m.collectWorkspaceMeta(ws.ID)

	// Process each agent through SIFU_AGENT.md template
	var agentSections []string
	var allTdaRefs []string
	seenRefs := make(map[string]bool)

	for _, agent := range ws.Agents {
		if agent.IsSifu() {
			continue // Don't include the sifu agent in its own agent sections
		}

		agentValues := m.collectAgentMeta(agent.Folder)

		// Parse @ references from agent's CLAUDE.md
		claudeMdPath := filepath.Join(agent.Folder, "CLAUDE.md")
		if content, err := os.ReadFile(claudeMdPath); err == nil {
			refs := ParseAtReferences(string(content))
			// Format as @ reference lines for the agent section
			var refLines []string
			for _, ref := range refs {
				refLines = append(refLines, "@"+ref)
				if !seenRefs[ref] {
					allTdaRefs = append(allTdaRefs, "@"+ref)
					seenRefs[ref] = true
				}
			}
			agentValues["AGENT_AT_INCLUDE_REFS"] = strings.Join(refLines, "\n")
		} else {
			agentValues["AGENT_AT_INCLUDE_REFS"] = ""
		}

		// Process per-agent template
		section := ProcessTemplate(string(sifuAgentTemplate), agentValues)
		agentSections = append(agentSections, section)
	}

	// Build final substitution values
	wsValues["AGENT_SECTIONS"] = strings.Join(agentSections, "\n\n")
	wsValues["AT_INCLUDE_REFS"] = strings.Join(allTdaRefs, "\n\n")

	// Process main template
	result := ProcessTemplate(string(sifuTemplate), wsValues)

	// Write to sifu folder
	outputPath := filepath.Join(sifuFolder, "CLAUDE.md")
	if err := os.WriteFile(outputPath, []byte(result), 0644); err != nil {
		return fmt.Errorf("failed to write sifu CLAUDE.md: %w", err)
	}

	fmt.Printf("[INFO] Generated Sifu CLAUDE.md at %s (%d agents, %d TDA refs)\n",
		outputPath, len(agentSections), len(allTdaRefs))
	return nil
}

// collectWorkspaceMeta gathers all workspace meta values for template substitution.
func (m *Manager) collectWorkspaceMeta(wsID string) map[string]string {
	values := make(map[string]string)

	wsInfo := m.GetWorkspaceMeta(wsID)
	if wsInfo != nil && wsInfo.Meta != nil {
		for k, v := range wsInfo.Meta {
			values[k] = v
		}
	}

	// Add workspace ID
	values["WORKSPACE_ID"] = wsID

	return values
}

// collectAgentMeta gathers all agent meta values for template substitution.
func (m *Manager) collectAgentMeta(folder string) map[string]string {
	values := make(map[string]string)

	info := m.GetAgentInfo(folder)
	if info != nil && info.Meta != nil {
		for k, v := range info.Meta {
			values[k] = v
		}
	}

	// Add derived values
	values["AGENT_FOLDER"] = folder
	if info != nil {
		values["AGENT_ID"] = info.ID
	}

	// Derive Claude project folder
	encoded := regexp.MustCompile(`[^a-zA-Z0-9]`).ReplaceAllString(folder, "-")
	values["AGENT_CLAUDE_PROJECT_FOLDER"] = "~/.claude/projects/" + encoded + "/"

	return values
}

// RefreshSifuAgent regenerates the Sifu CLAUDE.md from templates.
// Called when agents are added/removed/slug changed.
func (m *Manager) RefreshSifuAgent(ws *Workspace, sifuEnabled bool, sifuRootFolder string) error {
	if !sifuEnabled || sifuRootFolder == "" {
		return nil
	}

	wsInfo := m.GetWorkspaceMeta(ws.ID)
	if wsInfo == nil {
		return nil
	}
	sifuSlug := wsInfo.GetSifuSlug()
	if sifuSlug == "" {
		return nil
	}

	root := sifuRootFolder
	if strings.HasPrefix(root, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			root = filepath.Join(home, root[2:])
		}
	}
	sifuFolder := filepath.Join(root, sifuSlug)

	return m.GenerateSifuClaudeMD(ws, sifuFolder)
}
