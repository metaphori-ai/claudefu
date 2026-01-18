import { useEffect, useRef } from 'react';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import { useWorkspace } from './useWorkspace';
import { useSession } from './useSession';
import { useMessages } from './useMessages';
import { GetInboxTotalCount } from '../../wailsjs/go/main/App';
import { types } from '../../wailsjs/go/models';
import { Message } from '../components/chat/types';
import { logDebug } from '../utils/debugLogger';

type Session = types.Session;

/**
 * Central event hub for all Wails events.
 * This hook subscribes to backend events and dispatches actions to the contexts.
 * Should be rendered once at the app root level.
 */
export function useWailsEvents() {
  const { addDiscoveredSession } = useWorkspace();
  const { setUnreadTotal, setInboxCounts, setMCPPendingQuestion } = useSession();
  const {
    appendMessages,
    isMessageProcessed,
    getSessionMessages
  } = useMessages();

  // Debounce timer for session:messages events
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventDataRef = useRef<{ agentId: string; sessionId: string; messages: Message[] } | null>(null);

  // Subscribe to unread:changed events
  // We use session-specific 'unread' (not agentTotal) since each agent watches only ONE session
  useEffect(() => {
    const handleUnreadChanged = (envelope: {
      agentId?: string;
      payload?: { unread?: number };
    }) => {
      if (envelope?.agentId && envelope.payload?.unread !== undefined) {
        setUnreadTotal(envelope.agentId, envelope.payload.unread);
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

  // Subscribe to mcp:askuser events (MCP-based AskUserQuestion)
  useEffect(() => {
    const handleAskUser = (envelope: {
      payload?: {
        id?: string;
        agentSlug?: string;
        questions?: any[];
        createdAt?: string;
      };
    }) => {
      if (!envelope?.payload?.id || !envelope?.payload?.questions) {
        return;
      }

      console.log('[MCP:AskUser] Received question event:', envelope.payload.id?.substring(0, 8));
      setMCPPendingQuestion({
        id: envelope.payload.id,
        agentSlug: envelope.payload.agentSlug || 'unknown',
        questions: envelope.payload.questions,
        createdAt: envelope.payload.createdAt || new Date().toISOString(),
      });
    };

    EventsOn('mcp:askuser', handleAskUser);
    return () => {
      EventsOff('mcp:askuser');
    };
  }, [setMCPPendingQuestion]);

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

  // Subscribe to session:messages events
  useEffect(() => {
    const processMessages = (agentId: string, sessionId: string, messages: Message[]) => {
      // Check if this session has done initial load (if not, ignore - ChatView will handle it)
      const sessionData = getSessionMessages(agentId, sessionId);
      if (!sessionData?.initialLoadDone) {
        logDebug('WailsEvents', 'SKIP_MESSAGES_INITIAL_LOAD_NOT_DONE', {
          sessionId: sessionId.substring(0, 8),
          messageCount: messages.length,
        });
        return;
      }

      // Pre-filter messages that are already processed (use state-based check)
      // Note: The APPEND_MESSAGES reducer handles final deduplication and marking as processed
      const uniqueMessages: Message[] = [];
      let skippedCount = 0;
      for (const msg of messages) {
        // Skip if already processed (pre-filter to reduce unnecessary dispatch)
        if (msg.uuid && isMessageProcessed(agentId, sessionId, msg.uuid)) {
          skippedCount++;
          continue;
        }
        uniqueMessages.push(msg);
      }

      logDebug('WailsEvents', 'PROCESS_MESSAGES', {
        sessionId: sessionId.substring(0, 8),
        received: messages.length,
        unique: uniqueMessages.length,
        skipped: skippedCount,
        types: uniqueMessages.map(m => m.type).join(','),
      });

      if (uniqueMessages.length > 0) {
        // appendMessages handles: deduplication, marking as processed, and pending message cleanup
        appendMessages(agentId, sessionId, uniqueMessages);
      }
    };

    const handleSessionMessages = (envelope: {
      agentId?: string;
      sessionId?: string;
      payload?: { messages?: Message[] };
    }) => {
      if (!envelope?.agentId || !envelope?.sessionId || !envelope?.payload?.messages) {
        return;
      }

      const { agentId, sessionId } = envelope;
      const messages = envelope.payload.messages;

      logDebug('WailsEvents', 'EVENT_session:messages', {
        sessionId: sessionId.substring(0, 8),
        messageCount: messages.length,
        types: messages.map(m => m.type).join(','),
        uuids: messages.map(m => m.uuid?.substring(0, 8)).join(','),
      });

      // Log session:messages events (helps with debugging)
      if (messages.length > 10) {
        // Large batches are normal - Claude Code writes context compaction, images, etc.
        console.log(`[WailsEvents] session:messages: session=${sessionId.substring(0, 8)} count=${messages.length} (large batch - context/images)`);
      }

      // Debounce rapid events (50ms)
      if (debounceTimerRef.current) {
        // Accumulate messages
        if (pendingEventDataRef.current &&
            pendingEventDataRef.current.agentId === agentId &&
            pendingEventDataRef.current.sessionId === sessionId) {
          pendingEventDataRef.current.messages.push(...messages);
        } else {
          // Different session, process immediately
          if (pendingEventDataRef.current) {
            processMessages(
              pendingEventDataRef.current.agentId,
              pendingEventDataRef.current.sessionId,
              pendingEventDataRef.current.messages
            );
          }
          pendingEventDataRef.current = { agentId, sessionId, messages: [...messages] };
        }
        return;
      }

      // Start new debounce window
      pendingEventDataRef.current = { agentId, sessionId, messages: [...messages] };
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (pendingEventDataRef.current) {
          processMessages(
            pendingEventDataRef.current.agentId,
            pendingEventDataRef.current.sessionId,
            pendingEventDataRef.current.messages
          );
          pendingEventDataRef.current = null;
        }
      }, 50);
    };

    EventsOn('session:messages', handleSessionMessages);
    return () => {
      EventsOff('session:messages');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [appendMessages, isMessageProcessed, getSessionMessages]);
}

/**
 * Component wrapper for the event hub hook.
 * Renders nothing, just subscribes to events.
 */
export function WailsEventHub() {
  useWailsEvents();
  return null;
}
