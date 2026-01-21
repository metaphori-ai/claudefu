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
  onDeleteWorkspace: () => void;
  onManageWorkspaces: () => void;
}

export function WorkspaceDropdown({
  currentName,
  currentId,
  workspaces,
  onSelectWorkspace,
  onNewWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onManageWorkspaces,
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
                      color: isCurrent ? '#d97757' : '#ccc',
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
          </button>

          {/* Delete Workspace */}
          <button
            onClick={() => {
              if (workspaces.length > 1) {
                onDeleteWorkspace();
                setIsOpen(false);
              }
            }}
            disabled={workspaces.length <= 1}
            style={{
              ...menuItemStyle,
              justifyContent: 'space-between',
              color: workspaces.length > 1 ? '#dc2626' : '#555',
              cursor: workspaces.length > 1 ? 'pointer' : 'not-allowed',
              opacity: workspaces.length > 1 ? 1 : 0.6,
            }}
            onMouseEnter={(e) => {
              if (workspaces.length > 1) {
                e.currentTarget.style.background = '#252525';
              }
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
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete Workspace
            </span>
          </button>

          {/* Divider */}
          <div style={{
            height: '1px',
            background: '#333',
            margin: '0.25rem 0'
          }} />

          {/* Manage Workspaces */}
          <button
            onClick={() => {
              onManageWorkspaces();
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
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Manage Workspaces...
            </span>
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
