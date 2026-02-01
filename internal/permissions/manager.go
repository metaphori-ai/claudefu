package permissions

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	// ClaudeFu's own permission files (not Claude's settings.local.json)
	GlobalPermissionsFile = "global.permissions.json"
	AgentPermissionsFile  = "claudefu.permissions.json"
	ClaudeSettingsDir     = ".claude"
	ClaudeFuConfigDir     = ".claudefu"
)

// PermissionLevel represents how much of a permission set is enabled
type PermissionLevel string

const (
	LevelNone             PermissionLevel = "none"
	LevelCommon           PermissionLevel = "common"
	LevelCommonPermissive PermissionLevel = "common+permissive"
	LevelAll              PermissionLevel = "all"
)

// ToolPermission represents the enabled tools per tier for a permission set
// V2 format: explicit arrays of enabled tools per tier
type ToolPermission struct {
	Common     []string `json:"common"`     // Enabled common-tier tools
	Permissive []string `json:"permissive"` // Enabled permissive-tier tools
	YOLO       []string `json:"yolo"`       // Enabled YOLO-tier tools
}

// ClaudeFuPermissions is the main permission structure for ClaudeFu
// This is stored separately from Claude's settings.local.json
// V2 format: explicit tool arrays per tier, no override mechanism needed
type ClaudeFuPermissions struct {
	Version               int                       `json:"version"` // 2 for new format
	InheritFromGlobal     bool                      `json:"inheritFromGlobal,omitempty"`
	ToolPermissions       map[string]ToolPermission `json:"toolPermissions"`
	AdditionalDirectories []string                  `json:"additionalDirectories"`
}

// Manager handles permission file operations
type Manager struct {
	globalConfigPath string // ~/.claudefu
	mu               sync.RWMutex
}

// NewManager creates a new permissions manager
func NewManager() (*Manager, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	globalPath := filepath.Join(homeDir, ClaudeFuConfigDir)

	// Ensure global config directory exists
	if err := os.MkdirAll(globalPath, 0755); err != nil {
		return nil, err
	}

	return &Manager{
		globalConfigPath: globalPath,
	}, nil
}

// DefaultGlobalPermissions returns sensible default permissions for new users
func DefaultGlobalPermissions() *ClaudeFuPermissions {
	// Get built-in set definitions to populate defaults
	builtinSet := GetSetByID("claude-builtin")
	filesSet := GetSetByID("files")
	gitSet := GetSetByID("git")

	return &ClaudeFuPermissions{
		Version: 2,
		ToolPermissions: map[string]ToolPermission{
			// Claude Built-in Tools: common + permissive enabled (YOLO disabled)
			"claude-builtin": {
				Common:     builtinSet.Permissions.Common,
				Permissive: builtinSet.Permissions.Permissive,
				YOLO:       []string{}, // YOLO disabled by default (blanket Bash)
			},
			// Files: common enabled only (read-only)
			"files": {
				Common:     filesSet.Permissions.Common,
				Permissive: []string{},
				YOLO:       []string{},
			},
			// Git: common enabled only (read-only)
			"git": {
				Common:     gitSet.Permissions.Common,
				Permissive: []string{},
				YOLO:       []string{},
			},
			// Other sets: all disabled by default
			"docker": {Common: []string{}, Permissive: []string{}, YOLO: []string{}},
			"go":     {Common: []string{}, Permissive: []string{}, YOLO: []string{}},
			"make":   {Common: []string{}, Permissive: []string{}, YOLO: []string{}},
			"node":   {Common: []string{}, Permissive: []string{}, YOLO: []string{}},
			"python": {Common: []string{}, Permissive: []string{}, YOLO: []string{}},
		},
		AdditionalDirectories: []string{},
	}
}

// LoadGlobalPermissions loads permissions from ~/.claudefu/global.permissions.json
// Creates default file if it doesn't exist
func (m *Manager) LoadGlobalPermissions() (*ClaudeFuPermissions, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	path := filepath.Join(m.globalConfigPath, GlobalPermissionsFile)
	perms, err := m.readPermissionsFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// Return defaults if file doesn't exist
			return DefaultGlobalPermissions(), nil
		}
		return nil, err
	}
	return perms, nil
}

