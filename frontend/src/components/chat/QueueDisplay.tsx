// QueueDisplay component - Shows queued messages above input area
// Each item shows truncated preview with delete button and click-to-edit

import { QueuedMessage } from '../../context/SessionContext';

interface QueueDisplayProps {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
  onEdit: (message: QueuedMessage) => void;  // Click to edit (loads into textarea)
}

export function QueueDisplay({ queue, onRemove, onEdit }: QueueDisplayProps) {
  if (queue.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      marginBottom: '8px',
      maxHeight: '120px',
      overflowY: 'auto'
    }}>
      {queue.map((msg, index) => (
        <div
          key={msg.id}
          onClick={() => onEdit(msg)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            background: '#2a2a2a',
            borderRadius: '6px',
            cursor: 'pointer',
            border: '1px solid #3a3a3a',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#333';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#2a2a2a';
          }}
          title="Click to edit"
        >
          {/* Queue number */}
          <span style={{
            fontSize: '11px',
            color: '#d97757',
            fontWeight: 600,
            minWidth: '18px'
          }}>
            #{index + 1}
          </span>

          {/* Message preview */}
          <span style={{
            flex: 1,
            fontSize: '13px',
            color: '#ccc',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {msg.content || '(empty)'}
          </span>

          {/* Attachment indicator */}
          {msg.attachments && msg.attachments.length > 0 && (
            <span style={{
              fontSize: '11px',
              color: '#888',
              display: 'flex',
              alignItems: 'center',
              gap: '2px'
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              {msg.attachments.length}
            </span>
          )}

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.stopPropagation();  // Prevent edit on delete click
              onRemove(msg.id);
            }}
            title="Remove from queue"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              transition: 'color 0.15s ease, background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#ef4444';
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#666';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
