import { useContext, useCallback } from 'react';
import { MessagesContext, SessionMessages } from '../context/MessagesContext';
import { Message } from '../components/chat/types';

export function useMessages() {
  const context = useContext(MessagesContext);
  if (!context) {
    throw new Error('useMessages must be used within a MessagesProvider');
  }

  const { state, dispatch } = context;

  // Get session messages for a specific agent/session
  const getSessionMessages = useCallback((agentId: string, sessionId: string): SessionMessages | undefined => {
    const agentMessages = state.sessionMessages.get(agentId);
    if (!agentMessages) return undefined;
    return agentMessages.get(sessionId);
  }, [state.sessionMessages]);

  // Set initial messages for a session
  const setMessages = useCallback((
    agentId: string,
    sessionId: string,
    messages: Message[],
    totalCount: number,
    hasMore: boolean
  ) => {
    dispatch({
      type: 'SET_MESSAGES',
      payload: { agentId, sessionId, messages, totalCount, hasMore }
    });
  }, [dispatch]);

  // Append new messages (from events)
  const appendMessages = useCallback((agentId: string, sessionId: string, messages: Message[]) => {
    dispatch({
      type: 'APPEND_MESSAGES',
      payload: { agentId, sessionId, messages }
    });
  }, [dispatch]);

  // Prepend older messages (Load More)
  const prependMessages = useCallback((
    agentId: string,
    sessionId: string,
    messages: Message[],
    hasMore: boolean
  ) => {
    dispatch({
      type: 'PREPEND_MESSAGES',
      payload: { agentId, sessionId, messages, hasMore }
    });
  }, [dispatch]);

  // Set loading state
  const setLoading = useCallback((agentId: string, sessionId: string, isLoading: boolean) => {
    dispatch({
      type: 'SET_LOADING',
      payload: { agentId, sessionId, isLoading }
    });
  }, [dispatch]);

  // Mark initial load complete
  const markInitialLoadDone = useCallback((agentId: string, sessionId: string) => {
    dispatch({
      type: 'MARK_INITIAL_LOAD_DONE',
      payload: { agentId, sessionId }
    });
  }, [dispatch]);

  // Add pending (optimistic) user message
  const addPendingMessage = useCallback((
    agentId: string,
    sessionId: string,
    content: string,
    message: Message
  ) => {
    dispatch({
      type: 'ADD_PENDING_MESSAGE',
      payload: { agentId, sessionId, content, message }
    });
  }, [dispatch]);

  // Clear pending message (confirmed in JSONL)
  const clearPendingMessage = useCallback((agentId: string, sessionId: string, content: string) => {
    dispatch({
      type: 'CLEAR_PENDING_MESSAGE',
      payload: { agentId, sessionId, content }
    });
  }, [dispatch]);

  // Clear all pending messages in session (on cancel/interrupt)
  const clearAllPendingInSession = useCallback((agentId: string, sessionId: string) => {
    dispatch({
      type: 'CLEAR_ALL_PENDING_IN_SESSION',
      payload: { agentId, sessionId }
    });
  }, [dispatch]);

  // Check if a message UUID has been processed
  const isMessageProcessed = useCallback((agentId: string, sessionId: string, uuid: string): boolean => {
    const agentUUIDs = state.processedUUIDs.get(agentId);
    if (!agentUUIDs) return false;
    const sessionUUIDs = agentUUIDs.get(sessionId);
    if (!sessionUUIDs) return false;
    return sessionUUIDs.has(uuid);
  }, [state.processedUUIDs]);

  // Mark a message UUID as processed
  const markMessageProcessed = useCallback((agentId: string, sessionId: string, uuid: string) => {
    dispatch({
      type: 'MARK_MESSAGE_PROCESSED',
      payload: { agentId, sessionId, uuid }
    });
  }, [dispatch]);

  // Check if a message is pending
  const isPendingMessage = useCallback((agentId: string, sessionId: string, content: string): boolean => {
    const agentPending = state.pendingMessages.get(agentId);
    if (!agentPending) return false;
    const sessionPending = agentPending.get(sessionId);
    if (!sessionPending) return false;
    return sessionPending.has(content);
  }, [state.pendingMessages]);

  // Clear all messages for a session (for JSONL patching)
  const clearSession = useCallback((agentId: string, sessionId: string) => {
    dispatch({
      type: 'CLEAR_SESSION',
      payload: { agentId, sessionId }
    });
  }, [dispatch]);

  // Clear all messages for an agent
  const clearAgent = useCallback((agentId: string) => {
    dispatch({
      type: 'CLEAR_AGENT',
      payload: { agentId }
    });
  }, [dispatch]);

  // Reset all messages
  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, [dispatch]);

  return {
    // State accessors
    getSessionMessages,
    isMessageProcessed,
    isPendingMessage,

    // Actions
    setMessages,
    appendMessages,
    prependMessages,
    setLoading,
    markInitialLoadDone,
    addPendingMessage,
    clearPendingMessage,
    clearAllPendingInSession,
    markMessageProcessed,
    clearSession,
    clearAgent,
    reset,

    // Raw dispatch for advanced usage
    dispatch,
  };
}
