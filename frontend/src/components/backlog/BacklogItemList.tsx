import { useMemo } from 'react';
import { BacklogItem, BacklogStatus, BacklogType, BacklogTreeNode } from './types';
import { BacklogItemRow } from './BacklogItemRow';

interface BacklogItemListProps {
  items: BacklogItem[];
  statusFilter: BacklogStatus | 'all';
  typeFilter: BacklogType | 'all';
  searchQuery: string;
  onEdit: (item: BacklogItem) => void;
  onAddSubtask: (parentId: string) => void;
  onDelete: (item: BacklogItem) => void;
  onStatusChange: (item: BacklogItem, newStatus: BacklogStatus) => void;
}

/** Build a tree from flat items, then flatten with depth for rendering */
function buildTree(items: BacklogItem[]): BacklogTreeNode[] {
  // Group items by parentId
  const childrenMap = new Map<string, BacklogItem[]>();
  const rootItems: BacklogItem[] = [];

  for (const item of items) {
    if (!item.parentId) {
      rootItems.push(item);
    } else {
      const siblings = childrenMap.get(item.parentId) || [];
      siblings.push(item);
      childrenMap.set(item.parentId, siblings);
    }
  }

  // Sort by sortOrder within each group
  const sortBySortOrder = (a: BacklogItem, b: BacklogItem) => a.sortOrder - b.sortOrder;
  rootItems.sort(sortBySortOrder);
  for (const [, children] of childrenMap) {
    children.sort(sortBySortOrder);
  }

  // Recursively build tree nodes
  function buildNodes(parentItems: BacklogItem[], depth: number): BacklogTreeNode[] {
    return parentItems.map((item) => {
      const children = childrenMap.get(item.id) || [];
      return {
        item,
        children: buildNodes(children, depth + 1),
        depth,
      };
    });
  }

  return buildNodes(rootItems, 0);
}

/** Flatten tree into ordered list for rendering */
function flattenTree(nodes: BacklogTreeNode[]): BacklogTreeNode[] {
  const result: BacklogTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

export function BacklogItemList({
  items,
  statusFilter,
  typeFilter,
  searchQuery,
  onEdit,
  onAddSubtask,
  onDelete,
  onStatusChange,
}: BacklogItemListProps) {
  // Filter items
  const filteredItems = useMemo(() => {
    let result = items;

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((item) => item.status === statusFilter);
    }

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter((item) => item.type === typeFilter);
    }

    // Search filter (title + tags)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.title.toLowerCase().includes(q) ||
        (item.tags && item.tags.toLowerCase().includes(q))
      );
    }

    return result;
  }, [items, statusFilter, typeFilter, searchQuery]);

  // Build tree and flatten
  const flatNodes = useMemo(() => {
    const tree = buildTree(filteredItems);
    return flattenTree(tree);
  }, [filteredItems]);

  // Count stats
  const doneCount = items.filter((i) => i.status === 'done').length;

  if (flatNodes.length === 0) {
    return (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#555',
        fontSize: '0.85rem',
      }}>
        {items.length === 0
          ? 'No backlog items yet. Click "+ Add" to create one.'
          : 'No items match the current filter.'}
      </div>
    );
  }

  return (
    <div>
      {/* Item list */}
      <div style={{ borderTop: '1px solid #1a1a1a' }}>
        {flatNodes.map((node) => (
          <BacklogItemRow
            key={node.item.id}
            item={node.item}
            depth={node.depth}
            onEdit={onEdit}
            onAddSubtask={onAddSubtask}
            onDelete={onDelete}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>

      {/* Footer stats */}
      <div style={{
        padding: '0.75rem',
        textAlign: 'center',
        color: '#444',
        fontSize: '0.75rem',
        borderTop: '1px solid #1a1a1a',
      }}>
        {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        {doneCount > 0 && ` (${doneCount} done)`}
      </div>
    </div>
  );
}
