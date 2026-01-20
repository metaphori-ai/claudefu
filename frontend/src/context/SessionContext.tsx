import { createContext, useReducer, ReactNode, Dispatch } from 'react';
import { mcpserver } from '../../wailsjs/go/models';

type InboxMessage = mcpserver.InboxMessage;

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
  // Per-agent "Claude is responding" state (survives agent switching)
  respondingAgents: Map<string, boolean>;
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
  | { type: 'SET_AGENT_RESPONDING'; payload: { agentId: string; isResponding: boolean } }
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
  respondingAgents: new Map(),
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

    case 'SET_AGENT_RESPONDING': {
      const newRespondingAgents = new Map(state.respondingAgents);
      if (action.payload.isResponding) {
        newRespondingAgents.set(action.payload.agentId, true);
      } else {
        newRespondingAgents.delete(action.payload.agentId);
      }
      return { ...state, respondingAgents: newRespondingAgents };
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
