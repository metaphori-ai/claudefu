import React, { useState } from 'react';

interface ThinkingBlockProps {
  content: string;
  initiallyCollapsed?: boolean;
}

export function ThinkingBlock({ content, initiallyCollapsed = true }: ThinkingBlockProps) {
  const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed);

  // Calculate preview length based on content
  const previewLength = 120;
  const hasMore = content.length > previewLength;
  const preview = hasMore ? content.slice(0, previewLength).trim() + '...' : content;

  return (
    <div style={{
      marginBottom: '0.75rem',
      borderRadius: '8px',
      background: '#151515',
      border: '1px solid #2a2a2a',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          width: '100%',
          padding: '0.5rem 0.75rem',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        {/* Brain icon */}
        <span style={{
          fontSize: '0.75rem',
          color: '#8b5cf6'
        }}>
          {/* Simple brain/thinking indicator */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a8 8 0 0 1 8 8c0 3-1.5 5.5-4 7v3a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-3c-2.5-1.5-4-4-4-7a8 8 0 0 1 8-8z"/>
            <path d="M12 12v4"/>
            <path d="M8 16h8"/>
          </svg>
        </span>
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 500,
          color: '#8b5cf6',
          flex: 1
        }}>
          Thinking
        </span>
        <span style={{
          fontSize: '0.7rem',
          color: '#666',
          transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
          transition: 'transform 0.2s ease'
        }}>
          {/* Chevron */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </span>
      </button>

      {/* Content */}
      <div style={{
        padding: isCollapsed ? '0 0.75rem 0.5rem' : '0 0.75rem 0.75rem',
        maxHeight: isCollapsed ? '60px' : '400px',
        overflow: isCollapsed ? 'hidden' : 'auto',
        transition: 'max-height 0.3s ease'
      }}>
        <div style={{
          fontSize: '0.8rem',
          color: '#888',
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace'
        }}>
          {isCollapsed ? preview : content}
        </div>
      </div>
    </div>
  );
}
