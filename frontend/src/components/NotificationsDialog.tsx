import { DialogBase } from './DialogBase';
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';
import type { NotificationItem } from '../hooks/useNotifications';

interface NotificationsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onClearAll: () => void;
  onRemove: (id: string) => void;
}

export function NotificationsDialog({ isOpen, onClose, notifications, onClearAll, onRemove }: NotificationsDialogProps) {
  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title="Notifications"
      width="500px"
      maxHeight="600px"
      headerActions={
        notifications.length > 0 ? (
          <button
            onClick={onClearAll}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: '0.8rem',
              padding: '0.25rem 0.5rem'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#eb815e')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
          >
            Clear All
          </button>
        ) : undefined
      }
    >
      <div style={{ maxHeight: '450px', overflowY: 'auto' }}>
        {notifications.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: '2rem' }}>
            No notifications yet
          </div>
        ) : (
          notifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => {
                if (notif.releaseUrl) {
                  BrowserOpenURL(notif.releaseUrl);
                }
              }}
              style={{
                padding: '0.75rem 1rem',
                borderBottom: '1px solid #333',
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'flex-start',
                cursor: notif.releaseUrl ? 'pointer' : 'default',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => notif.releaseUrl && (e.currentTarget.style.background = '#2a2a2a')}
              onMouseLeave={(e) => notif.releaseUrl && (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{
                color: notif.type === 'success' ? '#22c55e' :
                       notif.type === 'warning' ? '#f59e0b' :
                       notif.type === 'question' ? '#8b5cf6' : '#3b82f6',
                fontSize: '1.1rem',
                flexShrink: 0
              }}>
                {notif.type === 'success' && '✓'}
                {notif.type === 'warning' && '⚠'}
                {notif.type === 'question' && '?'}
                {notif.type === 'info' && 'ℹ'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <div>
                    {notif.title && (
                      <span style={{ fontWeight: 600, color: '#fff', marginRight: '0.5rem' }}>
                        {notif.title}
                      </span>
                    )}
                    {notif.fromAgent && (
                      <span style={{ fontSize: '0.75rem', color: '#d97757', background: '#2a1a0a', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                        {notif.fromAgent}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#555', whiteSpace: 'nowrap' }}>
                    {notif.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ color: '#aaa', fontSize: '0.85rem', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {notif.message}
                  {notif.releaseUrl && (
                    <span style={{ color: '#d97757', marginLeft: '0.5rem' }}>
                      View Release →
                    </span>
                  )}
                </div>
                {notif.releaseNotes && (
                  <details style={{ marginTop: '0.5rem' }}>
                    <summary style={{
                      color: '#888',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}>
                      What's New
                    </summary>
                    <div style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      background: '#1a1a1a',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      color: '#999',
                      maxHeight: '150px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap'
                    }}>
                      {notif.releaseNotes}
                    </div>
                  </details>
                )}
              </div>
              <button
                onClick={() => onRemove(notif.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#555',
                  cursor: 'pointer',
                  padding: '0',
                  fontSize: '0.9rem',
                  flexShrink: 0
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#eb815e')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </DialogBase>
  );
}
