package mcpserver

import (
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

// AgentInfo holds the information needed to describe an agent in tool descriptions
type AgentInfo struct {
	Slug        string
	Name        string
	Description string
}

// buildAgentListDescription builds a formatted list of available agents for tool descriptions
func buildAgentListDescription(agents []AgentInfo) string {
	if len(agents) == 0 {
		return "\n\nNo agents currently configured with MCP enabled."
	}

	var sb strings.Builder
	sb.WriteString("\n\nAvailable agents:")
	for _, agent := range agents {
		if agent.Description != "" {
			sb.WriteString(fmt.Sprintf("\n- %s: %s", agent.Slug, agent.Description))
		} else {
			sb.WriteString(fmt.Sprintf("\n- %s (%s)", agent.Slug, agent.Name))
		}
	}
	return sb.String()
}

// CreateAgentQueryTool creates the AgentQuery tool definition with dynamic agent list
func CreateAgentQueryTool(instruction string, agents []AgentInfo) mcp.Tool {
	description := instruction
	description += buildAgentListDescription(agents)

	return mcp.NewTool("AgentQuery",
		mcp.WithDescription(description),
		mcp.WithString("target_agent",
			mcp.Required(),
			mcp.Description("Name or slug of the agent to query"),
		),
		mcp.WithString("query",
			mcp.Required(),
			mcp.Description("The question or request to send to the target agent"),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional but recommended)"),
		),
	)
}

// CreateAgentMessageTool creates the AgentMessage tool definition with dynamic agent list
func CreateAgentMessageTool(instruction string, agents []AgentInfo) mcp.Tool {
	description := instruction
	description += buildAgentListDescription(agents)

	return mcp.NewTool("AgentMessage",
		mcp.WithDescription(description),
		mcp.WithString("target_agents",
			mcp.Required(),
			mcp.Description("Comma-separated list of agent names or slugs to message (e.g., 'api,frontend' or just 'api')"),
		),
		mcp.WithString("message",
			mcp.Required(),
			mcp.Description("The message content"),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional but recommended)"),
		),
		mcp.WithString("priority",
			mcp.Description("Message priority: 'normal' (default) or 'high'"),
			mcp.Enum("normal", "high"),
		),
	)
}

// CreateAgentBroadcastTool creates the AgentBroadcast tool definition
func CreateAgentBroadcastTool(instruction string, agents []AgentInfo) mcp.Tool {
	description := instruction
	description += buildAgentListDescription(agents)

	return mcp.NewTool("AgentBroadcast",
		mcp.WithDescription(description),
		mcp.WithString("message",
			mcp.Required(),
			mcp.Description("The message content to broadcast to all agents"),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional but recommended)"),
		),
		mcp.WithString("priority",
			mcp.Description("Message priority: 'normal' (default) or 'high'"),
			mcp.Enum("normal", "high"),
		),
	)
}

// CreateNotifyUserTool creates the NotifyUser tool definition
func CreateNotifyUserTool(instruction string) mcp.Tool {
	return mcp.NewTool("NotifyUser",
		mcp.WithDescription(instruction),
		mcp.WithString("message",
			mcp.Required(),
			mcp.Description("The notification message"),
		),
		mcp.WithString("type",
			mcp.Required(),
			mcp.Description("Notification type: 'info', 'success', 'warning', or 'question'"),
			mcp.Enum("info", "success", "warning", "question"),
		),
		mcp.WithString("title",
			mcp.Description("Optional notification title"),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional but recommended)"),
		),
	)
}

// CreateAskUserQuestionTool creates the AskUserQuestion tool definition
// This matches the schema of Claude's built-in AskUserQuestion tool
func CreateAskUserQuestionTool(instruction string) mcp.Tool {
	return mcp.NewTool("AskUserQuestion",
		mcp.WithDescription(instruction),
		mcp.WithArray("questions",
			mcp.Required(),
			mcp.Description("Array of questions to ask the user. Each question has: question (string), header (string), options (array of {label, description}), multiSelect (boolean)"),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional)"),
		),
	)
}

// CreateSelfQueryTool creates the SelfQuery tool definition
// Unlike AgentQuery, from_agent is REQUIRED because we need to identify the caller's folder
func CreateSelfQueryTool(instruction string) mcp.Tool {
	return mcp.NewTool("SelfQuery",
		mcp.WithDescription(instruction),
		mcp.WithString("query",
			mcp.Required(),
			mcp.Description("The question or request to answer using your own codebase context"),
		),
		mcp.WithString("from_agent",
			mcp.Required(),
			mcp.Description("Your agent name/slug - REQUIRED to identify your folder"),
		),
	)
}

