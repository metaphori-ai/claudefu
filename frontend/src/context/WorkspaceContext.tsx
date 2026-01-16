import { createContext, useReducer, ReactNode, Dispatch } from 'react';
import { workspace, types } from '../../wailsjs/go/models';

type Agent = workspace.Agent;
type Session = types.Session;
type MCPConfig = workspace.MCPConfig;
type WorkspaceSummary = workspace.WorkspaceSummary;

// WorkspaceState: state that changes infrequently (workspace switches, agent add/remove)
export interface WorkspaceState {
  workspaceId: string;
  workspaceName: string;
  allWorkspaces: WorkspaceSummary[];
  mcpConfig: MCPConfig | undefined;
  agents: Agent[];
  selectedAgentId: string | null;
  agentSessions: Map<string, Session[]>;
  sessionNames: Map<string, Map<string, string>>;
  isLoading: boolean;
}

export type WorkspaceAction =
  | { type: 'SET_WORKSPACE'; payload: { id: string; name: string; agents: Agent[]; mcpConfig?: MCPConfig; selectedAgentId?: string | null } }
  | { type: 'SET_WORKSPACE_NAME'; payload: string }
  | { type: 'SET_ALL_WORKSPACES'; payload: WorkspaceSummary[] }
  | { type: 'SET_MCP_CONFIG'; payload: MCPConfig | undefined }
  | { type: 'ADD_AGENT'; payload: Agent }
  | { type: 'REMOVE_AGENT'; payload: string }
  | { type: 'RENAME_AGENT'; payload: { agentId: string; name: string } }
  | { type: 'UPDATE_AGENT'; payload: Agent }
  | { type: 'SET_AGENTS'; payload: Agent[] }
  | { type: 'SELECT_AGENT'; payload: string | null }
  | { type: 'SET_AGENT_SELECTED_SESSION'; payload: { agentId: string; sessionId: string } }
  | { type: 'SET_AGENT_SESSIONS'; payload: { agentId: string; sessions: Session[] } }
  | { type: 'ADD_DISCOVERED_SESSION'; payload: { agentId: string; session: Session } }
  | { type: 'SET_SESSION_NAME'; payload: { agentId: string; sessionId: string; name: string } }
  | { type: 'SET_ALL_SESSION_NAMES'; payload: { agentId: string; names: Record<string, string> } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'RESET' };

const initialState: WorkspaceState = {
  workspaceId: '',
  workspaceName: 'New Workspace',
  allWorkspaces: [],
  mcpConfig: undefined,
  agents: [],
  selectedAgentId: null,
  agentSessions: new Map(),
  sessionNames: new Map(),
  isLoading: false,
};

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'SET_WORKSPACE':
      return {
        ...state,
        workspaceId: action.payload.id,
        workspaceName: action.payload.name,
        agents: action.payload.agents,
        mcpConfig: action.payload.mcpConfig,
        selectedAgentId: action.payload.selectedAgentId ?? null,
        // Clear session data when switching workspaces
        agentSessions: new Map(),
        sessionNames: new Map(),
      };

    case 'SET_WORKSPACE_NAME':
      return { ...state, workspaceName: action.payload };

    case 'SET_ALL_WORKSPACES':
      return { ...state, allWorkspaces: action.payload };

    case 'SET_MCP_CONFIG':
      return { ...state, mcpConfig: action.payload };

    case 'ADD_AGENT':
      return { ...state, agents: [...state.agents, action.payload] };

    case 'REMOVE_AGENT': {
      const newAgents = state.agents.filter(a => a.id !== action.payload);
      const newSelectedAgentId = state.selectedAgentId === action.payload ? null : state.selectedAgentId;
      // Clean up session data for removed agent
      const newAgentSessions = new Map(state.agentSessions);
      const newSessionNames = new Map(state.sessionNames);
      newAgentSessions.delete(action.payload);
      newSessionNames.delete(action.payload);
      return {
        ...state,
        agents: newAgents,
        selectedAgentId: newSelectedAgentId,
        agentSessions: newAgentSessions,
        sessionNames: newSessionNames,
      };
    }

    case 'RENAME_AGENT':
      return {
        ...state,
        agents: state.agents.map(a =>
          a.id === action.payload.agentId ? { ...a, name: action.payload.name } : a
        ),
      };

    case 'UPDATE_AGENT':
      return {
        ...state,
        agents: state.agents.map(a =>
          a.id === action.payload.id ? action.payload : a
        ),
      };

    case 'SET_AGENTS':
      return { ...state, agents: action.payload };

    case 'SELECT_AGENT':
      return { ...state, selectedAgentId: action.payload };

    case 'SET_AGENT_SELECTED_SESSION':
      return {
        ...state,
        agents: state.agents.map(a =>
          a.id === action.payload.agentId
            ? { ...a, selectedSessionId: action.payload.sessionId }
            : a
        ),
      };

    case 'SET_AGENT_SESSIONS': {
      const newAgentSessions = new Map(state.agentSessions);
      newAgentSessions.set(action.payload.agentId, action.payload.sessions);
      return { ...state, agentSessions: newAgentSessions };
    }

    case 'ADD_DISCOVERED_SESSION': {
      const { agentId, session } = action.payload;
      // Skip subagent sessions
      if (session.id.startsWith('agent-')) return state;

      const currentSessions = state.agentSessions.get(agentId) || [];
      // Check if session already exists
      if (currentSessions.some(s => s.id === session.id)) return state;

      // Add new session and sort by updatedAt descending
      const updatedSessions = [...currentSessions, session].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      const newAgentSessions = new Map(state.agentSessions);
      newAgentSessions.set(agentId, updatedSessions);
      return { ...state, agentSessions: newAgentSessions };
    }

    case 'SET_SESSION_NAME': {
      const { agentId, sessionId, name } = action.payload;
      const newSessionNames = new Map(state.sessionNames);
      const agentNames = new Map(newSessionNames.get(agentId) || []);
      if (name) {
        agentNames.set(sessionId, name);
      } else {
        agentNames.delete(sessionId);
      }
      newSessionNames.set(agentId, agentNames);
      return { ...state, sessionNames: newSessionNames };
    }

    case 'SET_ALL_SESSION_NAMES': {
      const { agentId, names } = action.payload;
      const newSessionNames = new Map(state.sessionNames);
      newSessionNames.set(agentId, new Map(Object.entries(names)));
      return { ...state, sessionNames: newSessionNames };
    }

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);

  return (
    <WorkspaceContext.Provider value={{ state, dispatch }}>
      {children}
    </WorkspaceContext.Provider>
  );
}