// SaveGlobalPermissions saves permissions to ~/.claudefu/global.permissions.json
func (m *Manager) SaveGlobalPermissions(perms *ClaudeFuPermissions) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	path := filepath.Join(m.globalConfigPath, GlobalPermissionsFile)
	return m.writePermissionsFile(path, perms)
}

// LoadAgentPermissions loads permissions from {agentFolder}/.claude/claudefu.permissions.json
// Returns nil if file doesn't exist (agent hasn't been configured yet)
func (m *Manager) LoadAgentPermissions(agentFolder string) (*ClaudeFuPermissions, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	path := m.agentPermissionsPath(agentFolder)
	perms, err := m.readPermissionsFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // No agent-specific permissions yet
		}
		return nil, err
	}
	return perms, nil
}

// SaveAgentPermissions saves permissions to {agentFolder}/.claude/claudefu.permissions.json
func (m *Manager) SaveAgentPermissions(agentFolder string, perms *ClaudeFuPermissions) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Ensure .claude directory exists
	claudeDir := filepath.Join(agentFolder, ClaudeSettingsDir)
	if err := os.MkdirAll(claudeDir, 0755); err != nil {
		return err
	}

	path := m.agentPermissionsPath(agentFolder)
	return m.writePermissionsFile(path, perms)
}

// GetAgentPermissionsOrGlobal returns agent permissions if they exist, otherwise global
func (m *Manager) GetAgentPermissionsOrGlobal(agentFolder string) (*ClaudeFuPermissions, error) {
	agentPerms, err := m.LoadAgentPermissions(agentFolder)
	if err != nil {
		return nil, err
	}
	if agentPerms != nil {
		return agentPerms, nil
	}
	return m.LoadGlobalPermissions()
}

// CopyGlobalToAgent copies global permissions to an agent's folder
// Used when creating a new agent
func (m *Manager) CopyGlobalToAgent(agentFolder string) error {
	globalPerms, err := m.LoadGlobalPermissions()
	if err != nil {
		return err
	}

	// Mark as not inheriting (it's now a copy)
	// Don't copy additionalDirectories — those stay global-only
	permsCopy := *globalPerms
	permsCopy.InheritFromGlobal = false
	permsCopy.AdditionalDirectories = []string{}

	return m.SaveAgentPermissions(agentFolder, &permsCopy)
}

// RevertAgentToGlobal resets agent permissions to match global template (tools only)
// Deprecated: Use RevertToolsToGlobal for clarity
func (m *Manager) RevertAgentToGlobal(agentFolder string) error {
	return m.RevertToolsToGlobal(agentFolder)
}

// CompileAllowList generates the list of permissions for --allowedTools flag
// V2 format: Simply collect all tools from all tier arrays
// IMPORTANT: Blanket "Bash" is EXCLUDED - only Bash(...) patterns are included.
// This prevents auto-approving ALL Bash commands when user only wants specific patterns.
// Bash availability in the tool pool is handled by CompileAvailableTools via --tools flag.
func (m *Manager) CompileAllowList(perms *ClaudeFuPermissions) []string {
	var allowList []string
	seen := make(map[string]bool)

	// Collect all enabled tools from all permission sets
	for _, toolPerm := range perms.ToolPermissions {
		// Add tools from all three tiers
		for _, tierTools := range [][]string{toolPerm.Common, toolPerm.Permissive, toolPerm.YOLO} {
			for _, t := range tierTools {
				// Skip blanket "Bash" - it would auto-approve ALL Bash commands
				// Only Bash(...) patterns should go into --allowedTools
				// Bash availability is handled by CompileAvailableTools (--tools flag)
				if t == "Bash" {
					continue
				}
				if !seen[t] {
					seen[t] = true
					allowList = append(allowList, t)
				}
			}
		}
	}

	return allowList
}

