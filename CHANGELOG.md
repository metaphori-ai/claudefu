# Changelog

All notable changes to ClaudeFu will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
