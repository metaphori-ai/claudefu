import { useEffect, useRef } from 'react';

interface AgentMenuProps {
  onViewSessions: () => void;
  onRename: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function AgentMenu({ onViewSessions, onRename, onRemove, onClose }: AgentMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay adding listener to avoid immediate close from button click
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const menuItemStyle = {
    width: '100%',
    padding: '0.5rem 1rem',
    border: 'none',
    background: 'transparent',
    color: '#ccc',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontSize: '0.85rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        top: '100%',
        right: '0.5rem',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        zIndex: 50,
        minWidth: '120px',
        overflow: 'hidden'
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onViewSessions();
        }}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#252525';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
        </svg>
        View Sessions
      </button>
      <div style={{ height: '1px', background: '#333', margin: '0.25rem 0' }} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#252525';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
        Rename
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{ ...menuItemStyle, color: '#f87171' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#252525';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        Remove
      </button>
    </div>
  );
}