// CompileAvailableTools generates the list of built-in tools for --tools flag
// This is the "pool" of available tools (not Bash patterns)
// V2 format: Simply return tools from claude-builtin arrays
// IMPORTANT: If ANY Bash(...) pattern exists in allowedTools, Bash must be in the tools pool
func (m *Manager) CompileAvailableTools(perms *ClaudeFuPermissions) []string {
	builtinPerm, ok := perms.ToolPermissions["claude-builtin"]
	if !ok {
		return nil
	}

	// Collect all tools from all tiers (no level-based logic needed)
	var tools []string
	tools = append(tools, builtinPerm.Common...)
	tools = append(tools, builtinPerm.Permissive...)
	tools = append(tools, builtinPerm.YOLO...)

	// Check if we have any Bash(...) patterns in ANY permission set
	// If so, Bash must be in the available tools pool for patterns to work
	hasBashPattern := false
	hasBashTool := false
	for _, t := range tools {
		if t == "Bash" {
			hasBashTool = true
			break
		}
	}

	if !hasBashTool {
		// Check all permission sets for Bash(...) patterns
		for _, toolPerm := range perms.ToolPermissions {
			for _, tierTools := range [][]string{toolPerm.Common, toolPerm.Permissive, toolPerm.YOLO} {
				for _, t := range tierTools {
					if strings.HasPrefix(t, "Bash(") {
						hasBashPattern = true
						break
					}
				}
				if hasBashPattern {
					break
				}
			}
			if hasBashPattern {
				break
			}
		}

		// If we have Bash patterns but no Bash tool, add Bash to the tools pool
		if hasBashPattern {
			tools = append(tools, "Bash")
		}
	}

	return tools
}

// CompileDenyList generates the list of patterns for --disallowedTools flag
// V2 format: Returns empty - deny list is no longer used (individual tool toggles handle this)
func (m *Manager) CompileDenyList(perms *ClaudeFuPermissions) []string {
	return []string{}
}

// HasExistingClaudeSettings checks if settings.local.json exists for an agent
func (m *Manager) HasExistingClaudeSettings(agentFolder string) bool {
	path := filepath.Join(agentFolder, ClaudeSettingsDir, "settings.local.json")
	_, err := os.Stat(path)
	return err == nil
}

// agentPermissionsPath returns the path to an agent's permission file
func (m *Manager) agentPermissionsPath(agentFolder string) string {
	return filepath.Join(agentFolder, ClaudeSettingsDir, AgentPermissionsFile)
}

// readPermissionsFile reads and parses a permissions JSON file
// Handles both v1 (level-based) and v2 (explicit arrays) formats
func (m *Manager) readPermissionsFile(path string) (*ClaudeFuPermissions, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	// First, detect version
	var versionCheck struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(data, &versionCheck); err != nil {
		return nil, err
	}

	// If v1 format, migrate to v2
	if versionCheck.Version < 2 {
		return m.migrateV1ToV2(data)
	}

	// v2 format - parse directly
	var perms ClaudeFuPermissions
	if err := json.Unmarshal(data, &perms); err != nil {
		return nil, err
	}

	return &perms, nil
}

// v1ToolPermission is the old format used for parsing v1 files
type v1ToolPermission struct {
	Level PermissionLevel `json:"level"`
}

// v1ClaudeFuPermissions is the old format structure
type v1ClaudeFuPermissions struct {
	Version               int                          `json:"version"`
	InheritFromGlobal     bool                         `json:"inheritFromGlobal,omitempty"`
	ToolPermissions       map[string]v1ToolPermission  `json:"toolPermissions"`
	AdditionalDirectories []string                     `json:"additionalDirectories"`
	CustomBashPermissions []string                     `json:"customBashPermissions"`
	CustomDenyList        []string                     `json:"customDenyList"`
}

