import { useEffect, useRef, useState } from 'react';
import { types } from '../../wailsjs/go/models';
import { ClipboardSetText } from '../../wailsjs/runtime/runtime';

type Session = types.Session;
type SortOrder = 'recency' | 'messages';

interface SessionsDialogProps {
  isOpen: boolean;
  agentName: string;
  sessions: Session[];
  sessionNames: Map<string, string>;
  onSelectSession: (session: Session) => void;
  onRenameSession: (session: Session) => void;
  onNewSession: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

export function SessionsDialog({
  isOpen,
  agentName,
  sessions,
  sessionNames,
  onSelectSession,
  onRenameSession,
  onNewSession,
  onRefresh,
  onClose
}: SessionsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('recency');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleNewSession = async () => {
    setIsCreating(true);
    try {
      await onNewSession();
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopySessionId = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await ClipboardSetText(sessionId);
      setCopiedId(sessionId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy session ID:', err);
    }
  };

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

  // Add spin animation for refresh button
  const spinKeyframes = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;

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

  // Filter and sort sessions
  const filteredAndSortedSessions = sessions
    .filter(s => !hideEmpty || s.messageCount > 0)
    .sort((a, b) => {
      if (sortOrder === 'recency') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      } else {
        return b.messageCount - a.messageCount;
      }
    });

  const hiddenCount = sessions.length - filteredAndSortedSessions.length;

  return (
    <>
      <style>{spinKeyframes}</style>
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
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #333',
          textAlign: 'left'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '0.75rem'
          }}>
            <div style={{ margin: 0, padding: 0 }}>
              <h2 style={{
                margin: 0,
                padding: 0,
                fontSize: '1rem',
                fontWeight: 600,
                color: '#fff'
              }}>
                Sessions
              </h2>
              <p style={{
                margin: '0.25rem 0 0 0',
                padding: 0,
                fontSize: '0.8rem',
                color: '#888'
              }}>
                {agentName}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {/* New Session button */}
              <button
                onClick={handleNewSession}
                disabled={isCreating}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: isCreating ? 'default' : 'pointer',
                  padding: '0.5rem',
                  fontSize: '1rem',
                  lineHeight: 1,
                  opacity: isCreating ? 0.5 : 1
                }}
                onMouseEnter={(e) => !isCreating && (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => e.currentTarget.style.color = '#888'}
                title="New session"
              >
                <svg
                  width="16"
                  height="16"
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
              </button>
              {/* Refresh button */}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: isRefreshing ? 'default' : 'pointer',
                  padding: '0.5rem',
                  fontSize: '1rem',
                  lineHeight: 1,
                  opacity: isRefreshing ? 0.5 : 1
                }}
                onMouseEnter={(e) => !isRefreshing && (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => e.currentTarget.style.color = '#888'}
                title="Refresh sessions"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    animation: isRefreshing ? 'spin 1s linear infinite' : 'none'
                  }}
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
              </button>
              {/* Close button */}
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
          </div>

          {/* Controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem'
          }}>
            {/* Sort controls */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.8rem',
              color: '#888'
            }}>
              <span>Sort:</span>
              <button
                onClick={() => setSortOrder('recency')}
                style={{
                  background: sortOrder === 'recency' ? '#333' : 'transparent',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: sortOrder === 'recency' ? '#fff' : '#888',
                  cursor: 'pointer',
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.75rem'
                }}
              >
                Recent
              </button>
              <button
                onClick={() => setSortOrder('messages')}
                style={{
                  background: sortOrder === 'messages' ? '#333' : 'transparent',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: sortOrder === 'messages' ? '#fff' : '#888',
                  cursor: 'pointer',
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.75rem'
                }}
              >
                Messages
              </button>
            </div>

            {/* Hide empty checkbox */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              color: '#888',
              cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
                style={{
                  cursor: 'pointer',
                  accentColor: '#8b5cf6'
                }}
              />
              Hide empty
            </label>
          </div>
        </div>

        {/* Sessions List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.5rem',
          textAlign: 'left'
        }}>
          {filteredAndSortedSessions.length === 0 ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: '#666'
            }}>
              {sessions.length === 0
                ? 'No sessions yet. Start a conversation to create one.'
                : 'No sessions match the current filters.'}
            </div>
          ) : (
            filteredAndSortedSessions.map(session => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session)}
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  marginBottom: '0.5rem',
                  background: '#1f1f1f',
                  border: '1px solid #2a2a2a',
                  transition: 'background 0.15s ease, border-color 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#252525';
                  e.currentTarget.style.borderColor = '#333';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#1f1f1f';
                  e.currentTarget.style.borderColor = '#2a2a2a';
                }}
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
                    {/* Session ID with copy button */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: '0.7rem',
                      color: '#555',
                      marginBottom: '0.35rem',
                      fontFamily: 'monospace'
                    }}>
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {session.id}
                      </span>
                      <button
                        onClick={(e) => handleCopySessionId(e, session.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0.15rem',
                          color: copiedId === session.id ? '#22c55e' : '#555',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                        onMouseEnter={(e) => {
                          if (copiedId !== session.id) {
                            e.currentTarget.style.color = '#888';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (copiedId !== session.id) {
                            e.currentTarget.style.color = '#555';
                          }
                        }}
                        title={copiedId === session.id ? 'Copied!' : 'Copy session ID'}
                      >
                        {copiedId === session.id ? (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
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
          {filteredAndSortedSessions.length} session{filteredAndSortedSessions.length !== 1 ? 's' : ''}
          {hiddenCount > 0 && (
            <span style={{ color: '#444' }}>
              {' '}({hiddenCount} hidden)
            </span>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
