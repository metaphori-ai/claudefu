// Backlog item - matches Go BacklogItem struct (NAMES consistency)
export interface BacklogItem {
  id: string;
  agentId: string;          // which agent this item belongs to
  parentId: string;         // empty string = root item
  title: string;
  context: string;
  status: BacklogStatus;
  type: BacklogType;        // nature of work (bug_fix, new_feature, etc.)
  tags: string;             // comma-separated
  createdBy: string;        // "user" or agent slug
  sortOrder: number;
  createdAt: number;        // Unix timestamp
  updatedAt: number;
}

export type BacklogStatus = 'idea' | 'planned' | 'in_progress' | 'done' | 'parked';

// Status display configuration
export const STATUS_CONFIG: Record<BacklogStatus, { label: string; color: string }> = {
  idea:        { label: 'Idea',        color: '#8b5cf6' }, // purple
  planned:     { label: 'Planned',     color: '#3b82f6' }, // blue
  in_progress: { label: 'In Progress', color: '#d97757' }, // orange
  done:        { label: 'Done',        color: '#5d9e6e' }, // green
  parked:      { label: 'Parked',      color: '#666' },    // gray
};

export const ALL_STATUSES: BacklogStatus[] = ['idea', 'planned', 'in_progress', 'done', 'parked'];

// Type categorization - nature of work (orthogonal to status)
export type BacklogType =
  | 'bug_fix'
  | 'new_feature'
  | 'feature_expansion'
  | 'improvement'
  | 'refactor'
  | 'validation'
  | 'tech_debt'
  | 'documentation';

export const TYPE_CONFIG: Record<BacklogType, { label: string; color: string }> = {
  bug_fix:           { label: 'Bug Fix',    color: '#ef4444' }, // red
  new_feature:       { label: 'New Feature', color: '#3b82f6' }, // blue
  feature_expansion: { label: 'Expansion',  color: '#8b5cf6' }, // purple
  improvement:       { label: 'Improvement', color: '#f59e0b' }, // amber
  refactor:          { label: 'Refactor',   color: '#10b981' }, // green
  validation:        { label: 'Validation', color: '#06b6d4' }, // cyan
  tech_debt:         { label: 'Tech Debt',  color: '#d97757' }, // orange
  documentation:     { label: 'Docs',       color: '#6366f1' }, // indigo
};

export const ALL_TYPES: BacklogType[] = [
  'bug_fix', 'new_feature', 'feature_expansion', 'improvement',
  'refactor', 'validation', 'tech_debt', 'documentation',
];

// Tree node for client-side hierarchy building
export interface BacklogTreeNode {
  item: BacklogItem;
  children: BacklogTreeNode[];
  depth: number;
}