// migrateV1ToV2 converts v1 level-based format to v2 explicit arrays format
func (m *Manager) migrateV1ToV2(data []byte) (*ClaudeFuPermissions, error) {
	var v1Perms v1ClaudeFuPermissions
	if err := json.Unmarshal(data, &v1Perms); err != nil {
		return nil, err
	}

	// Create v2 structure
	v2Perms := &ClaudeFuPermissions{
		Version:               2,
		InheritFromGlobal:     v1Perms.InheritFromGlobal,
		ToolPermissions:       make(map[string]ToolPermission),
		AdditionalDirectories: v1Perms.AdditionalDirectories,
	}

	// Convert each permission set from level-based to explicit arrays
	for setID, v1ToolPerm := range v1Perms.ToolPermissions {
		set := GetSetByID(setID)
		if set == nil {
			// Unknown set, create empty entry
			v2Perms.ToolPermissions[setID] = ToolPermission{
				Common:     []string{},
				Permissive: []string{},
				YOLO:       []string{},
			}
			continue
		}

		// Convert level to explicit arrays
		v2Tool := ToolPermission{
			Common:     []string{},
			Permissive: []string{},
			YOLO:       []string{},
		}

		switch v1ToolPerm.Level {
		case LevelAll:
			v2Tool.Common = append(v2Tool.Common, set.Permissions.Common...)
			v2Tool.Permissive = append(v2Tool.Permissive, set.Permissions.Permissive...)
			v2Tool.YOLO = append(v2Tool.YOLO, set.Permissions.YOLO...)
		case LevelCommonPermissive:
			v2Tool.Common = append(v2Tool.Common, set.Permissions.Common...)
			v2Tool.Permissive = append(v2Tool.Permissive, set.Permissions.Permissive...)
		case LevelCommon:
			v2Tool.Common = append(v2Tool.Common, set.Permissions.Common...)
		// LevelNone: all arrays stay empty
		}

		// Apply deny list: remove denied tools from arrays
		denySet := make(map[string]bool)
		for _, denied := range v1Perms.CustomDenyList {
			denySet[denied] = true
		}

		v2Tool.Common = filterDenied(v2Tool.Common, denySet)
		v2Tool.Permissive = filterDenied(v2Tool.Permissive, denySet)
		v2Tool.YOLO = filterDenied(v2Tool.YOLO, denySet)

		v2Perms.ToolPermissions[setID] = v2Tool
	}

	// CustomBashPermissions from v1 are not migrated
	// (they were a workaround that's no longer needed)

	return v2Perms, nil
}

// filterDenied removes denied tools from a slice
func filterDenied(tools []string, denySet map[string]bool) []string {
	if len(denySet) == 0 {
		return tools
	}
	result := make([]string, 0, len(tools))
	for _, t := range tools {
		if !denySet[t] {
			result = append(result, t)
		}
	}
	return result
}

// CompileDirectories unions global + agent directories for CLI --add-dir flags
// This implements the layered directories model where global dirs are always included
func (m *Manager) CompileDirectories(agentFolder string) ([]string, error) {
	global, err := m.LoadGlobalPermissions()
	if err != nil {
		return nil, err
	}

	agent, err := m.LoadAgentPermissions(agentFolder)
	if err != nil {
		return nil, err
	}

	// Union: global dirs + agent dirs (deduplicated)
	seen := make(map[string]bool)
	var result []string

	// Global directories first
	for _, d := range global.AdditionalDirectories {
		if !seen[d] {
			seen[d] = true
			result = append(result, d)
		}
	}

	// Then agent-specific directories
	if agent != nil {
		for _, d := range agent.AdditionalDirectories {
			if !seen[d] {
				seen[d] = true
				result = append(result, d)
			}
		}
	}

	return result, nil
}

// RevertToolsToGlobal resets only toolPermissions to match global template
// Preserves the agent's AdditionalDirectories (layered model)
func (m *Manager) RevertToolsToGlobal(agentFolder string) error {
	globalPerms, err := m.LoadGlobalPermissions()
	if err != nil {
		return err
	}

	agentPerms, err := m.LoadAgentPermissions(agentFolder)
	if err != nil {
		return err
	}

	// If agent has no permissions yet, just copy global (with empty dirs)
	if agentPerms == nil {
		agentPerms = &ClaudeFuPermissions{
			Version:               2,
			AdditionalDirectories: []string{},
		}
	}

	// Replace tools with global template, keep agent's directories
	agentPerms.ToolPermissions = globalPerms.ToolPermissions
	agentPerms.InheritFromGlobal = false

	return m.SaveAgentPermissions(agentFolder, agentPerms)
}

// MergeToolsFromGlobal additively merges global tools into agent (never removes)
func (m *Manager) MergeToolsFromGlobal(agentFolder string) error {
	globalPerms, err := m.LoadGlobalPermissions()
	if err != nil {
		return err
	}

	agentPerms, err := m.LoadAgentPermissions(agentFolder)
	if err != nil {
		return err
	}

	// If agent has no permissions yet, just copy global
	if agentPerms == nil {
		return m.CopyGlobalToAgent(agentFolder)
	}

	// Merge each set's tools (add from global, keep agent's existing)
	for setID, globalPerm := range globalPerms.ToolPermissions {
		agentPerm := agentPerms.ToolPermissions[setID]

		// Union each tier
		agentPerm.Common = unionStrings(agentPerm.Common, globalPerm.Common)
		agentPerm.Permissive = unionStrings(agentPerm.Permissive, globalPerm.Permissive)
		agentPerm.YOLO = unionStrings(agentPerm.YOLO, globalPerm.YOLO)

		agentPerms.ToolPermissions[setID] = agentPerm
	}

	return m.SaveAgentPermissions(agentFolder, agentPerms)
}

