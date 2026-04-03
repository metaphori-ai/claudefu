package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"claudefu/internal/providers"
	"claudefu/internal/types"
	"claudefu/internal/workspace"

	"github.com/mark3labs/mcp-go/server"
)

// MCPService provides an MCP server for inter-agent communication
type MCPService struct {
	server             *server.MCPServer
	claude             *providers.ClaudeCodeService
	workspace          func() *workspace.Workspace
	manager            *workspace.Manager
	emitFunc           func(types.EventEnvelope)
	inbox              *InboxManager
	backlog            *BacklogManager
	toolInstructions   *ToolInstructionsManager
	toolAvailability   *ToolAvailabilityManager
	pendingQuestions   *PendingQuestionManager
	pendingPermissions *PendingPermissionRequestManager
	pendingPlanReviews *PendingPlanReviewManager
	activeSessionGetter func(agentSlug string) (agentID, sessionID, folder, slug string)
	port               int
	ctx                context.Context
	cancel             context.CancelFunc
	mu                 sync.RWMutex
	running            bool
}

// NewMCPService creates a new MCP service on the specified port
// configPath is the base config path (e.g., ~/.claudefu)
// inboxConfigPath is the path to store inbox databases (e.g., ~/.claudefu/inbox)
// backlogConfigPath is the path to store backlog databases (e.g., ~/.claudefu/backlog)
func NewMCPService(port int, configPath string, inboxConfigPath string, backlogConfigPath string) *MCPService {
	return &MCPService{
		port:               port,
		inbox:              NewInboxManager(inboxConfigPath),
		backlog:            NewBacklogManager(backlogConfigPath),
		toolInstructions:   NewToolInstructionsManager(configPath),
		toolAvailability:   NewToolAvailabilityManager(configPath),
		pendingQuestions:   NewPendingQuestionManager(),
		pendingPermissions: NewPendingPermissionRequestManager(),
		pendingPlanReviews: NewPendingPlanReviewManager(),
	}
}

// SetClaudeService sets the Claude Code service for executing queries
func (s *MCPService) SetClaudeService(claude *providers.ClaudeCodeService) {
	s.claude = claude
}

// SetWorkspaceGetter sets the function to get the current workspace
func (s *MCPService) SetWorkspaceGetter(getter func() *workspace.Workspace) {
	s.workspace = getter
}

// SetEmitFunc sets the function to emit Wails events
func (s *MCPService) SetEmitFunc(emitFunc func(types.EventEnvelope)) {
	s.emitFunc = emitFunc
}

// SetManager sets the workspace manager for cross-workspace slug/UUID resolution
func (s *MCPService) SetManager(manager *workspace.Manager) {
	s.manager = manager
}

// SetActiveSessionGetter sets the function to resolve an agent slug to its active session context.
// Returns agentID, sessionID, folder, and session slug for JSONL writing.
func (s *MCPService) SetActiveSessionGetter(getter func(agentSlug string) (agentID, sessionID, folder, slug string)) {
	s.activeSessionGetter = getter
}

// GetInbox returns the inbox manager for accessing messages
func (s *MCPService) GetInbox() *InboxManager {
	return s.inbox
}

// GetBacklog returns the backlog manager for accessing backlog items
func (s *MCPService) GetBacklog() *BacklogManager {
	return s.backlog
}

// GetPort returns the port the MCP server is running on
func (s *MCPService) GetPort() int {
	return s.port
}

// GetToolInstructions returns the tool instructions manager
func (s *MCPService) GetToolInstructions() *ToolInstructionsManager {
	return s.toolInstructions
}

// GetPendingQuestions returns the pending questions manager
func (s *MCPService) GetPendingQuestions() *PendingQuestionManager {
	return s.pendingQuestions
}

// GetToolAvailability returns the tool availability manager
func (s *MCPService) GetToolAvailability() *ToolAvailabilityManager {
	return s.toolAvailability
}

// GetPendingPermissions returns the pending permission requests manager
func (s *MCPService) GetPendingPermissions() *PendingPermissionRequestManager {
	return s.pendingPermissions
}

// GetPendingPlanReviews returns the pending plan reviews manager
func (s *MCPService) GetPendingPlanReviews() *PendingPlanReviewManager {
	return s.pendingPlanReviews
}

