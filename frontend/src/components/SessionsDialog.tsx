import { useEffect, useRef } from 'react';
import { types } from '../../wailsjs/go/models';

type Session = types.Session;

interface SessionsDialogProps {
  isOpen: boolean;
  agentName: string;
  sessions: Session[];
  sessionNames: Map<string, string>;
  onSelectSession: (session: Session) => void;
  onRenameSession: (session: Session) => void;
  onClose: () => void;
}

export function SessionsDialog({
  isOpen,
  agentName,
  sessions,
  sessionNames,
  onSelectSession,
  onRenameSession,
  onClose
}: SessionsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getSessionDisplayName = (session: Session) => {
    const customName = sessionNames.get(session.id);
    return customName || session.preview || 'New conversation';
  };

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
    >
      <div
        ref={dialogRef}
        style={{
          background: '#1a1a1a',
          borderRadius: '12px',
          border: '1px solid #333',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          width: '480px',
          maxWidth: '90vw',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #333'
        }}>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 600,
              color: '#fff'
            }}>
              Sessions
            </h2>
            <p style={{
              margin: '0.25rem 0 0 0',
              fontSize: '0.8rem',
              color: '#888'
            }}>
              {agentName}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              padding: '0.5rem',
              fontSize: '1.25rem',
              lineHeight: 1
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#888'}
          >
            ×
          </button>
        </div>

        {/* Sessions List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.5rem'
        }}>
          {sessions.length === 0 ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: '#666'
            }}>
              No sessions yet. Start a conversation to create one.
            </div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session)}
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  marginBottom: '0.25rem',
                  background: 'transparent',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#252525'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem'
                }}>
                  {/* Edit button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRenameSession(session);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      color: '#555',
                      flexShrink: 0,
                      marginTop: '0.1rem'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = '#888'}
                    onMouseLeave={(e) => e.currentTarget.style.color = '#555'}
                    title="Rename session"
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
                  </button>

                  {/* Session info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.9rem',
                      color: '#fff',
                      marginBottom: '0.35rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {getSessionDisplayName(session)}
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      fontSize: '0.75rem',
                      color: '#666'
                    }}>
                      <span>{session.messageCount} messages</span>
                      <span>•</span>
                      <span>Updated {formatRelativeTime(session.updatedAt)}</span>
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: '#555',
                      marginTop: '0.25rem'
                    }}>
                      Created {formatDate(session.createdAt)}
                    </div>
                  </div>

                  {/* Arrow */}
                  <div style={{
                    color: '#444',
                    fontSize: '1rem',
                    alignSelf: 'center'
                  }}>
                    →
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid #333',
          fontSize: '0.75rem',
          color: '#555',
          textAlign: 'center'
        }}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}
