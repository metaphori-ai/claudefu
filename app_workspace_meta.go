package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"claudefu/internal/workspace"
)

// =============================================================================
// WORKSPACE & AGENT META METHODS (Bound to frontend)
// =============================================================================

// GetMetaSchema returns the current meta schema (attribute definitions).
func (a *App) GetMetaSchema() (workspace.MetaSchema, error) {
	if a.workspace == nil || a.workspace.MetaSchema == nil {
		return workspace.DefaultSchema(), nil
	}
	return a.workspace.MetaSchema.GetSchema(), nil
}

// SaveMetaSchema validates and persists the meta schema.
func (a *App) SaveMetaSchema(schema workspace.MetaSchema) error {
	if a.workspace == nil || a.workspace.MetaSchema == nil {
		return fmt.Errorf("meta schema manager not initialized")
	}
	return a.workspace.MetaSchema.SaveSchema(schema)
}

// GetWorkspaceRegistryInfo returns workspace meta for a single workspace.
func (a *App) GetWorkspaceRegistryInfo(workspaceID string) (*workspace.WorkspaceInfo, error) {
	if a.workspace == nil || a.workspace.WorkspaceRegistry == nil {
		return nil, fmt.Errorf("workspace registry not initialized")
	}
	info := a.workspace.WorkspaceRegistry.GetInfo(workspaceID)
	if info == nil {
		return nil, fmt.Errorf("workspace not found in registry: %s", workspaceID)
	}
	return info, nil
}

// GetAllWorkspaceRegistryInfo returns all workspace entries from the registry.
func (a *App) GetAllWorkspaceRegistryInfo() (map[string]workspace.WorkspaceInfo, error) {
	if a.workspace == nil || a.workspace.WorkspaceRegistry == nil {
		return make(map[string]workspace.WorkspaceInfo), nil
	}
	return a.workspace.WorkspaceRegistry.GetAll(), nil
}

// UpdateWorkspaceMeta updates workspace metadata in the registry.
// If the name changed, also syncs to the workspace JSON file.
func (a *App) UpdateWorkspaceMeta(workspaceID string, info workspace.WorkspaceInfo) error {
	if a.workspace == nil || a.workspace.WorkspaceRegistry == nil {
		return fmt.Errorf("workspace registry not initialized")
	}

	// Check if name changed — need to sync to workspace JSON
	existing := a.workspace.WorkspaceRegistry.GetInfo(workspaceID)
	nameChanged := existing != nil && info.Name != "" && info.Name != existing.Name

	if err := a.workspace.WorkspaceRegistry.UpdateMeta(workspaceID, info); err != nil {
		return err
	}

	// Sync name change to workspace JSON
	if nameChanged {
		if err := a.workspace.RenameWorkspace(workspaceID, info.Name); err != nil {
			fmt.Printf("[WARN] Failed to sync workspace name to JSON: %v\n", err)
		}
	}

	return nil
}

// GetAgentRegistryInfo returns agent meta for a single agent by folder.
func (a *App) GetAgentRegistryInfo(folder string) (*workspace.AgentInfo, error) {
	if a.workspace == nil || a.workspace.Registry == nil {
		return nil, fmt.Errorf("agent registry not initialized")
	}
	info := a.workspace.Registry.GetInfo(folder)
	if info == nil {
		return nil, fmt.Errorf("agent not found in registry: %s", folder)
	}
	return info, nil
}

// GetAllAgentRegistryInfo returns all agent entries from the registry.
func (a *App) GetAllAgentRegistryInfo() (map[string]workspace.AgentInfo, error) {
	if a.workspace == nil || a.workspace.Registry == nil {
		return make(map[string]workspace.AgentInfo), nil
	}
	return a.workspace.Registry.AllEntries(), nil
}

// UpdateAgentRegistryMeta updates the custom meta map for an agent.
func (a *App) UpdateAgentRegistryMeta(folder string, meta map[string]string) error {
	if a.workspace == nil || a.workspace.Registry == nil {
		return fmt.Errorf("agent registry not initialized")
	}
	return a.workspace.Registry.UpdateAgentCustomMeta(folder, meta)
}

// GetWorkspaceSifuFolder returns the derived Sifu folder for a workspace.
// Returns: expandHome(sifuRootFolder) + "/" + workspaceSifuSlug
func (a *App) GetWorkspaceSifuFolder(workspaceID string) string {
	if a.settings == nil || a.workspace == nil || a.workspace.WorkspaceRegistry == nil {
		return ""
	}

	settings := a.settings.GetSettings()
	if settings.SifuRootFolder == "" {
		return ""
	}

	wsInfo := a.workspace.WorkspaceRegistry.GetInfo(workspaceID)
	if wsInfo == nil {
		return ""
	}

	slug := wsInfo.SifuSlug
	if slug == "" && wsInfo.SifuName != "" {
		slug = workspace.Slugify(wsInfo.SifuName)
	}
	if slug == "" {
		slug = workspace.Slugify(wsInfo.Name)
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
// Used by the meta dialog to filter agents by workspace.
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
