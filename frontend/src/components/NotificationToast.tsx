import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';
import type { NotificationData } from '../hooks/useNotifications';

interface NotificationToastProps {
  notification: NotificationData | null;
  onDismiss: () => void;
}

export function NotificationToast({ notification, onDismiss }: NotificationToastProps) {
  if (!notification) return null;

  return (
    <div
      onClick={() => {
        if (notification.releaseUrl) {
          BrowserOpenURL(notification.releaseUrl);
          onDismiss();
        }
      }}
      style={{
        position: 'fixed',
        top: '2rem',
        right: '2rem',
        background: notification.type === 'success' ? '#14532d' :
                   notification.type === 'warning' ? '#78350f' :
                   notification.type === 'question' ? '#4c1d95' : '#1e3a5f',
        border: `1px solid ${
          notification.type === 'success' ? '#22c55e' :
          notification.type === 'warning' ? '#f59e0b' :
          notification.type === 'question' ? '#8b5cf6' : '#3b82f6'
        }`,
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        maxWidth: '400px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        cursor: notification.releaseUrl ? 'pointer' : 'default'
      }}
    >
      <div style={{
        color: notification.type === 'success' ? '#22c55e' :
               notification.type === 'warning' ? '#f59e0b' :
               notification.type === 'question' ? '#8b5cf6' : '#3b82f6',
        fontSize: '1.25rem'
      }}>
        {notification.type === 'success' && '✓'}
        {notification.type === 'warning' && '⚠'}
        {notification.type === 'question' && '?'}
        {notification.type === 'info' && 'ℹ'}
      </div>
      <div style={{ flex: 1 }}>
        {notification.title && (
          <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.25rem' }}>
            {notification.title}
          </div>
        )}
        <div style={{ color: '#ccc', fontSize: '0.9rem' }}>
          {notification.message}
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: '#666',
          fontSize: '1rem',
          cursor: 'pointer',
          padding: '0'
        }}
      >
        ×
      </button>
    </div>
  );
}
