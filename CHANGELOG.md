# Changelog

All notable changes to ClaudeFu will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-03-23

### Added
- **Sequential migration system** — New `internal/workspace/migrations.go` with numbered, append-only migrations tracked in `~/.claudefu/migration-state.json`. Six migrations extracted covering agents v1→v2, current.json relocation, workspace registry population, camelCase→ALL_CAPS meta, and system attribute enforcement.

### Changed
- **Manager encapsulation** — All three registries (AgentRegistry, WorkspaceRegistry, MetaSchemaManager) are now private fields on Manager. All access goes through named Manager methods (`GetAgentInfo`, `FindAgentBySlug`, `UpdateWorkspaceMeta`, `GetMetaSchema`, etc.). No external code can reach registries directly.
- **MCP uses Manager** — MCPService replaced `registry *AgentRegistry` field with `manager *Manager`. Handlers use `s.manager.FindAgentBySlug()` and `s.manager.FindAgentByID()` instead of direct registry calls.
- **app_agent.go simplified** — All `a.workspace.Registry.*` calls replaced with Manager methods (`GetAgentInfo`, `UpdateAgentIdentity`).
- **app_workspace.go simplified** — `ReconcileWorkspace` called via Manager, not direct registry access.

## [0.5.2] - 2026-03-23

### Changed
- **AgentInfo NAMES fix** — Flattened `AgentInfo` struct to match `WorkspaceInfo`: removed dedicated `Name`, `Slug` fields, all values stored in `meta` map with ALL_CAPS keys (`AGENT_NAME`, `AGENT_SLUG`). Auto-migrates old camelCase fields on startup. Full NAMES consistency across both registries.

## [0.5.1] - 2026-03-23

### Added
- **File attribute type** — Meta schema now supports `file` type alongside text/textarea/folder. File type renders a text input + Browse button using native file picker (vs directory picker for folder type).

### Changed
- **WorkspaceInfo NAMES fix** — Flattened `WorkspaceInfo` struct: removed dedicated `name`, `slug`, `sifuName`, `sifuSlug` fields. All values now stored in `meta` map with ALL_CAPS keys matching attribute definitions (e.g., `WORKSPACE_NAME`, `WORKSPACE_SIFU_SLUG`). Eliminates NAMES violation where JSON keys were camelCase but attributes were ALL_CAPS.
- **Workspace registry migration** — On startup, automatically migrates old camelCase fields (`name`→`WORKSPACE_NAME`, `slug`→`WORKSPACE_SLUG`, etc.) into `meta` map. One-time migration, persisted immediately.
- **Browse paths normalized** — Folder and file Browse results in Workspaces & Agents dialog now normalize to `~/` prefix via `NormalizeDirPath`.
- **Removed default AGENT_TDA_ROOT and AGENT_MODULE** — Only `AGENT_DESCRIPTION` ships as a default custom agent attribute. Users add others via Schema tab.

## [0.5.0] - 2026-03-23

### Added
- **Meta Schema System** — Global attribute definitions (`~/.claudefu/meta-schema.json`) for workspace and agent metadata. System attributes (`system: true`) are non-removable; custom attributes are user-defined with ALL_CAPS names, text/textarea/folder types, and descriptions. Defaults loaded from embedded `default_meta_schema.json`.
- **Workspace Registry** — Centralized workspace metadata (`~/.claudefu/workspaces.json`) mirroring the agents.json pattern. Stores per-workspace slug, description, Sifu name/slug, and custom meta values. Auto-populates from existing workspace files on first startup.
- **Agent Meta Extension** — Added `meta` map to `AgentInfo` in agents.json for custom per-agent attribute values (backwards compatible).
- **Workspaces & Agents Dialog** — New global dialog accessible from sidebar with four tabs: Workspace Schema, Agent Schema, Workspaces (dropdown selector with field editor), and Agents (dropdown selector with workspace filter). Supports text, textarea, and folder input types with Browse button.
- **Copy path button in Permissions directories** — Each directory row (global and agent) now has a copy-to-clipboard button next to the remove/lock icon. Shows green checkmark for 2s on success.

### Fixed
- **Dialog backdrop drag-close bug** — Dialogs and slide-in panes no longer close when a text selection drag ends outside the dialog. Tracks mousedown origin so only deliberate backdrop clicks close the modal. Fixes DialogBase (all 12+ dialogs) and SlideInPane (tool detail, MCP settings, backlog, @references).
- **DirectoryRow render loop** — Moved DirectoryRow to module-level component to prevent unmount/remount cycle when copy state changed.
- **Sifu tab alignment** — Fixed text centering in Global Settings Sifu tab; labels and descriptions now left-aligned.

## [0.4.31] - 2026-03-19

### Changed
- **useErrorListeners hook** — Extracted auth:expired and rate:limited DOM event listeners from `useKeyboardShortcuts` into dedicated `useErrorListeners` hook. NAMES principle: each hook does what its name says.

## [0.4.30] - 2026-03-19

### Added
- **Rate limit detection** — Detects Claude CLI "hit your limit" errors and shows a dialog with the reset time. Same event chain pattern as auth:expired (backend emit → useWailsEvents → DOM event → useKeyboardShortcuts → App dialog).

## [0.4.29] - 2026-03-19

### Added
- **@ References Viewer** — New SlideInPane that parses `@/path/to/file` references from both agent and global CLAUDE.md files. Displays grouped list with drill-down preview using markdown rendering. Accessible via @ icon button in ControlButtonsRow.

## [0.4.28] - 2026-03-19

