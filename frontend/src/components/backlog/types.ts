// Backlog item - matches Go BacklogItem struct (NAMES consistency)
export interface BacklogItem {
  id: string;
  agentId: string;          // which agent this item belongs to
  parentId: string;         // empty string = root item
  title: string;
  context: string;
  status: BacklogStatus;
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

// Tree node for client-side hierarchy building
export interface BacklogTreeNode {
  item: BacklogItem;
  children: BacklogTreeNode[];
  depth: number;
}
