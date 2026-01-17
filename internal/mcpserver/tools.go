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