### Changed
- **App.tsx refactoring (Phase 1)** — Extracted 5 concerns from AppContent (1,832 → 1,153 lines, -37%):
  - `useNotifications` hook — notification toast + history + MCP subscription + update checks
  - `useMenuEvents` hook — 15 native macOS menu event subscriptions
  - `useKeyboardShortcuts` hook — CMD-N/R/1-9, Ctrl-`, Ctrl-Shift-D shortcuts
  - `StartupView` + `AuthView` components — self-contained view extractions
  - `NotificationToast` + `NotificationsDialog` components — presentational extractions
- Menu event handlers no longer duplicate workspace switch/create logic inline — they delegate to shared handlers, eliminating code duplication.

## [0.4.27] - 2026-03-19

### Fixed
- **Terminal keyboard handling** — Backspace, Alt+Left/Right word navigation now work correctly. Set `TERM=xterm-256color` for PTY, enabled `macOptionIsMeta` for Alt key, and added custom Alt+Arrow handlers for word-jump escape sequences.
- **Terminal left padding** — Added 10px left padding so text isn't flush against the window border.

## [0.4.26] - 2026-03-18

### Fixed
- **Agent name from registry** — Adding an existing agent (from agents.json) to a new workspace now uses the canonical name and slug from the global registry instead of deriving from the folder basename.

## [0.4.25] - 2026-03-18

### Fixed
- **Notarized build** — Re-release with proper Apple notarization for macOS Gatekeeper.

## [0.4.24] - 2026-03-17

### Added
- **Model selector** — Per-prompt model selector in ControlButtonsRow with 7 options: Opus 4.6 [1M], Opus Plan [1M], Sonnet 4.6 [1M] (1M context), and Opus 4.6, Opus Plan, Sonnet 4.6, Haiku 4.5 (200K context). Default Opus [1M] omits `--model` flag entirely.

### Changed
- **ExitPlanMode JSONL flush delay** — Increased from 500ms to 1500ms to ensure write is fully persisted before Claude resumes.
- **SendMessage bound method** — Now accepts `model` as 6th parameter, passed directly from frontend per-prompt selection to Claude CLI `--model` flag.

## [0.4.23] - 2026-03-17

### Fixed
- **ExitPlanMode JSONL structure — complete context reset** — Synthetic JSONL entries were missing `parentUuid`, `isSidechain`, `sessionId`, `sourceToolAssistantUUID`, `cwd`, `slug`, and `userType` fields. Claude Code requires these to link the tool_result back to the assistant's tool_use call; without them it discards the conversation chain and starts fresh (full context reset, not compaction). `FindLatestToolUseID` now also returns the assistant message UUID for use as `parentUuid`.

## [0.4.22] - 2026-03-14

### Added
- **Slash command passthrough** — `/context` and `/compact` commands pass through to Claude CLI. Output displayed as transient markdown-rendered inline messages (not persisted to JSONL). Backend `RunSlashCommand` method with ANSI code stripping.

### Fixed
- **1M context window** — Updated token metrics from 200K to 1M context window. "Left until compact" now shows both percentage and token count based on 33K autocompact buffer.
- **ExitPlanMode race condition** — Added 500ms delay after JSONL write before returning MCP result, ensuring Claude CLI reads the synced plan state transition.
- **Inbox store race condition** — `Stop()` no longer closes inbox/backlog SQLite databases. DBs remain open across `Restart()` to prevent message loss when tool calls arrive between stop and start. New `CloseStores()` for clean app shutdown.

### Removed
- **MCP slug row in sidebar** — Removed the link icon + agent slug row that appeared under session names.

## [0.4.21] - 2026-03-12

### Added
- **MetalogsQuery MCP tool** — Agents can now query the Metalogs log aggregation system via `mcp__claudefu__MetalogsQuery`. Filters by `site`, `layer`, `level`, `collection`, `contains`, `since` (default `1h`), and `limit` (default `50`). Disabled by default; enable in MCP Settings → Tool Availability. Requires `~/go/bin/metalogs` CLI.

### Improved
- **Workspace file cleanup (v4 slim format)** — Workspace JSON files no longer duplicate agent `name` and `folder` (already canonical in `agents.json`). Agents array now stores only `id`, `watchMode`, `mcpEnabled`, `mcpDescription`. On load, agents are enriched from the registry via `EnrichWorkspaceAgents`. Old-format workspaces (v0–v3) load identically; first save rewrites to v4. Removes `Created` timestamp from workspace files.
- **`agents.json` sorted case-insensitively by folder path** — Previously sorted by raw ASCII byte value, placing uppercase paths (`TrueMemory`) before lowercase (`anyscale`). Now uses case-insensitive sort so all paths interleave naturally. Applied to all write paths (`GetOrCreateID`, `UpdateAgentMeta`, `ReconcileWorkspace`, etc.).
- **Agent rename persists to `agents.json`** — Renaming an agent from the sidebar (inline edit, rename dialog, or macOS menu) now calls the backend `UpdateAgent`, keeping `agents.json` name/slug in sync. Previously only `ManageAgentsDialog` persisted renames.

## [0.4.20] - 2026-03-10

### Fixed
- **Project path encoding matches Claude Code exactly** — Claude CLI encodes folder paths by replacing *every* non-alphanumeric character with `-` (`/[^a-zA-Z0-9]/g → "-"`), but ClaudeFu only replaced `/` and `_`. Projects with dots, spaces, or other special characters in their path (e.g., `hello.world`) would fail to match their session directory. Fixed all 4 packages (`workspace`, `session`, `watcher`, `scaffold`) to use `regexp.MustCompile("[^a-zA-Z0-9]")`. Found by inspecting Claude Code's npm source via `npm pack`.

### Added
- **Auth expired modal** — When Claude CLI returns an OAuth 401 (`authentication_failed`), ClaudeFu now shows a modal telling the user to run `/login` in Claude Code terminal. Previously the error was silently swallowed. Backend emits `auth:expired` event, extracted `emitResponseComplete()` helper to DRY two identical blocks in `app_claude.go`.

## [0.4.19] - 2026-03-09

### Fixed
- **ExitPlanMode JSONL structure alignment** — Claude Code's plan mode tracker expects `toolUseResult: {plan, isAgent, filePath}` but our MCP ExitPlanMode returned a generic text result written as `toolUseResult: [{type:"text",...}]`, causing Claude to loop calling ExitPlanMode thinking plan mode was still active. Fixed by writing a synthetic JSONL entry matching the built-in format before returning the MCP result. Added `WritePlanReviewResult()` and `FindLatestToolUseID()` to `jsonl_patch.go`, wired `activeSessionGetter` through MCPService for session context resolution.

### Added
- **Alignment feedback on plan accept** — Users can now provide optional alignment notes when accepting a plan (not just when rejecting). Feedback appears as `ADDITIONAL ALIGNMENT FEEDBACK:` in the JSONL content, guiding Claude's implementation. Textarea placeholder and accept button label update dynamically.

## [0.4.18] - 2026-03-07

### Fixed
- **Draft persistence actually works across agent switches** — The v0.4.14 implementation was broken because `ChatView` has a React `key` prop including `agentId`, causing full component remount on agent switch. The old `prevAgentIdRef` approach never detected changes (ref initialized to the *new* agent on mount). Fixed by lifting the `draftsRef` Map to `App.tsx` (survives remounts) and using mount/unmount lifecycle: restore draft on mount, save to `draftsRef` + localStorage on unmount. Added `onInputChange` callback from `InputArea` to keep the current draft ref in sync.

### Improved
- **Extracted Slack changelog posting into standalone script** — Split `scripts/release.sh` Slack posting logic (~90 lines) into `scripts/post-changelog.sh` for ad-hoc use (e.g., `./scripts/post-changelog.sh v0.4.16`). Release script now calls it as a non-fatal step.

## [0.4.17] - 2026-03-07

### Fixed
- **Concurrent map panic in SaveWorkspaceState** — `SetActiveSession` writes to the `AgentSessions` map while `SaveWorkspaceState` serializes it via `json.MarshalIndent`, causing a concurrent map read/write panic. Fixed by snapshotting the map before serialization.

### Improved
- **Enhanced MCP debug logging** — `findMCPEnabledAgent` now logs all available agents (with slug and MCP status) when no match is found, making slug mismatches easier to diagnose. Inbox message persistence and retrieval now log success/failure with agent IDs.
- **Plan file debug logging** — `GetPlanFilePath` and `TouchPlanFile` now log at every exit point, helping diagnose "no plan file" issues when sessions lack slugs.
- **README dev setup** — Added missing `go install wails` instruction to development setup steps.
- **Release script Slack posting** — Split changelog into multiple Slack messages to avoid the 3000-character block limit that was truncating release notes.

## [0.4.16] - 2026-03-07

### Fixed
- **Permission path handling — normalize, expand, and convert** — Three new utility functions (`NormalizePath`, `ExpandPath`, `ToClaudeSettingsPath`) fix two bugs: (1) `--add-dir ~/svml` passed literal `~` to CLI because Go's `exec.Command` doesn't expand shell tilde, (2) `SyncToClaudeSettings` wrote `/Users/jasdeep/svml` which Claude Code interpreted as project-relative (gitignore syntax: `/path` = project-relative, `//path` = absolute). Paths are now stored in canonical `~/relative` format, expanded to real filesystem paths for `--add-dir`, and converted to gitignore syntax (`~/` or `//`) for `settings.local.json`.
- **Duplicate directory entries auto-consolidated** — Entering both `~/svml` and `/Users/jasdeep/svml` previously created duplicate entries. Paths are now normalized on read (in-memory) so duplicates collapse immediately, and persist on next save. Covers v1→v2 migration and import-from-Claude paths too.
- **Auto-sync permissions to settings.local.json on save** — `SaveAgentPermissions` now automatically syncs to Claude's `settings.local.json` after saving (best-effort, doesn't fail the save). Removed the manual "Sync to settings.local" button from the UI since every save now triggers sync.
- **Directory browse shows canonical paths** — Browsing for a directory via native file picker now normalizes the result (e.g., `/Users/jasdeep/svml` → `~/svml`) before displaying in the UI.

## [0.4.15] - 2026-03-05

### Fixed
- **"Inject into Prompt" button in Inbox dialog now works** — Previously clicked "Inject into Prompt" sent the message directly to Claude CLI via backend, bypassing the input area entirely. Now it prepends the formatted message into InputArea for user review and editing before sending. Message stays in inbox (marked as read) for future reference. Uses the established custom DOM event pattern (`claudefu:inject-into-prompt`) for Sidebar→ChatView communication.

