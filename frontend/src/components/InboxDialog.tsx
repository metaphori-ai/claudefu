import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { mcpserver } from '../../wailsjs/go/models';
import { DialogBase } from './DialogBase';

type InboxMessage = mcpserver.InboxMessage;

interface InboxDialogProps {
  isOpen: boolean;
  agentName: string;
  messages: InboxMessage[];
  selectedSessionId: string | null;
  onInject: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onMarkRead: (messageId: string) => void;
  onClose: () => void;
}

export function InboxDialog({
  isOpen,
  agentName,
  messages,
  selectedSessionId,
  onInject,
  onDelete,
  onMarkRead,
  onClose,
}: InboxDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Clear copied state after animation
  useEffect(() => {
    if (copiedId) {
      const timer = setTimeout(() => setCopiedId(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [copiedId]);

  const selectedMessage = messages.find(m => m.id === selectedId);

  const formatRelativeTime = (timestamp: any) => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins} min ago`;
      if (diffHours < 24) return `${diffHours} hr ago`;
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } catch {
      return '';
    }
  };

  const handleSelectMessage = (msg: InboxMessage) => {
    setSelectedId(msg.id);
    if (!msg.read) {
      onMarkRead(msg.id);
    }
  };

  const unreadCount = messages.filter(m => !m.read).length;

  const title = (
    <>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
      </svg>
      <span>Inbox: {agentName}</span>
      {unreadCount > 0 && (
        <span style={{
          background: '#8b5cf6',
          color: '#fff',
          fontSize: '0.7rem',
          padding: '0.15rem 0.5rem',
          borderRadius: '10px',
          fontWeight: 600,
        }}>
          {unreadCount} new
        </span>
      )}
    </>
  );

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width="800px"
      height="600px"
    >
      {/* Split Panel Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Panel - Message List */}
        <div style={{
          width: '240px',
          borderRight: '1px solid #333',
          overflow: 'auto',
          flexShrink: 0,
        }}>
          {messages.length === 0 ? (
            <div style={{
              padding: '2rem 1rem',
              textAlign: 'center',
              color: '#555',
              fontSize: '0.85rem',
            }}>
              No messages
            </div>
          ) : (
            messages.map(msg => {
              const isSelected = selectedId === msg.id;
              const isUnread = !msg.read;

              return (
                <div
                  key={msg.id}
                  onClick={() => handleSelectMessage(msg)}
                  style={{
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    background: isSelected ? '#252525' : 'transparent',
                    borderBottom: '1px solid #222',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = '#1f1f1f';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {/* Unread indicator */}
                  <span style={{
                    color: isUnread ? '#8b5cf6' : 'transparent',
                    fontSize: '0.5rem',
                    marginTop: '0.25rem',
                  }}>
                    ●
                  </span>

                  {/* Message info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: isUnread ? '#fff' : '#888',
                      fontSize: '0.85rem',
                      fontWeight: isUnread ? 500 : 400,
                      marginBottom: '0.2rem',
                    }}>
                      {msg.fromAgentName || 'Unknown'}
                    </div>
                    <div style={{
                      color: '#555',
                      fontSize: '0.75rem',
                    }}>
                      {formatRelativeTime(msg.timestamp)}
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(msg.id);
                      if (selectedId === msg.id) setSelectedId(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      opacity: 0.5,
                      display: 'flex',
                      alignItems: 'center',
                      alignSelf: 'center',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.5';
                    }}
                    title="Delete message"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Right Panel - Message Preview */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {selectedMessage ? (
            <>
              {/* Message Header */}
              <div style={{
                padding: '1rem',
                borderBottom: '1px solid #333',
                flexShrink: 0,
              }}>
                <div style={{ marginBottom: '0.25rem' }}>
                  <span style={{ color: '#666', fontSize: '0.8rem' }}>From: </span>
                  <span style={{ color: '#8b5cf6', fontSize: '0.9rem', fontWeight: 500 }}>
                    {selectedMessage.fromAgentName || 'Unknown'}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#666', fontSize: '0.8rem' }}>Received: </span>
                  <span style={{ color: '#888', fontSize: '0.85rem' }}>
                    {formatRelativeTime(selectedMessage.timestamp)}
                  </span>
                </div>
                {selectedMessage.priority === 'high' && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <span style={{
                      background: '#7f1d1d',
                      color: '#fca5a5',
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                    }}>
                      High Priority
                    </span>
                  </div>
                )}
              </div>

              {/* Message Content */}
              <div style={{
                flex: 1,
                overflow: 'auto',
                padding: '1rem',
              }}>
                <div style={{
                  color: '#ccc',
                  fontSize: '0.9rem',
                  lineHeight: 1.6,
                }}
                className="markdown-content"
                >
                  <ReactMarkdown>{selectedMessage.message}</ReactMarkdown>
                </div>
              </div>

              {/* Actions */}
              <div style={{
                padding: '1rem',
                borderTop: '1px solid #333',
                display: 'flex',
                gap: '0.75rem',
                justifyContent: 'flex-end',
                flexShrink: 0,
              }}>
                <button
                  onClick={() => {
                    const text = `[Message from ${selectedMessage.fromAgentName || 'Unknown'}]\n\n${selectedMessage.message}`;
                    navigator.clipboard.writeText(text);
                    setCopiedId(selectedMessage.id);
                  }}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid #444',
                    background: copiedId === selectedMessage.id ? '#16a34a22' : 'transparent',
                    color: copiedId === selectedMessage.id ? '#22c55e' : '#888',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {copiedId === selectedMessage.id ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    'Copy'
                  )}
                </button>
                <button
                  onClick={() => onInject(selectedMessage.id)}
                  disabled={!selectedSessionId}
                  title={!selectedSessionId ? 'Select a session first' : 'Inject into current session'}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: selectedSessionId ? '#8b5cf6' : '#333',
                    color: selectedSessionId ? '#fff' : '#666',
                    fontSize: '0.85rem',
                    cursor: selectedSessionId ? 'pointer' : 'not-allowed',
                    fontWeight: 500,
                  }}
                >
                  Inject into Prompt
                </button>
              </div>
            </>
          ) : (
            /* No message selected */
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#444',
              fontSize: '0.9rem',
            }}>
              {messages.length > 0 ? 'Select a message to preview' : 'No messages in inbox'}
            </div>
          )}
        </div>
      </div>
    </DialogBase>
  );
}