// unionStrings returns a union of two string slices (no duplicates)
func unionStrings(a, b []string) []string {
	seen := make(map[string]bool)
	var result []string

	for _, s := range a {
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	for _, s := range b {
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}

// PermissionsDiff represents the changes that would occur from an operation
type PermissionsDiff struct {
	ToolsAdded   []string `json:"toolsAdded"`
	ToolsRemoved []string `json:"toolsRemoved"`
	HasChanges   bool     `json:"hasChanges"`
}

// PreviewRevertTools shows what tools would be added/removed by RevertToolsToGlobal
func (m *Manager) PreviewRevertTools(agentFolder string) (*PermissionsDiff, error) {
	globalPerms, err := m.LoadGlobalPermissions()
	if err != nil {
		return nil, err
	}

	agentPerms, err := m.LoadAgentPermissions(agentFolder)
	if err != nil {
		return nil, err
	}

	// If no agent perms, nothing would change
	if agentPerms == nil {
		return &PermissionsDiff{HasChanges: false}, nil
	}

	// Collect all tools from both
	agentTools := m.collectAllTools(agentPerms)
	globalTools := m.collectAllTools(globalPerms)

	return m.computeDiff(agentTools, globalTools), nil
}

// PreviewMergeTools shows what tools would be added by MergeToolsFromGlobal
func (m *Manager) PreviewMergeTools(agentFolder string) (*PermissionsDiff, error) {
	globalPerms, err := m.LoadGlobalPermissions()
	if err != nil {
		return nil, err
	}

	agentPerms, err := m.LoadAgentPermissions(agentFolder)
	if err != nil {
		return nil, err
	}

	// If no agent perms, all global tools would be added
	if agentPerms == nil {
		globalTools := m.collectAllTools(globalPerms)
		return &PermissionsDiff{
			ToolsAdded:   globalTools,
			ToolsRemoved: []string{},
			HasChanges:   len(globalTools) > 0,
		}, nil
	}

	// Collect all tools from both
	agentTools := m.collectAllTools(agentPerms)
	globalTools := m.collectAllTools(globalPerms)

	// Merge never removes, only adds
	agentSet := toSet(agentTools)
	var added []string
	for _, t := range globalTools {
		if !agentSet[t] {
			added = append(added, t)
		}
	}

	return &PermissionsDiff{
		ToolsAdded:   added,
		ToolsRemoved: []string{},
		HasChanges:   len(added) > 0,
	}, nil
}

// collectAllTools returns all enabled tools from all permission sets
func (m *Manager) collectAllTools(perms *ClaudeFuPermissions) []string {
	seen := make(map[string]bool)
	var result []string

	for _, toolPerm := range perms.ToolPermissions {
		for _, tier := range [][]string{toolPerm.Common, toolPerm.Permissive, toolPerm.YOLO} {
			for _, t := range tier {
				if !seen[t] {
					seen[t] = true
					result = append(result, t)
				}
			}
		}
	}
	return result
}

// computeDiff computes what tools would be added/removed going from current to target
func (m *Manager) computeDiff(currentTools, targetTools []string) *PermissionsDiff {
	currentSet := toSet(currentTools)
	targetSet := toSet(targetTools)

	var added, removed []string

	// Find added (in target but not in current)
	for _, t := range targetTools {
		if !currentSet[t] {
			added = append(added, t)
		}
	}

	// Find removed (in current but not in target)
	for _, t := range currentTools {
		if !targetSet[t] {
			removed = append(removed, t)
		}
	}

	return &PermissionsDiff{
		ToolsAdded:   added,
		ToolsRemoved: removed,
		HasChanges:   len(added) > 0 || len(removed) > 0,
	}
}

// toSet converts a slice to a map for O(1) lookup
func toSet(slice []string) map[string]bool {
	m := make(map[string]bool)
	for _, s := range slice {
		m[s] = true
	}
	return m
}

// writePermissionsFile writes permissions to a JSON file
func (m *Manager) writePermissionsFile(path string, perms *ClaudeFuPermissions) error {
	data, err := json.MarshalIndent(perms, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}
