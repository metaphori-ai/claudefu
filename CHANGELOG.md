# Changelog

All notable changes to ClaudeFu will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-01-17

### Added
- **Configurable MCP Tool Instructions** - Customize the instructions/prompts for all MCP inter-agent tools
  - Tool instructions stored in `~/.claudefu/mcp_tool_instructions.json`
  - Editable via new "Tool Instructions" tab in MCP Settings pane
  - Configurable fields: AgentQuery, AgentQuerySystemPrompt, AgentMessage, AgentBroadcast, NotifyUser
  - "Reset to Defaults" button to restore original instructions
  - MCP server automatically restarts when instructions are saved

- **New Backend Domain Files** - Refactored `app.go` from ~1235 lines to ~295 lines
  - `app_agent.go` - Agent management (AddAgent, RemoveAgent, UpdateAgent, GetAgent)
  - `app_auth.go` - Authentication (API key, Hyper login)
  - `app_claude.go` - Claude CLI integration (SendMessage, NewSession, AnswerQuestion)
  - `app_claude_settings.go` - Claude Code project-local settings (Permissions, CLAUDE.md)
  - `app_dialogs.go` - Native dialog wrappers (SelectDirectory, ConfirmDialog, etc.)
  - `app_inbox.go` - MCP inbox management
  - `app_mcp.go` - MCP tool instructions bound methods
  - `app_session.go` - Session state and conversation loading
  - `app_settings.go` - Application settings
  - `app_util.go` - Utility methods (ReadImageAsDataURL, GetVersion)
  - `app_workspace.go` - Workspace CRUD and switching

- **ChatView Component Extraction** - Refactored `ChatView.tsx` from ~1705 lines to ~535 lines
  - `chat/ContentBlockRenderer.tsx` - Renders text, tool_use, tool_result, image, thinking blocks
  - `chat/ControlButtonsRow.tsx` - New Session, Planning Mode, View Plan, Permissions, CLAUDE.md buttons
  - `chat/DebugStatsOverlay.tsx` - Debug statistics display (message counts, costs, scroll info)
  - `chat/InputArea.tsx` - Prompt textarea with auto-resize and send button
  - `chat/MessageList.tsx` - Scrollable message container with scroll-to-bottom button
  - `chat/MessageRow.tsx` - Individual user/assistant message rendering
  - `chat/types.ts` - Shared TypeScript types

- **New Frontend Utilities**
  - `utils/scrollUtils.ts` - Scroll helpers (isNearBottom, scrollToBottom, scrollToBottomRAF, getScrollDebugInfo)
  - `utils/messageUtils.ts` - Message processing (formatTime, buildToolResultMap, buildPendingQuestionMap, computeDebugStats)

- **New Scroll Management Hook**
  - `hooks/useScrollManagement.ts` - Encapsulates scroll state, userHasScrolled tracking, auto-scroll logic

### Changed
- **MCP Settings Pane** - Wider panel (700px) with tabbed interface
  - "Configuration" tab for workspace-level MCP settings
  - "Tool Instructions" tab for customizing tool prompts
  - Fixed Save button at bottom with border separator
- **All MCP tools pre-approved** - AgentMessage added to `--allowed-tools` in both main session spawner and AgentQuery subprocess

### Fixed
- **AgentMessage permission prompt** - Tool was missing from `--allowed-tools` in `internal/providers/claudecode.go`, causing permission prompts when agents tried to use it

### Technical
- Backend follows "one domain per file" pattern with all methods on `*App` receiver
- Frontend follows component extraction pattern for maintainability
- Tool instructions manager handles backward compatibility for new fields
- MCP server restart on instruction changes ensures tools use latest prompts

## [0.2.9] - 2025-01-16

### Added
- **MCP Inter-Agent Tools** - New tools for agent-to-agent communication
  - `AgentQuery` - Synchronous stateless query to another agent
  - `AgentMessage` - Send message to specific agent(s) inbox
  - `AgentBroadcast` - Broadcast message to ALL agents
  - `NotifyUser` - Display toast notification in ClaudeFu UI
- **Notifications System** - Bell icon in header with notification history
  - Glow effect when unread notifications exist
  - Dialog showing notification list with type icons, timestamps, and originating agent
  - Clear all and individual delete options
