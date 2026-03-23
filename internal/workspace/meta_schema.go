package workspace

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"claudefu/internal/defaults"
)

// MetaAttribute defines a single metadata attribute for workspaces or agents.
type MetaAttribute struct {
	Name        string `json:"name"`                    // ALL_CAPS identifier (e.g., WORKSPACE_NAME, AGENT_TDA_ROOT)
	Type        string `json:"type"`                    // "text", "textarea", or "folder"
	Description string `json:"description"`             // Human-readable label for UI
	System      bool   `json:"system,omitempty"`        // true = built-in, non-removable
}

// MetaSchema defines all workspace and agent metadata attributes.
type MetaSchema struct {
	Version             int             `json:"version"`
	WorkspaceAttributes []MetaAttribute `json:"workspaceAttributes"`
	AgentAttributes     []MetaAttribute `json:"agentAttributes"`
}

// MetaSchemaManager handles loading, saving, and validating the meta schema.
type MetaSchemaManager struct {
	mu       sync.RWMutex
	filePath string
	schema   MetaSchema
}

var allCapsRegex = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)

// NewMetaSchemaManager creates a manager backed by meta-schema.json in the config directory.
func NewMetaSchemaManager(configPath string) *MetaSchemaManager {
	return &MetaSchemaManager{
		filePath: filepath.Join(configPath, "meta-schema.json"),
		schema:   DefaultSchema(),
	}
}

// DefaultSchema returns the default schema parsed from the embedded default_meta_schema.json.
func DefaultSchema() MetaSchema {
	var schema MetaSchema
	if err := json.Unmarshal(defaults.MetaSchemaJSON(), &schema); err != nil {
		log.Printf("Warning: failed to parse embedded default meta schema: %v", err)
		return MetaSchema{Version: 1}
	}
	return schema
}

// systemWorkspaceAttrNames returns the set of system workspace attribute names from the default schema.
func systemWorkspaceAttrNames() map[string]bool {
	schema := DefaultSchema()
	names := make(map[string]bool)
	for _, a := range schema.WorkspaceAttributes {
		if a.System {
			names[a.Name] = true
		}
	}
	return names
}

// systemAgentAttrNames returns the set of system agent attribute names from the default schema.
func systemAgentAttrNames() map[string]bool {
	schema := DefaultSchema()
	names := make(map[string]bool)
	for _, a := range schema.AgentAttributes {
		if a.System {
			names[a.Name] = true
		}
	}
	return names
}

// Load reads the schema from disk. Pure deserialization — creates default if not found.
// System attribute enforcement is handled by migration 6 (migrations.go).
func (m *MetaSchemaManager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	raw, err := os.ReadFile(m.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			// First launch — write default schema
			m.schema = DefaultSchema()
			return m.save()
		}
		return fmt.Errorf("failed to read meta schema: %w", err)
	}

	if err := json.Unmarshal(raw, &m.schema); err != nil {
		return fmt.Errorf("failed to parse meta schema: %w", err)
	}

	return nil
}

// ensureSystemAttrs ensures all required system attributes exist in the list.
// Inserts missing ones at the beginning. Returns true if any were added.
func (m *MetaSchemaManager) ensureSystemAttrs(attrs *[]MetaAttribute, required []MetaAttribute) bool {
	existing := make(map[string]bool)
	for _, a := range *attrs {
		existing[a.Name] = true
	}

	var missing []MetaAttribute
	for _, req := range required {
		if !existing[req.Name] {
			missing = append(missing, req)
		}
	}

	if len(missing) == 0 {
		return false
	}

	// Prepend missing system attrs
	*attrs = append(missing, *attrs...)
	return true
}

// GetSchema returns the current schema.
func (m *MetaSchemaManager) GetSchema() MetaSchema {
	m.mu.RLock()
	defer m.mu.RUnlock()
	// Return a copy
	ws := make([]MetaAttribute, len(m.schema.WorkspaceAttributes))
	copy(ws, m.schema.WorkspaceAttributes)
	ag := make([]MetaAttribute, len(m.schema.AgentAttributes))
	copy(ag, m.schema.AgentAttributes)
	return MetaSchema{
		Version:             m.schema.Version,
		WorkspaceAttributes: ws,
		AgentAttributes:     ag,
	}
}

// SaveSchema validates and persists the schema.
// Rejects removal of system attributes. Enforces ALL_CAPS and AGENT_ prefix.
func (m *MetaSchemaManager) SaveSchema(schema MetaSchema) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Validate: all system workspace attrs must be present
	sysWsNames := systemWorkspaceAttrNames()
	for name := range sysWsNames {
		found := false
		for _, a := range schema.WorkspaceAttributes {
			if a.Name == name && a.System {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("cannot remove system attribute: %s", name)
		}
	}

	// Validate: all system agent attrs must be present
	sysAgNames := systemAgentAttrNames()
	for name := range sysAgNames {
		found := false
		for _, a := range schema.AgentAttributes {
			if a.Name == name && a.System {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("cannot remove system attribute: %s", name)
		}
	}

	// Validate custom attributes
	for _, a := range schema.WorkspaceAttributes {
		if a.System {
			continue
		}
		if err := validateCustomAttribute(a, false); err != nil {
			return err
		}
	}
	for _, a := range schema.AgentAttributes {
		if a.System {
			continue
		}
		if err := validateCustomAttribute(a, true); err != nil {
			return err
		}
	}

	schema.Version = 1
	m.schema = schema
	return m.save()
}

func validateCustomAttribute(a MetaAttribute, isAgent bool) error {
	if !allCapsRegex.MatchString(a.Name) {
		return fmt.Errorf("attribute name must be ALL_CAPS: %s", a.Name)
	}
	if isAgent && !strings.HasPrefix(a.Name, "AGENT_") {
		return fmt.Errorf("agent attribute must start with AGENT_: %s", a.Name)
	}
	if a.Type != "text" && a.Type != "textarea" && a.Type != "folder" && a.Type != "file" {
		return fmt.Errorf("invalid attribute type %q for %s (must be text, textarea, folder, or file)", a.Type, a.Name)
	}
	return nil
}

func (m *MetaSchemaManager) save() error {
	data, err := json.MarshalIndent(m.schema, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.filePath, data, 0644)
}
