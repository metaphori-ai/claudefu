package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// =============================================================================
// CLAUDE SETTINGS METHODS (Bound to frontend)
// =============================================================================

// ClaudePermissions represents the permissions section of Claude's settings.json
type ClaudePermissions struct {
	Allow                 []string `json:"allow"`
	Deny                  []string `json:"deny"`
	AdditionalDirectories []string `json:"additionalDirectories"`
}

// GetClaudePermissions reads permissions from {folder}/.claude/settings.local.json
func (a *App) GetClaudePermissions(folder string) (ClaudePermissions, error) {
	settingsPath := filepath.Join(folder, ".claude", "settings.local.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Return empty permissions if file doesn't exist
			return ClaudePermissions{Allow: []string{}, Deny: []string{}}, nil
		}
		return ClaudePermissions{}, fmt.Errorf("failed to read settings: %w", err)
	}

	// Parse the JSON to extract permissions
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		return ClaudePermissions{}, fmt.Errorf("failed to parse settings: %w", err)
	}

	result := ClaudePermissions{Allow: []string{}, Deny: []string{}, AdditionalDirectories: []string{}}

	if perms, ok := settings["permissions"].(map[string]any); ok {
		if allow, ok := perms["allow"].([]any); ok {
			for _, v := range allow {
				if s, ok := v.(string); ok {
					result.Allow = append(result.Allow, s)
				}
			}
		}
		if deny, ok := perms["deny"].([]any); ok {
			for _, v := range deny {
				if s, ok := v.(string); ok {
					result.Deny = append(result.Deny, s)
				}
			}
		}
		if addDirs, ok := perms["additionalDirectories"].([]any); ok {
			for _, v := range addDirs {
				if s, ok := v.(string); ok {
					result.AdditionalDirectories = append(result.AdditionalDirectories, s)
				}
			}
		}
	}

	return result, nil
}

// SaveClaudePermissions writes permissions to {folder}/.claude/settings.local.json
func (a *App) SaveClaudePermissions(folder string, allow []string, deny []string, additionalDirectories []string) error {
	settingsPath := filepath.Join(folder, ".claude", "settings.local.json")

	// Read existing settings to preserve other fields
	var settings map[string]any
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			settings = make(map[string]any)
			// Create .claude directory if it doesn't exist
			claudeDir := filepath.Join(folder, ".claude")
			if err := os.MkdirAll(claudeDir, 0755); err != nil {
				return fmt.Errorf("failed to create .claude directory: %w", err)
			}
		} else {
			return fmt.Errorf("failed to read settings: %w", err)
		}
	} else {
		if err := json.Unmarshal(data, &settings); err != nil {
			return fmt.Errorf("failed to parse settings: %w", err)
		}
	}

	// Build permissions object
	perms := make(map[string]any)
	perms["allow"] = allow
	perms["deny"] = deny
	if len(additionalDirectories) > 0 {
		perms["additionalDirectories"] = additionalDirectories
	}
	settings["permissions"] = perms

	// Write back
	newData, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %w", err)
	}

	if err := os.WriteFile(settingsPath, newData, 0644); err != nil {
		return fmt.Errorf("failed to write settings: %w", err)
	}

	return nil
}

// GetClaudeMD reads the CLAUDE.md file from an agent's folder
func (a *App) GetClaudeMD(folder string) (string, error) {
	if folder == "" {
		return "", fmt.Errorf("folder is required")
	}

	claudeMDPath := filepath.Join(folder, "CLAUDE.md")
	data, err := os.ReadFile(claudeMDPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil // Return empty string if file doesn't exist
		}
		return "", fmt.Errorf("failed to read CLAUDE.md: %w", err)
	}

	return string(data), nil
}

// SaveClaudeMD writes content to the CLAUDE.md file in an agent's folder
func (a *App) SaveClaudeMD(folder, content string) error {
	if folder == "" {
		return fmt.Errorf("folder is required")
	}

	claudeMDPath := filepath.Join(folder, "CLAUDE.md")
	if err := os.WriteFile(claudeMDPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write CLAUDE.md: %w", err)
	}

	return nil
}

// GetGlobalClaudeMD reads ~/.claude/CLAUDE.md
func (a *App) GetGlobalClaudeMD() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home dir: %w", err)
	}
	data, err := os.ReadFile(filepath.Join(home, ".claude", "CLAUDE.md"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("failed to read global CLAUDE.md: %w", err)
	}
	return string(data), nil
}

// SaveGlobalClaudeMD writes ~/.claude/CLAUDE.md
func (a *App) SaveGlobalClaudeMD(content string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home dir: %w", err)
	}
	dir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create .claude dir: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write global CLAUDE.md: %w", err)
	}
	return nil
}

// GetDefaultTemplateMD reads ~/.claudefu/default-templates/CLAUDE.md
func (a *App) GetDefaultTemplateMD() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home dir: %w", err)
	}
	data, err := os.ReadFile(filepath.Join(home, ".claudefu", "default-templates", "CLAUDE.md"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("failed to read default template CLAUDE.md: %w", err)
	}
	return string(data), nil
}

// SaveDefaultTemplateMD writes ~/.claudefu/default-templates/CLAUDE.md
func (a *App) SaveDefaultTemplateMD(content string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home dir: %w", err)
	}
	dir := filepath.Join(home, ".claudefu", "default-templates")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create default-templates dir: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write default template CLAUDE.md: %w", err)
	}
	return nil
}
