import { useState, useEffect, useCallback } from 'react';
import { SlideInPane } from './SlideInPane';
import { BacklogToolbar } from './backlog/BacklogToolbar';
import { BacklogItemList } from './backlog/BacklogItemList';
import { BacklogItem, BacklogStatus } from './backlog/types';
import { mcpserver } from '../../wailsjs/go/models';
import {
  GetBacklogItems,
  AddBacklogItem,
  UpdateBacklogItem,
  DeleteBacklogItem,
} from '../../wailsjs/go/main/App';

interface BacklogPaneProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  onEditItem: (item: BacklogItem) => void;
  onAddItem: (parentId?: string) => void;
}

export function BacklogPane({
  isOpen,
  onClose,
  agentId,
  agentName,
  onEditItem,
  onAddItem,
}: BacklogPaneProps) {
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BacklogStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch items when pane opens or agentId changes
  const fetchItems = useCallback(async () => {
    if (!agentId) return;
    setIsLoading(true);
    try {
      const result = await GetBacklogItems(agentId);
      // Convert Wails-generated class instances to our interface type
      setItems((result || []).map((r: mcpserver.BacklogItem) => ({
        id: r.id,
        agentId: r.agentId,
        parentId: r.parentId || '',
        title: r.title,
        context: r.context || '',
        status: (r.status || 'idea') as BacklogStatus,
        tags: r.tags || '',
        createdBy: r.createdBy || '',
        sortOrder: r.sortOrder,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })));
    } catch (err) {
      console.error('Failed to load backlog items:', err);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (isOpen) {
      fetchItems();
    }
  }, [isOpen, fetchItems]);

  // Listen for backlog:changed events to auto-refresh
  useEffect(() => {
    if (!isOpen) return;

    const handleBacklogChanged = () => {
      fetchItems();
    };

    window.addEventListener('claudefu:backlog-changed', handleBacklogChanged);
    return () => window.removeEventListener('claudefu:backlog-changed', handleBacklogChanged);
  }, [isOpen, fetchItems]);

  // Handle status change inline
  const handleStatusChange = useCallback(async (item: BacklogItem, newStatus: BacklogStatus) => {
    try {
      const updated = new mcpserver.BacklogItem({
        ...item,
        status: newStatus,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      const success = await UpdateBacklogItem(updated);
      if (success) {
        setItems(prev => prev.map(i =>
          i.id === item.id ? { ...i, status: newStatus, updatedAt: updated.updatedAt } : i
        ));
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }, []);

  // Handle delete
  const handleDelete = useCallback(async (item: BacklogItem) => {
    try {
      const success = await DeleteBacklogItem(agentId, item.id);
      if (success) {
        // Remove item and its children from local state
        const idsToRemove = new Set<string>();
        const collectChildren = (parentId: string) => {
          idsToRemove.add(parentId);
          for (const child of items.filter(i => i.parentId === parentId)) {
            collectChildren(child.id);
          }
        };
        collectChildren(item.id);
        setItems(prev => prev.filter(i => !idsToRemove.has(i.id)));
      }
    } catch (err) {
      console.error('Failed to delete backlog item:', err);
    }
  }, [agentId, items]);

  const backlogIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="13" y2="13" />
    </svg>
  );

  return (
    <SlideInPane
      isOpen={isOpen}
      onClose={onClose}
      title={`Backlog — ${agentName}`}
      titleColor="#d97757"
      icon={backlogIcon}
      storageKey="backlog"
      defaultWidth={500}
      minWidth={350}
      maxWidth={800}
    >
      <BacklogToolbar
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onAdd={() => onAddItem()}
        onRefresh={fetchItems}
      />

      {isLoading ? (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#555',
          fontSize: '0.85rem',
        }}>
          Loading...
        </div>
      ) : (
        <BacklogItemList
          items={items}
          statusFilter={statusFilter}
          searchQuery={searchQuery}
          onEdit={onEditItem}
          onAddSubtask={(parentId) => onAddItem(parentId)}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
        />
      )}
    </SlideInPane>
  );
}
