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
  const { workspaceId, addDiscoveredSession } = useWorkspace();
  const { setUnreadTotal, setInboxCounts, setMCPPendingQuestion, setMCPPendingPermission, setMCPPendingPlanReview, setAgentResponding, setBacklogCount } = useSession();
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

  // Subscribe to mcp:askuser:dismissed events (backend signals question timed out, cancelled, or completed)
  // This clears the pending question dialog so the UI doesn't get stuck
  useEffect(() => {
    const handleAskUserDismissed = (envelope: {
      payload?: { questionId?: string };
    }) => {
      const questionId = envelope?.payload?.questionId;
      console.log('[MCP:AskUser] Question dismissed:', questionId?.substring(0, 8));
      setMCPPendingQuestion(null);
    };

    EventsOn('mcp:askuser:dismissed', handleAskUserDismissed);
    return () => {
      EventsOff('mcp:askuser:dismissed');
    };
  }, [setMCPPendingQuestion]);

  // Subscribe to mcp:permission-request events (MCP-based RequestToolPermission)
  useEffect(() => {
    const handlePermissionRequest = (envelope: {
      payload?: {
        id?: string;
        agentSlug?: string;
        permission?: string;
        reason?: string;
        createdAt?: string;
      };
    }) => {
      if (!envelope?.payload?.id || !envelope?.payload?.permission) {
        return;
      }

      console.log('[MCP:PermissionRequest] Received permission request:', envelope.payload.id?.substring(0, 8));
      setMCPPendingPermission({
        id: envelope.payload.id,
        agentSlug: envelope.payload.agentSlug || 'unknown',
        permission: envelope.payload.permission,
        reason: envelope.payload.reason || '',
        createdAt: envelope.payload.createdAt || new Date().toISOString(),
      });
    };

    EventsOn('mcp:permission-request', handlePermissionRequest);
    return () => {
      EventsOff('mcp:permission-request');
    };
  }, [setMCPPendingPermission]);

  // Subscribe to mcp:permission-request:dismissed events
  useEffect(() => {
    const handlePermissionDismissed = (envelope: {
      payload?: { requestId?: string };
    }) => {
      console.log('[MCP:PermissionRequest] Dismissed:', envelope?.payload?.requestId?.substring(0, 8));
      setMCPPendingPermission(null);
    };

    EventsOn('mcp:permission-request:dismissed', handlePermissionDismissed);
    return () => {
      EventsOff('mcp:permission-request:dismissed');
    };
  }, [setMCPPendingPermission]);

  // Subscribe to mcp:planreview events (MCP-based ExitPlanMode)
  useEffect(() => {
    const handlePlanReview = (envelope: {
      payload?: {
        id?: string;
        agentSlug?: string;
        createdAt?: string;
      };
    }) => {
      if (!envelope?.payload?.id) {
        return;
      }

      console.log('[MCP:PlanReview] Received plan review event:', envelope.payload.id?.substring(0, 8));
      setMCPPendingPlanReview({
        id: envelope.payload.id,
        agentSlug: envelope.payload.agentSlug || 'unknown',
        createdAt: envelope.payload.createdAt || new Date().toISOString(),
      });
    };

    EventsOn('mcp:planreview', handlePlanReview);
    return () => {
      EventsOff('mcp:planreview');
    };
  }, [setMCPPendingPlanReview]);

  // Subscribe to mcp:planreview:dismissed events
  useEffect(() => {
    const handlePlanReviewDismissed = (envelope: {
      payload?: { reviewId?: string };
    }) => {
      console.log('[MCP:PlanReview] Dismissed:', envelope?.payload?.reviewId?.substring(0, 8));
      setMCPPendingPlanReview(null);
    };

    EventsOn('mcp:planreview:dismissed', handlePlanReviewDismissed);
    return () => {
      EventsOff('mcp:planreview:dismissed');
    };
  }, [setMCPPendingPlanReview]);

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

  // Subscribe to backlog:changed events (per-agent backlog count updates)
  useEffect(() => {
    const handleBacklogChanged = (envelope: {
      agentId?: string;
      payload?: { nonDoneCount?: number };
    }) => {
      if (envelope?.agentId && envelope.payload?.nonDoneCount !== undefined) {
        setBacklogCount(envelope.agentId, envelope.payload.nonDoneCount);
      }
    };

    EventsOn('backlog:changed', handleBacklogChanged);
    return () => {
      EventsOff('backlog:changed');
    };
  }, [setBacklogCount]);

  // Subscribe to response_complete events (backend signals when Claude CLI process exits)
  // This is the AUTHORITATIVE signal that a response is complete - much more reliable than stop_reason
  useEffect(() => {
    const handleResponseComplete = (envelope: {
      workspaceId?: string;
      agentId?: string;
      sessionId?: string;
      payload?: { success?: boolean; cancelled?: boolean; error?: string };
    }) => {
      // Ignore events from different workspace
      if (envelope.workspaceId !== workspaceId) return;
      if (!envelope?.agentId || !envelope?.sessionId) return;

      const { agentId, sessionId, payload } = envelope;
      const success = payload?.success ?? false;
      const cancelled = payload?.cancelled ?? false;

      logDebug('WailsEvents', 'RESPONSE_COMPLETE', {
        agentId: agentId.substring(0, 8),
        sessionId: sessionId.substring(0, 8),
        success,
        cancelled,
      });

      // Clear responding state - this is the authoritative signal that response is done
      setAgentResponding(agentId, false);

      // Trigger queue auto-submit if successful and not cancelled
      if (success && !cancelled) {
        window.dispatchEvent(new CustomEvent('claudefu:queue-autosubmit', {
          detail: { agentId, sessionId }
        }));
      }
    };

    EventsOn('response_complete', handleResponseComplete);
    return () => {
      EventsOff('response_complete');
    };
  }, [workspaceId, setAgentResponding]);

  // Subscribe to auth:expired events (OAuth token expired)
  useEffect(() => {
    const handleAuthExpired = (envelope: {
      agentId?: string;
      sessionId?: string;
      payload?: { error?: string };
    }) => {
      logDebug('WailsEvents', 'AUTH_EXPIRED', { agentId: envelope?.agentId?.substring(0, 8) });
      window.dispatchEvent(new CustomEvent('claudefu:auth-expired', {
        detail: { error: envelope?.payload?.error }
      }));
    };

    EventsOn('auth:expired', handleAuthExpired);
    return () => {
      EventsOff('auth:expired');
    };
  }, []);

  // Subscribe to rate:limited events (usage limit hit)
  useEffect(() => {
    const handleRateLimited = (envelope: {
      agentId?: string;
      sessionId?: string;
      payload?: { error?: string; resetTime?: string };
    }) => {
      logDebug('WailsEvents', 'RATE_LIMITED', { resetTime: envelope?.payload?.resetTime });
      window.dispatchEvent(new CustomEvent('claudefu:rate-limited', {
        detail: { error: envelope?.payload?.error, resetTime: envelope?.payload?.resetTime }
      }));
    };

    EventsOn('rate:limited', handleRateLimited);
    return () => {
      EventsOff('rate:limited');
    };
  }, []);

  // Subscribe to debug:cli-command events (emitted by Claude CLI service)
  useEffect(() => {
    const handleDebugCliCommand = (data: { command?: string; sessionId?: string }) => {
      if (data?.command) {
        // Forward to custom event for DebugStatsOverlay
        window.dispatchEvent(new CustomEvent('claudefu:debug-cli-command', {
          detail: { command: data.command, sessionId: data.sessionId }
        }));
      }
    };

    EventsOn('debug:cli-command', handleDebugCliCommand);
    return () => {
      EventsOff('debug:cli-command');
    };
  }, []);

  // Subscribe to session:messages events
  useEffect(() => {
    const processMessages = (agentId: string, sessionId: string, messages: Message[]) => {
      // NOTE: Responding state is now cleared by response_complete event, not by stop_reason.
      // The response_complete event is emitted by backend AFTER cmd.Wait() returns,
      // which is the authoritative signal that the Claude CLI process has exited.
      // stop_reason signals were unreliable (can appear mid-response between tool batches).

      // Check if this session has done initial load
      // If not, skip storing messages - ChatView will load them when it mounts
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

  // ---------------------------------------------------------------------------
  // Subagent events — dispatched as DOM events for ToolDetailPane consumption
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleSubagentStarted = (data: any) => {
      window.dispatchEvent(new CustomEvent('claudefu:subagent-started', { detail: data }));
    };
    const handleSubagentMessages = (data: any) => {
      window.dispatchEvent(new CustomEvent('claudefu:subagent-messages', { detail: data }));
    };
    const handleSubagentCompleted = (data: any) => {
      window.dispatchEvent(new CustomEvent('claudefu:subagent-completed', { detail: data }));
    };

    EventsOn('subagent:started', handleSubagentStarted);
    EventsOn('subagent:messages', handleSubagentMessages);
    EventsOn('subagent:completed', handleSubagentCompleted);
    return () => {
      EventsOff('subagent:started');
      EventsOff('subagent:messages');
      EventsOff('subagent:completed');
    };
  }, []);
}

/**
 * Component wrapper for the event hub hook.
 * Renders nothing, just subscribes to events.
 */
export function WailsEventHub() {
  useWailsEvents();
  return null;
}
