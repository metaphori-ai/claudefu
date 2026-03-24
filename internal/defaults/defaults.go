package defaults

import (
	_ "embed"
)

//go:embed default_tool_instructions.json
var toolInstructionsJSON []byte

//go:embed default_claude_md.txt
var claudeMDTemplate string

//go:embed default_meta_schema.json
var metaSchemaJSON []byte

//go:embed default_sifu.md
var sifuMDTemplate string

//go:embed default_sifu_agent.md
var sifuAgentMDTemplate string

// ToolInstructionsJSON returns the embedded default tool instructions JSON bytes.
func ToolInstructionsJSON() []byte {
	return toolInstructionsJSON
}

// ClaudeMDTemplate returns the embedded default CLAUDE.md template content.
func ClaudeMDTemplate() string {
	return claudeMDTemplate
}

// MetaSchemaJSON returns the embedded default meta schema JSON bytes.
func MetaSchemaJSON() []byte {
	return metaSchemaJSON
}

// SifuMDTemplate returns the embedded default SIFU.md template content.
func SifuMDTemplate() string {
	return sifuMDTemplate
}

// SifuAgentMDTemplate returns the embedded default SIFU_AGENT.md template content.
func SifuAgentMDTemplate() string {
	return sifuAgentMDTemplate
}