// CreateBrowserAgentTool creates the BrowserAgent tool definition
// This tool delegates visual/DOM/CSS investigation to Claude in Browser via a Chrome extension bridge
func CreateBrowserAgentTool(instruction string) mcp.Tool {
	return mcp.NewTool("BrowserAgent",
		mcp.WithDescription(instruction),
		mcp.WithString("prompt",
			mcp.Required(),
			mcp.Description("Investigation prompt for Claude in Browser"),
		),
		mcp.WithNumber("timeout",
			mcp.Description("Seconds to wait for findings (default: 600 = 10 minutes)"),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification"),
		),
	)
}

// CreateExitPlanModeTool creates the ExitPlanMode tool definition
// This replaces Claude's built-in ExitPlanMode which fails in non-interactive CLI mode
func CreateExitPlanModeTool(instruction string) mcp.Tool {
	return mcp.NewTool("ExitPlanMode",
		mcp.WithDescription(instruction),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional)"),
		),
	)
}

// CreateRequestToolPermissionTool creates the RequestToolPermission tool definition
// This tool allows Claude to request runtime permission for a tool/command that isn't pre-approved
func CreateRequestToolPermissionTool(instruction string) mcp.Tool {
	return mcp.NewTool("RequestToolPermission",
		mcp.WithDescription(instruction),
		mcp.WithString("permission",
			mcp.Required(),
			mcp.Description("The permission pattern being requested (e.g., 'Bash(git push:*)' or 'Bash(npm publish:*)')"),
		),
		mcp.WithString("reason",
			mcp.Required(),
			mcp.Description("Why this permission is needed - explain what you want to do and why"),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional but recommended)"),
		),
	)
}

// CreateBacklogAddTool creates the BacklogAdd tool definition
func CreateBacklogAddTool(instruction string) mcp.Tool {
	return mcp.NewTool("BacklogAdd",
		mcp.WithDescription(instruction),
		mcp.WithString("title",
			mcp.Required(),
			mcp.Description("One-line summary of the backlog item"),
		),
		mcp.WithString("context",
			mcp.Description("Rich context: SVML fragments, markdown notes, research, architectural decisions"),
		),
		mcp.WithString("status",
			mcp.Description("Item status (default: 'idea')"),
			mcp.Enum("idea", "planned", "in_progress", "done", "parked"),
		),
		mcp.WithString("type",
			mcp.Description("Item type categorizing the nature of work (default: 'feature_expansion')"),
			mcp.Enum("bug_fix", "new_feature", "feature_expansion", "improvement", "refactor", "validation", "tech_debt", "documentation"),
		),
		mcp.WithString("tags",
			mcp.Description("Comma-separated tags (e.g., 'frontend,ux,v2')"),
		),
		mcp.WithString("parent_id",
			mcp.Description("UUID of parent item to create as subtask"),
		),
		mcp.WithString("from_agent",
			mcp.Required(),
			mcp.Description("Your agent name/slug (required — scopes items to your agent's backlog)"),
		),
	)
}

// CreateBacklogUpdateTool creates the BacklogUpdate tool definition
func CreateBacklogUpdateTool(instruction string) mcp.Tool {
	return mcp.NewTool("BacklogUpdate",
		mcp.WithDescription(instruction),
		mcp.WithString("id",
			mcp.Required(),
			mcp.Description("UUID of the backlog item to update"),
		),
		mcp.WithString("title",
			mcp.Description("New title (replaces existing if provided)"),
		),
		mcp.WithString("context",
			mcp.Description("New context content. Use 'append:' prefix to append to existing context instead of replacing."),
		),
		mcp.WithString("status",
			mcp.Description("New status"),
			mcp.Enum("idea", "planned", "in_progress", "done", "parked"),
		),
		mcp.WithString("type",
			mcp.Description("New item type categorizing the nature of work"),
			mcp.Enum("bug_fix", "new_feature", "feature_expansion", "improvement", "refactor", "validation", "tech_debt", "documentation"),
		),
		mcp.WithString("tags",
			mcp.Description("New comma-separated tags (replaces existing if provided)"),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for attribution (optional for update — used for logging)"),
		),
	)
}

// CreateBacklogListTool creates the BacklogList tool definition
func CreateBacklogListTool(instruction string) mcp.Tool {
	return mcp.NewTool("BacklogList",
		mcp.WithDescription(instruction),
		mcp.WithString("status",
			mcp.Description("Filter by status (omit for all items)"),
			mcp.Enum("idea", "planned", "in_progress", "done", "parked"),
		),
		mcp.WithString("type",
			mcp.Description("Filter by item type (omit for all types)"),
			mcp.Enum("bug_fix", "new_feature", "feature_expansion", "improvement", "refactor", "validation", "tech_debt", "documentation"),
		),
		mcp.WithString("tag",
			mcp.Description("Filter by tag (substring match)"),
		),
		mcp.WithString("include_context",
			mcp.Description("Include full context in results ('true'/'false', default: false to save tokens)"),
			mcp.Enum("true", "false"),
		),
		mcp.WithString("from_agent",
			mcp.Required(),
			mcp.Description("Your agent name/slug (required — scopes list to your agent's backlog)"),
		),
	)
}
