package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"claudefu/internal/workspace"
)

// =============================================================================
// META METHODS — Workspaces & Agents dialog (Bound to frontend)
// =============================================================================

// GetMetaSchema returns the current meta schema (attribute definitions).
func (a *App) GetMetaSchema() (workspace.MetaSchema, error) {
	if a.workspace == nil {
		return workspace.DefaultSchema(), nil
	}
	return a.workspace.GetMetaSchema(), nil
}

// SaveMetaSchema validates and persists the meta schema.
func (a *App) SaveMetaSchema(schema workspace.MetaSchema) error {
	if a.workspace == nil {
		return fmt.Errorf("workspace manager not initialized")
	}
	return a.workspace.SaveMetaSchema(schema)
}

// GetWorkspaceMeta returns workspace meta for a single workspace.
func (a *App) GetWorkspaceMeta(workspaceID string) (*workspace.WorkspaceInfo, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}
	info := a.workspace.GetWorkspaceMeta(workspaceID)
	if info == nil {
		return nil, fmt.Errorf("workspace not found in registry: %s", workspaceID)
	}
	return info, nil
}

// GetAllWorkspaceMeta returns all workspace entries from the registry.
func (a *App) GetAllWorkspaceMeta() (map[string]workspace.WorkspaceInfo, error) {
	if a.workspace == nil {
		return make(map[string]workspace.WorkspaceInfo), nil
	}
	return a.workspace.GetAllWorkspaceMeta(), nil
}

// UpdateWorkspaceMeta updates workspace metadata in the registry.
// If WORKSPACE_NAME changed, also syncs to the workspace JSON file.
func (a *App) UpdateWorkspaceMeta(workspaceID string, meta map[string]string) error {
	if a.workspace == nil {
		return fmt.Errorf("workspace manager not initialized")
	}

	// Check if name changed — need to sync to workspace JSON
	existing := a.workspace.GetWorkspaceMeta(workspaceID)
	newName := meta["WORKSPACE_NAME"]
	nameChanged := existing != nil && newName != "" && newName != existing.GetSlug()

	if err := a.workspace.UpdateWorkspaceMeta(workspaceID, meta); err != nil {
		return err
	}

	// Sync name change to workspace JSON
	if nameChanged {
		if err := a.workspace.RenameWorkspace(workspaceID, newName); err != nil {
			fmt.Printf("[WARN] Failed to sync workspace name to JSON: %v\n", err)
		}
	}

	return nil
}

// GetAgentMeta returns agent meta for a single agent by folder.
func (a *App) GetAgentMeta(folder string) (*workspace.AgentInfo, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}
	info := a.workspace.GetAgentInfo(folder)
	if info == nil {
		return nil, fmt.Errorf("agent not found in registry: %s", folder)
	}
	return info, nil
}

// GetAllAgentMeta returns all agent entries from the registry.
func (a *App) GetAllAgentMeta() (map[string]workspace.AgentInfo, error) {
	if a.workspace == nil {
		return make(map[string]workspace.AgentInfo), nil
	}
	return a.workspace.GetAllAgentInfo(), nil
}

// UpdateAgentMeta updates the custom meta map for an agent.
func (a *App) UpdateAgentMeta(folder string, meta map[string]string) error {
	if a.workspace == nil {
		return fmt.Errorf("workspace manager not initialized")
	}
	return a.workspace.UpdateAgentCustomMeta(folder, meta)
}

// GetWorkspaceSifuFolder returns the derived Sifu folder for a workspace.
func (a *App) GetWorkspaceSifuFolder(workspaceID string) string {
	if a.settings == nil || a.workspace == nil {
		return ""
	}

	settings := a.settings.GetSettings()
	if settings.SifuRootFolder == "" {
		return ""
	}

	wsInfo := a.workspace.GetWorkspaceMeta(workspaceID)
	if wsInfo == nil {
		return ""
	}

	slug := wsInfo.GetSifuSlug()
	if slug == "" && wsInfo.GetSifuName() != "" {
		slug = workspace.Slugify(wsInfo.GetSifuName())
	}
	if slug == "" {
		slug = workspace.Slugify(wsInfo.GetName())
	}
	if slug == "" {
		return ""
	}

	root := settings.SifuRootFolder
	if strings.HasPrefix(root, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			root = filepath.Join(home, root[2:])
		}
	}

	return filepath.Join(root, slug)
}

// GetWorkspaceAgentFolders returns the agent folders for a given workspace.
func (a *App) GetWorkspaceAgentFolders(workspaceID string) ([]string, error) {
	if a.workspace == nil {
		return nil, fmt.Errorf("workspace manager not initialized")
	}
	ws, err := a.workspace.LoadWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	folders := make([]string, 0, len(ws.Agents))
	for _, agent := range ws.Agents {
		if agent.Folder != "" {
			folders = append(folders, agent.Folder)
		}
	}
	return folders, nil
}

// GetSifuTemplateMD reads the SIFU.md template from ~/.claudefu/default-templates/.
func (a *App) GetSifuTemplateMD() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(home, ".claudefu", "default-templates", "SIFU.md")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveSifuTemplateMD writes the SIFU.md template to ~/.claudefu/default-templates/.
func (a *App) SaveSifuTemplateMD(content string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	path := filepath.Join(home, ".claudefu", "default-templates", "SIFU.md")
	return os.WriteFile(path, []byte(content), 0644)
}

// GetSifuAgentTemplateMD reads the SIFU_AGENT.md template from ~/.claudefu/default-templates/.
func (a *App) GetSifuAgentTemplateMD() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(home, ".claudefu", "default-templates", "SIFU_AGENT.md")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveSifuAgentTemplateMD writes the SIFU_AGENT.md template to ~/.claudefu/default-templates/.
func (a *App) SaveSifuAgentTemplateMD(content string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	path := filepath.Join(home, ".claudefu", "default-templates", "SIFU_AGENT.md")
	return os.WriteFile(path, []byte(content), 0644)
}
