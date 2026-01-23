package main

import (
	"fmt"

	"claudefu/internal/permissions"
)

// =============================================================================
// CLAUDEFU PERMISSIONS METHODS (Bound to frontend)
// These manage ClaudeFu's own permission files, separate from Claude's settings.local.json
// =============================================================================

// ImportResult contains the result of importing from Claude's settings.local.json
type ImportResult struct {
	Found          bool                           `json:"found"`
	HasBlanketBash bool                           `json:"hasBlanketBash"`
	Imported       *permissions.ClaudeFuPermissions `json:"imported"`
}

// GetGlobalPermissions returns the global permission template from ~/.claudefu/global.permissions.json
func (a *App) GetGlobalPermissions() (*permissions.ClaudeFuPermissions, error) {
	mgr, err := permissions.NewManager()
	if err != nil {
		return nil, fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.LoadGlobalPermissions()
}

// SaveGlobalPermissions saves the global permission template
func (a *App) SaveGlobalPermissions(perms permissions.ClaudeFuPermissions) error {
	mgr, err := permissions.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.SaveGlobalPermissions(&perms)
}

// GetAgentPermissions returns permissions for a specific agent folder
// Returns nil if agent hasn't been configured yet (falls back to global)
func (a *App) GetAgentPermissions(folder string) (*permissions.ClaudeFuPermissions, error) {
	if folder == "" {
		return nil, fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return nil, fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.LoadAgentPermissions(folder)
}

// GetAgentPermissionsOrGlobal returns agent permissions if they exist, otherwise global
func (a *App) GetAgentPermissionsOrGlobal(folder string) (*permissions.ClaudeFuPermissions, error) {
	if folder == "" {
		return nil, fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return nil, fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.GetAgentPermissionsOrGlobal(folder)
}

// SaveAgentPermissions saves permissions for a specific agent folder
func (a *App) SaveAgentPermissions(folder string, perms permissions.ClaudeFuPermissions) error {
	if folder == "" {
		return fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.SaveAgentPermissions(folder, &perms)
}

// RevertAgentToGlobal resets agent tool permissions to match the global template
// Note: This preserves agent's additionalDirectories (layered model)
func (a *App) RevertAgentToGlobal(folder string) error {
	if folder == "" {
		return fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.RevertAgentToGlobal(folder)
}

// MergeToolsFromGlobal additively merges global tools into agent (never removes)
func (a *App) MergeToolsFromGlobal(folder string) error {
	if folder == "" {
		return fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.MergeToolsFromGlobal(folder)
}

// PreviewRevertTools shows what tools would be added/removed by RevertAgentToGlobal
func (a *App) PreviewRevertTools(folder string) (*permissions.PermissionsDiff, error) {
	if folder == "" {
		return nil, fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return nil, fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.PreviewRevertTools(folder)
}

// PreviewMergeTools shows what tools would be added by MergeToolsFromGlobal
func (a *App) PreviewMergeTools(folder string) (*permissions.PermissionsDiff, error) {
	if folder == "" {
		return nil, fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return nil, fmt.Errorf("failed to create permissions manager: %w", err)
	}

	return mgr.PreviewMergeTools(folder)
}

// GetGlobalDirectories returns the additionalDirectories from global permissions
func (a *App) GetGlobalDirectories() ([]string, error) {
	mgr, err := permissions.NewManager()
	if err != nil {
		return nil, fmt.Errorf("failed to create permissions manager: %w", err)
	}

	perms, err := mgr.LoadGlobalPermissions()
	if err != nil {
		return nil, fmt.Errorf("failed to load global permissions: %w", err)
	}

	return perms.AdditionalDirectories, nil
}

// SyncToClaudeSettings writes ClaudeFu permissions to Claude's settings.local.json
// This is a manual action the user can take to sync permissions for direct CLI usage
func (a *App) SyncToClaudeSettings(folder string) error {
	if folder == "" {
		return fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return fmt.Errorf("failed to create permissions manager: %w", err)
	}

	// Get agent permissions (or global if agent hasn't been configured)
	perms, err := mgr.GetAgentPermissionsOrGlobal(folder)
	if err != nil {
		return fmt.Errorf("failed to load permissions: %w", err)
	}

	// Compile allow list from permissions
	allowList := mgr.CompileAllowList(perms)
	denyList := mgr.CompileDenyList(perms)

	// Write to Claude's settings.local.json using existing method
	return a.SaveClaudePermissions(folder, allowList, denyList, perms.AdditionalDirectories)
}

// ImportFromClaudeSettings reads existing settings.local.json and converts to ClaudeFu format
func (a *App) ImportFromClaudeSettings(folder string) (*ImportResult, error) {
	if folder == "" {
		return nil, fmt.Errorf("folder is required")
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return nil, fmt.Errorf("failed to create permissions manager: %w", err)
	}

	// Check if settings.local.json exists
	if !mgr.HasExistingClaudeSettings(folder) {
		return &ImportResult{Found: false}, nil
	}

	// Read existing Claude permissions
	existing, err := a.GetClaudePermissions(folder)
	if err != nil {
		return nil, fmt.Errorf("failed to read Claude settings: %w", err)
	}

	// Convert to ClaudeFu format
	imported := convertClaudeToClaudeFu(existing)

	// Check for blanket Bash permission (dangerous)
	hasBlanketBash := false
	for _, perm := range existing.Allow {
		if perm == "Bash" {
			hasBlanketBash = true
			break
		}
	}

	return &ImportResult{
		Found:          true,
		HasBlanketBash: hasBlanketBash,
		Imported:       imported,
	}, nil
}

// HasExistingClaudeSettings checks if settings.local.json exists for an agent
func (a *App) HasExistingClaudeSettings(folder string) bool {
	if folder == "" {
		return false
	}

	mgr, err := permissions.NewManager()
	if err != nil {
		return false
	}

	return mgr.HasExistingClaudeSettings(folder)
}

// HasAgentPermissions checks if claudefu.permissions.json exists for an agent
func (a *App) HasAgentPermissions(folder string) bool {
	if folder == "" {
		return false
	}

	perms, err := a.GetAgentPermissions(folder)
	if err != nil {
		return false
	}

	return perms != nil
}

// GetOrderedPermissionSets returns all built-in permission sets in display order
func (a *App) GetOrderedPermissionSets() []permissions.PermissionSet {
	ids := permissions.GetOrderedSetIDs()
	sets := make([]permissions.PermissionSet, 0, len(ids))

	for _, id := range ids {
		set := permissions.GetSetByID(id)
		if set != nil {
			sets = append(sets, *set)
		}
	}

	return sets
}

// convertClaudeToClaudeFu converts Claude's allow/deny list to ClaudeFu's v2 format
func convertClaudeToClaudeFu(claude ClaudePermissions) *permissions.ClaudeFuPermissions {
	// Create result with v2 structure
	result := &permissions.ClaudeFuPermissions{
		Version:               2,
		ToolPermissions:       make(map[string]permissions.ToolPermission),
		AdditionalDirectories: claude.AdditionalDirectories,
	}

	// Initialize all sets with empty arrays
	builtInSets := permissions.BuiltInSets()
	for setID := range builtInSets {
		result.ToolPermissions[setID] = permissions.ToolPermission{
			Common:     []string{},
			Permissive: []string{},
			YOLO:       []string{},
		}
	}

	// Build deny set for filtering (if Claude had a deny list)
	denySet := make(map[string]bool)
	for _, denied := range claude.Deny {
		denySet[denied] = true
	}

	// For each permission in the allow list, add to appropriate tier
	for _, perm := range claude.Allow {
		// Skip denied permissions
		if denySet[perm] {
			continue
		}

		// Check each permission set to find where this perm belongs
		for setID, set := range builtInSets {
			tier := findPermissionTier(perm, set)
			if tier != "" {
				current := result.ToolPermissions[setID]
				switch tier {
				case "common":
					current.Common = append(current.Common, perm)
				case "permissive":
					current.Permissive = append(current.Permissive, perm)
				case "yolo":
					current.YOLO = append(current.YOLO, perm)
				}
				result.ToolPermissions[setID] = current
				break // Found the set, no need to check others
			}
		}
		// Unmatched permissions are ignored in v2 (no custom bash permissions field)
	}

	return result
}

// findPermissionTier determines which tier a permission belongs to in a set
// Returns "common", "permissive", "yolo", or "" if not found
func findPermissionTier(perm string, set permissions.PermissionSet) string {
	// Check Common
	for _, p := range set.Permissions.Common {
		if p == perm {
			return "common"
		}
	}

	// Check Permissive
	for _, p := range set.Permissions.Permissive {
		if p == perm {
			return "permissive"
		}
	}

	// Check YOLO
	for _, p := range set.Permissions.YOLO {
		if p == perm {
			return "yolo"
		}
	}

	return ""
}
