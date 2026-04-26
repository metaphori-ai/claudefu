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

// buildAgentListDescription builds a formatted list of available agents for tool descriptions.
// crossWorkspaceAgents (optional) are shown in a separate section.
func buildAgentListDescription(agents []AgentInfo, crossWorkspaceAgents []AgentInfo) string {
	if len(agents) == 0 && len(crossWorkspaceAgents) == 0 {
		return "\n\nNo agents currently configured with MCP enabled."
	}

	var sb strings.Builder
	if len(agents) > 0 {
		sb.WriteString("\n\nAvailable agents:")
		for _, agent := range agents {
			if agent.Description != "" {
				sb.WriteString(fmt.Sprintf("\n- %s: %s", agent.Slug, agent.Description))
			} else {
				sb.WriteString(fmt.Sprintf("\n- %s", agent.Slug))
			}
		}
	}
	if len(crossWorkspaceAgents) > 0 {
		sb.WriteString("\n\nCross-workspace agents:")
		for _, agent := range crossWorkspaceAgents {
			if agent.Description != "" {
				sb.WriteString(fmt.Sprintf("\n- %s: %s", agent.Slug, agent.Description))
			} else {
				sb.WriteString(fmt.Sprintf("\n- %s", agent.Slug))
			}
		}
	}
	return sb.String()
}

// CreateAgentQueryTool creates the AgentQuery tool definition with dynamic agent list
func CreateAgentQueryTool(instruction string, agents []AgentInfo) mcp.Tool {
	description := instruction
	description += buildAgentListDescription(agents, nil)

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
func CreateAgentMessageTool(instruction string, agents []AgentInfo, crossWorkspaceAgents []AgentInfo) mcp.Tool {
	description := instruction
	description += buildAgentListDescription(agents, crossWorkspaceAgents)

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
	description += buildAgentListDescription(agents, nil)

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
			mcp.Description("CRITICAL: Your OWN agent slug or AGENT_ID from your CLAUDE.md. This determines which backlog database items are stored in. Do NOT use another agent's slug — check the Agent Identity section at the top of your CLAUDE.md."),
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

// CreateMetaserverQueryTool creates the MetaserverQuery tool definition.
// Replaces the retired MetalogsQuery — queries metaserver's HTTP log API on :9990.
func CreateMetaserverQueryTool(instruction string) mcp.Tool {
	return mcp.NewTool("MetaserverQuery",
		mcp.WithDescription(instruction),
		mcp.WithString("services",
			mcp.Description("CSV of exact service names to filter by (e.g. 'mapi,ta-bff'). Use MetaserverServices to discover."),
		),
		mcp.WithString("collections",
			mcp.Description("CSV of collection names — expands to UNION of services in those collections. Examples: 'tm', 'ta', 'mp', 'iapi', 'metaphori', 'cm'."),
		),
		mcp.WithString("collection",
			mcp.Description("Single-collection alias for collections= (kept for compat with old metalogs queries)."),
		),
		mcp.WithString("layers",
			mcp.Description("CSV of layers to filter by: api, bff, fe."),
		),
		mcp.WithString("sites",
			mcp.Description("CSV of site short_ids."),
		),
		mcp.WithString("levels",
			mcp.Description("CSV of levels: debug,info,warn,error,fatal. Default: 'warn,error,fatal'."),
		),
		mcp.WithString("run",
			mcp.Description("Run window: 'current' (default) | 'previous' | 'last_3' / 'last_5' | 'all' | specific run_id like 'mapi-r47'. Almost always leave at 'current'."),
		),
		mcp.WithString("since",
			mcp.Description("RFC3339 timestamp, duration ('5m', '1h', '24h'), 'last_start', or 'last_restart'."),
		),
		mcp.WithString("until",
			mcp.Description("RFC3339 end timestamp."),
		),
		mcp.WithString("contains",
			mcp.Description("Case-insensitive substring search on message + details."),
		),
		mcp.WithString("field",
			mcp.Description("Match a structured log field — 'key=value' form (e.g. 'trace_id=abc123')."),
		),
		mcp.WithNumber("limit",
			mcp.Description("Maximum lines to return. Default 200, max 10000."),
		),
		mcp.WithString("order",
			mcp.Description("'asc' (oldest first) or 'desc' (newest first, default)."),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional)."),
		),
	)
}

// CreateMetaserverServicesTool creates the MetaserverServices tool definition.
// Discovery — lists all services + collections in one call.
func CreateMetaserverServicesTool(instruction string) mcp.Tool {
	return mcp.NewTool("MetaserverServices",
		mcp.WithDescription(instruction),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional)."),
		),
	)
}

// CreateMetaserverStartTool creates the MetaserverStart tool definition.
// Starts a single service. May block up to 90s if the service has start_after dependencies.
func CreateMetaserverStartTool(instruction string) mcp.Tool {
	return mcp.NewTool("MetaserverStart",
		mcp.WithDescription(instruction),
		mcp.WithString("name",
			mcp.Required(),
			mcp.Description("Exact service name (e.g. 'mapi', 'ta-bff'). Use MetaserverServices to discover."),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional)."),
		),
	)
}

// CreateMetaserverStopTool creates the MetaserverStop tool definition.
// Stops a single service via SIGTERM-then-SIGKILL on its process group.
func CreateMetaserverStopTool(instruction string) mcp.Tool {
	return mcp.NewTool("MetaserverStop",
		mcp.WithDescription(instruction),
		mcp.WithString("name",
			mcp.Required(),
			mcp.Description("Exact service name (e.g. 'mapi', 'ta-bff'). Use MetaserverServices to discover."),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional)."),
		),
	)
}

// CreateMetaserverRestartTool creates the MetaserverRestart tool definition.
// Soft restart by default (uses restart_command if configured); force=true does hard kill+respawn.
func CreateMetaserverRestartTool(instruction string) mcp.Tool {
	return mcp.NewTool("MetaserverRestart",
		mcp.WithDescription(instruction),
		mcp.WithString("name",
			mcp.Required(),
			mcp.Description("Exact service name (e.g. 'mapi', 'ta-bff'). Use MetaserverServices to discover."),
		),
		mcp.WithBoolean("force",
			mcp.Description("If true, skip restart_command and do hard kill+respawn. Default false."),
		),
		mcp.WithString("from_agent",
			mcp.Description("Your agent name/slug for identification (optional)."),
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
			mcp.Description("CRITICAL: Your OWN agent slug or AGENT_ID from your CLAUDE.md. This determines which backlog you see. Do NOT use another agent's slug — check the Agent Identity section at the top of your CLAUDE.md."),
		),
	)
}
