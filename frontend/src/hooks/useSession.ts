import { useContext, useCallback } from 'react';
import { SessionContext, SessionAction, MCPPendingQuestion, MCPPendingPermission, MCPPendingPlanReview, QueuedMessage } from '../context/SessionContext';
import { mcpserver } from '../../wailsjs/go/models';
import { Attachment } from '../components/chat/types';

type InboxMessage = mcpserver.InboxMessage;

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }

  const { state, dispatch } = context;

  // Action creators
  const selectSession = useCallback((sessionId: string, folder: string) => {
    dispatch({ type: 'SELECT_SESSION', payload: { sessionId, folder } });
  }, [dispatch]);

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, [dispatch]);

  const setUnreadTotal = useCallback((agentId: string, total: number) => {
    dispatch({ type: 'SET_UNREAD_TOTAL', payload: { agentId, total } });
  }, [dispatch]);

  const setInboxUnread = useCallback((agentId: string, count: number) => {
    dispatch({ type: 'SET_INBOX_UNREAD', payload: { agentId, count } });
  }, [dispatch]);

  const setInboxTotal = useCallback((agentId: string, count: number) => {
    dispatch({ type: 'SET_INBOX_TOTAL', payload: { agentId, count } });
  }, [dispatch]);

  const setInboxCounts = useCallback((agentId: string, unread?: number, total?: number) => {
    dispatch({ type: 'SET_INBOX_COUNTS', payload: { agentId, unread, total } });
  }, [dispatch]);

  const decrementInboxUnread = useCallback((agentId: string) => {
    dispatch({ type: 'DECREMENT_INBOX_UNREAD', payload: { agentId } });
  }, [dispatch]);

  const decrementInboxTotal = useCallback((agentId: string) => {
    dispatch({ type: 'DECREMENT_INBOX_TOTAL', payload: { agentId } });
  }, [dispatch]);

  const openInboxDialog = useCallback((agentId: string, messages: InboxMessage[]) => {
    dispatch({ type: 'OPEN_INBOX_DIALOG', payload: { agentId, messages } });
  }, [dispatch]);

  const closeInboxDialog = useCallback(() => {
    dispatch({ type: 'CLOSE_INBOX_DIALOG' });
  }, [dispatch]);

  const setInboxMessages = useCallback((messages: InboxMessage[]) => {
    dispatch({ type: 'SET_INBOX_MESSAGES', payload: messages });
  }, [dispatch]);

  const updateInboxMessage = useCallback((messageId: string, updates: Partial<InboxMessage>) => {
    dispatch({ type: 'UPDATE_INBOX_MESSAGE', payload: { messageId, updates } });
  }, [dispatch]);

  const removeInboxMessage = useCallback((messageId: string) => {
    dispatch({ type: 'REMOVE_INBOX_MESSAGE', payload: messageId });
  }, [dispatch]);

  const setMCPPendingQuestion = useCallback((question: MCPPendingQuestion | null) => {
    dispatch({ type: 'SET_MCP_PENDING_QUESTION', payload: question });
  }, [dispatch]);

  const setMCPPendingPermission = useCallback((permission: MCPPendingPermission | null) => {
    dispatch({ type: 'SET_MCP_PENDING_PERMISSION', payload: permission });
  }, [dispatch]);

  const setMCPPendingPlanReview = useCallback((review: MCPPendingPlanReview | null) => {
    dispatch({ type: 'SET_MCP_PENDING_PLAN_REVIEW', payload: review });
  }, [dispatch]);

  // Per-agent "Claude is responding" state
  const setAgentResponding = useCallback((agentId: string, isResponding: boolean) => {
    dispatch({ type: 'SET_AGENT_RESPONDING', payload: { agentId, isResponding } });
  }, [dispatch]);

  const isAgentResponding = useCallback((agentId: string): boolean => {
    return state.respondingAgents.get(agentId) ?? false;
  }, [state.respondingAgents]);

  // Message Queue action creators
  const addToQueue = useCallback((agentId: string, message: QueuedMessage) => {
    dispatch({ type: 'ADD_TO_QUEUE', payload: { agentId, message } });
  }, [dispatch]);

  const removeFromQueue = useCallback((agentId: string, messageId: string) => {
    dispatch({ type: 'REMOVE_FROM_QUEUE', payload: { agentId, messageId } });
  }, [dispatch]);

  const updateQueueMessage = useCallback((agentId: string, messageId: string, content: string, attachments?: Attachment[]) => {
    dispatch({ type: 'UPDATE_QUEUE_MESSAGE', payload: { agentId, messageId, content, attachments } });
  }, [dispatch]);

  const shiftQueue = useCallback((agentId: string) => {
    dispatch({ type: 'SHIFT_QUEUE', payload: { agentId } });
  }, [dispatch]);

  const clearQueue = useCallback((agentId: string) => {
    dispatch({ type: 'CLEAR_QUEUE', payload: { agentId } });
  }, [dispatch]);

  const getQueue = useCallback((agentId: string): QueuedMessage[] => {
    return state.messageQueues.get(agentId) || [];
  }, [state.messageQueues]);

  // Backlog count per agent
  const setBacklogCount = useCallback((agentId: string, count: number) => {
    dispatch({ type: 'SET_BACKLOG_COUNT', payload: { agentId, count } });
  }, [dispatch]);

  const getBacklogCount = useCallback((agentId: string): number => {
    return state.backlogCounts.get(agentId) || 0;
  }, [state.backlogCounts]);

  // Last session tracking (for global auto-submit)
  const setLastSessionId = useCallback((agentId: string, sessionId: string) => {
    dispatch({ type: 'SET_LAST_SESSION_ID', payload: { agentId, sessionId } });
  }, [dispatch]);

  const getLastSessionId = useCallback((agentId: string): string | undefined => {
    return state.lastSessionIds.get(agentId);
  }, [state.lastSessionIds]);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, [dispatch]);

  return {
    // State
    selectedSessionId: state.selectedSessionId,
    selectedFolder: state.selectedFolder,
    unreadTotals: state.unreadTotals,
    inboxUnreadCounts: state.inboxUnreadCounts,
    inboxTotalCounts: state.inboxTotalCounts,
    inboxMessages: state.inboxMessages,
    inboxDialogAgentId: state.inboxDialogAgentId,
    mcpPendingQuestion: state.mcpPendingQuestion,
    mcpPendingPermission: state.mcpPendingPermission,
    mcpPendingPlanReview: state.mcpPendingPlanReview,
    respondingAgents: state.respondingAgents,
    messageQueues: state.messageQueues,
    lastSessionIds: state.lastSessionIds,
    backlogCounts: state.backlogCounts,

    // Actions
    selectSession,
    clearSelection,
    setUnreadTotal,
    setInboxUnread,
    setInboxTotal,
    setInboxCounts,
    decrementInboxUnread,
    decrementInboxTotal,
    openInboxDialog,
    closeInboxDialog,
    setInboxMessages,
    updateInboxMessage,
    removeInboxMessage,
    setMCPPendingQuestion,
    setMCPPendingPermission,
    setMCPPendingPlanReview,
    setAgentResponding,
    isAgentResponding,
    // Backlog count actions
    setBacklogCount,
    getBacklogCount,
    // Message Queue actions
    addToQueue,
    removeFromQueue,
    updateQueueMessage,
    shiftQueue,
    clearQueue,
    getQueue,
    // Last session tracking
    setLastSessionId,
    getLastSessionId,
    reset,

    // Raw dispatch for advanced usage
    dispatch,
  };
}