- **Ko-fi Support Link** - Support button in header opens Ko-fi page in browser
- **MCP Logo** - Official MCP logo replaces sun/star icon in header and settings pane
- **MIT License** - Added LICENSE file to repository
- **README Disclaimer** - Added independence/trademark disclaimer under logo

### Changed
- **Splash Screen** - Added acknowledgments (Wails, Claude Code), trademark disclaimer, CLI requirement notice
- **Splash Minimum Duration** - Splash screen displays for minimum 3 seconds regardless of load time
- **Send Button** - Shows spinning indicator instead of "Sending..." text, fixed width to prevent size changes
- **Notification Toast** - Moved from bottom-left to top-right position

### Fixed
- **Folder Picker** - Added `CanCreateDirectories` option to fix macOS folder selection behavior (selecting folder now works without double-clicking into it)

## [0.2.8] - 2025-01-16

### Added
- **Permissions Dialog** - New dedicated dialog for managing Claude Code permissions
  - Core Tools section with toggles for all 18 built-in tools
  - Bash Permissions section with add/remove capability
  - Additional Directories section for configuring `additionalDirectories`
  - Alphabetized sorting on save (Core Tools → Bash → Others)
- **New toolbar icons** - `view-permissions.png` and `view-plan.png` with grey/orange hover styling
- **Start maximized** - App window now opens maximized by default

### Changed
- **ClaudeSettingsDialog** simplified to CLAUDE.md editor only (permissions moved to new dialog)
- **Icon layout** - Order: Plan (if exists) → Permissions → Clawd (CLAUDE.md)

### Technical
- Backend `ClaudePermissions` struct now includes `AdditionalDirectories`
- `SaveClaudePermissions` accepts and saves `additionalDirectories` array
- Wails `WindowStartState: options.Maximised` for maximized startup

## [0.2.7] - 2025-01-16

### Added
- **Homebrew distribution** - Install via `brew tap metaphori-ai/claudefu && brew install --cask claudefu`
- **Release script** - `./scripts/release.sh v0.2.7` builds, tags, releases, and updates Homebrew tap
- **Sessions dialog improvements** - New Session (+) and Refresh buttons in header
- **Workspace dropdown enhancements** - Rename Workspace option with keyboard shortcut hint (⌘S)
- **Keyboard shortcut hints** - New Workspace (⌘N) shown in dropdown

### Fixed
- **New workspace agent assignment** - Call `SwitchWorkspace` before adding agents so they're assigned to the correct workspace

## [0.2.6] - 2025-01-16

### Fixed
- **Context compaction card not displaying** - Compaction messages have both `isCompactSummary: true` AND `isVisibleInTranscriptOnly: true`. Fixed by exempting compaction summaries from the metadata filter.
- **CLI command metadata showing as user messages** - Filter out slash command invocations (`<command-name>...`) and local command output (`<local-command-...`) from chat display.
- **Summary events incorrectly displayed** - Summary events with `leafUuid` are reference pointers to other sessions, not actual content. Now properly filtered out instead of showing as "Context Compaction Summary".
- **Ghost sessions appearing** - Sessions containing only summary/metadata events no longer appear in the session list.

## [0.2.5] - 2025-01-15

### Fixed
- **New Session not working** - Fixed Claude CLI command by adding `--verbose` flag required when using `--print` with `--output-format stream-json`.
- **New Session UX** - Clear chat and show "Creating new session..." spinner while session is being created.

## [0.2.4] - 2025-01-15

### Fixed
- **Stale assistant messages deleted on answer** - When answering AskUserQuestion, delete Claude's "waiting" response from JSONL since it's invalid after patching is_error=false.
- **Watcher paused during patching** - Pause file watcher events for the session during JSONL patching to prevent stale data from racing with the reload. Resume after clean reload.
- **Synthetic messages filtered** - Frontend also filters synthetic assistant messages (model="<synthetic>") as safety net when question was answered successfully.
- **Backend cache reload after JSONL patch** - Added `ReloadSession` to watcher and `ClearSession` to runtime. After patching JSONL, the backend now clears and reloads the session cache from disk so `GetMessages` returns fresh data with `is_error=false`.

