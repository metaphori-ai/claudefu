package defaults

import (
	_ "embed"
)

//go:embed default_tool_instructions.json
var toolInstructionsJSON []byte

//go:embed default_claude_md.txt
var claudeMDTemplate string

// ToolInstructionsJSON returns the embedded default tool instructions JSON bytes.
func ToolInstructionsJSON() []byte {
	return toolInstructionsJSON
}

// ClaudeMDTemplate returns the embedded default CLAUDE.md template content.
func ClaudeMDTemplate() string {
	return claudeMDTemplate
}
