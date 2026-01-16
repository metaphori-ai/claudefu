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
func CreateAgentQueryTool(agents []AgentInfo) mcp.Tool {
	description := `Send a stateless query to another agent in your workspace. Returns their response synchronously.

The target agent will receive your query with context that it's from another agent, and will respond concisely with facts only.

Use this when you need information from another agent's domain (e.g., asking the backend agent about an API endpoint signature).`

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

// CreateAgentBroadcastTool creates the AgentBroadcast tool definition with dynamic agent list
func CreateAgentBroadcastTool(agents []AgentInfo) mcp.Tool {
	description := `Send a message to another agent's inbox. The message will appear in ClaudeFu UI for the user to review and inject into that agent's conversation when ready.

Use this for:
- Notifying other agents of changes (e.g., "API schema updated")
- Sharing information that doesn't need immediate response
- Coordinating across agents without blocking

The user controls when/if the message gets injected into the target agent's context.

Use target_agent='all' to broadcast to all MCP-enabled agents.`

	description += buildAgentListDescription(agents)

	return mcp.NewTool("AgentBroadcast",
		mcp.WithDescription(description),
		mcp.WithString("target_agent",
			mcp.Required(),
			mcp.Description("Name or slug of the agent to message, or 'all' to broadcast to all agents"),
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

// CreateNotifyUserTool creates the NotifyUser tool definition
func CreateNotifyUserTool() mcp.Tool {
	return mcp.NewTool("NotifyUser",
		mcp.WithDescription(`Display a notification to the user in the ClaudeFu UI.

Use this for:
- Important status updates (e.g., "Build complete")
- Warnings that need user attention
- Success confirmations
- Questions that need user awareness (not blocking questions)`),
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
	)
}
