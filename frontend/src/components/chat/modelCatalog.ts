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
  { id: '',          label: 'CLI Default',      group: 'alias', effortLevels: EFFORT_OPUS_47, description: 'Account-default model (Max → Opus 4.7; Pro/API → Sonnet 4.6). No --model flag.' },
  { id: 'default',   label: 'default (reset)',  group: 'alias', effortLevels: EFFORT_OPUS_47, description: 'Clears any override and uses account default.' },
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
  ...MODEL_CATALOG
    .filter(m => m.id !== '' && m.id !== 'default' && m.id !== 'best')
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
