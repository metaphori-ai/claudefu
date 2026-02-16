import { useState } from 'react';
import { BacklogItem, BacklogStatus, BacklogType, STATUS_CONFIG, TYPE_CONFIG } from './types';

interface BacklogItemRowProps {
  item: BacklogItem;
  depth: number;
  onEdit: (item: BacklogItem) => void;
  onAddSubtask: (parentId: string) => void;
  onDelete: (item: BacklogItem) => void;
  onStatusChange: (item: BacklogItem, newStatus: BacklogStatus) => void;
}

export function BacklogItemRow({
  item,
  depth,
  onEdit,
  onAddSubtask,
  onDelete,
  onStatusChange,
}: BacklogItemRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const statusConfig = STATUS_CONFIG[item.status as BacklogStatus] || STATUS_CONFIG.idea;
  const tags = item.tags ? item.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0.5rem 0.75rem',
        paddingLeft: `${0.75 + depth * 1.5}rem`,
        borderBottom: '1px solid #1a1a1a',
        background: isHovered ? '#151515' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s ease',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onEdit(item)}
    >
      {/* Status dot */}
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: statusConfig.color,
          marginRight: '0.5rem',
          flexShrink: 0,
        }}
        title={statusConfig.label}
      />

      {/* Title */}
      <span style={{
        flex: 1,
        color: item.status === 'done' ? '#555' : '#ccc',
        fontSize: '0.85rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textDecoration: item.status === 'done' ? 'line-through' : 'none',
      }}>
        {item.title}
      </span>

      {/* Type badge */}
      {item.type && TYPE_CONFIG[item.type as BacklogType] && (
        <span style={{
          fontSize: '0.6rem',
          padding: '0.05rem 0.3rem',
          borderRadius: '3px',
          border: `1px solid ${TYPE_CONFIG[item.type as BacklogType].color}40`,
          color: TYPE_CONFIG[item.type as BacklogType].color,
          marginLeft: '0.5rem',
          flexShrink: 0,
          opacity: item.status === 'done' ? 0.5 : 0.8,
        }}>
          {TYPE_CONFIG[item.type as BacklogType].label}
        </span>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: '0.25rem', marginLeft: '0.5rem', flexShrink: 0 }}>
          {tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: '0.6rem',
                padding: '0.05rem 0.3rem',
                borderRadius: '3px',
                background: '#1a1a1a',
                color: '#888',
                border: '1px solid #333',
              }}
            >
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span style={{ fontSize: '0.6rem', color: '#555' }}>+{tags.length - 2}</span>
          )}
        </div>
      )}

      {/* Status badge */}
      <span style={{
        fontSize: '0.65rem',
        padding: '0.05rem 0.35rem',
        borderRadius: '3px',
        color: statusConfig.color,
        marginLeft: '0.5rem',
        flexShrink: 0,
        opacity: 0.8,
      }}>
        {statusConfig.label.toLowerCase()}
      </span>

      {/* Created by indicator */}
      {item.createdBy && item.createdBy !== 'user' && (
        <span style={{
          fontSize: '0.6rem',
          color: '#444',
          marginLeft: '0.35rem',
          fontFamily: 'monospace',
          flexShrink: 0,
        }}>
          @{item.createdBy}
        </span>
      )}

      {/* Hover actions */}
      {isHovered && (
        <div
          style={{
            display: 'flex',
            gap: '0.25rem',
            marginLeft: '0.5rem',
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick status cycle */}
          <button
            onClick={() => {
              const statuses: BacklogStatus[] = ['idea', 'planned', 'in_progress', 'done', 'parked'];
              const currentIdx = statuses.indexOf(item.status as BacklogStatus);
              const nextStatus = statuses[(currentIdx + 1) % statuses.length];
              onStatusChange(item, nextStatus);
            }}
            style={hoverButtonStyle}
            title="Cycle status"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          </button>

          {/* Add subtask */}
          <button
            onClick={() => onAddSubtask(item.id)}
            style={hoverButtonStyle}
            title="Add subtask"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Delete */}
          <button
            onClick={() => onDelete(item)}
            style={{ ...hoverButtonStyle, color: '#b33' }}
            title="Delete"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

const hoverButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0.15rem',
  color: '#666',
  display: 'flex',
  alignItems: 'center',
};