## [0.4.14] - 2026-03-05

### Added
- **Message draft persistence across agent switches** — Typing a message in one agent and switching to another no longer loses the draft. Drafts (text + file attachments) are saved per-agent in memory and restored when switching back. Text drafts also persist to localStorage so they survive app restarts. Image attachments are excluded from localStorage to avoid quota limits but are preserved for same-session agent switches.

## [0.4.13] - 2026-03-05

### Fixed
- **Syncthing sync conflicts on runtime state files** — Per-machine ephemeral state (selected session, current workspace, last-viewed timestamps) was stored in synced config files, causing constant `*-sync-conflict-*` files when using ClaudeFu on multiple machines. Decoupled runtime state into `~/.claudefu/local/` which can be `.stignore`d:
  - `session-views.json` → `local/session-views.json` (last-viewed timestamps, written every session click)
  - `current.json` → `local/current.json` (active workspace ID, written every workspace switch)
  - Workspace runtime fields (`selectedSession`, `lastOpened`, per-agent `selectedSessionId`) → `local/workspace-state/{workspace_id}.json`
  - Shared data (workspaces, agents, inbox, backlog, settings) remains in synced root — only ephemeral view state moves
  - One-time automatic migration on first launch: old files moved to new locations if not already present
  - `SaveWorkspace()` now strips runtime fields via copy-and-strip pattern, keeping in-memory structs populated for frontend/menu while writing clean config-only JSON to disk
  - Zero frontend changes required — backend populates in-memory workspace from state file on load

## [0.4.12] - 2026-03-03

### Added
- **Cross-Workspace MCP Agent Resolution** — MCP tools (BacklogAdd, BacklogList, etc.) now resolve agents across all workspaces, not just the active one
  - `resolveAgentID()` upgraded with 4-step resolution chain: UUID fast path → workspace slug → registry slug → "Did you mean?" error
  - Agents can pass their UUID directly as `from_agent` for instant resolution without slug lookup
  - Global registry stores slug/name metadata alongside UUIDs for cross-workspace slug matching
  - "Did you mean?" errors with substring-matched suggestions when agent not found

- **Registry v2 Format** — Agent registry upgraded from `folder → UUID` to `folder → {id, slug, name}`
  - Automatic v1→v2 migration on load (transparent, preserves all existing entries)
  - New methods: `FindByID`, `FindBySlug`, `AllSlugs`, `UpdateAgentMeta`, `GetInfo`
  - **Canonical slug (first-write-wins)**: Registry slug set once on first registration and preserved across workspaces. Same folder added to a different workspace with a different name won't overwrite the canonical slug. Only explicit user edits via `UpdateAgent` change it.

- **CLAUDE.md Agent Identity Template Variables** — New agents automatically get `{AGENT_ID}` and `{AGENT_SLUG}` in their scaffolded CLAUDE.md
  - Template at `~/.claudefu/default-templates/CLAUDE.md` now supports `{AGENT_ID}` and `{AGENT_SLUG}` alongside existing `{PROJECT_NAME}`
  - Prevents agent identity confusion in MCP tool calls (e.g., `from_agent` in BacklogAdd/BacklogList)
  - `ScaffoldAgent` uses canonical slug from global registry when available, falls back to `Slugify(name)` for new agents
  - Exported `workspace.Slugify()` for cross-package slug derivation

### Fixed
- **Registry slug overwritten on workspace switch** — When the same folder was added to multiple workspaces with different agent names, `ReconcileWorkspace()` and `AddAgent()` would overwrite the canonical registry slug on each workspace load. This broke cross-workspace `from_agent` resolution (e.g., `BacklogList` with `from_agent: "claudefu-main"` would fail if the last-loaded workspace used a different slug). Fixed with first-write-wins semantics: registry slug is set once and only explicit user edits via `UpdateAgent()` can change it.

- **Backlog `from_agent` identity confusion** — Agents could accidentally use another agent's slug as `from_agent`, routing backlog items to the wrong database. Strengthened `from_agent` parameter descriptions in BacklogAdd and BacklogList tools with explicit guidance to check CLAUDE.md Agent Identity section.

- **Folder encoding mismatch for paths with underscores** — Claude CLI encodes folder paths by replacing both `/` and `_` with `-`, but ClaudeFu only replaced `/`. This caused sessions created by ClaudeFu to land in a different directory than where Claude CLI looks, resulting in "No conversation found" errors when resuming. Fixed all 7 encoding locations across 4 files (session creation, scaffold, file watcher, workspace).

- **`---` pattern causing ClaudeFu to hang** — Messages containing `---` (POSIX option terminator) caused Claude CLI to hang when passed via `-p` argument. All message sending now uses stdin stream-json (`sendViaStdin`), completely bypassing CLI argument parsing. Affects all special characters: `---`, backticks, quotes, etc.

- **File watcher infinite loop during streaming** — During Claude streaming, fsnotify fired hundreds of Write events per second (~569 bytes each). `handleFileChange` ran on every event, read incomplete JSONL lines, found 0 messages, and never advanced `filePos` — creating a CPU-burning hot loop. Added 200ms per-path debounce timer with "don't reset" strategy, reducing processing to ~5 calls/sec during streaming.

- **File watcher paused on agent switch** — Switching agents during an active Claude response caused the file watcher to stop monitoring the previous agent's session. Refactored from single `activeSessionPath` to per-agent `agentSessionPaths map[string]string`, so each agent in the workspace watches its own selected session file simultaneously. Added `restoreAgentSessionWatches()` at startup and workspace switch to resume all persisted per-agent watches.

- **MCP AskUserQuestion/RequestToolPermission/ExitPlanMode getting stuck** — When MCP tool handlers timed out, were cancelled, or the context was shut down, the frontend dialog was never dismissed. Added dismiss event emission (`mcp:askuser:dismissed`, `mcp:permission-request:dismissed`, `mcp:planreview:dismissed`) from all handler exit paths (timeout, cancel, context done, shutdown) and corresponding frontend handlers to clear pending UI state.

### Changed
- Unified `SendMessage` to always use stdin stream-json (removed separate `-p` CLI argument code path)
- Removed unused `readNewMessages` method (replaced by `readNewMessagesLimited`)
- `ClearActiveSession()` no longer unwatches the file watcher — per-agent watching means each agent's session stays monitored even when the user switches to a different agent
- `ClearActiveSessionWatch()` now takes `agentID string` parameter (was no-args)
- `resolveAgentID` now returns `(string, error)` instead of `string` for richer error messages

## [0.4.10] - 2026-02-15

### Added
- **Global Agent Registry** — Same folder now gets the same agent UUID across all workspaces
  - Registry persisted at `~/.claudefu/agents.json` (folder path → UUID mapping)
  - `GetOrCreateID()` is idempotent: same folder always returns the same UUID
  - Agent ID reconciliation runs on workspace load and switch, aligning IDs with registry
  - Duplicate folder prevention: cannot add the same folder twice to one workspace

- **Per-Agent Backlog Databases** — Backlog DBs now stored per-agent instead of per-workspace
  - Storage moved from `~/.claudefu/backlog/{workspace_id}.db` to `~/.claudefu/backlog/agents/{agent_id}.db`
  - Aligns with TDA specification; backlog items follow the agent across workspaces
  - `BacklogManager` refactored to multi-store with lazy-open per agent

- **One-Time Migration** — Automatic migration of existing backlog and inbox data
  - Old per-workspace backlog DBs migrated to per-agent DBs on startup/workspace switch
  - Inbox agent IDs updated in-place when reconciliation remaps IDs
  - Old DBs renamed to `.migrated` suffix (data preserved, idempotent)

## [0.4.9] - 2026-02-15

