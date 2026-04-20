package workspace

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Migration represents a single sequential data migration.
type Migration struct {
	Version int
	Name    string
	Run     func(configPath string, m *Manager) error
}

// MigrationState tracks which migrations have been applied.
type MigrationState struct {
	LastMigration int    `json:"lastMigration"`
	CompletedAt   string `json:"completedAt,omitempty"`
}

// All migrations in sequential order. Append-only — never reorder or remove.
var allMigrations = []Migration{
	{1, "agents-v1-to-v2", migrateAgentsV1ToV2},
	{2, "current-json-to-local", migrateCurrentJSONToLocal},
	{3, "workspace-populate-registry", migratePopulateWorkspaceRegistry},
	{4, "agents-camelcase-to-allcaps-meta", migrateAgentsCamelCaseToMeta},
	{5, "workspaces-camelcase-to-allcaps-meta", migrateWorkspacesCamelCaseToMeta},
	{6, "meta-schema-ensure-system-attrs", migrateInitMetaIfNilSchemaSystemAttrs},
	{7, "remove-agent-name-from-meta", migrateRemoveAgentName},
	{8, "fix-agent-slug-description", migrateFixAgentSlugDescription},
	{9, "add-agent-type-to-schema", migrateAddAgentTypeToSchema},
	{10, "add-agent-model-attrs-to-schema", migrateAddAgentModelAttrs},
}

// RunMigrations runs all pending migrations in order.
// Each migration runs exactly once; progress is tracked in migration-state.json.
func (m *Manager) RunMigrations() error {
	state := m.loadMigrationState()

	for _, mig := range allMigrations {
		if mig.Version <= state.LastMigration {
			continue
		}
		log.Printf("Running migration %d: %s", mig.Version, mig.Name)
		if err := mig.Run(m.configPath, m); err != nil {
			return fmt.Errorf("migration %d (%s) failed: %w", mig.Version, mig.Name, err)
		}
		state.LastMigration = mig.Version
		state.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		m.saveMigrationState(state)
		log.Printf("Migration %d complete: %s", mig.Version, mig.Name)
	}

	return nil
}

func (m *Manager) migrationStatePath() string {
	return filepath.Join(m.configPath, "migration-state.json")
}

func (m *Manager) loadMigrationState() MigrationState {
	var state MigrationState
	data, err := os.ReadFile(m.migrationStatePath())
	if err != nil {
		return state // Start from 0
	}
	json.Unmarshal(data, &state)
	return state
}

func (m *Manager) saveMigrationState(state MigrationState) {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		log.Printf("Warning: failed to marshal migration state: %v", err)
		return
	}
	if err := os.WriteFile(m.migrationStatePath(), data, 0644); err != nil {
		log.Printf("Warning: failed to save migration state: %v", err)
	}
}

// =============================================================================
// Migration 1: agents.json v1 (folder→UUID string) → v2 (folder→AgentInfo)
// =============================================================================

func migrateAgentsV1ToV2(configPath string, m *Manager) error {
	agentsPath := filepath.Join(configPath, "agents.json")
	raw, err := os.ReadFile(agentsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // Nothing to migrate
		}
		return err
	}

	var versionCheck struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &versionCheck); err != nil {
		return nil // Corrupt, skip
	}
	if versionCheck.Version >= 2 {
		return nil // Already v2+
	}

	// v1: map[folder] → UUID string
	var v1 struct {
		Version int               `json:"version"`
		Agents  map[string]string `json:"agents"`
	}
	if err := json.Unmarshal(raw, &v1); err != nil {
		return nil // Corrupt, skip
	}

	// Convert to v2: map[folder] → AgentInfo{ID: uuid}
	v2 := registryData{
		Version: 2,
		Agents:  make(map[string]AgentInfo, len(v1.Agents)),
	}
	for folder, id := range v1.Agents {
		v2.Agents[folder] = AgentInfo{ID: id}
	}

	data, err := json.MarshalIndent(v2, "", "  ")
	if err != nil {
		return err
	}
	log.Printf("Migration 1: agents.json v1→v2: %d entries", len(v2.Agents))
	return os.WriteFile(agentsPath, data, 0644)
}

