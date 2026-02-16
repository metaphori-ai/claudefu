import { useState, useEffect } from 'react';
import { DialogBase } from './DialogBase';
import { BacklogItem, BacklogStatus, BacklogType, ALL_STATUSES, ALL_TYPES, STATUS_CONFIG, TYPE_CONFIG } from './backlog/types';
import { mcpserver } from '../../wailsjs/go/models';
import { AddBacklogItem, UpdateBacklogItem } from '../../wailsjs/go/main/App';
import { useSaveShortcut } from '../hooks';

interface BacklogEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  /** If provided, editing existing item. If null, creating new item. */
  item: BacklogItem | null;
  /** Parent ID for new subtask creation */
  parentId?: string;
  /** Initial status for new items (e.g., 'parked' for Park flow) */
  initialStatus?: BacklogStatus;
  /** Initial context content (e.g., from Park flow) */
  initialContext?: string;
  /** Callback after successful save */
  onSaved?: () => void;
}

export function BacklogEditorDialog({
  isOpen,
  onClose,
  agentId,
  item,
  parentId,
  initialStatus,
  initialContext,
  onSaved,
}: BacklogEditorDialogProps) {
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [status, setStatus] = useState<BacklogStatus>('idea');
  const [type, setType] = useState<BacklogType>('feature_expansion');
  const [tags, setTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!item;

  // Initialize form when dialog opens
  useEffect(() => {
    if (isOpen) {
      if (item) {
        // Editing existing item
        setTitle(item.title);
        setContext(item.context || '');
        setStatus(item.status as BacklogStatus);
        setType((item.type as BacklogType) || 'feature_expansion');
        setTags(item.tags || '');
      } else {
        // Creating new item
        setTitle('');
        setContext(initialContext || '');
        setStatus(initialStatus || 'idea');
        setType('feature_expansion');
        setTags('');
      }
      setError(null);
    }
  }, [isOpen, item, initialStatus, initialContext]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (isEditing && item) {
        // Update existing
        const updated = new mcpserver.BacklogItem({
          ...item,
          title: title.trim(),
          context,
          status,
          type,
          tags: tags.trim(),
          updatedAt: Math.floor(Date.now() / 1000),
        });
        const success = await UpdateBacklogItem(updated);
        if (!success) {
          setError('Failed to update item');
          return;
        }
      } else {
        // Create new
        await AddBacklogItem(
          agentId,
          title.trim(),
          context,
          status,
          type,
          tags.trim(),
          parentId || '',
        );
      }

      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  // CMD-S to save
  useSaveShortcut(isOpen, handleSave);

  const createdDate = item
    ? new Date(item.createdAt * 1000).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null;

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit: ${item!.title}` : 'New Backlog Item'}
      width="700px"
      height="600px"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Form content */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '1rem 1.25rem',
          gap: '0.75rem',
          overflow: 'hidden',
        }}>
        {/* Title input */}
        <div>
          <label style={labelStyle}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="One-line summary..."
            autoFocus
            style={{
              width: '100%',
              background: '#111',
              border: '1px solid #333',
              borderRadius: '4px',
              color: '#ccc',
              padding: '0.5rem',
              fontSize: '0.9rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Status + Tags row */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 auto' }}>
            <label style={labelStyle}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as BacklogStatus)}
              style={{
                background: '#111',
                border: '1px solid #333',
                borderRadius: '4px',
                color: STATUS_CONFIG[status]?.color || '#ccc',
                padding: '0.5rem',
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxSizing: 'border-box',
                height: '34px',
              }}
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '0 0 auto' }}>
            <label style={labelStyle}>Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as BacklogType)}
              style={{
                background: '#111',
                border: '1px solid #333',
                borderRadius: '4px',
                color: TYPE_CONFIG[type]?.color || '#ccc',
                padding: '0.5rem',
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxSizing: 'border-box',
                height: '34px',
              }}
            >
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_CONFIG[t].label}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="comma-separated (e.g., frontend, ux, v2)"
              style={{
                width: '100%',
                background: '#111',
                border: '1px solid #333',
                borderRadius: '4px',
                color: '#ccc',
                padding: '0.5rem',
                fontSize: '0.85rem',
                boxSizing: 'border-box',
                height: '34px',
              }}
            />
          </div>
        </div>

        {/* Metadata line */}
        {isEditing && (
          <div style={{
            fontSize: '0.75rem',
            color: '#555',
          }}>
            Created by: {item!.createdBy || 'user'}
            {createdDate && ` • ${createdDate}`}
            {item!.parentId && ' • subtask'}
          </div>
        )}

        {/* Context textarea */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <label style={labelStyle}>Context</label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Rich context: SVML fragments, markdown notes, research, architectural decisions..."
            style={{
              flex: 1,
              background: '#111',
              border: '1px solid #333',
              borderRadius: '4px',
              color: '#ccc',
              padding: '0.75rem',
              fontSize: '0.85rem',
              fontFamily: 'monospace',
              lineHeight: 1.5,
              resize: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            color: '#e55',
            fontSize: '0.8rem',
          }}>
            {error}
          </div>
        )}
        </div>

        {/* Footer - matches PermissionsDialog pattern */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid #333',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '0.5rem',
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid #333',
              borderRadius: '6px',
              color: '#888',
              padding: '0.5rem 1.25rem',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !title.trim()}
            style={{
              background: isSaving ? '#555' : '#d97757',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              padding: '0.5rem 1.25rem',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
              opacity: !title.trim() ? 0.5 : 1,
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  color: '#666',
  marginBottom: '0.25rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