### Added
- **Backlog Feature** — Hierarchical, orderable feature memory for both users and Claude agents
  - Per-agent backlog scoped by `from_agent` slug — each agent maintains its own backlog
  - Rich context storage: SVML fragments, markdown notes, research, architectural decisions
  - 5 status values: `idea`, `planned`, `in_progress`, `done`, `parked`
  - Hierarchical items with parent/child relationships (subtasks)
  - Sort ordering with 1000-gap strategy and automatic reindexing
  - Tags as comma-separated strings with substring filtering
  - 8 item types orthogonal to status: `bug_fix`, `new_feature`, `feature_expansion`, `improvement`, `refactor`, `validation`, `tech_debt`, `documentation`
  - Color-coded type badges in item rows and type filter dropdown in toolbar

- **Backlog MCP Tools** — 3 new tools for Claude agents to manage backlog items
  - `BacklogAdd` — Create items with title, context, status, type, tags, and parent_id
  - `BacklogUpdate` — Modify items; `append:` prefix on context appends instead of replacing
  - `BacklogList` — List items with status/type/tag filters; XML output format for clean parsing
  - `from_agent` required on Add/List to scope items to the calling agent
  - Tool availability toggles and configurable instructions in MCP Settings

- **Backlog UI — BacklogPane** — Right-side slide-in panel for browsing backlog
  - Tree view with indentation for parent/child hierarchy
  - Status filter dropdown and Type filter dropdown
  - Search input filtering by title and tags
  - Color-coded status dots and badges per item
  - Hover actions: Edit, Add Subtask, Delete
  - Item count footer with done/total breakdown
  - Accessible via Backlog button in ControlButtonsRow (with non-done count badge)

- **Backlog UI — BacklogEditorDialog** — Full context editing dialog
  - Title, Status dropdown, Type dropdown, Tags input, and large monospace Context textarea
  - Supports creating new items, editing existing, and adding subtasks
  - Park flow: opens with status pre-set to "parked" and initial context
  - CMD-S keyboard shortcut to save
  - Consistent DialogBase styling matching PermissionsDialog (proper footer, padding, border-radius)

- **Backlog Backend** — SQLite persistence with per-agent database files
  - Storage: `~/.claudefu/backlog/{agent_id}.db`
  - `BacklogStore` with full CRUD, hierarchy queries, and sort order management
  - `BacklogManager` with RWMutex thread safety and workspace lifecycle
  - `backlog:changed` event emission with totalCount/nonDoneCount payload
  - 7 bound methods: GetBacklogItems, GetBacklogItem, AddBacklogItem, UpdateBacklogItem, DeleteBacklogItem, MoveBacklogItem, GetBacklogCount

### Changed
- **BacklogList XML Output** — Switched from markdown bullets to XML format
  - Each item wrapped in `<item id="..." status="..." type="..." tags="...">` with `<title>` and `<context>` children
  - Prevents context bleed between items when rich SVML/markdown content is present
  - IDs as XML attributes are easily extractable by Claude for BacklogUpdate references
- **TDA Documentation Updated** — Backend TDA, Frontend TDA, and CLAUDE.md updated with full backlog architecture

## [0.4.8] - 2026-02-01

### Improved
- **AgentQuery/SelfQuery session labels** — Prepend "AgentQuery: " and "SelfQuery: " to spawned queries so they're identifiable in the session list

## [0.4.6] - 2026-02-01

### Fixed
- **Planning mode auto-clear** — Planning mode toggle now resets after each send, preventing unintentional plan mode on subsequent prompts
- **Lock required MCP tools** — AskUserQuestion and ExitPlanMode toggles in MCP Settings are now locked on (required for ClaudeFu operation)
- **Remove ExitPlanMode from permission sets** — Removed built-in ExitPlanMode from claude-builtin permissive tier (always replaced by MCP version)

## [0.4.5] - 2026-02-01

### Added
- **ExitPlanMode MCP tool** — Replaces Claude's built-in ExitPlanMode (which fails in non-interactive CLI mode) with a channel-based MCP tool following the same pattern as AskUserQuestion
  - Plan SlideInPane auto-opens with Accept/Reject buttons when Claude calls ExitPlanMode
  - Pulsing "Claude is waiting for your approval" indicator
  - Reject with optional feedback text that Claude receives to iterate on the plan
  - 10-minute timeout with graceful cancellation
- **MCP Settings pane** — Added RequestToolPermission and ExitPlanMode to Tool Availability toggles and Tool Instructions editors

### Fixed
- **Tool availability defaults for new fields** — Existing `mcp_tool_availability.json` files missing new bool fields now correctly default to `true` instead of `false` (Go zero-value trap fix)

## [0.4.4] - 2026-02-01

### Fixed
- **Scaffold session selection** — After Init dialog creates a session for a new/existing agent, the session is now properly selected and visible in ChatView
  - Root cause: ScaffoldDialog called `onClose()` after `onConfirm()`, triggering cancel logic that cleared the session selection
  - Also batches all state updates (addAgent + selectAgent + selectSession) after async calls to avoid intermediate renders

## [0.4.3] - 2026-02-01