// Start starts the MCP server
func (s *MCPService) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return nil // Already running
	}

	// Create context for this server instance
	s.ctx, s.cancel = context.WithCancel(context.Background())

	// Gather MCP-enabled agents for dynamic tool descriptions
	agents := s.getMCPEnabledAgentInfo()
	crossWorkspaceAgents := s.getCrossWorkspaceAgentInfo()

	// Get tool instructions
	instructions := s.toolInstructions.GetInstructions()

	// Create MCP server
	mcpServer := server.NewMCPServer(
		"ClaudeFu",
		"0.2.5",
		server.WithResourceCapabilities(true, true),
		server.WithPromptCapabilities(true),
		server.WithToolCapabilities(true),
	)

	// Register tools with dynamic agent list and configurable instructions
	mcpServer.AddTool(CreateAgentQueryTool(instructions.AgentQuery, agents), s.handleAgentQuery)
	mcpServer.AddTool(CreateAgentMessageTool(instructions.AgentMessage, agents, crossWorkspaceAgents), s.handleAgentMessage)
	mcpServer.AddTool(CreateAgentBroadcastTool(instructions.AgentBroadcast, agents), s.handleAgentBroadcast)
	mcpServer.AddTool(CreateNotifyUserTool(instructions.NotifyUser), s.handleNotifyUser)
	mcpServer.AddTool(CreateAskUserQuestionTool(instructions.AskUserQuestion), s.handleAskUserQuestion)
	mcpServer.AddTool(CreateSelfQueryTool(instructions.SelfQuery), s.handleSelfQuery)
	mcpServer.AddTool(CreateBrowserAgentTool(instructions.BrowserAgent), s.handleBrowserAgent)
	mcpServer.AddTool(CreateRequestToolPermissionTool(instructions.RequestToolPermission), s.handleRequestToolPermission)
	mcpServer.AddTool(CreateExitPlanModeTool(instructions.ExitPlanMode), s.handleExitPlanMode)
	mcpServer.AddTool(CreateBacklogAddTool(instructions.BacklogAdd), s.handleBacklogAdd)
	mcpServer.AddTool(CreateBacklogUpdateTool(instructions.BacklogUpdate), s.handleBacklogUpdate)
	mcpServer.AddTool(CreateBacklogListTool(instructions.BacklogList), s.handleBacklogList)
	mcpServer.AddTool(CreateMetalogsQueryTool(instructions.MetalogsQuery), s.handleMetalogsQuery)

	s.server = mcpServer

	// Start SSE server in goroutine
	go func() {
		sseServer := server.NewSSEServer(mcpServer,
			server.WithBaseURL(fmt.Sprintf("http://localhost:%d", s.port)),
		)

		addr := fmt.Sprintf(":%d", s.port)
		fmt.Printf("[MCP] Starting SSE server on %s\n", addr)

		httpServer := &http.Server{
			Addr:    addr,
			Handler: sseServer,
		}

		// Run server in a goroutine
		go func() {
			if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				fmt.Printf("[MCP] Server error: %v\n", err)
			}
		}()

		// Wait for context cancellation
		<-s.ctx.Done()
		fmt.Println("[MCP] Shutting down SSE server...")
		httpServer.Close()
	}()

	s.running = true
	fmt.Printf("[MCP] MCP server started on port %d\n", s.port)
	return nil
}

// Stop stops the MCP server
func (s *MCPService) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return
	}

	if s.cancel != nil {
		s.cancel()
	}

	// Cancel all pending questions
	if s.pendingQuestions != nil {
		s.pendingQuestions.CancelAll()
	}

	// Cancel all pending permission requests
	if s.pendingPermissions != nil {
		s.pendingPermissions.CancelAll()
	}

	// Cancel all pending plan reviews
	if s.pendingPlanReviews != nil {
		s.pendingPlanReviews.CancelAll()
	}

	// NOTE: Inbox and backlog databases are NOT closed here.
	// They remain open across Restart() to avoid a race where MCP tool calls
	// arrive between Stop()+Start() and LoadInbox()/LoadBacklog().
	// The databases are properly closed by LoadWorkspace() when switching
	// to a new workspace, or by the app's shutdown handler.

	s.running = false
	fmt.Println("[MCP] MCP server stopped")
}

// Restart stops and starts the MCP server (useful for workspace switches)
func (s *MCPService) Restart() error {
	s.Stop()
	return s.Start()
}

// CloseStores closes the inbox and backlog databases. Called on app shutdown.
func (s *MCPService) CloseStores() {
	if s.inbox != nil {
		s.inbox.Close()
	}
	if s.backlog != nil {
		s.backlog.Close()
	}
}

// LoadInbox opens per-agent inbox databases for the given agent IDs.
func (s *MCPService) LoadInbox(agentIDs []string) error {
	return s.inbox.LoadAgents(agentIDs)
}

// LoadBacklog opens per-agent backlog databases for the given agent IDs.
func (s *MCPService) LoadBacklog(agentIDs []string) error {
	return s.backlog.LoadAgents(agentIDs)
}

// IsRunning returns whether the MCP server is currently running
func (s *MCPService) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

// getMCPEnabledAgentInfo returns info for all MCP-enabled agents in the current workspace
func (s *MCPService) getMCPEnabledAgentInfo() []AgentInfo {
	if s.workspace == nil {
		return nil
	}

	ws := s.workspace()
	if ws == nil {
		return nil
	}

	var agents []AgentInfo
	for _, agent := range ws.Agents {
		if agent.GetMCPEnabled() {
			agents = append(agents, AgentInfo{
				Slug:        agent.GetSlug(),
				Name:        agent.GetSlug(),
				Description: agent.Description,
			})
		}
	}
	return agents
}

// getCrossWorkspaceAgentInfo returns info for agents with AGENT_CROSS_WORKSPACE=true
// that are NOT in the current workspace. Used for tool descriptions.
func (s *MCPService) getCrossWorkspaceAgentInfo() []AgentInfo {
	if s.manager == nil {
		return nil
	}

	// Build exclude set from current workspace slugs
	excludeSlugs := make(map[string]bool)
	if s.workspace != nil {
		if ws := s.workspace(); ws != nil {
			for _, agent := range ws.Agents {
				excludeSlugs[strings.ToLower(agent.GetSlug())] = true
			}
		}
	}

	registryAgents := s.manager.GetCrossWorkspaceAgents(excludeSlugs)
	var agents []AgentInfo
	for _, ra := range registryAgents {
		agents = append(agents, AgentInfo{
			Slug:        ra.GetSlug(),
			Name:        ra.GetSlug(),
			Description: ra.Meta["AGENT_DESCRIPTION"],
		})
	}
	return agents
}