// =============================================================================
// Migration 2: current.json → local/current.json
// =============================================================================

func migrateCurrentJSONToLocal(configPath string, m *Manager) error {
	oldPath := filepath.Join(configPath, "current.json")
	newDir := filepath.Join(configPath, "local")
	newPath := filepath.Join(newDir, "current.json")

	if _, err := os.Stat(oldPath); os.IsNotExist(err) {
		return nil // Nothing to migrate
	}
	if _, err := os.Stat(newPath); err == nil {
		return nil // Already migrated
	}

	os.MkdirAll(newDir, 0755)
	if err := os.Rename(oldPath, newPath); err != nil {
		return fmt.Errorf("failed to move current.json to local/: %w", err)
	}
	log.Printf("Migration 2: moved current.json → local/current.json")
	return nil
}

// =============================================================================
// Migration 3: Populate workspaces.json from existing workspace files
// =============================================================================

func migratePopulateWorkspaceRegistry(configPath string, m *Manager) error {
	workspacesDir := filepath.Join(configPath, "workspaces")
	entries, err := os.ReadDir(workspacesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	wsRegistryPath := filepath.Join(configPath, "workspaces.json")

	// Load existing registry (may be empty)
	var wsData workspaceRegistryData
	if raw, err := os.ReadFile(wsRegistryPath); err == nil {
		json.Unmarshal(raw, &wsData)
	}
	if wsData.Workspaces == nil {
		wsData.Workspaces = make(map[string]WorkspaceInfo)
		wsData.Version = 1
	}

	changed := false
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		wsID := strings.TrimSuffix(entry.Name(), ".json")
		if _, exists := wsData.Workspaces[wsID]; exists {
			continue
		}

		data, err := os.ReadFile(filepath.Join(workspacesDir, entry.Name()))
		if err != nil {
			continue
		}

		var ws struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(data, &ws); err != nil {
			continue
		}

		name := ws.Name
		if name == "" {
			name = wsID
		}

		wsData.Workspaces[wsID] = WorkspaceInfo{
			ID: wsID,
			Meta: map[string]string{
				"WORKSPACE_NAME": name,
				"WORKSPACE_SLUG": Slugify(name),
			},
		}
		changed = true
		log.Printf("Migration 3: registered workspace %s → %s", wsID, name)
	}

	if changed {
		data, err := json.MarshalIndent(wsData, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(wsRegistryPath, data, 0644)
	}
	return nil
}

// =============================================================================
// Migration 4: agents.json camelCase slug/name → ALL_CAPS meta
// =============================================================================

func migrateAgentsCamelCaseToMeta(configPath string, m *Manager) error {
	agentsPath := filepath.Join(configPath, "agents.json")
	raw, err := os.ReadFile(agentsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var rawData struct {
		Version int                                `json:"version"`
		Agents  map[string]map[string]interface{} `json:"agents"`
	}
	if err := json.Unmarshal(raw, &rawData); err != nil {
		return nil // Corrupt, skip
	}

	migrated := registryData{
		Version: rawData.Version,
		Agents:  make(map[string]AgentInfo, len(rawData.Agents)),
	}

	needsWrite := false
	fieldMap := map[string]string{"slug": "AGENT_SLUG", "name": "AGENT_NAME"}

	for folder, rawInfo := range rawData.Agents {
		info := AgentInfo{}

		if idVal, ok := rawInfo["id"]; ok {
			if s, ok := idVal.(string); ok {
				info.ID = s
			}
		}

		// Parse existing meta
		if metaRaw, ok := rawInfo["meta"]; ok && metaRaw != nil {
			if metaMap, ok := metaRaw.(map[string]interface{}); ok {
				info.Meta = make(map[string]string, len(metaMap))
				for k, v := range metaMap {
					if s, ok := v.(string); ok {
						info.Meta[k] = s
					}
				}
			}
		}
		info.InitMetaIfNil()

		// Migrate camelCase → ALL_CAPS
		for oldKey, newKey := range fieldMap {
			if val, ok := rawInfo[oldKey]; ok && val != nil {
				if s, ok := val.(string); ok && s != "" && info.Meta[newKey] == "" {
					info.Meta[newKey] = s
					needsWrite = true
				}
			}
		}

		migrated.Agents[folder] = info
	}

	if needsWrite {
		// Re-serialize and write (using the registry's own save for sorted output)
		m.agentRegistry.mu.Lock()
		m.agentRegistry.data = migrated
		err := m.agentRegistry.save()
		m.agentRegistry.mu.Unlock()
		if err != nil {
			return err
		}
		log.Printf("Migration 4: agents.json camelCase → ALL_CAPS meta")
	}
	return nil
}

// =============================================================================
// Migration 5: workspaces.json camelCase → ALL_CAPS meta
// =============================================================================

func migrateWorkspacesCamelCaseToMeta(configPath string, m *Manager) error {
	wsPath := filepath.Join(configPath, "workspaces.json")
	raw, err := os.ReadFile(wsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var rawData struct {
		Version    int                                `json:"version"`
		Workspaces map[string]map[string]interface{} `json:"workspaces"`
	}
	if err := json.Unmarshal(raw, &rawData); err != nil {
		return nil
	}

	needsWrite := false
	fieldMap := map[string]string{
		"name":     "WORKSPACE_NAME",
		"slug":     "WORKSPACE_SLUG",
		"sifuName": "WORKSPACE_SIFU_NAME",
		"sifuSlug": "WORKSPACE_SIFU_SLUG",
	}

	migratedData := workspaceRegistryData{
		Version:    rawData.Version,
		Workspaces: make(map[string]WorkspaceInfo, len(rawData.Workspaces)),
	}

	for wsID, rawInfo := range rawData.Workspaces {
		info := WorkspaceInfo{ID: wsID}

		// Parse existing meta
		if metaRaw, ok := rawInfo["meta"]; ok && metaRaw != nil {
			if metaMap, ok := metaRaw.(map[string]interface{}); ok {
				info.Meta = make(map[string]string, len(metaMap))
				for k, v := range metaMap {
					if s, ok := v.(string); ok {
						info.Meta[k] = s
					}
				}
			}
		}
		if info.Meta == nil {
			info.Meta = make(map[string]string)
		}

		for oldKey, newKey := range fieldMap {
			if val, ok := rawInfo[oldKey]; ok && val != nil {
				if s, ok := val.(string); ok && s != "" && info.Meta[newKey] == "" {
					info.Meta[newKey] = s
					needsWrite = true
				}
			}
		}

		migratedData.Workspaces[wsID] = info
	}

	if needsWrite {
		m.workspaceRegistry.mu.Lock()
		m.workspaceRegistry.data = migratedData
		err := m.workspaceRegistry.save()
		m.workspaceRegistry.mu.Unlock()
		if err != nil {
			return err
		}
		log.Printf("Migration 5: workspaces.json camelCase → ALL_CAPS meta")
	}
	return nil
}

// =============================================================================
// Migration 6: Ensure meta-schema.json has all system attributes
// =============================================================================

func migrateInitMetaIfNilSchemaSystemAttrs(configPath string, m *Manager) error {
	schema := m.metaSchema.GetSchema()
	def := DefaultSchema()

	// Collect system attrs from default schema
	var sysWs, sysAg []MetaAttribute
	for _, a := range def.WorkspaceAttributes {
		if a.System {
			sysWs = append(sysWs, a)
		}
	}
	for _, a := range def.AgentAttributes {
		if a.System {
			sysAg = append(sysAg, a)
		}
	}

	changed := false

	// Ensure workspace system attrs present
	existing := make(map[string]bool)
	for _, a := range schema.WorkspaceAttributes {
		existing[a.Name] = true
	}
	for _, req := range sysWs {
		if !existing[req.Name] {
			schema.WorkspaceAttributes = append([]MetaAttribute{req}, schema.WorkspaceAttributes...)
			changed = true
		}
	}

	// Ensure agent system attrs present
	existing = make(map[string]bool)
	for _, a := range schema.AgentAttributes {
		existing[a.Name] = true
	}
	for _, req := range sysAg {
		if !existing[req.Name] {
			schema.AgentAttributes = append([]MetaAttribute{req}, schema.AgentAttributes...)
			changed = true
		}
	}

	if changed {
		m.metaSchema.mu.Lock()
		m.metaSchema.schema = schema
		err := m.metaSchema.save()
		m.metaSchema.mu.Unlock()
		if err != nil {
			return err
		}
		log.Printf("Migration 6: ensured system attributes in meta-schema.json")
	}
	return nil
}

// =============================================================================
// Migration 7: Remove AGENT_NAME from agent registry meta
// =============================================================================

func migrateRemoveAgentName(configPath string, m *Manager) error {
	allAgents := m.agentRegistry.GetAllInfo()
	changed := false

	for folder, info := range allAgents {
		if info.Meta == nil {
			continue
		}

		// If AGENT_SLUG is empty but AGENT_NAME exists, copy name → slug first
		if info.Meta["AGENT_SLUG"] == "" && info.Meta["AGENT_NAME"] != "" {
			info.Meta["AGENT_SLUG"] = Slugify(info.Meta["AGENT_NAME"])
			changed = true
		}

		// Remove AGENT_NAME
		if _, exists := info.Meta["AGENT_NAME"]; exists {
			delete(info.Meta, "AGENT_NAME")
			changed = true
		}

		if changed {
			m.agentRegistry.mu.Lock()
			m.agentRegistry.data.Agents[folder] = info
			m.agentRegistry.mu.Unlock()
		}
	}

	if changed {
		m.agentRegistry.mu.Lock()
		err := m.agentRegistry.save()
		m.agentRegistry.mu.Unlock()
		if err != nil {
			return err
		}
		log.Printf("Migration 7: removed AGENT_NAME from agent registry meta")
	}

	// Also remove AGENT_NAME from meta-schema if present
	schema := m.metaSchema.GetSchema()
	filtered := make([]MetaAttribute, 0, len(schema.AgentAttributes))
	schemaChanged := false
	for _, attr := range schema.AgentAttributes {
		if attr.Name == "AGENT_NAME" {
			schemaChanged = true
			continue // Remove AGENT_NAME entirely
		}
		// Update AGENT_SLUG description to remove "MCP" prefix
		if attr.Name == "AGENT_SLUG" && strings.Contains(attr.Description, "MCP") {
			attr.Description = "Agent identifier (displayed in sidebar, used for MCP)"
			schemaChanged = true
		}
		filtered = append(filtered, attr)
	}
	if schemaChanged {
		schema.AgentAttributes = filtered
		m.metaSchema.mu.Lock()
		m.metaSchema.schema = schema
		err := m.metaSchema.save()
		m.metaSchema.mu.Unlock()
		if err != nil {
			return err
		}
		log.Printf("Migration 7: removed AGENT_NAME from meta-schema.json")
	}

	return nil
}

// =============================================================================
// Migration 8: Fix AGENT_SLUG description and remove any remaining AGENT_NAME
// =============================================================================

func migrateFixAgentSlugDescription(configPath string, m *Manager) error {
	schema := m.metaSchema.GetSchema()
	changed := false

	// Remove AGENT_NAME if still present (idempotent with migration 7)
	filtered := make([]MetaAttribute, 0, len(schema.AgentAttributes))
	for _, attr := range schema.AgentAttributes {
		if attr.Name == "AGENT_NAME" {
			changed = true
			continue
		}
		// Fix AGENT_SLUG description
		if attr.Name == "AGENT_SLUG" && (strings.Contains(attr.Description, "MCP") || attr.Description == "Agent identifier slug") {
			attr.Description = "Agent identifier (displayed in sidebar, used for MCP)"
			changed = true
		}
		filtered = append(filtered, attr)
	}

	if changed {
		schema.AgentAttributes = filtered
		m.metaSchema.mu.Lock()
		m.metaSchema.schema = schema
		err := m.metaSchema.save()
		m.metaSchema.mu.Unlock()
		if err != nil {
			return err
		}
		log.Printf("Migration 8: fixed AGENT_SLUG description, removed AGENT_NAME")
	}

	// Also clean up any remaining AGENT_NAME from agent registry meta
	allAgents := m.agentRegistry.GetAllInfo()
	registryChanged := false
	for folder, info := range allAgents {
		if info.Meta == nil {
			continue
		}
		if _, exists := info.Meta["AGENT_NAME"]; exists {
			if info.Meta["AGENT_SLUG"] == "" && info.Meta["AGENT_NAME"] != "" {
				info.Meta["AGENT_SLUG"] = Slugify(info.Meta["AGENT_NAME"])
			}
			delete(info.Meta, "AGENT_NAME")
			m.agentRegistry.mu.Lock()
			m.agentRegistry.data.Agents[folder] = info
			m.agentRegistry.mu.Unlock()
			registryChanged = true
		}
	}
	if registryChanged {
		m.agentRegistry.mu.Lock()
		err := m.agentRegistry.save()
		m.agentRegistry.mu.Unlock()
		if err != nil {
			return err
		}
		log.Printf("Migration 8: cleaned AGENT_NAME from agent registry")
	}

	return nil
}

// =============================================================================
// Migration 9: Add AGENT_TYPE system attribute to meta-schema
// =============================================================================

func migrateAddAgentTypeToSchema(configPath string, m *Manager) error {
	schema := m.metaSchema.GetSchema()

	// Check if AGENT_TYPE already exists
	for _, attr := range schema.AgentAttributes {
		if attr.Name == "AGENT_TYPE" {
			return nil // Already present
		}
	}

	// Find position after AGENT_SLUG to insert AGENT_TYPE
	var updated []MetaAttribute
	inserted := false
	for _, attr := range schema.AgentAttributes {
		updated = append(updated, attr)
		if attr.Name == "AGENT_SLUG" && !inserted {
			updated = append(updated, MetaAttribute{
				Name:        "AGENT_TYPE",
				Type:        "text",
				Description: "Agent type (agent, sifu)",
				System:      true,
			})
			inserted = true
		}
	}

	if !inserted {
		updated = append(updated, MetaAttribute{
			Name:        "AGENT_TYPE",
			Type:        "text",
			Description: "Agent type (agent, sifu)",
			System:      true,
		})
	}

	schema.AgentAttributes = updated
	m.metaSchema.mu.Lock()
	m.metaSchema.schema = schema
	err := m.metaSchema.save()
	m.metaSchema.mu.Unlock()
	if err != nil {
		return err
	}
	log.Printf("Migration 9: added AGENT_TYPE system attribute to meta-schema")
	return nil
}

// =============================================================================
// Migration 10: Add AGENT_MODEL and AGENT_EFFORT system attributes to meta-schema
// =============================================================================

func migrateAddAgentModelAttrs(configPath string, m *Manager) error {
	schema := m.metaSchema.GetSchema()

	// Build a set of existing attribute names for idempotency.
	existing := make(map[string]bool, len(schema.AgentAttributes))
	for _, attr := range schema.AgentAttributes {
		existing[attr.Name] = true
	}

	// Attributes to ensure, in insertion order.
	required := []MetaAttribute{
		{Name: "AGENT_MODEL", Type: "text", Description: "Default Claude model (alias or full ID; blank = CLI default)", System: true},
		{Name: "AGENT_EFFORT", Type: "text", Description: "Default effort level (low|medium|high|xhigh|max; blank = model default)", System: true},
	}

	var toAdd []MetaAttribute
	for _, req := range required {
		if !existing[req.Name] {
			toAdd = append(toAdd, req)
		}
	}
	if len(toAdd) == 0 {
		return nil // Already present
	}

	// Insert after AGENT_CROSS_WORKSPACE if present, else append.
	var updated []MetaAttribute
	inserted := false
	for _, attr := range schema.AgentAttributes {
		updated = append(updated, attr)
		if !inserted && attr.Name == "AGENT_CROSS_WORKSPACE" {
			updated = append(updated, toAdd...)
			inserted = true
		}
	}
	if !inserted {
		updated = append(updated, toAdd...)
	}

	schema.AgentAttributes = updated
	m.metaSchema.mu.Lock()
	m.metaSchema.schema = schema
	err := m.metaSchema.save()
	m.metaSchema.mu.Unlock()
	if err != nil {
		return err
	}
	log.Printf("Migration 10: added %d agent model attributes to meta-schema", len(toAdd))
	return nil
}
