package permissions

// ExperimentalFeatureDefinition defines a known experimental feature
// that can be enabled via environment variable settings
type ExperimentalFeatureDefinition struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	EnvVar      string   `json:"envVar"`
	Tools       []string `json:"tools"` // Tools unlocked by this feature
}

// ExperimentalFeatureStatus reports the detection status of an experimental feature
type ExperimentalFeatureStatus struct {
	Feature  ExperimentalFeatureDefinition `json:"feature"`
	Detected bool                          `json:"detected"` // Is the env var set to "1"?
	Source   string                        `json:"source"`   // "project", "global", "env", "none"
}

// AgentTeamsFeature defines the Agent Teams experimental feature
var AgentTeamsFeature = ExperimentalFeatureDefinition{
	ID:          "agent-teams",
	Name:        "Agent Teams",
	Description: "Coordinate multiple Claude Code sessions working together as a team with shared tasks and inter-agent messaging.",
	EnvVar:      "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
	Tools: []string{
		"TeamCreate",
		"TeamDelete",
		"SendMessage",
		"TaskCreate",
		"TaskUpdate",
		"TaskList",
		"TaskGet",
		"TaskStop",
		"TaskOutput",
	},
}

// GetAllFeatureDefinitions returns all known experimental feature definitions
func GetAllFeatureDefinitions() []ExperimentalFeatureDefinition {
	return []ExperimentalFeatureDefinition{
		AgentTeamsFeature,
	}
}

// GetToolsForEnabledFeatures returns all tool names from enabled experimental features
func GetToolsForEnabledFeatures(enabled map[string]bool) []string {
	if len(enabled) == 0 {
		return nil
	}

	var tools []string
	seen := make(map[string]bool)

	for _, feature := range GetAllFeatureDefinitions() {
		if enabled[feature.ID] {
			for _, tool := range feature.Tools {
				if !seen[tool] {
					seen[tool] = true
					tools = append(tools, tool)
				}
			}
		}
	}

	return tools
}
