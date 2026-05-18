// Centralized constants for chat conversation loading.
//
// Everything here is in *turns* (one real user message + everything until the
// next real user message), not raw messages or JSONL lines. See the Go-side
// GetConversationByTurns in internal/workspace/workspace.go for the exact
// turn definition.
//
// Per-agent override: AGENT_DEFAULT_LOAD_TURNS in agent meta (set via the
// Workspace & Agents dialog) takes precedence over DEFAULT_INITIAL_LOAD_TURNS
// when present and parses as a positive integer.

export const DEFAULT_INITIAL_LOAD_TURNS = 25;

// Load Recent button options. ChatView filters this list to options strictly
// greater than turns currently loaded so the buttons always represent an
// upgrade. A separate "All (N)" button is shown when N is larger than the
// largest option in this list.
export const LOAD_TURN_COUNTS = [25, 50, 100, 200] as const;

// Meta key for per-agent override (system attribute in default-meta-schema.json).
export const AGENT_META_DEFAULT_LOAD_TURNS = 'AGENT_DEFAULT_LOAD_TURNS' as const;

/** Resolve the initial turn count for an agent: per-agent meta wins, else default. */
export function resolveInitialLoadTurns(agentMeta: Record<string, string> | null | undefined): number {
  const raw = agentMeta?.[AGENT_META_DEFAULT_LOAD_TURNS];
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_INITIAL_LOAD_TURNS;
}
