package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"claudefu/internal/providers"
	"claudefu/internal/types"
	"claudefu/internal/workspace"

	"github.com/mark3labs/mcp-go/server"
)

// MCPService provides an MCP server for inter-agent communication
type MCPService struct {
	server           *server.MCPServer
	claude           *providers.ClaudeCodeService
	workspace        func() *workspace.Workspace
	emitFunc         func(types.EventEnvelope)
	inbox            *InboxManager
	toolInstructions *ToolInstructionsManager
	port             int
	ctx              context.Context
	cancel           context.CancelFunc
	mu               sync.RWMutex
	running          bool
}

// NewMCPService creates a new MCP service on the specified port
// configPath is the base config path (e.g., ~/.claudefu)
// inboxConfigPath is the path to store inbox databases (e.g., ~/.claudefu/inbox)
func NewMCPService(port int, configPath string, inboxConfigPath string) *MCPService {
	return &MCPService{
		port:             port,
		inbox:            NewInboxManager(inboxConfigPath),
		toolInstructions: NewToolInstructionsManager(configPath),
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

// GetInbox returns the inbox manager for accessing messages
func (s *MCPService) GetInbox() *InboxManager {
	return s.inbox
}

// GetPort returns the port the MCP server is running on
func (s *MCPService) GetPort() int {
	return s.port
}

// GetToolInstructions returns the tool instructions manager
func (s *MCPService) GetToolInstructions() *ToolInstructionsManager {
	return s.toolInstructions
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
	mcpServer.AddTool(CreateAgentMessageTool(instructions.AgentMessage, agents), s.handleAgentMessage)
	mcpServer.AddTool(CreateAgentBroadcastTool(instructions.AgentBroadcast, agents), s.handleAgentBroadcast)
	mcpServer.AddTool(CreateNotifyUserTool(instructions.NotifyUser), s.handleNotifyUser)

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

	// Close inbox database
	if s.inbox != nil {
		s.inbox.Close()
	}

	s.running = false
	fmt.Println("[MCP] MCP server stopped")
}

// Restart stops and starts the MCP server (useful for workspace switches)
func (s *MCPService) Restart() error {
	s.Stop()
	return s.Start()
}

// LoadInbox opens the inbox database for a workspace
func (s *MCPService) LoadInbox(workspaceID string) error {
	return s.inbox.LoadWorkspace(workspaceID)
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
				Name:        agent.Name,
				Description: agent.MCPDescription,
			})
		}
	}
	return agents
}