### Added
- **CLAUDE.md Editing in Global Settings** — Two new tabs in Global Settings dialog
  - "Global CLAUDE.md" edits `~/.claude/CLAUDE.md` (Claude Code's global instructions)
  - "Default CLAUDE.md" edits `~/.claudefu/default-templates/CLAUDE.md` (template for new agents)
  - Edit/Preview toggle with markdown rendering (ReactMarkdown + remark-gfm)
  - Independent save per tab (CMD-S supported)
- **CLAUDE.md Local/Global Tabs** — Agent CLAUDE.md dialog now has Local and Global tabs
  - Local tab edits `{agent_folder}/CLAUDE.md` (unchanged behavior)
  - Global tab edits `~/.claude/CLAUDE.md` (same file as Global Settings)

### Fixed
- **Placeholder text visibility** — Global CSS rule sets placeholder color to `#555` for clear distinction from input text

## [0.4.2] - 2026-01-31

### Added
- **CLI Agent Addition** - `claudefu .` or `claudefu /path/to/folder` adds a folder as an agent
  - Interactive terminal prompt to select workspace (alphabetical, numbered list)
  - `--workspace "name"` flag for non-interactive use (case-insensitive match)
  - Invalid `--workspace` name falls through to interactive prompt
  - Single workspace auto-selected without prompt
  - Deduplication: if folder already exists as agent, selects it instead of duplicating
  - Homebrew cask already symlinks binary to `claudefu` on PATH

- **Externalized MCP Tool Instructions** - Default tool prompts moved from hardcoded Go strings to `default_tool_instructions.json` (embedded via `go:embed`)
  - Single source of truth for all default prompts (12 fields including compaction prompts)
  - `~/.claudefu/mcp_tool_instructions.json` auto-generated on first launch with identical format
  - New fields auto-backfilled on upgrade without losing user customizations
- **Compaction Prompts** - Added configurable `compactionPrompt` and `compactionContinuation` to tool instructions
  - Stored in same format as all other tool instructions
  - Customizable via MCP Settings pane (not yet wired to compaction flow)

- **Agent Initialization Dialog** — Checks 4 setup items when adding/selecting an agent
  - Claude projects directory, Sessions, CLAUDE.md, Permissions
  - Toggleable checkboxes for missing items, "All set!" when complete
  - Creates first session automatically when scaffolding projects dir
  - All 3 agent-switch paths (click, CMD+N, menu) go through scaffold check

### Changed
- **Slug-Based Plan File Detection** - Replaced regex content scanning with JSONL slug field
  - Plan file path now derived from session slug: `~/.claude/plans/{slug}.md`
  - Removed ~50 lines of regex + JSON marshaling (`extractPlanFilePath`, `planPathRegex`)
  - Slug propagated end-to-end: JSONL event → Go `Message.Slug` → Frontend
  - View Plan button now visible whenever session has a slug (virtually always)
  - `TouchPlanFile` creates the plan file on-demand if it doesn't exist yet
  - Frontend no longer polls backend on every message change — slug derived client-side via `useMemo`

## [0.4.1] - 2026-01-28

### Added
- **Embedded Terminal Panel** - VS Code-style terminal panel at the bottom of the app
  - Toggle via header button (terminal icon) or **Cmd+`** / **Ctrl+`** keyboard shortcut
  - Multi-tab support with right-side tab list (VS Code layout)
  - Each tab spawns a real PTY shell (`$SHELL` or `/bin/zsh`) in the selected agent's folder
  - Resizable panel height with drag handle, persisted to localStorage
  - Full ANSI escape code support via xterm.js (colors, cursor positioning, TUI apps)
  - Inline flex layout — chat content shrinks to accommodate terminal, no overlay
  - Backend: `internal/terminal/manager.go` (Go PTY manager using `creack/pty`)
  - Frontend: `@xterm/xterm` + `@xterm/addon-fit` for terminal rendering

- **Context Headroom Indicator** - Shows "% left until auto-compact" in token metrics
  - Displays in orange next to context percentage: `ctx 96.0k (48.0%) (30% left)`
  - Calculated from 77.5% auto-compact threshold (100% - 22.5% buffer)
  - Formula: `left = max(0, 77.5 - currentContextPercent)`
  - Helps users anticipate when Claude Code will trigger auto-compaction

### Fixed
- **AgentQuery/SelfQuery API Concurrency Errors** - Fixed "tool_use ids must be unique" and concurrency errors
  - **Root cause**: Child Claude processes were sharing MCP SSE connection with parent
  - **Fix 1**: Removed `--mcp-config` from child spawns - stateless queries don't need inter-agent tools
  - **Fix 2**: Added `--disallowed-tools Task` - prevents subagent spawning which caused API conflicts
  - **Fix 3**: Added retry logic (up to 3 attempts) with exponential backoff (500ms, 1000ms, 1500ms)
  - Retries only on transient errors: "concurrency issues" or "tool_use ids must be unique"
  - Detailed failure logging shows exact command to reproduce issues

## [0.4.0] - 2026-01-24

### Added
- **Instant Session Creation** - New sessions are created instantly without waiting for Claude CLI
  - Previous: Clicking "New Session" spawned Claude CLI with a dummy prompt, waited 15-30+ seconds
  - Now: Writes starter exchange to JSONL + updates `sessions-index.json` (instant!)
  - Starter exchange: User "Starting a new session with Claude." → Assistant "I'm ready for action..."
  - Claude CLI's `--resume` picks up from the starter exchange seamlessly
  - New `internal/session/` package with `SessionService` for programmatic session management
  - Key discovery: Assistant messages require `content` as array of content blocks, not plain string

- **Token Metrics Display** - Show full context breakdown below InputArea
  - `in`: Non-cached input tokens (fresh content this turn)
  - `cr`: Cache read tokens (content from Anthropic's prompt cache)
  - `cw`: Cache write tokens (content written to cache this turn)
  - `ctx`: Total context window = in + cr + cw (with percentage of 200K)
  - `out`: Cumulative output tokens generated
  - Display: "in 8 | cr 139.8k | cw 354 | ctx 140.2k (70.1%) | out 45.2k"
  - Metrics automatically reflect context compaction (uses latest values)
  - Formatted with K/M suffixes (e.g., "12.5k", "1.2M")

- **Token Usage Documentation** - Comprehensive token behavior documentation in TDA
  - New section in `claude-code-jsonl-schema.tda.svml.md`
  - Documents context calculation formula: `ctx = in + cr + cw`
  - Documents compaction effects (cr drops dramatically, cw spikes)
  - Documents streaming output_tokens behavior (per-chunk in JSONL)
  - Documents ~5-6% variance between Claude Code /context and API usage

### Changed
- **SessionService Architecture** - Session creation moved from `ClaudeCodeService` to dedicated service
  - `app.sessionService` handles instant session creation
  - Writes `file-history-snapshot`, user message, and assistant response in Claude's exact format
  - `sessions-index.json` updated with proper format (version as int, fileMtime as milliseconds)

## [0.3.20] - 2026-01-23

### Added
- **Quit ClaudeFu Menu Item** - Standard macOS app menu items now present
  - Hide ClaudeFu (⌘H)
  - Quit ClaudeFu (⌘Q)
- **Debug: CLI Command Display** - Debug overlay (Ctrl+D) now shows the last executed Claude CLI command
  - Useful for debugging permission args, MCP config, env vars
  - Command includes all args: `--allowedTools`, `--add-dir`, `--mcp-config`, etc.

### Fixed
- **Bash Patterns Not Working Without YOLO** - Auto-add `Bash` to `--tools` when patterns exist
  - `Bash(git status:*)` patterns in `--allowedTools` require `Bash` in `--tools` pool
  - Previously: Bash only added to `--tools` when YOLO tier enabled
  - Fix: Detect any `Bash(...)` pattern and ensure `Bash` is in available tools
  - Now git/files/etc patterns work without enabling blanket Bash YOLO
- **Blanket Bash in YOLO Auto-Approving All Commands** - Exclude `Bash` from `--allowedTools`
  - When `Bash` was in YOLO tier, it was added to `--allowedTools` which auto-approves ALL commands
  - Fix: `CompileAllowList` now skips blanket `Bash` - only `Bash(...)` patterns are included
  - `Bash` still goes into `--tools` (tool pool) via `CompileAvailableTools` when patterns exist
  - Result: Specific patterns like `Bash(git:*)` are auto-approved, other commands prompt for permission
- **Duplicate allowedTools/allowed-tools Flags Conflicting** - Consolidated into single flag
  - MCP args used `--allowed-tools` (kebab-case), permissions used `--allowedTools` (camelCase)
  - Having both flags caused the second to OVERWRITE the first, losing permission patterns
  - Fix: MCP tools now merged into `buildPermissionArgs` as a single `--allowedTools` flag
  - Same fix for `--disallowedTools` - AskUserQuestion denial merged into main deny list
- **Permissions Dialog Crash on New Agents** - Fixed "null is not an object" error
  - Was calling `GetAgentPermissions` (returns null for new agents)
  - Now calls `GetAgentPermissionsOrGlobal` (falls back to global template)
- **Cancellation Breaking Conversation Context** - Stop writing to Claude's JSONL
  - ClaudeFu was inserting `[CANCELLED]` user messages on STOP
  - This broke the parentUuid chain, causing Claude to lose conversation thread
  - Fix: Just kill the process, don't write anything - let Claude handle its own state

### Changed
- **Button Label Clarity** - Renamed confusing "Import from Claude" / "Sync to Claude" buttons
  - Now "Import from settings.local" and "Sync to settings.local"
  - ClaudeFu IS Claude, so the old naming was ambiguous

## [0.3.19] - 2026-01-22

### Added
- **Layered Directories Model** - Effective directories = global ∪ agent
  - Global directories (from Global Settings) automatically included for ALL agents
  - Agent-specific directories are additive on top of global
  - `CompileDirectories()` backend method unions both sets for CLI args
  - Useful for shared resources like documentation repos that all agents need
- **Custom Permission Set** - Add your own Bash patterns (e.g., `Bash(wails:*)`)
  - New "Custom" set at bottom of permission sets sidebar
  - Add/remove custom permissions to any tier (🟢 Common, 🟡 Permissive, 🔴 YOLO)
  - Type pattern in input field and click Add (or press Enter)
  - Remove with X button next to each permission
- **Directories Tab Redesign** - Clear global vs agent separation
  - Global Directories section (read-only, shows lock icon, "Edit in Global Settings" hint)
  - Agent Directories section (editable with Add/Browse/Remove)
  - "Effective directories at runtime" summary showing total count
- **Action Buttons in Tools Tab** - Tool-specific operations now in context
  - "Merge from Global" - Additively add global tools without removing agent's
  - "Replace with Global" - Reset tools to match global template (directories preserved!)
  - "Import from Claude" - Import from `settings.local.json`
  - "Sync to Claude" - Write permissions to `settings.local.json`
- **Preview Diff Methods** (Backend) - Foundation for showing changes before operations
  - `PreviewRevertTools()` and `PreviewMergeTools()` return `PermissionsDiff`
  - Shows tools that would be added/removed (UI not yet wired up)

### Changed
- **Permission Format v2 - Explicit Tool Arrays** - Complete redesign of permission storage format
  - **Before (v1):** `{ "level": "common+permissive" }` - implicit level-based
  - **After (v2):** `{ "common": [...], "permissive": [...], "yolo": [...] }` - explicit tool arrays
  - Self-documenting JSON - see exactly which tools are enabled at each tier
  - Partial tier support - enable some tools in a tier without enabling all
  - Direct toggle state - UI maps directly to stored arrays (no level↔tier conversion)
  - Removed `customBashPermissions` and `customDenyList` fields (no longer needed)
  - Automatic v1→v2 migration when loading old permission files
- **Revert Preserves Directories** - "Replace with Global" only resets tools
  - Previously `RevertAgentToGlobal` wiped EVERYTHING including directories
  - Renamed to `RevertToolsToGlobal` to reflect semantic intent
  - Agent's `additionalDirectories` now preserved during revert
- **Dialog Footer Simplified** - Only Save button remains in footer
  - Action buttons moved to Tools tab where they belong contextually
  - Cleaner separation: Tools tab has tool operations, Directories tab has directory editing

### Fixed
- **Agent/Session Selection Not Persisting** - Selections now survive reload
  - `SetActiveSession` was updating runtime state but never persisting to workspace JSON
  - Now persists both workspace-level `SelectedSession` (active agent+session) and per-agent `SelectedSessionID`
  - Switching agents or sessions is now saved immediately to `~/.claudefu/workspaces/{id}.json`
  - On reload, app correctly restores exact agent AND session you were viewing

### Technical
- **Backend Permission Changes**
  - `ToolPermission` struct changed from `{ Level string }` to `{ Common, Permissive, YOLO []string }`
  - `ClaudeFuPermissions` removed `CustomBashPermissions` and `CustomDenyList` fields
  - Added `migrateV1ToV2()` for transparent backward-compatible migration
  - Simplified `CompileAllowList()` - iterates arrays directly instead of level parsing
  - `CompileDenyList()` now returns empty (individual tool toggles handle this)
  - New `CompileDirectories()` unions global + agent directories
  - New `MergeToolsFromGlobal()` for additive tool merging
  - New `PermissionsDiff` type with `ToolsAdded`/`ToolsRemoved` arrays
  - Renamed `RevertAgentToGlobal` → `RevertToolsToGlobal`
- **Frontend Permission Changes**
  - Removed `PermissionLevel` type and `getEnabledTiers()`/`tiersToLevel()` helpers
  - `ToolsTabContent.tsx` rewritten with direct array manipulation
  - `PresetListItem.tsx` status color from array lengths instead of level string
  - Removed `CustomPatternsEditor` component (no longer needed)
  - `DirectoriesTabContent.tsx` redesigned with two-section layout
  - `RiskLevelGroup.tsx` supports custom permission add/remove for Custom set
  - Action buttons added to `ToolsTabContent.tsx` (moved from dialog footer)

## [0.3.18] - 2026-01-21

### Added
- **Backend-Controlled `response_complete` Event** - Authoritative signal for when Claude CLI exits
  - Backend emits event AFTER `cmd.Wait()` returns (CLI process exit)
  - Distinguishes user cancellation from errors via `cancelledSessions` tracking
  - Frontend subscribes and dispatches `claudefu:queue-autosubmit` custom event
  - Much more reliable than `stop_reason` which fires mid-response between tool batches
- **Reliable Queue Auto-Submit** - Revived QueueWatcher with backend-driven timing
  - Queue items submitted only after previous response definitively completes
  - Multiple queued messages now process sequentially (was broken before)
  - Cancellation prevents queue processing (correct behavior)

### Changed
- **Queue Display Location** - Moved from MessageList to InputArea
  - Fixed "jiggling" issue caused by rendering in scrolling container
  - Queue items now styled exactly like YOU messages (orange label, gray "Queued #N")
  - Click to edit, X button to remove

### Fixed
- **Queue Processing Race Condition** - Only first queued item was being sent
  - Removed `processingRef` that blocked subsequent items
  - `shiftQueue()` already provides atomic protection against double-processing
- **Responding State Clearing** - Now uses `response_complete` event instead of `stop_reason`
  - `stop_reason: "stop_sequence"` fires mid-response, causing premature state clearing
  - `response_complete` fires only when CLI process actually exits

### Technical
- New `cancelledSessions map[string]bool` in `ClaudeCodeService` with mutex protection
- New `WasCancelled(sessionID)` method clears flag after checking (one-shot)
- `response_complete` event payload: `{ success, cancelled?, error? }`
- Custom DOM event `claudefu:queue-autosubmit` bridges Wails events to QueueWatcher

## [0.3.17] - 2026-01-21

### Added
- **Manage Workspaces Dialog** - Full workspace management accessible from menu and dropdown
  - Radio selection with deferred switching (click to select, "Switch" button to confirm)
  - Inline rename via pencil icon → InputDialog
  - Delete workspace with confirmation dialog
  - "New Workspace" button in footer
  - Workspace count display
- **Manage Agents Dialog** - Full agent management accessible from Agent menu
  - Radio selection with deferred switching (prevents accidental agent switches)
  - Displays agent name and folder path for context
  - Inline rename and remove with confirmation dialogs
  - "Add Agent" button opens native folder picker
- **ConfirmDialog Component** - Reusable confirmation dialog for destructive actions
  - Danger mode with red confirm button
  - ESC to cancel, Enter to confirm
- **Native Menu Enhancements** - Expanded Workspace and Agent menus
  - Workspace menu: Rename, Delete, Manage Workspaces, New Workspace
  - Agent menu: Rename, Remove, Manage Agents (with radio selection indicators)
- **WorkspaceDropdown Enhancements** - Added "Delete Workspace" and "Manage Workspaces..." options

### Fixed
- **Agent Menu Checkmarks** - Now uses `AddRadio` instead of `AddText` for proper selection indicators

### Technical
- New `RenameWorkspace(id, newName)` method in `internal/workspace/workspace.go` and `app_workspace.go`
- Deferred selection pattern: local state for visual selection, commit only on explicit action
- Menu event handlers: `menu:rename-workspace`, `menu:delete-workspace`, `menu:manage-workspaces`, `menu:rename-agent`, `menu:remove-agent`, `menu:manage-agents`

## [0.3.16] - 2026-01-21

### Fixed
- **AgentMessage Tool** - Now accepts both `target_agent` (singular) and `target_agents` (plural) parameters
  - Claude sometimes uses singular form despite schema specifying plural
  - Added comprehensive logging to MCP message handlers for debugging

## [0.3.15] - 2026-01-20

### Added
- **Update Notifications** - App checks for updates on startup
  - Checks GitHub Releases API 3 seconds after startup
  - Shows toast notification when newer version available
  - Displays `brew upgrade --cask claudefu` command for easy upgrade
  - Click notification to open GitHub release page
  - "What's New" expandable section shows release notes in notifications dialog

### Technical
- New `app_updates.go` with `CheckForUpdates()` bound method
- Semantic version comparison for update detection
- Release notes fetched from GitHub API and displayed in UI

## [0.3.14] - 2026-01-20

### Added
- **Apple Notarization Support** - Build configuration for signed and notarized macOS releases
  - `build/darwin/entitlements.plist` with required permissions for spawning claude CLI
  - `scripts/setup-notarization.sh` interactive setup guide for Developer ID credentials
  - Release script now includes code signing and notarization steps (gracefully skips if no cert)
  - GitHub release notes auto-adjust based on signing status

### Changed
- **Release Script** - Now 10 steps (was 8) with signing/notarization workflow
  - Detects Developer ID certificate and notarization credentials automatically
  - Signs app bundle with hardened runtime and entitlements
  - Submits to Apple notarization service and staples ticket
  - Re-creates ZIP with stapled app for distribution

### Technical
- `build/darwin/Info.plist` updated with proper bundle ID (`com.metaphori.claudefu`)
- Added `NSAppleEventsUsageDescription` for Apple review process
- `wails.json` now includes company metadata and version info
- Entitlements include: `allow-unsigned-executable-memory`, `disable-library-validation`, `network.server`

## [0.3.13] - 2026-01-20

### Added
- **Global Settings Dialog** - New settings page accessible from sidebar
  - Click "Settings" button above "Claude Code Agent" in sidebar footer
  - Configure environment variables passed to all Claude CLI processes
  - Useful for corporate proxies (e.g., `ANTHROPIC_BASE_URL=http://localhost:9123/mtlsproxy:claudecode`)
  - Settings persisted to `~/.claudefu/settings.json`
- **Claude CLI Environment Variables** - Custom env vars injected into all Claude processes
  - Backend `ClaudeCodeService.SetEnvironment()` method for runtime configuration
  - `buildEnvironment()` merges parent process env with custom vars (custom takes precedence)
  - Applied to all three CLI execution paths: `SendMessage`, `sendWithAttachments`, `NewSession`
  - Changes take effect immediately when saved (no restart required)

### Technical
- New `ClaudeEnvVars map[string]string` field in `Settings` struct
- Thread-safe env var storage with `sync.RWMutex` in `ClaudeCodeService`
- `GlobalSettingsDialog.tsx` component using `DialogBase` pattern
- Env vars loaded at startup and applied via `SaveSettings` bound method

## [0.3.12] - 2026-01-20

### Fixed
- **AI Responding State Persists on Agent Switch** - "Type while waiting" UI state now survives switching agents
  - Previously, switching to another agent and back would show normal input even though Claude was still responding
  - Added `respondingAgents` Map to SessionContext tracking per-agent responding state
  - ChatView now derives `isSending` from context instead of local useState
  - Stripes and dancing Clawd watermark now persist correctly when switching between agents

## [0.3.11] - 2026-01-19

### Fixed
- **Version Display on Fresh Install** - Version now shows correctly (was showing "v0.0.0")
  - VERSION file now embedded into binary using Go's `//go:embed` directive
  - Works regardless of working directory when app is launched
- **First Launch Crash** - Fixed "null is not an object (evaluating 'Ao.length')" error
  - Go nil slice was serializing to JSON `null` instead of `[]`
  - Changed `var workspaces []WorkspaceSummary` to `workspaces := []WorkspaceSummary{}`
- **First Launch Workspace Creation** - Auto-creates "My Workspace" on first launch
  - Previously, adding an agent failed with "no workspace loaded" on fresh install
  - Now creates default workspace when no workspaces exist

### Changed
- **Type While Waiting** - Can now type next message while Claude is thinking
  - Diagonal stripe background pattern on textarea when sending
  - Random verb placeholder: "Claude is Gallivanting, Wibbling and Pondering..."
  - Dancing Clawd watermark (60x60) in center of textarea at 25% opacity
- **Control Button Hover Effects** - Refined hover styling for icon buttons
  - Permissions and CLAUDE.md buttons now glow orange on hover
  - Uses CSS `drop-shadow` filter for consistent glow effect

### Fixed
- **FilePicker Race Condition** - Fixed file list getting stuck when typing quickly
  - Request counter pattern ensures only latest search updates state
  - Fixed duplicate key React warning from overlapping search roots
  - Results now sorted by relevance (filename matches first, shallower paths prioritized)

## [0.3.10] - 2026-01-19

### Fixed
- **Session Discovery on Refresh** - Clicking Refresh in SessionsDialog now properly discovers new sessions
  - Added `RescanSessions` backend method that re-scans filesystem for JSONL files
  - Sessions created externally (e.g., terminal Claude Code) now appear after refresh
- **New Session File Loading** - Externally-created JSONL files now load their existing content
  - Fixed `handleFileCreate` to call `loadInitialMessages()` instead of assuming empty files
  - Sessions no longer appear with 0 messages when created outside ClaudeFu
- **Session Timestamp Accuracy** - Session "Updated" timestamps now reflect actual file modification time
  - Added `RefreshSessionUpdatedAt` to sync timestamps from filesystem on startup and refresh
  - Sessions sorted by recency now use accurate file mod times instead of stale message timestamps
  - Fixes sessions showing "2d ago" when they were modified moments ago

## [0.3.9] - 2026-01-19

### Added
- **Session Breadcrumb** - Current session name now appears in the header breadcrumb
  - Shows as `ClaudeFu / Workspace / Agent / Session Name` hierarchy
  - Session name truncated at 30 characters with tooltip showing full name
  - Chevron icon opens Sessions dialog for quick session switching
- **Session Switcher Icon** - Click chevron in breadcrumb to open Sessions dialog
  - Opens the same Sessions dialog as sidebar with full functionality
  - Hover shows "Switch session" tooltip

### Changed
- **Shared New Session Spinner** - SessionsDialog "+" button now shows same spinner as InputArea
  - "Creating new session..." spinner displays in chat area during creation
  - Consistent visual feedback across both new session creation methods
  - DRY implementation shares state between Sidebar and ChatView via App.tsx

## [0.3.8] - 2026-01-19

### Added
- **FloatingUI Tooltips** - Instant hover tooltips (~100ms) on control buttons and file cards
  - New `Tooltip` component using `@floating-ui/react` with offset, flip, shift, arrow middleware
  - Control buttons (New Session, Planning Mode, View Plan, Permissions, CLAUDE.md) now show instant tooltips
  - Active toggle states show "(ON)" in orange within tooltip
  - File attachment cards show full path, file type, and formatted size on hover
- **Status Indicator Chip** - Floating chip shows active toggle modes
  - Appears at bottom-right of textarea when New Session or Planning Mode is active
  - Shows "+ Create New Session" and/or "📋 Planning Mode" with clipboard SVG icon
  - Semi-transparent dark background with orange text

### Changed
- **Attachment Preview Location** - File/image attachments now render in ControlButtonsRow spacer
  - Moved from above textarea to natural space between left and right button groups
  - Attachment state lifted from InputArea to ChatView for cross-component access
- **File Card Design** - Redesigned attachment preview cards
  - 26px height matching control button row
  - 4-character extension badges (YAML, JSON, SVML, TOML) instead of 3
  - Integrated X remove button on right edge (not floating bubble)
  - Wider filename display area (160px max for files, 140px for images)
  - Smaller fonts with compact layout
- **Input Area Alignment** - Attach button, textarea, and send button now match heights
  - All elements use `minHeight: 100px` with `boxSizing: border-box`
  - Flex container uses `alignItems: stretch` for consistent sizing
- **Textarea Styling** - Refined textarea appearance
  - Font size reduced from 0.9rem to 0.85rem
  - ~5 lines visible by default (100px minHeight)

## [0.3.7] - 2026-01-19

### Added
- **@file Path References** - Type `@filename` in prompt to insert absolute file path
  - FilePicker dropdown appears below cursor when typing `@`
  - Searches agent folder + `additionalDirectories` from `.claude/settings.local.json`
  - Keyboard navigation: Up/Down arrows, Enter to select, ESC/Space to cancel
  - Substring matching on any part of file path
  - File/folder icons with extension hints
  - Uses `@floating-ui/react` for smart positioning
- **@@file Content Attachments** - Type `@@filename` to attach file content to prompt
  - Same FilePicker UI as @file
  - Reads file content (max 100KB) and attaches to message
  - File content sent to Claude as part of the prompt context
- **FileAttachmentBlock Component** - Collapsible file attachment display in chat
  - Attached files show as expandable blocks in user messages
  - Click header to expand/collapse file content
  - `.md` files render as formatted markdown with compact styling
  - Other files display as syntax-highlighted code blocks
  - Shows filename, line count, and expand/collapse indicator
- **Backend File Listing API** - New `ListFiles` and `ReadFileContent` bound methods
  - `ListFiles(agentID, query, maxResults)` - searches directories with ignore patterns
  - `ReadFileContent(filePath)` - reads file with 100KB limit
  - Ignores: node_modules, .git, dist, build, __pycache__, .venv, vendor, target, etc.

### Changed
- **Attachment Type Extended** - `Attachment` interface now supports both images and files
  - New fields: `fileName`, `filePath`, `extension` for file attachments
  - `AttachmentPreviewRow` displays file chips with filename (distinct from image thumbnails)
- **File Content Format** - Uses XML-style `<claudefu-file>` delimiter to avoid collision with content containing markdown fences

### Fixed
- **Pending Message Spinner** - Fixed spinner not clearing when sending messages with attachments
  - Changed from exact content match to `startsWith` matching in MessagesContext
  - Attachments append content to the user message, so exact match failed
- **File Attachment Display** - Fixed missing filepath in "Contents of:" header
  - `backendAttachments` mapping now includes `fileName`, `filePath`, `extension` fields
- **Long Message Truncation** - Skip 6-line truncation for messages with file attachments
  - Truncation was cutting off `</claudefu-file>` closing tag, breaking the regex parser

## [0.3.6] - 2025-01-19

### Added
- **Stop/Cancel Claude Response** - Interrupt Claude mid-response with ESC key or Stop button
  - Red Stop button appears while Claude is thinking (replaces Send button)
  - ESC key cancels the current response
  - Ctrl+C also cancels (when nothing is selected)
  - Sends SIGINT to gracefully terminate the Claude process
  - Backend process tracking (`map[sessionID]*exec.Cmd`) enables per-session cancellation
- **Cancellation Marker** - Visual indicator in chat when response is interrupted
  - Subtle centered pill with red stop icon and timestamp
  - Writes `[CANCELLED]` user message to JSONL for persistence

### Removed
- **Copy Claude Response button** - Removed the always-visible "Copy Claude Response" button
  - Individual hover-to-show copy buttons remain for both user and assistant messages
  - Cleaner UI with less visual clutter

## [0.3.5] - 2025-01-18

### Added
- **SessionsDialog current session highlight** - Currently selected session now highlighted with orange border
  - Uses per-agent `selectedSessionId` so highlight works regardless of which agent is being viewed

### Fixed
- **BrowserAgent permission** - Added `mcp__claudefu__BrowserAgent` to `--allowed-tools` in Claude CLI args
- **New agent sessions not loading** - Sessions now load immediately when adding a new agent
  - Fixed `GetOrCreateSessionState` to create agentState if it doesn't exist
- **Agent removal not persisting** - Removing an agent now calls backend `RemoveAgent` to persist to workspace file
  - Previously only updated React state without saving to disk

## [0.3.4] - 2025-01-18

### Added
- **Multi-Agent Folder Support** - Multiple agents can now share the same project folder
  - Each agent watches a different session within the shared folder
  - Folder-to-agent mapping changed from 1:1 to 1:M (`folderToAgentIDs`)
  - File change events routed to the correct agent based on active session
  - New session discovery notifies ALL agents sharing the folder
- **SelfQuery MCP Tool** - New `mcp__claudefu__SelfQuery` tool for querying your own codebase
  - Spawns stateless `claude --print` in the caller's folder (not a target's)
  - Has full access to CLAUDE.md and all includes - unlike Task subagents
  - `from_agent` is required to identify the caller's folder
  - Configurable tool instructions and system prompt via MCP Settings
- **BrowserAgent MCP Tool** - New `mcp__claudefu__BrowserAgent` for visual/DOM/CSS investigation
  - Delegates to Claude in Browser via WebSocket bridge (`ws://localhost:9320/ws`)
  - Requires custom Chrome extension bridge (not publicly available)
  - Disabled by default, password-protected (`claudefu`) to enable
  - 10-minute default timeout for complex investigations
  - Sends investigation prompt, receives findings via report form
- **Tool Availability System** - Per-tool enable/disable in MCP Settings
  - New "Tool Availability" tab in MCP Settings (between Configuration and Tool Instructions)
  - Toggle switches for all 7 MCP tools (AgentQuery, AgentMessage, AgentBroadcast, NotifyUser, AskUserQuestion, SelfQuery, BrowserAgent)
  - Standard tools enabled by default, experimental tools (BrowserAgent) disabled
  - Handler-level availability checks return helpful error messages when disabled
  - Settings persisted to `~/.claudefu/mcp_tool_availability.json`

### Changed
- **Watcher function signatures** - Updated to support multi-agent folders
  - `StopWatchingAgent(agentID, folder)` - now takes agentID to remove specific agent
  - `ReloadSession(agentID, folder, sessionID)` - now takes agentID explicitly

### Fixed
- **Unread badge accuracy** - Badge now shows session-specific unread count (not sum of all sessions)
  - Frontend uses `unread` from event payload instead of `agentTotal`
  - Badge only shows for non-selected agents (hidden when viewing that agent)
- **Same-session conflict validation** - Two agents from the same folder cannot watch the same sessionID
  - Returns error: "session {id} is already active in agent '{name}'"
  - Prevents weird duplicate conversation views

## [0.3.3] - 2025-01-17

### Added
- **Centralized Messages Context** - Messages now stored in React Context for instant session switching
  - New `MessagesContext` stores messages by agentId → sessionId
  - Cached messages persist when switching between agents/sessions
  - Background message accumulation (messages arrive even when not viewing)
- **Load More Messages** - Pagination support for long conversations
  - Initial load fetches 50 most recent messages
  - "Load older messages" button at top of chat when more available
  - Scroll position preserved when loading older messages
- **Backend Pagination** - New `GetConversationPaged` bound method
  - Returns `ConversationResult` with messages, totalCount, hasMore
  - Supports limit/offset for efficient pagination

### Changed
- **Event Handling Centralized** - `session:messages` events now handled in `WailsEventHub`
  - Single subscription point for all message events
  - Deduplication logic moved from ChatView to central hub
  - 50ms debounce for rapid file watcher events

### Fixed
- **Input Typing Performance** - Decoupled input state from ChatView render cycle
  - `InputArea` now owns its own state (isolated from parent re-renders)
  - Typing no longer triggers expensive message list reconciliation
  - Exposes `InputAreaHandle` via `useImperativeHandle` for future injection features

### Technical
- New `MessagesContext.tsx` with reducer pattern matching existing contexts
- New `useMessages.ts` hook with memoized action creators
- `ChatView.tsx` refactored to consume from context (no local message state)
- `MessageList.tsx` updated with Load More button UI

## [0.3.2] - 2025-01-17

### Added
- **Copy to Clipboard for Messages** - New copy functionality throughout chat
  - Copy user prompts (hover to show, right-aligned) - copies raw text with newlines preserved
  - Copy individual AI messages (hover to show, left-aligned) - copies text blocks only, excludes tool calls
  - Copy full Claude response (always visible centered button) - aggregates all text from response
  - Reusable `CopyButton` component with copied feedback (green checkmark for 2s)
- **Expand/Collapse for Long User Messages** - Messages >6 lines show collapsed with "Show more (N lines)" link
- **Preserve Newlines in User Messages** - User prompts now display with `white-space: pre-wrap`

### Technical
- New utility functions in `messageUtils.ts`: `getMessageText()`, `getFullResponseText()`, `isLastAssistantInResponse()`, `findResponseGroupStart()`
- `MessageList.tsx` computes `fullResponseMap` for response boundary detection
- State-based hover tracking in `MessageRow.tsx` for copy button visibility

## [0.3.1] - 2025-01-17

### Added
- **CMD-S Save Shortcut for Dialogs** - New `useSaveShortcut` hook
  - Press CMD-S (or Ctrl-S) to save when dialogs/panes are open
  - Supported in: ClaudeSettingsDialog, PermissionsDialog, MCPSettingsPane, InputDialog
  - Reusable hook pattern for consistent keyboard shortcuts

### Changed
- **Removed global CMD-S shortcut** - Workspace rename shortcut removed to prevent conflicts with dialog save shortcuts (rename still available via dropdown menu)

### Technical
- Vite dev server port set to 9316 (above MCP port 9315 to avoid increment clashes)

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
