import { useState, useEffect, useCallback } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { CheckForUpdates } from '../../wailsjs/go/main/App';

export interface NotificationData {
  type: 'info' | 'success' | 'warning' | 'question';
  message: string;
  title?: string;
  releaseUrl?: string;
  releaseNotes?: string;
}

export interface NotificationItem extends NotificationData {
  id: string;
  fromAgent?: string;
  timestamp: Date;
  read: boolean;
}

export function useNotifications() {
  const [notification, setNotification] = useState<NotificationData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsDialogOpen, setNotificationsDialogOpen] = useState(false);

  // Subscribe to mcp:notification events for toast notifications
  useEffect(() => {
    const unsubscribe = EventsOn('mcp:notification', (data: { payload?: { type?: string; message?: string; title?: string; from_agent?: string } }) => {
      if (data?.payload?.message) {
        const notifType = data.payload.type as 'info' | 'success' | 'warning' | 'question';
        // Show toast
        setNotification({
          type: notifType || 'info',
          message: data.payload.message,
          title: data.payload.title
        });
        // Add to notifications list
        const payload = data.payload!;
        setNotifications(prev => [{
          id: Date.now().toString(),
          type: notifType || 'info',
          message: payload.message!,
          title: payload.title,
          fromAgent: payload.from_agent,
          timestamp: new Date(),
          read: false
        }, ...prev].slice(0, 50)); // Keep last 50 notifications
        setTimeout(() => setNotification(null), 5000);
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Check for updates on startup (delayed to not block UI)
  useEffect(() => {
    const checkUpdates = async () => {
      try {
        // Wait a few seconds after startup before checking
        await new Promise(resolve => setTimeout(resolve, 3000));

        const updateInfo = await CheckForUpdates();
        if (updateInfo?.available) {
          // Extract first meaningful line from release notes for toast
          const notesPreview = updateInfo.releaseNotes
            ?.split('\n')
            .find(line => line.trim() && !line.startsWith('#') && !line.startsWith('*'))
            ?.substring(0, 80) || '';

          setNotification({
            type: 'info',
            title: `Update Available: v${updateInfo.latestVersion}`,
            message: `Run: brew upgrade --cask claudefu`,
            releaseUrl: updateInfo.releaseUrl,
            releaseNotes: updateInfo.releaseNotes
          });
          setNotifications(prev => [{
            id: `update-${Date.now()}`,
            type: 'info' as const,
            title: `Update Available: v${updateInfo.latestVersion}`,
            message: `You're on v${updateInfo.currentVersion}.\n\nUpgrade: brew upgrade --cask claudefu`,
            timestamp: new Date(),
            read: false,
            releaseUrl: updateInfo.releaseUrl,
            releaseNotes: updateInfo.releaseNotes
          }, ...prev]);
          // Keep toast longer for updates
          setTimeout(() => setNotification(null), 8000);
        }
      } catch (err) {
        // Silently ignore update check failures
        console.debug('Update check failed:', err);
      }
    };

    checkUpdates();
  }, []);

  const addNotification = useCallback((item: NotificationItem) => {
    setNotifications(prev => [item, ...prev].slice(0, 50));
  }, []);

  const showToast = useCallback((data: NotificationData, duration = 5000) => {
    setNotification(data);
    setTimeout(() => setNotification(null), duration);
  }, []);

  const dismissToast = useCallback(() => setNotification(null), []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const openDialog = useCallback(() => {
    setNotificationsDialogOpen(true);
    markAllRead();
  }, [markAllRead]);

  const closeDialog = useCallback(() => setNotificationsDialogOpen(false), []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    notification, notifications, notificationsDialogOpen, unreadCount,
    addNotification, showToast, dismissToast, openDialog, closeDialog,
    clearAll, markAllRead, removeNotification
  };
}