## [0.2.3] - 2025-01-15

### Added
- **Skip button** for AskUserQuestion - allows users to ignore questions and continue
- **Prompt area hint** - shows "Claude has a question... please answer above ↑" when waiting for answer
- **Submitting indicator** - spinner and "Submitting..." text after clicking Submit

### Fixed
- **Post-question text hidden** - Claude's error response after failed AskUserQuestion is now hidden until answered
- **Submit button overlay bug** - button now properly hides after submission with "Submitting..." indicator
- **Stuck in Submitting state** - reload conversation after answering to get fresh state
- **Question shows as Skipped** - explicitly set `is_error: false` in JSONL patch, removed `omitempty` from IsError JSON tag so false is always sent to frontend

### Changed
- Input area disabled when there's a pending question
- Cleaned up debug logging in convert.go

## [0.2.2] - 2025-01-14

### Added
- **Dynamic splash loader** with real-time loading status
  - Shows each initialization step: "Initializing settings...", "Loading workspace...", "Loading {AgentName}...", etc.
  - Bigger logo (400px, was 280px)
  - Reuses splash screen when switching workspaces
- Backend `loading:status` event emission throughout startup chain

### Changed
- Removed hardcoded 1.5s splash delay - transitions immediately when ready
- Workspace switch shows splash with live status updates

## [0.2.1] - 2025-01-13

### Added
- **Comprehensive README** with logo, features, tech stack, and installation guide
- **Architecture documentation** - Core principles, domain model hierarchy, communication flow diagram, file watcher strategy

### Changed
- Updated roadmap: Multi-Agent Orchestration, Parallel Execution, Dynamic MCP (agent-to-agent via MCP tools)
- Updated logo assets

## [0.2.0] - 2025-01-13

### Added
- **Interactive AskUserQuestion Support**
  - Detect failed AskUserQuestion tool calls from Claude Code `--print` mode
  - Interactive UI with clickable option buttons and "Other" text input
  - JSONL patching to inject successful tool_result and resume conversation
  - Full state machine: pending → user answers → conversation continues

### Fixed
- **Critical JSON parsing bug**: `ToolUseResult` field in `UserEvent` was typed as `map[string]any` but Claude Code outputs it as either a string or map. Changed to `any` to handle both cases, fixing silent unmarshal failures for `is_error:true` events.

### Technical Details
- `PendingQuestion` type for tracking unanswered questions
- `DetectPendingQuestions` in runtime.go matches tool_use with failed tool_result
- `PatchQuestionAnswer` in jsonl_patch.go rewrites JSONL with successful answer
- `AnswerQuestion` bound method orchestrates patch + resume flow

## [0.1.0] - 2025-01-12

### Added
- **Core Architecture**
  - Wails-based desktop app (Go backend + React frontend)
  - Workspace management with multiple agents per workspace
  - Session discovery and JSONL file watching
  - FIFO message buffer (750 messages per session)

- **JSONL Parsing**
  - Discriminated union classifier for Claude Code events
  - Support for user, assistant, tool_use, tool_result, summary (compaction) events
  - Smart fallback loading ensuring user messages are included

- **Chat Interface**
  - Real-time message streaming via file watcher
  - Markdown rendering with syntax highlighting
  - Tool call visualization with expandable details
  - Thinking block display (collapsible)
  - Image block support (base64, file, URL)
  - Compaction card with slide-in detail pane

- **Tool Detail Pane**
  - Resizable slide-in panel for tool inspection
  - Formatted input/output display per tool type
  - Subagent conversation viewer for Task tool

- **Auto-Scroll System**
  - Intent-based force scroll (activates on send, deactivates on scroll away)
  - 300px threshold for "near bottom" detection
  - Scroll-to-bottom button reactivates following

- **Debug Overlay**
  - Ctrl+D toggle for debug stats
  - Message type counts, scroll position, forceScroll state

- **Session Management**
  - Unread message tracking with badges
  - Last viewed persistence
  - Session list with previews

### Technical Details
- Race condition fix for initial load vs file watcher events
- Double-RAF scroll for reliable DOM update timing
- Shared SlideInPane component with localStorage width persistence
