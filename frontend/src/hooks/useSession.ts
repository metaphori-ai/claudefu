import { useContext, useCallback } from 'react';
import { SessionContext, SessionAction } from '../context/SessionContext';
import { mcpserver } from '../../wailsjs/go/models';

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
    reset,

    // Raw dispatch for advanced usage
    dispatch,
  };
}
