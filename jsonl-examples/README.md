# Claude Code JSONL Examples

This folder contains example JSONL events from Claude Code session files for testing and documentation purposes.

## File Structure

```
jsonl-examples/
├── main-session/           # Events from main session files
│   ├── user-message.jsonl
│   ├── user-tool-result.jsonl
│   ├── user-with-image.jsonl
│   ├── assistant-thinking.jsonl
│   ├── assistant-tool-use.jsonl
│   ├── system-turn-duration.jsonl
│   ├── file-history-snapshot.jsonl
│   └── queue-operation.jsonl
└── subagent/               # Events from subagent files
    ├── user-prompt.jsonl
    ├── assistant-tool-use.jsonl
    ├── user-tool-result.jsonl
    └── assistant-response.jsonl
```

## Event Types

### Main Session Events

| Type | Description |
|------|-------------|
| `user` | User messages (text, images, tool results) |
| `assistant` | Assistant responses (text, thinking, tool_use) |
| `system` | System events (turn_duration, etc.) |
| `file-history-snapshot` | File state snapshots |
| `queue-operation` | Message queue operations |
| `summary` | Context compaction summaries |

### Subagent-Specific Fields

Subagent events include additional fields:
- `agentId` - Unique identifier for the subagent
- `slug` - Human-readable agent name
- `isSidechain: true` - Marks as subagent conversation

## Content Block Types

| Block Type | Description |
|------------|-------------|
| `text` | Plain text content |
| `thinking` | Extended thinking blocks (Opus 4.5) |
| `tool_use` | Tool invocation requests |
| `tool_result` | Tool execution results |
| `image` | Image content (base64 or file path) |

## Usage

These examples are used for:
1. Unit testing the JSONL parser
2. Documenting the event schema
3. Debugging conversion logic
