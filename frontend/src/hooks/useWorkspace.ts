import { useContext, useCallback } from 'react';
import { WorkspaceContext, WorkspaceAction } from '../context/WorkspaceContext';
import { workspace, types } from '../../wailsjs/go/models';

type Agent = workspace.Agent;
type Session = types.Session;
type MCPConfig = workspace.MCPConfig;
type WorkspaceSummary = workspace.WorkspaceSummary;

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }

  const { state, dispatch } = context;

  // Action creators
  const setWorkspace = useCallback((payload: {
    id: string;
    name: string;
    agents: Agent[];
    mcpConfig?: MCPConfig;
    selectedAgentId?: string | null;
  }) => {
    dispatch({ type: 'SET_WORKSPACE', payload });
  }, [dispatch]);

  const setWorkspaceName = useCallback((name: string) => {
    dispatch({ type: 'SET_WORKSPACE_NAME', payload: name });
  }, [dispatch]);

  const setAllWorkspaces = useCallback((workspaces: WorkspaceSummary[]) => {
    dispatch({ type: 'SET_ALL_WORKSPACES', payload: workspaces });
  }, [dispatch]);

  const setMcpConfig = useCallback((config: MCPConfig | undefined) => {
    dispatch({ type: 'SET_MCP_CONFIG', payload: config });
  }, [dispatch]);

  const addAgent = useCallback((agent: Agent) => {
    dispatch({ type: 'ADD_AGENT', payload: agent });
  }, [dispatch]);

  const removeAgent = useCallback((agentId: string) => {
    dispatch({ type: 'REMOVE_AGENT', payload: agentId });
  }, [dispatch]);

  const renameAgent = useCallback((agentId: string, name: string) => {
    dispatch({ type: 'RENAME_AGENT', payload: { agentId, name } });
  }, [dispatch]);

  const updateAgent = useCallback((agent: Agent) => {
    dispatch({ type: 'UPDATE_AGENT', payload: agent });
  }, [dispatch]);

  const setAgents = useCallback((agents: Agent[]) => {
    dispatch({ type: 'SET_AGENTS', payload: agents });
  }, [dispatch]);

  const selectAgent = useCallback((agentId: string | null) => {
    dispatch({ type: 'SELECT_AGENT', payload: agentId });
  }, [dispatch]);

  const setAgentSelectedSession = useCallback((agentId: string, sessionId: string) => {
    dispatch({ type: 'SET_AGENT_SELECTED_SESSION', payload: { agentId, sessionId } });
  }, [dispatch]);

  const setAgentSessions = useCallback((agentId: string, sessions: Session[]) => {
    dispatch({ type: 'SET_AGENT_SESSIONS', payload: { agentId, sessions } });
  }, [dispatch]);

  const addDiscoveredSession = useCallback((agentId: string, session: Session) => {
    dispatch({ type: 'ADD_DISCOVERED_SESSION', payload: { agentId, session } });
  }, [dispatch]);

  const setSessionName = useCallback((agentId: string, sessionId: string, name: string) => {
    dispatch({ type: 'SET_SESSION_NAME', payload: { agentId, sessionId, name } });
  }, [dispatch]);

  const setAllSessionNames = useCallback((agentId: string, names: Record<string, string>) => {
    dispatch({ type: 'SET_ALL_SESSION_NAMES', payload: { agentId, names } });
  }, [dispatch]);

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading });
  }, [dispatch]);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, [dispatch]);

  return {
    // State
    workspaceId: state.workspaceId,
    workspaceName: state.workspaceName,
    allWorkspaces: state.allWorkspaces,
    mcpConfig: state.mcpConfig,
    agents: state.agents,
    selectedAgentId: state.selectedAgentId,
    agentSessions: state.agentSessions,
    sessionNames: state.sessionNames,
    isLoading: state.isLoading,

    // Actions
    setWorkspace,
    setWorkspaceName,
    setAllWorkspaces,
    setMcpConfig,
    addAgent,
    removeAgent,
    renameAgent,
    updateAgent,
    setAgents,
    selectAgent,
    setAgentSelectedSession,
    setAgentSessions,
    addDiscoveredSession,
    setSessionName,
    setAllSessionNames,
    setLoading,
    reset,

    // Raw dispatch for advanced usage
    dispatch,
  };
}
