import { useEffect } from 'react';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import { useWorkspace } from './useWorkspace';
import { useSession } from './useSession';
import { GetInboxTotalCount } from '../../wailsjs/go/main/App';
import { types } from '../../wailsjs/go/models';

type Session = types.Session;

/**
 * Central event hub for all Wails events.
 * This hook subscribes to backend events and dispatches actions to the contexts.
 * Should be rendered once at the app root level.
 */
export function useWailsEvents() {
  const { addDiscoveredSession } = useWorkspace();
  const { setUnreadTotal, setInboxCounts } = useSession();

  // Subscribe to unread:changed events
  useEffect(() => {
    const handleUnreadChanged = (envelope: {
      agentId?: string;
      payload?: { agentTotal?: number };
    }) => {
      if (envelope?.agentId && envelope.payload?.agentTotal !== undefined) {
        setUnreadTotal(envelope.agentId, envelope.payload.agentTotal);
      }
    };

    EventsOn('unread:changed', handleUnreadChanged);
    return () => {
      EventsOff('unread:changed');
    };
  }, [setUnreadTotal]);

  // Subscribe to session:discovered events
  useEffect(() => {
    const handleSessionDiscovered = (envelope: {
      agentId?: string;
      payload?: { session?: Session };
    }) => {
      if (envelope?.agentId && envelope?.payload?.session) {
        addDiscoveredSession(envelope.agentId, envelope.payload.session);
      }
    };

    EventsOn('session:discovered', handleSessionDiscovered);
    return () => {
      EventsOff('session:discovered');
    };
  }, [addDiscoveredSession]);

  // Subscribe to mcp:inbox events
  useEffect(() => {
    const handleInboxUpdate = async (envelope: {
      agentId?: string;
      payload?: { unreadCount?: number; totalCount?: number };
    }) => {
      if (!envelope?.agentId) return;

      const unread = envelope.payload?.unreadCount;

      // If totalCount is provided, use it; otherwise fetch it
      let total = envelope.payload?.totalCount;
      if (total === undefined) {
        try {
          total = await GetInboxTotalCount(envelope.agentId);
        } catch {
          // Ignore errors
        }
      }

      setInboxCounts(envelope.agentId, unread, total);
    };

    EventsOn('mcp:inbox', handleInboxUpdate);
    return () => {
      EventsOff('mcp:inbox');
    };
  }, [setInboxCounts]);
}

/**
 * Component wrapper for the event hub hook.
 * Renders nothing, just subscribes to events.
 */
export function WailsEventHub() {
  useWailsEvents();
  return null;
}
