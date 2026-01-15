import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { InputDialog } from './components/InputDialog';
import { WorkspaceDropdown } from './components/WorkspaceDropdown';
import {
  GetAuthStatus,
  GetSettings,
  SetAPIKey,
  GetConfigPath,
  StartHyperLogin,
  CompleteHyperLogin,
  Logout,
  SaveWorkspace,
  CreateWorkspace,
  GetAllWorkspaces,
  GetCurrentWorkspaceID,
  SwitchWorkspace,
  GetSessions,
  AddAgent,
  GetVersion
} from "../wailsjs/go/main/App";
import { EventsOn, EventsOff } from "../wailsjs/runtime/runtime";
import { workspace } from "../wailsjs/go/models";

interface AuthStatus {
  isAuthenticated: boolean;
  authMethod: string;
  hasApiKey: boolean;
  hasHyper: boolean;
  hasClaudeCode: boolean;
  claudeCodeSubscription: string;
}

interface DeviceAuthInfo {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}

// Use the Wails-generated Agent type
type Agent = workspace.Agent;

type View = 'startup' | 'auth' | 'main';

function App() {
  const [view, setView] = useState<View>('startup');
  const [version, setVersion] = useState<string>('');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuthInfo | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('Initializing...');

  // Workspace state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string>('New Workspace');
  const [workspaceId, setWorkspaceId] = useState<string>(''); // Workspace ID (empty = unsaved new workspace)
  const [allWorkspaces, setAllWorkspaces] = useState<workspace.WorkspaceSummary[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0); // Increment to force ChatView remount
  const [pendingInitialMessage, setPendingInitialMessage] = useState<string | null>(null); // Message to send after new session creation

  // Refs to track latest values for saveWorkspace (avoids stale closure issues)
  const workspaceNameRef = useRef(workspaceName);
  const workspaceIdRef = useRef(workspaceId);
  const agentsRef = useRef(agents);
  const selectedAgentIdRef = useRef(selectedAgentId);
  const selectedSessionIdRef = useRef(selectedSessionId);
  const selectedFolderRef = useRef(selectedFolder);

  // Keep refs in sync with state
  useEffect(() => { workspaceNameRef.current = workspaceName; }, [workspaceName]);
  useEffect(() => { workspaceIdRef.current = workspaceId; }, [workspaceId]);
  useEffect(() => { agentsRef.current = agents; }, [agents]);
  useEffect(() => { selectedAgentIdRef.current = selectedAgentId; }, [selectedAgentId]);
  useEffect(() => { selectedSessionIdRef.current = selectedSessionId; }, [selectedSessionId]);
  useEffect(() => { selectedFolderRef.current = selectedFolder; }, [selectedFolder]);

  // Clear pendingInitialMessage after it's been passed to ChatView
  // The message is consumed on mount, so we clear it shortly after
  useEffect(() => {
    if (pendingInitialMessage) {
      const timer = setTimeout(() => {
        setPendingInitialMessage(null);
      }, 500); // Small delay to ensure ChatView has received it
      return () => clearTimeout(timer);
    }
  }, [pendingInitialMessage]);

  // Save workspace function (uses refs for latest values)
  const saveWorkspaceState = useCallback(async () => {
    try {
      // Use refs for latest values (avoids stale closure issues)
      const id = workspaceIdRef.current;
      if (!id) return; // Don't save if workspace has no ID (unsaved new workspace)

      // Build selected session object if we have one
      const selAgentId = selectedAgentIdRef.current;
      const selSessionId = selectedSessionIdRef.current;
      const selFolder = selectedFolderRef.current;
      const selectedSession = selAgentId && selSessionId && selFolder
        ? { agentId: selAgentId, sessionId: selSessionId, folder: selFolder }
        : undefined;

      // Save workspace using Wails-generated class
      const ws = workspace.Workspace.createFrom({
        id: id,
        name: workspaceNameRef.current,
        agents: agentsRef.current,
        selectedSession: selectedSession,
        created: new Date().toISOString(),
        lastOpened: new Date().toISOString()
      });

      await SaveWorkspace(ws);
    } catch (err) {
      console.error('Failed to save workspace:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // Subscribe to loading:status events from backend
  useEffect(() => {
    const unsubscribe = EventsOn('loading:status', (data: { status: string }) => {
      setLoadingStatus(data.status);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Subscribe to workspace:changed to trigger splash on workspace switch
  useEffect(() => {
    const unsubscribe = EventsOn('workspace:changed', (data: any) => {
      // When workspace:changed with null workspaceId, show splash
      if (data?.workspaceId === null) {
        setView('startup');
        setLoadingStatus('Switching workspace...');
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Keyboard shortcuts: CMD-1/2/3 for agents, CMD-S to save, CMD-N for new window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD-S: Save workspace (open dialog)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        setSaveDialogOpen(true);
        return;
      }

      // CMD-N: New workspace (clear state)
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleNewWorkspace();
        return;
      }

      // CMD-R: Reload workspace (restart watchers, refresh state)
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        handleReloadWorkspace();
        return;
      }

      // CMD-1/2/3... to select agents
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (index < agents.length) {
          const agent = agents[index];
          // Toggle selection - if already selected, deselect
          if (selectedAgentId === agent.id) {
            setSelectedAgentId(null);
            setSelectedSessionId(null);
            setSelectedFolder(null);
          } else {
            setSelectedAgentId(agent.id);
            // Restore agent's last selected session if it has one
            if (agent.selectedSessionId) {
              setSelectedSessionId(agent.selectedSessionId);
              setSelectedFolder(agent.folder);
            } else {
              setSelectedSessionId(null);
              setSelectedFolder(null);
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [agents, selectedAgentId]);

  // Auto-save workspace when agents, session, or name changes
  // Use a small delay to ensure refs are updated with latest state
  useEffect(() => {
    if (!workspaceId) return; // Only auto-save if we have a workspace ID

    // Debounce saves to avoid rapid successive writes
    const timeoutId = setTimeout(() => {
      saveWorkspaceState();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [agents, selectedAgentId, selectedSessionId, selectedFolder, workspaceName, workspaceId, saveWorkspaceState]);

  const loadData = async () => {
    try {
      const [auth, sett, path, ver] = await Promise.all([
        GetAuthStatus(),
        GetSettings(),
        GetConfigPath(),
        GetVersion()
      ]);
      setAuthStatus(auth);
      setSettings(sett);
      setConfigPath(path);
      setVersion(ver);

      // Load all workspaces and current workspace ID
      let workspaces: workspace.WorkspaceSummary[] = [];
      let currentId = '';
      try {
        [workspaces, currentId] = await Promise.all([
          GetAllWorkspaces(),
          GetCurrentWorkspaceID()
        ]);
        setAllWorkspaces(workspaces || []);
      } catch (e) {
        console.log('Failed to load workspaces');
      }

      // Auto-load the current workspace (if set)
      if (currentId) {
        try {
          const ws = await SwitchWorkspace(currentId);
          if (ws) {
            setWorkspaceName(ws.name || 'Workspace');
            setWorkspaceId(ws.id);
            setAgents(ws.agents || []);
            console.log(`Loaded workspace "${ws.name}" with ${ws.agents?.length || 0} agent(s)`);

            // Restore selected session
            if (ws.selectedSession?.agentId && ws.selectedSession?.sessionId && ws.selectedSession?.folder) {
              setSelectedAgentId(ws.selectedSession.agentId);
              setSelectedSessionId(ws.selectedSession.sessionId);
              setSelectedFolder(ws.selectedSession.folder);
            } else {
              // Find first agent with a saved session
              const agentWithSession = ws.agents?.find((a: any) => a.selectedSessionId);
              if (agentWithSession?.selectedSessionId) {
                setSelectedAgentId(agentWithSession.id);
                setSelectedSessionId(agentWithSession.selectedSessionId);
                setSelectedFolder(agentWithSession.folder);
              }
            }
          }
        } catch (e) {
          console.log('Failed to load current workspace, starting fresh');
        }
      } else if (workspaces.length > 0) {
        // No current set, but workspaces exist - load the most recent
        try {
          const ws = await SwitchWorkspace(workspaces[0].id);
          if (ws) {
            setWorkspaceName(ws.name || 'Workspace');
            setWorkspaceId(ws.id);
            setAgents(ws.agents || []);
          }
        } catch (e) {
          console.log('Failed to load workspace');
        }
      } else {
        // No workspaces exist - start with empty state
        console.log('No workspaces found, starting fresh');
      }

      // Transition to main or auth view (no delay - backend loading:status shows progress)
      if (auth.isAuthenticated) {
        setView('main');
      } else {
        setView('auth');
      }
    } catch (err) {
      setMessage(`Error loading data: ${err}`);
      setView('auth');
    }
  };

  const handleSetAPIKey = async () => {
    if (!apiKey.trim()) {
      setMessage('Please enter an API key');
      return;
    }
    try {
      await SetAPIKey(apiKey);
      setMessage('API key saved successfully!');
      setApiKey('');
      await loadData();
    } catch (err) {
      setMessage(`Error saving API key: ${err}`);
    }
  };

  const handleHyperLogin = async () => {
    setIsLoading(true);
    setMessage('');
    try {
      const info = await StartHyperLogin();
      setDeviceAuth(info);
      setMessage(`Enter code "${info.userCode}" in the browser window that opened`);
      await CompleteHyperLogin(info.deviceCode, info.expiresIn);
      setMessage('Successfully authenticated with Claude Pro/Max!');
      setDeviceAuth(null);
      await loadData();
    } catch (err) {
      setMessage(`Authentication failed: ${err}`);
      setDeviceAuth(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await Logout();
      setMessage('Logged out successfully');
      await loadData();
    } catch (err) {
      setMessage(`Error logging out: ${err}`);
    }
  };

  const handleAddAgent = async (folder: string, name: string) => {
    try {
      // Create the agent in the backend (generates UUID, starts watching)
      const newAgent = await AddAgent(name, folder);
      setAgents(prev => [...prev, newAgent]);

      // Auto-select the agent and its newest session
      const sessions = await GetSessions(newAgent.id);
      if (sessions && sessions.length > 0) {
        // Sessions are sorted by updatedAt (newest first)
        const newestSession = sessions[0];
        setSelectedAgentId(newAgent.id);
        setSelectedSessionId(newestSession.id);
        setSelectedFolder(folder);
        // Also save to agent for persistence
        setAgents(prev => prev.map(agent =>
          agent.id === newAgent.id
            ? { ...agent, selectedSessionId: newestSession.id }
            : agent
        ));
      } else {
        // No sessions yet, just select the agent
        setSelectedAgentId(newAgent.id);
        setSelectedSessionId(null);
        setSelectedFolder(null);
      }
    } catch (err) {
      console.error('Failed to add agent:', err);
    }
  };

  const handleRenameAgent = (agentId: string, newName: string) => {
    setAgents(prev => prev.map(agent =>
      agent.id === agentId ? { ...agent, name: newName } : agent
    ));
  };

  const handleRemoveAgent = (agentId: string) => {
    setAgents(prev => prev.filter(agent => agent.id !== agentId));
    if (selectedAgentId === agentId) {
      setSelectedAgentId(null);
      setSelectedSessionId(null);
      setSelectedFolder(null);
    }
  };

  const handleSessionSelect = (agentId: string, sessionId: string, folder: string) => {
    setSelectedAgentId(agentId);
    setSelectedSessionId(sessionId);
    setSelectedFolder(folder);
    // Save selectedSessionId to the agent for persistence
    setAgents(prev => prev.map(agent =>
      agent.id === agentId
        ? { ...agent, selectedSessionId: sessionId }
        : agent
    ));
  };

  // Handler for when a new session is created from ChatView
  const handleNewSessionCreated = (newSessionId: string, initialMessage: string) => {
    console.log('New session created:', newSessionId, 'with message:', initialMessage);
    // Store the message to send after switching
    setPendingInitialMessage(initialMessage);
    // Switch to the new session (using current agent's folder)
    if (selectedAgentId && selectedFolder) {
      handleSessionSelect(selectedAgentId, newSessionId, selectedFolder);
      // Increment reloadKey to force ChatView remount
      setReloadKey(prev => prev + 1);
    }
  };

  const handleAgentSelect = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    // Toggle selection - if already selected, deselect
    if (selectedAgentId === agentId) {
      setSelectedAgentId(null);
      setSelectedSessionId(null);
      setSelectedFolder(null);
    } else {
      setSelectedAgentId(agentId);
      // Restore agent's last selected session if it has one
      if (agent.selectedSessionId) {
        setSelectedSessionId(agent.selectedSessionId);
        setSelectedFolder(agent.folder);
      } else {
        setSelectedSessionId(null);
        setSelectedFolder(null);
      }
    }
  };

  const handleSaveWorkspaceName = async (newName: string) => {
    setWorkspaceName(newName);
    setSaveDialogOpen(false);
    // Save to workspace file
    await saveWorkspaceState();
    console.log(`Workspace renamed to: ${newName}`);
  };

  const handleSwitchWorkspace = async (id: string) => {
    // Show splash immediately before async call
    setView('startup');
    setLoadingStatus('Switching workspace...');

    try {
      const ws = await SwitchWorkspace(id);
      if (ws) {
        setWorkspaceName(ws.name || 'Workspace');
        setWorkspaceId(ws.id);
        setAgents(ws.agents || []);
        // Restore selected session if any
        if (ws.selectedSession?.agentId && ws.selectedSession?.sessionId && ws.selectedSession?.folder) {
          setSelectedAgentId(ws.selectedSession.agentId);
          setSelectedSessionId(ws.selectedSession.sessionId);
          setSelectedFolder(ws.selectedSession.folder);
        } else {
          setSelectedAgentId(null);
          setSelectedSessionId(null);
          setSelectedFolder(null);
        }
      }
      // Refresh workspace list
      const workspaces = await GetAllWorkspaces();
      setAllWorkspaces(workspaces || []);
      // Transition back to main view
      setView('main');
    } catch (err) {
      console.error('Failed to switch workspace:', err);
      setView('main'); // Go back to main even on error
    }
  };

  const handleNewWorkspace = async () => {
    try {
      // Create a new workspace with default name
      const ws = await CreateWorkspace('New Workspace');
      if (ws) {
        setWorkspaceName(ws.name);
        setWorkspaceId(ws.id);
        setAgents([]);
        setSelectedAgentId(null);
        setSelectedSessionId(null);
        setSelectedFolder(null);
        // Refresh workspace list
        const workspaces = await GetAllWorkspaces();
        setAllWorkspaces(workspaces || []);
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  };

  const handleReloadWorkspace = async () => {
    // Reload current workspace from disk and restart file watchers
    console.log('Reloading workspace...');

    // Increment reloadKey to force ChatView remount (restarts file watchers)
    setReloadKey(k => k + 1);

    // Reload workspace from disk if we have one
    if (workspaceId) {
      try {
        const ws = await SwitchWorkspace(workspaceId);
        if (ws) {
          setWorkspaceName(ws.name || 'Workspace');
          setAgents(ws.agents || []);
          // Keep current selection but refresh data
          console.log(`Reloaded workspace "${ws.name}"`);
        }
      } catch (err) {
        console.error('Failed to reload workspace:', err);
      }
    }

    // Refresh workspace list
    try {
      const workspaces = await GetAllWorkspaces();
      setAllWorkspaces(workspaces || []);
    } catch (err) {
      console.error('Failed to refresh workspace list:', err);
    }
  };

  // Startup View
  if (view === 'startup') {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 100%)'
      }}>
        <img
          src="/assets/claudefu-logo.png"
          alt="ClaudeFu"
          style={{ width: '400px', marginBottom: '2rem' }}
        />
        {version && (
          <div style={{ color: '#444', fontSize: '0.8rem', marginBottom: '1rem' }}>
            v{version}
          </div>
        )}
        <div style={{ color: '#666', fontSize: '0.9rem' }}>
          {loadingStatus}
        </div>
      </div>
    );
  }

  // Auth View
  if (view === 'auth') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '3rem 2rem',
        background: 'linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 100%)'
      }}>
        <img
          src="/assets/claude-fu-icon.png"
          alt="ClaudeFu"
          style={{ width: '120px', marginBottom: '1rem' }}
        />
        <h1 style={{ color: '#fff', marginBottom: '0.25rem', fontSize: '1.5rem' }}>ClaudeFu</h1>
        <p style={{ color: '#666', marginBottom: '2rem', fontSize: '0.85rem' }}>Code GUI Orchestrator</p>

        {authStatus?.hasClaudeCode && (
          <div style={{
            background: '#14532d',
            padding: '1.25rem',
            borderRadius: '12px',
            marginBottom: '1.5rem',
            width: '100%',
            maxWidth: '360px',
            textAlign: 'center'
          }}>
            <div style={{ color: '#4ade80', fontWeight: 600, marginBottom: '0.5rem' }}>
              Claude Code Detected
            </div>
            <p style={{ color: '#86efac', fontSize: '0.85rem', margin: 0 }}>
              {authStatus.claudeCodeSubscription && (
                <span>Claude {authStatus.claudeCodeSubscription.charAt(0).toUpperCase() + authStatus.claudeCodeSubscription.slice(1)} subscription</span>
              )}
            </p>
            <button
              onClick={() => setView('main')}
              style={{
                marginTop: '1rem',
                padding: '0.6rem 1.5rem',
                borderRadius: '6px',
                border: 'none',
                background: '#4ade80',
                color: '#000',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              Continue
            </button>
          </div>
        )}

        {!authStatus?.hasClaudeCode && !authStatus?.hasHyper && (
          <div style={{
            background: '#1a1a1a',
            padding: '1.25rem',
            borderRadius: '12px',
            marginBottom: '1rem',
            width: '100%',
            maxWidth: '360px'
          }}>
            <h3 style={{ color: '#fff', marginBottom: '0.5rem', fontSize: '0.95rem' }}>Claude Pro/Max</h3>
            <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '1rem' }}>
              Log in with your Claude subscription
            </p>
            <button
              onClick={handleHyperLogin}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.6rem 1rem',
                borderRadius: '6px',
                border: 'none',
                background: isLoading ? '#555' : '#8b5cf6',
                color: '#fff',
                cursor: isLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {isLoading ? 'Waiting for browser...' : 'Login with Claude'}
            </button>
            {deviceAuth && (
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#2a2a2a', borderRadius: '6px' }}>
                <p style={{ color: '#fff', fontSize: '0.85rem', margin: 0 }}>
                  Code: <strong style={{ color: '#fbbf24' }}>{deviceAuth.userCode}</strong>
                </p>
              </div>
            )}
          </div>
        )}

        <div style={{
          background: '#1a1a1a',
          padding: '1.25rem',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '360px'
        }}>
          <h3 style={{ color: '#fff', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
            {authStatus?.hasClaudeCode ? 'Or Use API Key' : 'API Key'}
          </h3>
          <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            Use an Anthropic API key
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: '6px',
                border: '1px solid #333',
                background: '#0a0a0a',
                color: '#fff',
                fontSize: '0.85rem'
              }}
            />
            <button
              onClick={handleSetAPIKey}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: 'none',
                background: '#f97316',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Save
            </button>
          </div>
        </div>

        {message && (
          <div style={{
            padding: '1rem',
            borderRadius: '8px',
            background: message.includes('Error') || message.includes('failed') ? '#7f1d1d' : '#14532d',
            color: '#fff',
            marginTop: '1.5rem',
            width: '100%',
            maxWidth: '360px',
            fontSize: '0.85rem',
            textAlign: 'center'
          }}>
            {message}
          </div>
        )}
      </div>
    );
  }

  // Get selected agent for header
  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  // Main View
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0a0a',
      color: '#fff'
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid #222',
        background: '#111',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/assets/claude-fu-icon.png" alt="ClaudeFu" style={{ width: '32px' }} />
          <span style={{ fontWeight: 600, color: '#f97316' }}>ClaudeFu</span>
          <span style={{ color: '#333' }}>/</span>
          <WorkspaceDropdown
            currentName={workspaceName}
            currentId={workspaceId}
            workspaces={allWorkspaces}
            onSelectWorkspace={handleSwitchWorkspace}
            onNewWorkspace={handleNewWorkspace}
          />
          {selectedAgent && (
            <>
              <span style={{ color: '#333' }}>/</span>
              <span style={{ color: '#888', fontSize: '0.9rem' }}>{selectedAgent.name}</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#666' }}>
            {authStatus?.hasClaudeCode && authStatus.claudeCodeSubscription && (
              <span style={{ color: '#4ade80' }}>
                Claude {authStatus.claudeCodeSubscription.charAt(0).toUpperCase() + authStatus.claudeCodeSubscription.slice(1)}
              </span>
            )}
            {authStatus?.hasApiKey && !authStatus.hasClaudeCode && (
              <span style={{ color: '#f97316' }}>API Key</span>
            )}
          </span>
        </div>
      </header>

      {/* Main Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <Sidebar
          agents={agents}
          onAddAgent={handleAddAgent}
          onRenameAgent={handleRenameAgent}
          onRemoveAgent={handleRemoveAgent}
          onAgentSelect={handleAgentSelect}
          onSessionSelect={handleSessionSelect}
          selectedAgentId={selectedAgentId}
          selectedSessionId={selectedSessionId}
        />

        {/* Main Content */}
        <main style={{
          flex: 1,
          overflow: 'hidden',
          padding: selectedSessionId ? 0 : '2rem',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {agents.length === 0 ? (
            // No agents - show welcome
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center'
            }}>
              <img
                src="/assets/claude-fu-icon.png"
                alt=""
                style={{ width: '100px', opacity: 0.2, marginBottom: '1.5rem' }}
              />
              <h2 style={{ color: '#444', fontWeight: 400, marginBottom: '0.5rem' }}>
                Add a Claude Code Agent
              </h2>
              <p style={{ color: '#333', fontSize: '0.9rem', maxWidth: '400px' }}>
                Click "+ Claude Code Agent" to add a project folder to your workspace.
              </p>
            </div>
          ) : selectedSessionId && selectedFolder && selectedAgentId ? (
            // Session selected - show conversation
            <ChatView
              key={`${selectedAgentId}-${selectedSessionId}-${reloadKey}`}
              agentId={selectedAgentId}
              folder={selectedFolder}
              sessionId={selectedSessionId}
              onSessionCreated={handleNewSessionCreated}
              initialMessage={pendingInitialMessage || undefined}
            />
          ) : (
            // Agents but no session selected
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center'
            }}>
              <img
                src="/assets/claude-fu-icon.png"
                alt=""
                style={{ width: '80px', opacity: 0.15, marginBottom: '1.5rem' }}
              />
              <h2 style={{ color: '#444', fontWeight: 400, marginBottom: '0.5rem' }}>
                Select a Conversation
              </h2>
              <p style={{ color: '#333', fontSize: '0.9rem', maxWidth: '400px' }}>
                Expand an agent in the sidebar to see conversations.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Save Workspace Dialog */}
      <InputDialog
        isOpen={saveDialogOpen}
        title="Save Workspace"
        label="Workspace Name"
        value={workspaceName}
        placeholder="Enter workspace name"
        onSubmit={handleSaveWorkspaceName}
        onClose={() => setSaveDialogOpen(false)}
      />
    </div>
  );
}

export default App;
