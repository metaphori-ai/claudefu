import { createContext, useReducer, ReactNode, Dispatch } from 'react';
import { Message } from '../components/chat/types';

// SessionMessages: per-session message state
export interface SessionMessages {
  messages: Message[];          // Loaded messages
  hasMore: boolean;             // More available to load
  offset: number;               // Current offset for pagination
  totalCount: number;           // Total from backend
  isLoading: boolean;           // Loading indicator
  initialLoadDone: boolean;     // Prevents race conditions
}

// MessagesState: centralized message store
export interface MessagesState {
  // Map: agentId → (sessionId → SessionMessages)
  sessionMessages: Map<string, Map<string, SessionMessages>>;
  // Deduplication: agentId → (sessionId → Set<uuid>)
  processedUUIDs: Map<string, Map<string, Set<string>>>;
  // Pending user messages: agentId → (sessionId → Set<content>)
  pendingMessages: Map<string, Map<string, Set<string>>>;
}

export type MessagesAction =
  | { type: 'SET_MESSAGES'; payload: { agentId: string; sessionId: string; messages: Message[]; totalCount: number; hasMore: boolean } }
  | { type: 'APPEND_MESSAGES'; payload: { agentId: string; sessionId: string; messages: Message[] } }
  | { type: 'PREPEND_MESSAGES'; payload: { agentId: string; sessionId: string; messages: Message[]; hasMore: boolean } }
  | { type: 'SET_LOADING'; payload: { agentId: string; sessionId: string; isLoading: boolean } }
  | { type: 'MARK_INITIAL_LOAD_DONE'; payload: { agentId: string; sessionId: string } }
  | { type: 'ADD_PENDING_MESSAGE'; payload: { agentId: string; sessionId: string; content: string; message: Message } }
  | { type: 'CLEAR_PENDING_MESSAGE'; payload: { agentId: string; sessionId: string; content: string } }
  | { type: 'MARK_MESSAGE_PROCESSED'; payload: { agentId: string; sessionId: string; uuid: string } }
  | { type: 'CLEAR_SESSION'; payload: { agentId: string; sessionId: string } }
  | { type: 'CLEAR_AGENT'; payload: { agentId: string } }
  | { type: 'RESET' };

const initialState: MessagesState = {
  sessionMessages: new Map(),
  processedUUIDs: new Map(),
  pendingMessages: new Map(),
};

// Helper to get or create session messages
function getOrCreateSessionMessages(
  state: MessagesState,
  agentId: string,
  sessionId: string
): SessionMessages {
  const agentMessages = state.sessionMessages.get(agentId);
  if (agentMessages) {
    const sessionMsgs = agentMessages.get(sessionId);
    if (sessionMsgs) return sessionMsgs;
  }
  return {
    messages: [],
    hasMore: false,
    offset: 0,
    totalCount: 0,
    isLoading: false,
    initialLoadDone: false,
  };
}

// Helper to set session messages immutably
function setSessionMessages(
  state: MessagesState,
  agentId: string,
  sessionId: string,
  sessionMsgs: SessionMessages
): Map<string, Map<string, SessionMessages>> {
  const newSessionMessages = new Map(state.sessionMessages);
  const agentMessages = new Map(state.sessionMessages.get(agentId) || new Map());
  agentMessages.set(sessionId, sessionMsgs);
  newSessionMessages.set(agentId, agentMessages);
  return newSessionMessages;
}

// Helper to get or create processed UUIDs set
function getOrCreateProcessedUUIDs(
  state: MessagesState,
  agentId: string,
  sessionId: string
): Set<string> {
  const agentUUIDs = state.processedUUIDs.get(agentId);
  if (agentUUIDs) {
    const sessionUUIDs = agentUUIDs.get(sessionId);
    if (sessionUUIDs) return sessionUUIDs;
  }
  return new Set();
}

// Helper to set processed UUIDs immutably
function setProcessedUUIDs(
  state: MessagesState,
  agentId: string,
  sessionId: string,
  uuids: Set<string>
): Map<string, Map<string, Set<string>>> {
  const newProcessedUUIDs = new Map(state.processedUUIDs);
  const agentUUIDs = new Map(state.processedUUIDs.get(agentId) || new Map());
  agentUUIDs.set(sessionId, uuids);
  newProcessedUUIDs.set(agentId, agentUUIDs);
  return newProcessedUUIDs;
}

// Helper to get or create pending messages set
function getOrCreatePendingMessages(
  state: MessagesState,
  agentId: string,
  sessionId: string
): Set<string> {
  const agentPending = state.pendingMessages.get(agentId);
  if (agentPending) {
    const sessionPending = agentPending.get(sessionId);
    if (sessionPending) return sessionPending;
  }
  return new Set();
}

