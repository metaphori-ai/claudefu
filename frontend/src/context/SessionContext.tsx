import { createContext, useReducer, ReactNode, Dispatch } from 'react';
import { mcpserver } from '../../wailsjs/go/models';
import { Attachment } from '../components/chat/types';

type InboxMessage = mcpserver.InboxMessage;

// Queued message for sending when Claude finishes responding
export interface QueuedMessage {
  id: string;              // UUID for key/delete
  content: string;         // Message text
  attachments: Attachment[];  // Optional attachments
  createdAt: number;       // Timestamp for ordering
}

// MCP Pending Question from backend event
export interface MCPPendingQuestion {
  id: string;
  agentSlug: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  createdAt: string;
}

// MCP Pending Plan Review from backend event
export interface MCPPendingPlanReview {
  id: string;
  agentSlug: string;
  createdAt: string;
}

// MCP Pending Permission Request from backend event
export interface MCPPendingPermission {
  id: string;
  agentSlug: string;
  permission: string;
  reason: string;
  createdAt: string;
}

// SessionState: state that changes frequently via events
export interface SessionState {
  selectedSessionId: string | null;
  selectedFolder: string | null;
  // Session unread counts per agent
  unreadTotals: Map<string, number>;
  // MCP Inbox counts per agent
  inboxUnreadCounts: Map<string, number>;
  inboxTotalCounts: Map<string, number>;
  // Inbox dialog state
  inboxMessages: InboxMessage[];
  inboxDialogAgentId: string | null;
  // MCP AskUserQuestion dialog state
  mcpPendingQuestion: MCPPendingQuestion | null;
  // MCP Permission Request dialog state
  mcpPendingPermission: MCPPendingPermission | null;
  // MCP Plan Review dialog state
  mcpPendingPlanReview: MCPPendingPlanReview | null;
  // Per-agent "Claude is responding" state (survives agent switching)
  respondingAgents: Map<string, boolean>;
  // Per-agent message queue (for queuing messages while Claude is responding)
  messageQueues: Map<string, QueuedMessage[]>;
  // Per-agent last session ID (for global auto-submit to know which session to send to)
  lastSessionIds: Map<string, string>;
  // Per-agent backlog non-done count (for badge)
  backlogCounts: Map<string, number>;
}

export type SessionAction =
  | { type: 'SELECT_SESSION'; payload: { sessionId: string; folder: string } }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_UNREAD_TOTAL'; payload: { agentId: string; total: number } }
  | { type: 'SET_INBOX_UNREAD'; payload: { agentId: string; count: number } }
  | { type: 'SET_INBOX_TOTAL'; payload: { agentId: string; count: number } }
  | { type: 'SET_INBOX_COUNTS'; payload: { agentId: string; unread?: number; total?: number } }
  | { type: 'DECREMENT_INBOX_UNREAD'; payload: { agentId: string } }
  | { type: 'DECREMENT_INBOX_TOTAL'; payload: { agentId: string } }
  | { type: 'OPEN_INBOX_DIALOG'; payload: { agentId: string; messages: InboxMessage[] } }
  | { type: 'CLOSE_INBOX_DIALOG' }
  | { type: 'SET_INBOX_MESSAGES'; payload: InboxMessage[] }
  | { type: 'UPDATE_INBOX_MESSAGE'; payload: { messageId: string; updates: Partial<InboxMessage> } }
  | { type: 'REMOVE_INBOX_MESSAGE'; payload: string }
  | { type: 'SET_MCP_PENDING_QUESTION'; payload: MCPPendingQuestion | null }
  | { type: 'SET_MCP_PENDING_PERMISSION'; payload: MCPPendingPermission | null }
  | { type: 'SET_MCP_PENDING_PLAN_REVIEW'; payload: MCPPendingPlanReview | null }
  | { type: 'SET_AGENT_RESPONDING'; payload: { agentId: string; isResponding: boolean } }
  // Message Queue actions
  | { type: 'ADD_TO_QUEUE'; payload: { agentId: string; message: QueuedMessage } }
  | { type: 'REMOVE_FROM_QUEUE'; payload: { agentId: string; messageId: string } }
  | { type: 'UPDATE_QUEUE_MESSAGE'; payload: { agentId: string; messageId: string; content: string; attachments?: Attachment[] } }
  | { type: 'SHIFT_QUEUE'; payload: { agentId: string } }
  | { type: 'CLEAR_QUEUE'; payload: { agentId: string } }
  // Last session tracking (for global auto-submit)
  | { type: 'SET_LAST_SESSION_ID'; payload: { agentId: string; sessionId: string } }
  // Backlog counts per agent
  | { type: 'SET_BACKLOG_COUNT'; payload: { agentId: string; count: number } }
  | { type: 'RESET' };

