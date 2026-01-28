import React, { useState, useEffect, useCallback } from 'react';
import { TerminalPanel } from './TerminalPanel';

interface TerminalPanelInlineProps {
  selectedFolder?: string;
  onClose: () => void;
}

const STORAGE_KEY = 'terminalPanel_height';
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 150;
const MAX_HEIGHT_VH = 60;

export function TerminalPanelInline({ selectedFolder, onClose }: TerminalPanelInlineProps) {
  const getInitialHeight = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_HEIGHT) return parsed;
    }
    return DEFAULT_HEIGHT;
  };

  const [height, setHeight] = useState(getInitialHeight);
  const [isResizing, setIsResizing] = useState(false);

  // Persist height
  useEffect(() => {
    if (!isResizing) {
      localStorage.setItem(STORAGE_KEY, height.toString());
    }
  }, [height, isResizing]);

  // Resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const maxHeight = window.innerHeight * (MAX_HEIGHT_VH / 100);

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = window.innerHeight - e.clientY;
      setHeight(Math.max(MIN_HEIGHT, Math.min(maxHeight, newHeight)));
    };

    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return (
    <div
      style={{
        height: `${height}px`,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a0a',
        borderTop: '1px solid #333',
        position: 'relative',
        textAlign: 'left',
      }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          position: 'absolute',
          top: -3,
          left: 0,
          right: 0,
          height: '6px',
          cursor: 'row-resize',
          background: isResizing ? '#555' : 'transparent',
          transition: 'background 0.15s ease',
          zIndex: 10,
        }}
        onMouseEnter={(e) => {
          if (!isResizing) e.currentTarget.style.background = '#444';
        }}
        onMouseLeave={(e) => {
          if (!isResizing) e.currentTarget.style.background = 'transparent';
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: '0.3rem 0.75rem',
          borderBottom: '1px solid #222',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: '#111',
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
          <path d="M5 7L9 10L5 13" stroke="#d97757" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="11" y1="13" x2="15" y2="13" stroke="#d97757" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>
          Terminal
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            fontSize: '1.2rem',
            cursor: 'pointer',
            padding: '0 0.25rem',
            lineHeight: 1,
            borderRadius: '4px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
        >
          ×
        </button>
      </div>

      {/* Terminal content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <TerminalPanel selectedFolder={selectedFolder} />
      </div>
    </div>
  );
}