// Helper to set pending messages immutably
function setPendingMessages(
  state: MessagesState,
  agentId: string,
  sessionId: string,
  pending: Set<string>
): Map<string, Map<string, Set<string>>> {
  const newPendingMessages = new Map(state.pendingMessages);
  const agentPending = new Map(state.pendingMessages.get(agentId) || new Map());
  agentPending.set(sessionId, pending);
  newPendingMessages.set(agentId, agentPending);
  return newPendingMessages;
}

function messagesReducer(state: MessagesState, action: MessagesAction): MessagesState {
  switch (action.type) {
    case 'SET_MESSAGES': {
      const { agentId, sessionId, messages, totalCount, hasMore } = action.payload;

      // Create new session messages
      const sessionMsgs: SessionMessages = {
        messages,
        hasMore,
        offset: 0,
        totalCount,
        isLoading: false,
        initialLoadDone: true,
      };

      // Mark all messages as processed
      const uuids = new Set<string>();
      for (const msg of messages) {
        if (msg.uuid) uuids.add(msg.uuid);
      }

      return {
        ...state,
        sessionMessages: setSessionMessages(state, agentId, sessionId, sessionMsgs),
        processedUUIDs: setProcessedUUIDs(state, agentId, sessionId, uuids),
      };
    }

    case 'APPEND_MESSAGES': {
      const { agentId, sessionId, messages } = action.payload;
      if (messages.length === 0) return state;

      const current = getOrCreateSessionMessages(state, agentId, sessionId);
      const currentUUIDs = getOrCreateProcessedUUIDs(state, agentId, sessionId);
      const currentPending = getOrCreatePendingMessages(state, agentId, sessionId);

      // Filter duplicates and mark as processed
      const newUUIDs = new Set(currentUUIDs);
      const newPending = new Set(currentPending);
      const newMessages: Message[] = [];

      for (const msg of messages) {
        if (msg.uuid && newUUIDs.has(msg.uuid)) continue;
        if (msg.uuid) newUUIDs.add(msg.uuid);

        // Check if this confirms a pending user message
        if (msg.type === 'user' && newPending.has(msg.content)) {
          newPending.delete(msg.content);
          // Don't add - it was already added optimistically
          continue;
        }

        newMessages.push(msg);
      }

      if (newMessages.length === 0 && newPending.size === currentPending.size) {
        return state;
      }

      // Update messages, removing any pending flags that match confirmed messages
      const updatedMessages = [...current.messages];
      for (const msg of newMessages) {
        // Remove any pending message that matches this confirmed message
        const pendingIdx = updatedMessages.findIndex(
          m => m.isPending && m.type === 'user' && m.content === msg.content
        );
        if (pendingIdx !== -1) {
          updatedMessages.splice(pendingIdx, 1);
        }
        updatedMessages.push(msg);
      }

      const sessionMsgs: SessionMessages = {
        ...current,
        messages: updatedMessages,
        totalCount: current.totalCount + newMessages.length,
      };

      return {
        ...state,
        sessionMessages: setSessionMessages(state, agentId, sessionId, sessionMsgs),
        processedUUIDs: setProcessedUUIDs(state, agentId, sessionId, newUUIDs),
        pendingMessages: setPendingMessages(state, agentId, sessionId, newPending),
      };
    }

    case 'PREPEND_MESSAGES': {
      const { agentId, sessionId, messages, hasMore } = action.payload;
      if (messages.length === 0) return state;

      const current = getOrCreateSessionMessages(state, agentId, sessionId);
      const currentUUIDs = getOrCreateProcessedUUIDs(state, agentId, sessionId);

      // Filter duplicates and mark as processed
      const newUUIDs = new Set(currentUUIDs);
      const newMessages: Message[] = [];

      for (const msg of messages) {
        if (msg.uuid && newUUIDs.has(msg.uuid)) continue;
        if (msg.uuid) newUUIDs.add(msg.uuid);
        newMessages.push(msg);
      }

      if (newMessages.length === 0) return state;

      const sessionMsgs: SessionMessages = {
        ...current,
        messages: [...newMessages, ...current.messages],
        hasMore,
        offset: current.offset + newMessages.length,
      };

      return {
        ...state,
        sessionMessages: setSessionMessages(state, agentId, sessionId, sessionMsgs),
        processedUUIDs: setProcessedUUIDs(state, agentId, sessionId, newUUIDs),
      };
    }

    case 'SET_LOADING': {
      const { agentId, sessionId, isLoading } = action.payload;
      const current = getOrCreateSessionMessages(state, agentId, sessionId);

      const sessionMsgs: SessionMessages = {
        ...current,
        isLoading,
      };

      return {
        ...state,
        sessionMessages: setSessionMessages(state, agentId, sessionId, sessionMsgs),
      };
    }

    case 'MARK_INITIAL_LOAD_DONE': {
      const { agentId, sessionId } = action.payload;
      const current = getOrCreateSessionMessages(state, agentId, sessionId);

      const sessionMsgs: SessionMessages = {
        ...current,
        initialLoadDone: true,
      };

      return {
        ...state,
        sessionMessages: setSessionMessages(state, agentId, sessionId, sessionMsgs),
      };
    }

    case 'ADD_PENDING_MESSAGE': {
      const { agentId, sessionId, content, message } = action.payload;
      const current = getOrCreateSessionMessages(state, agentId, sessionId);
      const currentPending = getOrCreatePendingMessages(state, agentId, sessionId);

      // Add to pending set
      const newPending = new Set(currentPending);
      newPending.add(content);

      // Add optimistic message
      const sessionMsgs: SessionMessages = {
        ...current,
        messages: [...current.messages, message],
      };

      return {
        ...state,
        sessionMessages: setSessionMessages(state, agentId, sessionId, sessionMsgs),
        pendingMessages: setPendingMessages(state, agentId, sessionId, newPending),
      };
    }

    case 'CLEAR_PENDING_MESSAGE': {
      const { agentId, sessionId, content } = action.payload;
      const currentPending = getOrCreatePendingMessages(state, agentId, sessionId);

      if (!currentPending.has(content)) return state;

      const newPending = new Set(currentPending);
      newPending.delete(content);

      return {
        ...state,
        pendingMessages: setPendingMessages(state, agentId, sessionId, newPending),
      };
    }

    case 'MARK_MESSAGE_PROCESSED': {
      const { agentId, sessionId, uuid } = action.payload;
      const currentUUIDs = getOrCreateProcessedUUIDs(state, agentId, sessionId);

      if (currentUUIDs.has(uuid)) return state;

      const newUUIDs = new Set(currentUUIDs);
      newUUIDs.add(uuid);

      return {
        ...state,
        processedUUIDs: setProcessedUUIDs(state, agentId, sessionId, newUUIDs),
      };
    }

    case 'CLEAR_SESSION': {
      const { agentId, sessionId } = action.payload;

      // Remove from all maps
      const newSessionMessages = new Map(state.sessionMessages);
      const agentMessages = newSessionMessages.get(agentId);
      if (agentMessages) {
        const newAgentMessages = new Map(agentMessages);
        newAgentMessages.delete(sessionId);
        if (newAgentMessages.size === 0) {
          newSessionMessages.delete(agentId);
        } else {
          newSessionMessages.set(agentId, newAgentMessages);
        }
      }

      const newProcessedUUIDs = new Map(state.processedUUIDs);
      const agentUUIDs = newProcessedUUIDs.get(agentId);
      if (agentUUIDs) {
        const newAgentUUIDs = new Map(agentUUIDs);
        newAgentUUIDs.delete(sessionId);
        if (newAgentUUIDs.size === 0) {
          newProcessedUUIDs.delete(agentId);
        } else {
          newProcessedUUIDs.set(agentId, newAgentUUIDs);
        }
      }

      const newPendingMessages = new Map(state.pendingMessages);
      const agentPending = newPendingMessages.get(agentId);
      if (agentPending) {
        const newAgentPending = new Map(agentPending);
        newAgentPending.delete(sessionId);
        if (newAgentPending.size === 0) {
          newPendingMessages.delete(agentId);
        } else {
          newPendingMessages.set(agentId, newAgentPending);
        }
      }

      return {
        sessionMessages: newSessionMessages,
        processedUUIDs: newProcessedUUIDs,
        pendingMessages: newPendingMessages,
      };
    }

    case 'CLEAR_AGENT': {
      const { agentId } = action.payload;

      const newSessionMessages = new Map(state.sessionMessages);
      newSessionMessages.delete(agentId);

      const newProcessedUUIDs = new Map(state.processedUUIDs);
      newProcessedUUIDs.delete(agentId);

      const newPendingMessages = new Map(state.pendingMessages);
      newPendingMessages.delete(agentId);

      return {
        sessionMessages: newSessionMessages,
        processedUUIDs: newProcessedUUIDs,
        pendingMessages: newPendingMessages,
      };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

interface MessagesContextValue {
  state: MessagesState;
  dispatch: Dispatch<MessagesAction>;
}

export const MessagesContext = createContext<MessagesContextValue | null>(null);

interface MessagesProviderProps {
  children: ReactNode;
}

export function MessagesProvider({ children }: MessagesProviderProps) {
  const [state, dispatch] = useReducer(messagesReducer, initialState);

  return (
    <MessagesContext.Provider value={{ state, dispatch }}>
      {children}
    </MessagesContext.Provider>
  );
}
