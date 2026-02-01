# ClaudeFu

<p align="center">
  <img src="assets/claudefu-logo.png" alt="ClaudeFu Logo" width="400">
</p>

<p align="center">
  <em>ClaudeFu is an independent open source project and is not affiliated with, endorsed by, or sponsored by Anthropic, PBC.<br/>
  "Claude" and related marks are trademarks of Anthropic.<br/>
  This application requires a working <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code CLI</a> installation.</em>
</p>

<p align="center">
  <strong>Multi-Claude Code Orchestration Desktop App</strong>
</p>

<p align="center">
  Manage multiple Claude Code CLI instances from a unified interface with inter-agent communication, plan review, permission control, and real-time session monitoring.
</p>

---

## Installation

### Via Homebrew (Recommended)

```bash
brew tap metaphori-ai/claudefu
brew install --cask claudefu
```

**Upgrade to latest version:**
```bash
brew upgrade --cask claudefu
```

> **Note:** For unsigned builds, macOS may block the app. Right-click → Open, or go to System Settings > Privacy & Security, or run:
> ```bash
> xattr -cr /Applications/ClaudeFu.app
> ```

### Prerequisites

ClaudeFu requires the Claude Code CLI:

```bash
npm install -g @anthropic-ai/claude-code
```

### Reinstalling

```bash
rm -rf /Applications/ClaudeFu.app
brew uninstall --cask claudefu
brew untap metaphori-ai/claudefu
brew tap metaphori-ai/claudefu
brew install --cask claudefu
```

---

## Features

### Multi-Agent Dashboard
- Manage multiple Claude Code instances across different project folders
- Organize agents into **Workspaces** for different projects or workflows
- Per-agent MCP slugs and descriptions for inter-agent identification

### Real-Time Session Monitoring
- Watch Claude's conversation as it streams via JSONL file watching
- **Unread tracking** with badge indicators for sessions with new activity
- **Token metrics** — context window usage and total output tokens displayed per session
- **Session names** — custom display names for conversations

### MCP Inter-Agent Communication
ClaudeFu runs an MCP SSE server that gives every Claude Code agent access to orchestration tools:

- **AgentQuery** — Send a stateless query to another agent and get a synchronous response
- **AgentMessage** — Send messages to one or more agents' inboxes
- **AgentBroadcast** — Broadcast a message to all agents
- **SelfQuery** — Query your own codebase with full CLAUDE.md context
- **NotifyUser** — Display notifications in the ClaudeFu UI
- **AskUserQuestion** — Ask the user a question with options (blocks until answered)
- **RequestToolPermission** — Request permission to use restricted tools at runtime
- **ExitPlanMode** — Submit a plan for user review with Accept/Reject flow
- **BrowserAgent** — Delegate visual/DOM investigation to Claude in Browser *(experimental)*

All tools are configurable — toggle availability and customize instructions from the MCP Settings pane.

### Plan Mode & Review
- Toggle **Planning Mode** to have Claude write plans before implementing
- **Plan review UI** — when Claude calls ExitPlanMode, the plan pane auto-opens with Accept/Reject buttons
- Reject with feedback that Claude receives to iterate on the plan

### Permission System
- **Per-agent permissions** with risk-tiered tool control (common / permissive / YOLO)
- **Global permission template** for consistent defaults across agents
- Built-in permission sets: Claude tools, Git, Files, Docker, Go, Make, Node, Python
- Import from / sync to Claude's `settings.local.json`

### Interactive Tool Support
- **AskUserQuestion** — Answer Claude's questions directly in the UI with option selection or custom text
- **Permission requests** — Grant or deny tool permissions at runtime
- **Message queue** — Queue messages while Claude is responding; auto-submitted when the response completes

### Rich Conversation Display
- **Tool call visualization** — Expandable tool use/result blocks with formatted inputs and outputs
- **Subagent viewer** — Inspect Task tool spawned subagent conversations
- **Thinking blocks** — Collapsible extended thinking display
- **Context compaction** — View summary cards when Claude compacts conversation history
- **Image support** — Paste or drag-and-drop images into prompts
- **File references** — `@file` inserts paths, `@@file` attaches file content

### MCP Inbox
- Per-agent message inbox for inter-agent communication
- SQLite-backed persistence (survives app restart)
- Copy or inject inbox messages into the current prompt

### Embedded Terminal
- Multi-tab PTY terminal panel with Cmd+`` ` `` toggle
- Run shell commands alongside Claude conversations

### Settings & Configuration
- **Global Settings** — Environment variables for Claude CLI (e.g., proxy configuration), global/default CLAUDE.md editing
- **Per-agent CLAUDE.md** — Edit agent and global CLAUDE.md with markdown preview
- **MCP Settings** — Server configuration, tool availability toggles, customizable tool instructions
- **Native macOS menu** — Workspace and agent management from the menu bar

---

## Tech Stack

- **Backend**: Go with [Wails v2](https://wails.io/)
- **Frontend**: React + TypeScript + Vite
- **MCP Server**: SSE-based using [mcp-go](https://github.com/mark3labs/mcp-go)
- **Data**: Claude Code JSONL session files (`~/.claude/projects/`), SQLite for inbox persistence

## Architecture

### Core Principles

- **Single Source of Truth** — All state lives in Go backend, frontend is a view
- **Event-Driven** — State changes flow through Wails events, not polling
- **UUID Everywhere** — Workspace, Agent, Session all have stable UUIDs for event routing
- **Channel-Based Blocking** — MCP tools that need user input (AskUserQuestion, ExitPlanMode, RequestToolPermission) block on Go channels until the frontend responds

### Domain Model

```
Workspace (top-level container)
└── Agent (Claude Code instance tied to a folder)
    ├── Session (conversation in ~/.claude/projects/{folder}/)
    │   └── Subagent (Task tool spawned agents)
    └── Inbox (MCP messages from other agents)