const initialState: SessionState = {
  selectedSessionId: null,
  selectedFolder: null,
  unreadTotals: new Map(),
  inboxUnreadCounts: new Map(),
  inboxTotalCounts: new Map(),
  inboxMessages: [],
  inboxDialogAgentId: null,
  mcpPendingQuestion: null,
  mcpPendingPermission: null,
  mcpPendingPlanReview: null,
  respondingAgents: new Map(),
  messageQueues: new Map(),
  lastSessionIds: new Map(),
  backlogCounts: new Map(),
};

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'SELECT_SESSION':
      return {
        ...state,
        selectedSessionId: action.payload.sessionId,
        selectedFolder: action.payload.folder,
      };

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedSessionId: null,
        selectedFolder: null,
      };

    case 'SET_UNREAD_TOTAL': {
      const newUnreadTotals = new Map(state.unreadTotals);
      newUnreadTotals.set(action.payload.agentId, action.payload.total);
      return { ...state, unreadTotals: newUnreadTotals };
    }

    case 'SET_INBOX_UNREAD': {
      const newInboxUnreadCounts = new Map(state.inboxUnreadCounts);
      newInboxUnreadCounts.set(action.payload.agentId, action.payload.count);
      return { ...state, inboxUnreadCounts: newInboxUnreadCounts };
    }

    case 'SET_INBOX_TOTAL': {
      const newInboxTotalCounts = new Map(state.inboxTotalCounts);
      newInboxTotalCounts.set(action.payload.agentId, action.payload.count);
      return { ...state, inboxTotalCounts: newInboxTotalCounts };
    }

    case 'SET_INBOX_COUNTS': {
      const { agentId, unread, total } = action.payload;
      let newState = state;
      if (unread !== undefined) {
        const newInboxUnreadCounts = new Map(state.inboxUnreadCounts);
        newInboxUnreadCounts.set(agentId, unread);
        newState = { ...newState, inboxUnreadCounts: newInboxUnreadCounts };
      }
      if (total !== undefined) {
        const newInboxTotalCounts = new Map(state.inboxTotalCounts);
        newInboxTotalCounts.set(agentId, total);
        newState = { ...newState, inboxTotalCounts: newInboxTotalCounts };
      }
      return newState;
    }

    case 'DECREMENT_INBOX_UNREAD': {
      const current = state.inboxUnreadCounts.get(action.payload.agentId) || 0;
      const newInboxUnreadCounts = new Map(state.inboxUnreadCounts);
      newInboxUnreadCounts.set(action.payload.agentId, Math.max(0, current - 1));
      return { ...state, inboxUnreadCounts: newInboxUnreadCounts };
    }

    case 'DECREMENT_INBOX_TOTAL': {
      const current = state.inboxTotalCounts.get(action.payload.agentId) || 0;
      const newInboxTotalCounts = new Map(state.inboxTotalCounts);
      newInboxTotalCounts.set(action.payload.agentId, Math.max(0, current - 1));
      return { ...state, inboxTotalCounts: newInboxTotalCounts };
    }

    case 'OPEN_INBOX_DIALOG':
      return {
        ...state,
        inboxDialogAgentId: action.payload.agentId,
        inboxMessages: action.payload.messages,
      };

    case 'CLOSE_INBOX_DIALOG':
      return {
        ...state,
        inboxDialogAgentId: null,
        inboxMessages: [],
      };

    case 'SET_INBOX_MESSAGES':
      return { ...state, inboxMessages: action.payload };

    case 'UPDATE_INBOX_MESSAGE':
      return {
        ...state,
        inboxMessages: state.inboxMessages.map(m =>
          m.id === action.payload.messageId
            ? Object.assign({}, m, action.payload.updates) as InboxMessage
            : m
        ),
      };

    case 'REMOVE_INBOX_MESSAGE':
      return {
        ...state,
        inboxMessages: state.inboxMessages.filter(m => m.id !== action.payload),
      };

    case 'SET_MCP_PENDING_QUESTION':
      return {
        ...state,
        mcpPendingQuestion: action.payload,
      };

    case 'SET_MCP_PENDING_PERMISSION':
      return {
        ...state,
        mcpPendingPermission: action.payload,
      };

    case 'SET_MCP_PENDING_PLAN_REVIEW':
      return {
        ...state,
        mcpPendingPlanReview: action.payload,
      };

    case 'SET_AGENT_RESPONDING': {
      const newRespondingAgents = new Map(state.respondingAgents);
      if (action.payload.isResponding) {
        newRespondingAgents.set(action.payload.agentId, true);
      } else {
        newRespondingAgents.delete(action.payload.agentId);
      }
      return { ...state, respondingAgents: newRespondingAgents };
    }

    // Message Queue actions
    case 'ADD_TO_QUEUE': {
      const { agentId, message } = action.payload;
      const newQueues = new Map(state.messageQueues);
      const currentQueue = newQueues.get(agentId) || [];
      newQueues.set(agentId, [...currentQueue, message]);
      return { ...state, messageQueues: newQueues };
    }

    case 'REMOVE_FROM_QUEUE': {
      const { agentId, messageId } = action.payload;
      const newQueues = new Map(state.messageQueues);
      const currentQueue = newQueues.get(agentId) || [];
      newQueues.set(agentId, currentQueue.filter(m => m.id !== messageId));
      return { ...state, messageQueues: newQueues };
    }

    case 'UPDATE_QUEUE_MESSAGE': {
      const { agentId, messageId, content, attachments } = action.payload;
      const newQueues = new Map(state.messageQueues);
      const currentQueue = newQueues.get(agentId) || [];
      newQueues.set(agentId, currentQueue.map(m =>
        m.id === messageId
          ? { ...m, content, attachments: attachments ?? m.attachments }
          : m
      ));
      return { ...state, messageQueues: newQueues };
    }

    case 'SHIFT_QUEUE': {
      const { agentId } = action.payload;
      const newQueues = new Map(state.messageQueues);
      const currentQueue = newQueues.get(agentId) || [];
      newQueues.set(agentId, currentQueue.slice(1));
      return { ...state, messageQueues: newQueues };
    }

    case 'CLEAR_QUEUE': {
      const { agentId } = action.payload;
      const newQueues = new Map(state.messageQueues);
      newQueues.set(agentId, []);
      return { ...state, messageQueues: newQueues };
    }

    // Last session tracking (for global auto-submit)
    case 'SET_LAST_SESSION_ID': {
      const { agentId, sessionId } = action.payload;
      const newLastSessionIds = new Map(state.lastSessionIds);
      newLastSessionIds.set(agentId, sessionId);
      return { ...state, lastSessionIds: newLastSessionIds };
    }

    case 'SET_BACKLOG_COUNT': {
      const newBacklogCounts = new Map(state.backlogCounts);
      newBacklogCounts.set(action.payload.agentId, action.payload.count);
      return { ...state, backlogCounts: newBacklogCounts };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

interface SessionContextValue {
  state: SessionState;
  dispatch: Dispatch<SessionAction>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  return (
    <SessionContext.Provider value={{ state, dispatch }}>
      {children}
    </SessionContext.Provider>
  );
}
