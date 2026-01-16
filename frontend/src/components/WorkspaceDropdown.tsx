import { useState, useEffect, useRef } from 'react';

interface WorkspaceSummary {
  id: string;
  name: string;
  lastOpened: string;
}

interface WorkspaceDropdownProps {
  currentName: string;
  currentId: string;
  workspaces: WorkspaceSummary[];
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onRenameWorkspace: () => void;
}

export function WorkspaceDropdown({
  currentName,
  currentId,
  workspaces,
  onSelectWorkspace,
  onNewWorkspace,
  onRenameWorkspace
}: WorkspaceDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    // Delay to avoid immediate close from button click
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0.25rem 0.5rem',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          color: '#ccc',
          fontSize: '0.9rem'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#1a1a1a';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {currentName}
        <span style={{ fontSize: '0.6rem', color: '#666' }}>
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '0.25rem',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            zIndex: 100,
            minWidth: '200px',
            overflow: 'hidden'
          }}
        >
          {/* All Workspaces */}
          {workspaces.length > 0 && (
            <>
              {workspaces.map((ws) => {
                const isCurrent = ws.id === currentId;
                return (
                  <button
                    key={ws.id}
                    onClick={() => {
                      onSelectWorkspace(ws.id);
                      setIsOpen(false);
                    }}
                    style={{
                      ...menuItemStyle,
                      color: isCurrent ? '#f97316' : '#ccc',
                      fontWeight: isCurrent ? 500 : 400
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#252525';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {ws.name}
                    </span>
                  </button>
                );
              })}

              {/* Divider */}
              <div style={{
                height: '1px',
                background: '#333',
                margin: '0.25rem 0'
              }} />
            </>
          )}

          {/* Rename Workspace */}
          <button
            onClick={() => {
              onRenameWorkspace();
              setIsOpen(false);
            }}
            style={{ ...menuItemStyle, justifyContent: 'space-between' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#252525';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Rename Workspace
            </span>
            <span style={{ fontSize: '0.7rem', color: '#666' }}>⌘S</span>
          </button>

          {/* New Workspace */}
          <button
            onClick={() => {
              onNewWorkspace();
              setIsOpen(false);
            }}
            style={{ ...menuItemStyle, justifyContent: 'space-between' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#252525';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Workspace
            </span>
            <span style={{ fontSize: '0.7rem', color: '#666' }}>⌘N</span>
          </button>
        </div>
      )}
    </div>
  );
}
