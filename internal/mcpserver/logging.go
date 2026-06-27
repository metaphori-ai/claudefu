package mcpserver

import (
	"context"
	"fmt"
	"runtime/debug"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// MCP error logging. Previously an MCP failure could be completely silent: a
// handler that returned mcp.NewToolResultError(...) without also printing left
// the agent with an error and the logs with nothing, and protocol/transport-level
// errors (request parse failures, dispatch errors, transient SSE issues) never
// surfaced at all. These two hooks guarantee a `[MCP:ERROR]` breadcrumb for ANY
// MCP error:
//
//   - toolLoggingMiddleware wraps every tool handler — catches a returned error,
//     an error-result (IsError), AND a panic (with stack), tagged by tool name.
//   - newErrorLoggingHooks logs protocol/transport-level errors that never reach
//     a tool handler — the most likely source of "transient errors, nothing in
//     the logs, retry works".
//
// All output uses the existing fmt-to-stdout convention ([MCP:...] prefixes) so
// it lands in the same captured log stream as the rest of the MCP subsystem.

// toolLoggingMiddleware logs every tool-handler failure mode with the tool name.
// It is registered as the only tool middleware, so it is the innermost wrapper —
// its deferred recover catches handler panics first (rich stack), converting them
// into a clean error-result rather than letting the request goroutine die silently.
func toolLoggingMiddleware(next server.ToolHandlerFunc) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (result *mcp.CallToolResult, err error) {
		toolName := req.Params.Name
		start := time.Now()

		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("[MCP:ERROR] tool=%s PANIC after %s: %v\n%s\n",
					toolName, elapsed(start), r, debug.Stack())
				// Convert the panic into a normal error-result so the agent gets a
				// clear message and the SSE session isn't torn down.
				result = mcp.NewToolResultError(fmt.Sprintf("internal error in %s: %v", toolName, r))
				err = nil
			}
		}()

		result, err = next(ctx, req)

		switch {
		case err != nil:
			// A transport-level error: the agent typically sees a failed call.
			fmt.Printf("[MCP:ERROR] tool=%s failed after %s: %v\n", toolName, elapsed(start), err)
		case result != nil && result.IsError:
			// An error-result: NewToolResultError(...) returned by the handler.
			fmt.Printf("[MCP:ERROR] tool=%s error-result after %s: %s\n",
				toolName, elapsed(start), toolResultErrorText(result))
		}
		return result, err
	}
}

// newLoggingHooks returns Hooks that log the MCP connection lifecycle AND
// protocol/transport-level errors. The lifecycle logs exist to diagnose the
// "No such tool available: mcp__claudefu__*" failure — that error is emitted by
// the Claude CLI when the spawned process never finished loading our tool list,
// so it NEVER reaches a tool handler and produces no server-side error on its own.
// These breadcrumbs make the connection observable:
//
//   - session connected      → a spawned claude opened the SSE connection
//   - tools/list served (N)  → it actually received our N tools (the critical one:
//                              if a send has no matching line, the CLI never loaded
//                              our tools and any mcp__claudefu__* call will fail)
//   - tool call arrived      → a tool_use actually reached the server
//   - session disconnected   → the spawn finished / dropped
//
// Cross-referenced with the [MCP] Restarting line (server.go), an absent
// tools/list around a failing send pinpoints whether the CLI raced an SSE
// restart window or simply jumped the gun before the handshake completed.
func newLoggingHooks() *server.Hooks {
	hooks := &server.Hooks{}

	hooks.AddOnRegisterSession(func(ctx context.Context, session server.ClientSession) {
		fmt.Printf("[MCP] session connected: %s\n", shortID(session.SessionID()))
	})
	hooks.AddOnUnregisterSession(func(ctx context.Context, session server.ClientSession) {
		fmt.Printf("[MCP] session disconnected: %s\n", shortID(session.SessionID()))
	})
	hooks.AddAfterListTools(func(ctx context.Context, id any, message *mcp.ListToolsRequest, result *mcp.ListToolsResult) {
		n := 0
		if result != nil {
			n = len(result.Tools)
		}
		fmt.Printf("[MCP] tools/list served: %d tools\n", n)
	})
	hooks.AddBeforeCallTool(func(ctx context.Context, id any, message *mcp.CallToolRequest) {
		fmt.Printf("[MCP] → call tool=%s\n", message.Params.Name)
	})

	// Protocol/transport-level errors that never reach a tool handler
	// (request parse failures, unknown methods, session/dispatch errors).
	hooks.AddOnError(func(ctx context.Context, id any, method mcp.MCPMethod, message any, err error) {
		fmt.Printf("[MCP:ERROR] protocol method=%s id=%v: %v\n", method, id, err)
	})

	return hooks
}

// shortID truncates a session ID for compact logging.
func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// toolResultErrorText extracts the human-readable text from an error CallToolResult.
func toolResultErrorText(result *mcp.CallToolResult) string {
	if result == nil {
		return "(nil result)"
	}
	var parts []string
	for _, c := range result.Content {
		if tc, ok := c.(mcp.TextContent); ok {
			parts = append(parts, tc.Text)
		}
	}
	if len(parts) == 0 {
		return "(no text content)"
	}
	return strings.Join(parts, " | ")
}

func elapsed(start time.Time) time.Duration {
	return time.Since(start).Round(time.Millisecond)
}
