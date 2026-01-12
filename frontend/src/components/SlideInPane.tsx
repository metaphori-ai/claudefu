import React, { useState, useEffect, useRef, useCallback } from 'react';

interface SlideInPaneProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleColor?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  // Optional: unique key for persisting width preference
  storageKey?: string;
  // Optional: default width settings
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

const DEFAULT_WIDTH = 550;
const MIN_WIDTH = 350;
const MAX_WIDTH = 1200;

export function SlideInPane({
  isOpen,
  onClose,
  title,
  titleColor = '#fff',
  icon,
  children,
  storageKey,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = MIN_WIDTH,
  maxWidth = MAX_WIDTH,
}: SlideInPaneProps) {
  // Load persisted width or use default
  const getInitialWidth = () => {
    if (storageKey) {
      const saved = localStorage.getItem(`slideInPane_${storageKey}_width`);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    }
    return defaultWidth;
  };

  const [width, setWidth] = useState(getInitialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  // Persist width when it changes
  useEffect(() => {
    if (storageKey && !isResizing) {
      localStorage.setItem(`slideInPane_${storageKey}_width`, width.toString());
    }
  }, [width, storageKey, isResizing]);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Change cursor globally while resizing
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, minWidth, maxWidth]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 99,
        }}
      />

      {/* Slide-in Pane */}
      <div
        ref={paneRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: `${width}px`,
          background: '#0f0f0f',
          borderLeft: '1px solid #333',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          animation: isResizing ? 'none' : 'slideIn 0.2s ease-out',
        }}
      >
        {/* Resize Handle */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '6px',
            cursor: 'col-resize',
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
            padding: '1rem 1.5rem',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            background: '#111',
          }}
        >
          {icon && (
            <div style={{ display: 'flex', alignItems: 'center', color: titleColor }}>
              {icon}
            </div>
          )}
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 600,
              color: titleColor,
              flex: 1,
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              fontSize: '1.5rem',
              cursor: 'pointer',
              padding: '0.25rem',
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
            overflow: 'auto',
            padding: '1.5rem',
            textAlign: 'left',
          }}
        >
          {children}
        </div>
      </div>

      {/* Animation keyframes */}
      <style>
        {`
          @keyframes slideIn {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
        `}
      </style>
    </>
  );
}
