import React, { useState, useEffect, useRef, useCallback } from 'react';

interface SlideUpPaneProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleColor?: string;
  icon?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  storageKey?: string;
  defaultHeight?: number;
  minHeight?: number;
  maxHeightVh?: number;
}

const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 150;
const MAX_HEIGHT_VH = 60;

export function SlideUpPane({
  isOpen,
  onClose,
  title,
  titleColor = '#fff',
  icon,
  headerActions,
  children,
  storageKey,
  defaultHeight = DEFAULT_HEIGHT,
  minHeight = MIN_HEIGHT,
  maxHeightVh = MAX_HEIGHT_VH,
}: SlideUpPaneProps) {
  const getInitialHeight = () => {
    if (storageKey) {
      const saved = localStorage.getItem(`slideUpPane_${storageKey}_height`);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minHeight) {
          return parsed;
        }
      }
    }
    return defaultHeight;
  };

  const [height, setHeight] = useState(getInitialHeight);
  const [isResizing, setIsResizing] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  // Persist height
  useEffect(() => {
    if (storageKey && !isResizing) {
      localStorage.setItem(`slideUpPane_${storageKey}_height`, height.toString());
    }
  }, [height, storageKey, isResizing]);

  // Resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const maxHeight = window.innerHeight * (maxHeightVh / 100);

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = window.innerHeight - e.clientY;
      setHeight(Math.max(minHeight, Math.min(maxHeight, newHeight)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

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
  }, [isResizing, minHeight, maxHeightVh]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Slide-up Pane - no backdrop */}
      <div
        ref={paneRef}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: `${height}px`,
          background: '#0a0a0a',
          borderTop: '1px solid #333',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          animation: isResizing ? 'none' : 'slideUp 0.2s ease-out',
        }}
      >
        {/* Resize Handle */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: 'absolute',
            top: 0,
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
            padding: '0.4rem 0.75rem',
            borderBottom: '1px solid #222',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: '#111',
            flexShrink: 0,
          }}
        >
          {icon && (
            <div style={{ display: 'flex', alignItems: 'center', color: titleColor }}>
              {icon}
            </div>
          )}
          <span
            style={{
              margin: 0,
              fontSize: '0.8rem',
              fontWeight: 600,
              color: titleColor,
            }}
          >
            {title}
          </span>
          {headerActions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {headerActions}
            </div>
          )}
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

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            textAlign: 'left',
          }}
        >
          {children}
        </div>
      </div>

      <style>
        {`
          @keyframes slideUp {
            from {
              transform: translateY(100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
        `}
      </style>
    </>
  );
}