```

### Communication Flow

```
┌─────────────────────┐                  ┌─────────────────────┐
│   Frontend (React)  │                  │   Backend (Go)      │
│                     │                  │                     │
│  ───Bound Methods──────────────────▶   │  WorkspaceRuntime   │
│     SendMessage()   │                  │  AgentState         │
│     AcceptPlanReview│                  │  SessionState       │
│     AnswerQuestion()│                  │                     │
│                     │                  │  FileWatcher        │
│  ◀────Wails Events─────────────────   │  (fsnotify)         │
│     session:messages│                  │                     │
│     mcp:planreview  │                  │  MCP Server (SSE)   │
│     mcp:askuser     │                  │  InboxManager       │
│     response_complete                  │  PendingQuestions    │
└─────────────────────┘                  └─────────────────────┘
                                                  │
                          ┌───────────────────────┼───────────────┐
                          │                       │               │
                          ▼                       ▼               ▼
                 ~/.claude/projects/     Claude Code CLI    MCP Clients
                 └── {folder}/          (spawned per        (each agent
                     └── *.jsonl         agent/session)      connects)
```

### Data Storage

**Claude Code sessions** (read-only, watched by ClaudeFu):
```
~/.claude/projects/
└── {encoded-folder}/              # Folder path with / → -
    ├── sessions-index.json        # Session registry
    ├── {session-id}.jsonl         # Main conversation
    └── {session-id}/
        └── subagents/
            └── agent-{id}.jsonl   # Task agent conversations
```

**ClaudeFu config** (managed by ClaudeFu):
```
~/.claudefu/
├── workspaces/{id}.json           # Workspace with agents list
├── current_workspace.txt          # Active workspace ID
├── session_state.json             # Last viewed timestamps
├── settings.json                  # Global settings (env vars)
├── mcp_tool_instructions.json     # Configurable MCP tool prompts
├── mcp_tool_availability.json     # Per-tool enable/disable
├── global.permissions.json        # Global permission template
├── default-templates/CLAUDE.md    # Default CLAUDE.md for new agents
└── inbox/{workspace-id}.db        # SQLite inbox per workspace
```

---

## Build from Source

```bash
# Clone the repository
git clone https://github.com/metaphori-ai/claudefu.git
cd claudefu/app

# Install frontend dependencies
cd frontend && npm install && cd ..

# Development mode with hot reload
wails dev

# Production build
wails build
```

## Project Structure

```
claudefu/app/
├── app.go                         # Core lifecycle, initialization
├── app_*.go                       # Domain-specific bound methods
│   ├── app_agent.go               #   Agent management
│   ├── app_claude.go              #   Claude CLI integration
│   ├── app_inbox.go               #   MCP inbox management
│   ├── app_mcp.go                 #   MCP tools, questions, permissions, plan review
│   ├── app_permissions.go         #   Permission system (v2)
│   ├── app_session.go             #   Session state and conversations
│   ├── app_settings.go            #   Application settings
│   └── app_workspace.go           #   Workspace CRUD
├── internal/
│   ├── mcpserver/                 # MCP SSE server
│   │   ├── server.go              #   Lifecycle, tool registration
│   │   ├── handlers.go            #   Tool handlers
│   │   ├── tools.go               #   Tool definitions
│   │   ├── askuser.go             #   AskUserQuestion blocking
│   │   ├── planreview.go          #   ExitPlanMode blocking
│   │   ├── inbox.go               #   Per-agent message queues
│   │   ├── tool_instructions.go   #   Configurable prompts
│   │   └── tool_availability.go   #   Per-tool enable/disable
│   ├── permissions/               # Permission file management
│   ├── providers/claudecode.go    # Claude CLI integration
│   ├── session/                   # Instant session creation
│   └── watcher/                   # JSONL file watcher
└── frontend/src/
    ├── context/                   # React Context (Workspace, Session, Messages)
    ├── hooks/                     # Custom hooks (useWailsEvents, useSession, etc.)
    ├── components/
    │   ├── ChatView.tsx           # Main conversation orchestrator
    │   ├── chat/                  # Extracted chat components
    │   ├── Sidebar.tsx            # Agent/session sidebar
    │   ├── MCPSettingsPane.tsx    # MCP configuration panel
    │   ├── PermissionsDialog.tsx  # Permission editor
    │   └── ...                    # Dialogs, panes, shared components
    └── utils/                     # Message processing, scroll helpers
```

## License

MIT

## Acknowledgments

- Built with [Wails](https://wails.io/)
- MCP server powered by [mcp-go](https://github.com/mark3labs/mcp-go)
- Integrates with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic
