// Shared model catalog — single source of truth for model metadata in ClaudeFu.
//
// Consumed by:
//   - ModelSelector (input-area dropdown + agent default)
//   - EffortSelector (visible/hidden + level choices)
//   - GlobalSettingsDialog (Known Variables dropdowns)
//
// When Anthropic ships a new model, add it here.

export type ModelGroup = 'alias' | 'explicit';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelEntry {
  id: string;             // passed to --model verbatim; "" = omit flag entirely
  label: string;          // dropdown display
  group: ModelGroup;
  family?: 'opus' | 'sonnet' | 'haiku' | 'mixed'; // for grouping in explicit section
  effortLevels: EffortLevel[]; // empty array => effort selector hidden for this model
  extraUsage?: boolean;   // render $ badge (e.g., sonnet[1m] on Max plan)
  contextOneMillion?: boolean;
  description?: string;   // optional tooltip text
}

// Effort levels available across the platform. Individual models declare which they support.
export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// Effort profiles referenced by multiple entries.
const EFFORT_OPUS_47: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_46: EffortLevel[] = ['low', 'medium', 'high', 'max'];
const EFFORT_NONE: EffortLevel[] = [];

// MODEL_CATALOG — displayed top-to-bottom in ModelSelector.
export const MODEL_CATALOG: ModelEntry[] = [
  // ---------- Aliases ----------
  // Zero-value (empty id) = no --model flag; Claude Code resolves via its own priority chain
  // (settings.json → ANTHROPIC_MODEL env → account tier default). This is the "no opinion" state.
  { id: '',          label: 'Empty/Default',    group: 'alias', effortLevels: EFFORT_OPUS_47, description: 'No --model flag — Claude Code decides based on settings.json, ANTHROPIC_MODEL env, or account tier default (Max → Opus 4.7; Pro/API → Sonnet 4.6).' },
  { id: 'best',      label: 'best (opus)',      group: 'alias', effortLevels: EFFORT_OPUS_47, description: 'Most capable model available, currently opus.' },
  { id: 'opus',      label: 'opus',             group: 'alias', family: 'opus',   effortLevels: EFFORT_OPUS_47 },
  { id: 'opus[1m]',  label: 'opus [1M]',        group: 'alias', family: 'opus',   effortLevels: EFFORT_OPUS_47, contextOneMillion: true },
  { id: 'opusplan',  label: 'opusplan',         group: 'alias', family: 'mixed',  effortLevels: EFFORT_46,      description: 'Opus for plan mode, Sonnet for execution.' },
  { id: 'opusplan[1m]', label: 'opusplan [1M]', group: 'alias', family: 'mixed',  effortLevels: EFFORT_46,      contextOneMillion: true },
  { id: 'sonnet',    label: 'sonnet',           group: 'alias', family: 'sonnet', effortLevels: EFFORT_46 },
  { id: 'sonnet[1m]',label: 'sonnet [1M]',      group: 'alias', family: 'sonnet', effortLevels: EFFORT_46,      contextOneMillion: true, extraUsage: true, description: '1M context Sonnet — requires extra usage on Max plans.' },
  { id: 'haiku',     label: 'haiku',            group: 'alias', family: 'haiku',  effortLevels: EFFORT_NONE },

  // ---------- Explicit — Opus ----------
  { id: 'claude-opus-4-7',        label: 'Opus 4.7',         group: 'explicit', family: 'opus',   effortLevels: EFFORT_OPUS_47 },
  { id: 'claude-opus-4-7[1m]',    label: 'Opus 4.7 [1M]',    group: 'explicit', family: 'opus',   effortLevels: EFFORT_OPUS_47, contextOneMillion: true },
  { id: 'claude-opus-4-6',        label: 'Opus 4.6',         group: 'explicit', family: 'opus',   effortLevels: EFFORT_46 },
  { id: 'claude-opus-4-6[1m]',    label: 'Opus 4.6 [1M]',    group: 'explicit', family: 'opus',   effortLevels: EFFORT_46, contextOneMillion: true },
  { id: 'claude-opus-4-5-20251101', label: 'Opus 4.5',       group: 'explicit', family: 'opus',   effortLevels: EFFORT_NONE },
  { id: 'claude-opus-4-1-20250805', label: 'Opus 4.1',       group: 'explicit', family: 'opus',   effortLevels: EFFORT_NONE },
  { id: 'claude-opus-4-20250514',   label: 'Opus 4',         group: 'explicit', family: 'opus',   effortLevels: EFFORT_NONE },

  // ---------- Explicit — Sonnet ----------
  { id: 'claude-sonnet-4-6',       label: 'Sonnet 4.6',       group: 'explicit', family: 'sonnet', effortLevels: EFFORT_46 },
  { id: 'claude-sonnet-4-6[1m]',   label: 'Sonnet 4.6 [1M]',  group: 'explicit', family: 'sonnet', effortLevels: EFFORT_46, contextOneMillion: true, extraUsage: true },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5',    group: 'explicit', family: 'sonnet', effortLevels: EFFORT_NONE },
  { id: 'claude-sonnet-4-20250514',   label: 'Sonnet 4',      group: 'explicit', family: 'sonnet', effortLevels: EFFORT_NONE },

  // ---------- Explicit — Haiku ----------
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',      group: 'explicit', family: 'haiku',  effortLevels: EFFORT_NONE },
  { id: 'claude-3-haiku-20240307',   label: 'Haiku 3',        group: 'explicit', family: 'haiku',  effortLevels: EFFORT_NONE },
];

// Lookup helpers ----------------------------------------------------------

export function getModelEntry(id: string): ModelEntry | null {
  return MODEL_CATALOG.find(m => m.id === id) ?? null;
}

export function getSupportedEffortLevels(id: string): EffortLevel[] {
  return getModelEntry(id)?.effortLevels ?? [];
}

export function requiresExtraUsage(id: string): boolean {
  return getModelEntry(id)?.extraUsage ?? false;
}

// Returns the nominal context window in tokens for a given model id.
//   - Explicit `[1m]` variants (or contextOneMillion: true) → 1,000,000
//   - Everything else → 200,000
//   - Empty string (Empty/Default) → 1,000,000 assumption (Max plan is the common ClaudeFu tier;
//     Opus auto-upgrades to 1M there; on Pro/API the assumption is pessimistic — user can
//     explicitly pick a 200K model or alias to see accurate numbers).
// Unknown IDs fall through to 200K — a safer default for warning purposes (false positive
// warnings on model change are less harmful than false negatives).
export function getContextWindow(id: string): number {
  if (id === '') return 1_000_000;
  const entry = getModelEntry(id);
  if (!entry) return 200_000;
  return entry.contextOneMillion ? 1_000_000 : 200_000;
}

// Option lists for Global Settings "Known Variables" env var dropdowns.
// Keys must be ALL_CAPS env var names; values are the literal strings written
// to ClaudeEnvVars. A value of "" means "None (omit)".

export const ENV_OPUS_MODEL_OPTIONS: string[] = [
  'claude-opus-4-7',
  'claude-opus-4-7[1m]',
  'claude-opus-4-6',
  'claude-opus-4-6[1m]',
  'claude-opus-4-5-20251101',
];

export const ENV_SONNET_MODEL_OPTIONS: string[] = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-6[1m]',
  'claude-sonnet-4-5-20250929',
];

export const ENV_HAIKU_MODEL_OPTIONS: string[] = [
  'claude-haiku-4-5-20251001',
  'claude-3-haiku-20240307',
];

export const ENV_ANY_MODEL_OPTIONS: string[] = [
  // Skip the zero-value entry ("") and the "best" meta-alias which just tracks opus.
  ...MODEL_CATALOG
    .filter(m => m.id !== '' && m.id !== 'best')
    .map(m => m.id),
];

export const ENV_EFFORT_OPTIONS: string[] = [
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
