# Changelog

All notable changes to ClaudeFu will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
