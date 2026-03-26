import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import type { DraftState } from './components/chat/types';
import { InputDialog } from './components/InputDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ManageWorkspacesDialog } from './components/ManageWorkspacesDialog';
import { ManageAgentsDialog } from './components/ManageAgentsDialog';
import { WorkspaceDropdown } from './components/WorkspaceDropdown';
import { MCPSettingsPane } from './components/MCPSettingsPane';
import { TerminalPanelInline } from './components/terminal/TerminalPanelInline';
import { MCPQuestionDialog } from './components/MCPQuestionDialog';
import { PermissionRequestDialog } from './components/PermissionRequestDialog';
import { ScaffoldDialog } from './components/ScaffoldDialog';
import { StartupView } from './components/StartupView';
import { AuthView } from './components/AuthView';
import { NotificationToast } from './components/NotificationToast';
import { NotificationsDialog } from './components/NotificationsDialog';
import { WorkspaceMetaDialog } from './components/WorkspaceMetaDialog';
import { WorkspaceProvider, SessionProvider, MessagesProvider } from './context';
import { useWorkspace, useSession, useSelectedAgent, useSessionName, useKeyboardShortcuts, useErrorListeners, useMenuEvents, useNotifications, WailsEventHub } from './hooks';
import { QueueWatcher } from './components/QueueWatcher';
import { Tooltip } from './components/Tooltip';
import {
  GetAuthStatus,
  GetSettings,
  GetConfigPath,
  SaveWorkspace,
  CreateWorkspace,
  GetAllWorkspaces,
  GetCurrentWorkspaceID,
  GetCurrentWorkspace,
  ReloadCurrentWorkspace,
  SwitchWorkspace,
  GetSessions,
  AddAgent,
  GetVersion,
  CheckForUpdates,
  DownloadUpdate,
  ApplyUpdateAndRestart,
  RefreshMenu,
  DeleteWorkspace,
  RenameWorkspace,
  RemoveAgent,
  SelectWorkspaceFolder,
  CheckAgentScaffold,
  ScaffoldAgent,
  RefreshSessions,
  UpdateAgent,
  GetAgentMeta,
  UpdateAgentMeta
} from "../wailsjs/go/main/App";
import { EventsOn, BrowserOpenURL } from "../wailsjs/runtime/runtime";
import { workspace, scaffold } from "../wailsjs/go/models";
import { debugLogger } from './utils/debugLogger';

interface AuthStatus {
  isAuthenticated: boolean;
  authMethod: string;
  hasApiKey: boolean;
  hasHyper: boolean;
  hasClaudeCode: boolean;
  claudeCodeSubscription: string;
}

type View = 'startup' | 'auth' | 'main';

// Main app content that uses the context hooks
function AppContent() {
  const [view, setView] = useState<View>('startup');
  const [version, setVersion] = useState<string>('');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [loadingStatus, setLoadingStatus] = useState<string>('Initializing...');
  const [splashMinTimeElapsed, setSplashMinTimeElapsed] = useState<boolean>(false);
  const [pendingView, setPendingView] = useState<'auth' | 'main' | null>(null);

  // Local UI state
  const [saveDialogOpen, setSaveDialogOpen] = useState<boolean>(false);
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState<boolean>(false);
  const [manageWorkspacesOpen, setManageWorkspacesOpen] = useState<boolean>(false);
  const [manageAgentsOpen, setManageAgentsOpen] = useState<boolean>(false);
  const [confirmDeleteWorkspaceId, setConfirmDeleteWorkspaceId] = useState<string | null>(null);
  const [confirmRemoveAgentId, setConfirmRemoveAgentId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [pendingInitialMessage, setPendingInitialMessage] = useState<string | null>(null);
  const [openSessionsForAgentId, setOpenSessionsForAgentId] = useState<string | null>(null);
  const [isCreatingNewSessionExternally, setIsCreatingNewSessionExternally] = useState<boolean>(false);
  const [terminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [showAuthExpired, setShowAuthExpired] = useState<boolean>(false);
  const [rateLimitResetTime, setRateLimitResetTime] = useState<string | null>(null);
  const [workspaceMetaOpen, setWorkspaceMetaOpen] = useState(false);
  const [scaffoldDialog, setScaffoldDialog] = useState<{
    folder: string;
    name: string;
    check: scaffold.ScaffoldCheck;
    isAddAgent: boolean; // true = Add Agent flow, false = Select Agent flow
    pendingAgentId?: string; // for Select Agent flow
  } | null>(null);

  // Draft persistence across ChatView remounts (survives agent switching)
  const draftsRef = useRef<Map<string, DraftState>>(new Map());

  // Notifications hook (replaces inline notification state + mcp:notification subscription + update check)
  const notifications = useNotifications();

  // Use context hooks for workspace and session state
  const {
    workspaceId,
    workspaceName,
    allWorkspaces,
    mcpConfig,
    agents,
    selectedAgentId,
    setWorkspace,
    setWorkspaceName,
    setAllWorkspaces,
    setMcpConfig,
    addAgent,
    removeAgent,
    renameAgent,
    setAgents,
    selectAgent,
    setAgentSelectedSession,
  } = useWorkspace();

  const {
    selectedSessionId,
    selectedFolder,
    selectSession,
    clearSelection,
  } = useSession();

  const selectedAgent = useSelectedAgent();
  const sessionDisplayName = useSessionName(selectedAgentId || null, selectedSessionId || null);

  // Clear pendingInitialMessage after it's been passed to ChatView
  useEffect(() => {
    if (pendingInitialMessage) {
      const timer = setTimeout(() => {
        setPendingInitialMessage(null);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [pendingInitialMessage]);

  // Save workspace function
  const saveWorkspaceState = useCallback(async () => {
    if (!workspaceId) return;

    try {
      const selectedSession = selectedAgentId && selectedSessionId && selectedFolder
        ? { agentId: selectedAgentId, sessionId: selectedSessionId, folder: selectedFolder }
        : undefined;

      const ws = workspace.Workspace.createFrom({
        id: workspaceId,
        name: workspaceName,
        agents: agents,
        mcpConfig: mcpConfig,
        selectedSession: selectedSession,
        created: new Date().toISOString(),
        lastOpened: new Date().toISOString()
      });

      await SaveWorkspace(ws);
    } catch (err) {
      console.error('Failed to save workspace:', err);
    }
  }, [workspaceId, workspaceName, agents, mcpConfig, selectedAgentId, selectedSessionId, selectedFolder]);

  useEffect(() => {
    loadData();
    // Start 3 second minimum splash timer
    const timer = setTimeout(() => {
      setSplashMinTimeElapsed(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Transition from splash only when both loading is done AND minimum time elapsed
  useEffect(() => {
    if (splashMinTimeElapsed && pendingView && view === 'startup') {
      setView(pendingView);
      setPendingView(null);
    }
  }, [splashMinTimeElapsed, pendingView, view]);

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
      if (data?.workspaceId === null) {
        setView('startup');
        setLoadingStatus('Switching workspace...');
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Auto-save workspace when state changes
  useEffect(() => {
    if (!workspaceId) return;

    const timeoutId = setTimeout(() => {
      saveWorkspaceState();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [agents, selectedAgentId, selectedSessionId, selectedFolder, workspaceName, workspaceId, mcpConfig, saveWorkspaceState]);

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
      // Initialize debug logger from settings
      const debugEnabled = sett?.debugLogging ?? false;
      debugLogger.setEnabled(debugEnabled);
      if (debugEnabled) {
        console.log('[ClaudeFu] Debug logging ENABLED (Ctrl+Shift+D to toggle)');
      }
      setConfigPath(path);
      setVersion(ver);

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

      if (currentId) {
        try {
          // Use GetCurrentWorkspace on startup - backend already initialized it
          // This avoids duplicate session loading and MCP restarts
          const ws = await GetCurrentWorkspace();
          console.log('[DEBUG] GetCurrentWorkspace returned:', {
            id: ws?.id,
            name: ws?.name,
            agentCount: ws?.agents?.length,
            selectedSession: ws?.selectedSession,
          });
          if (ws) {
            setWorkspace({
              id: ws.id,
              name: ws.name || 'Workspace',
              agents: ws.agents || [],
              mcpConfig: ws.mcpConfig,
              selectedAgentId: ws.selectedSession?.agentId || null,
            });

            if (ws.selectedSession?.agentId && ws.selectedSession?.sessionId && ws.selectedSession?.folder) {
              console.log('[DEBUG] Restoring session from selectedSession:', ws.selectedSession);
              selectSession(ws.selectedSession.sessionId, ws.selectedSession.folder);
            } else {
              console.log('[DEBUG] No selectedSession found, checking agents for selectedSessionId');
              const agentWithSession = ws.agents?.find((a: any) => a.selectedSessionId);
              if (agentWithSession?.selectedSessionId) {
                console.log('[DEBUG] Found agent with selectedSessionId:', agentWithSession);
                selectAgent(agentWithSession.id);
                selectSession(agentWithSession.selectedSessionId, agentWithSession.folder);
              } else {
                console.log('[DEBUG] No session to restore');
              }
            }
          }
        } catch (e) {
          console.log('Failed to load current workspace, starting fresh:', e);
        }
      } else if (workspaces.length > 0) {
        try {
          const ws = await SwitchWorkspace(workspaces[0].id);
          if (ws) {
            setWorkspace({
              id: ws.id,
              name: ws.name || 'Workspace',
              agents: ws.agents || [],
              mcpConfig: ws.mcpConfig,
            });
          }
        } catch (e) {
          console.log('Failed to load workspace');
        }
      } else {
        // First launch - create a default workspace
        console.log('No workspaces found, creating default workspace');
        try {
          const ws = await CreateWorkspace('My Workspace');
          if (ws) {
            await SwitchWorkspace(ws.id);
            setWorkspace({
              id: ws.id,
              name: ws.name || 'My Workspace',
              agents: [],
              mcpConfig: ws.mcpConfig,
            });
            const updatedWorkspaces = await GetAllWorkspaces();
            setAllWorkspaces(updatedWorkspaces || []);
          }
        } catch (e) {
          console.log('Failed to create default workspace:', e);
        }
      }

      // Set pending view - will transition after splash minimum time
      if (view === 'startup') {
        setPendingView(auth.isAuthenticated ? 'main' : 'auth');
      } else {
        setView(auth.isAuthenticated ? 'main' : 'auth');
      }
    } catch (err) {
      console.error(`Error loading data: ${err}`);
      if (view === 'startup') {
        setPendingView('auth');
      } else {
        setView('auth');
      }
    }
  };

  // Completes the add-agent flow (called directly or after scaffold dialog)
  // scaffoldSessionId: if scaffold just created a first session, select it
  const completeAddAgent = async (folder: string, name: string, scaffoldSessionId?: string) => {
    try {
      const newAgent = await AddAgent(name, folder);

      // RefreshSessions ensures the backend discovers any scaffold-created session
      const sessions = await RefreshSessions(newAgent.id);
      const sessionToSelect = scaffoldSessionId
        || (sessions && sessions.length > 0 ? sessions[0].id : null);

      // Batch all state updates together (addAgent + selectAgent + selectSession)
      // to avoid intermediate renders where agent exists but no session is selected
      addAgent(newAgent);
      if (sessionToSelect) {
        selectAgent(newAgent.id);
        selectSession(sessionToSelect, folder);
        setAgentSelectedSession(newAgent.id, sessionToSelect);
        setReloadKey(prev => prev + 1);
      } else {
        selectAgent(newAgent.id);
        clearSelection();
      }
      RefreshMenu();
    } catch (err) {
      console.error('Failed to add agent:', err);
    }
  };

  const handleAddAgent = async (folder: string, name: string) => {
    try {
      const check = await CheckAgentScaffold(folder);
      if (!check.hasProjectsDir || !check.hasClaudeMD || !check.hasPermissions) {
        // Show scaffold dialog — completeAddAgent called on confirm
        setScaffoldDialog({ folder, name, check, isAddAgent: true });
      } else {
        await completeAddAgent(folder, name);
      }
    } catch (err) {
      console.error('Failed to check agent scaffold:', err);
      // Fall through to add without scaffold on error
      await completeAddAgent(folder, name);
    }
  };

  // Handler for adding agent from ManageAgentsDialog (opens folder picker)
  const handleAddAgentFromDialog = async () => {
    try {
      const folder = await SelectWorkspaceFolder();
      if (folder) {
        const name = folder.split('/').pop() || 'Agent';
        await handleAddAgent(folder, name);
      }
    } catch (err) {
      console.error('Failed to add agent:', err);
    }
  };

  const handleSessionSelect = (agentId: string, sessionId: string, folder: string) => {
    selectAgent(agentId);
    selectSession(sessionId, folder);
    setAgentSelectedSession(agentId, sessionId);
  };

  const handleNewSessionCreated = (newSessionId: string, initialMessage: string) => {
    console.log('New session created:', newSessionId, 'with message:', initialMessage);
    setPendingInitialMessage(initialMessage);
    if (selectedAgentId && selectedFolder) {
      handleSessionSelect(selectedAgentId, newSessionId, selectedFolder);
      setReloadKey(prev => prev + 1);
    }
  };

  // Completes agent selection (called directly or after scaffold dialog)
  // newSessionId: if scaffold just created a first session, select it
  const completeAgentSelect = (agentId: string, newSessionId?: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    selectAgent(agentId);
    const sessionToSelect = newSessionId || agent.selectedSessionId;
    if (sessionToSelect) {
      selectSession(sessionToSelect, agent.folder);
      if (newSessionId) {
        setAgentSelectedSession(agentId, newSessionId);
      }
    } else {
      clearSelection();
    }
    RefreshMenu();
  };

  const handleAgentSelect = async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    try {
      const check = await CheckAgentScaffold(agent.folder);
      if (!check.hasProjectsDir || !check.hasClaudeMD || !check.hasPermissions) {
        setScaffoldDialog({
          folder: agent.folder,
          name: agent.slug || '',
          check,
          isAddAgent: false,
          pendingAgentId: agentId,
        });
      } else {
        completeAgentSelect(agentId);
      }
    } catch (err) {
      console.error('Failed to check agent scaffold:', err);
      completeAgentSelect(agentId);
    }
  };

  const handleSaveWorkspaceName = async (newName: string) => {
    setWorkspaceName(newName);
    setSaveDialogOpen(false);
    await saveWorkspaceState();
    console.log(`Workspace renamed to: ${newName}`);
  };

  const handleSwitchWorkspace = async (id: string) => {
    setView('startup');
    setLoadingStatus('Switching workspace...');

    try {
      const ws = await SwitchWorkspace(id);
      if (ws) {
        setWorkspace({
          id: ws.id,
          name: ws.name || 'Workspace',
          agents: ws.agents || [],
          mcpConfig: ws.mcpConfig,
          selectedAgentId: ws.selectedSession?.agentId || null,
        });

        if (ws.selectedSession?.agentId && ws.selectedSession?.sessionId && ws.selectedSession?.folder) {
          selectSession(ws.selectedSession.sessionId, ws.selectedSession.folder);
        } else {
          clearSelection();
        }
      }
      const workspaces = await GetAllWorkspaces();
      setAllWorkspaces(workspaces || []);
      // Refresh native menu to reflect new workspace/agents
      await RefreshMenu();
      setView('main');
    } catch (err) {
      console.error('Failed to switch workspace:', err);
      setView('main');
    }
  };

  const handleNewWorkspace = async () => {
    try {
      const ws = await CreateWorkspace('New Workspace');
      if (ws) {
        // CRITICAL: Tell backend to switch to this workspace so AddAgent works correctly
        await SwitchWorkspace(ws.id);

        setWorkspace({
          id: ws.id,
          name: ws.name,
          agents: [],
        });
        clearSelection();
        const workspaces = await GetAllWorkspaces();
        setAllWorkspaces(workspaces || []);
        // Refresh native menu to show new workspace
        await RefreshMenu();
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  };

  const handleDeleteWorkspace = async (wsId: string) => {
    try {
      await DeleteWorkspace(wsId);
      // Refresh workspace list
      const workspaces = await GetAllWorkspaces();
      setAllWorkspaces(workspaces || []);
      // Backend already switches if we deleted current workspace
      const currentWs = await GetCurrentWorkspace();
      if (currentWs) {
        setWorkspace({
          id: currentWs.id,
          name: currentWs.name || 'Workspace',
          agents: currentWs.agents || [],
          mcpConfig: currentWs.mcpConfig,
          selectedAgentId: currentWs.selectedSession?.agentId || null,
        });
        if (currentWs.selectedSession?.agentId && currentWs.selectedSession?.sessionId && currentWs.selectedSession?.folder) {
          selectSession(currentWs.selectedSession.sessionId, currentWs.selectedSession.folder);
        } else {
          clearSelection();
        }
      }
      await RefreshMenu();
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  };

  const handleRenameWorkspaceById = async (wsId: string, newName: string) => {
    try {
      await RenameWorkspace(wsId, newName);
      // Refresh workspace list
      const workspaces = await GetAllWorkspaces();
      setAllWorkspaces(workspaces || []);
      // If we renamed the current workspace, update local state
      if (wsId === workspaceId) {
        setWorkspaceName(newName);
      }
      await RefreshMenu();
    } catch (err) {
      console.error('Failed to rename workspace:', err);
    }
  };

  const handleReloadWorkspace = async () => {
    console.log('Reloading workspace...');
    setReloadKey(k => k + 1);

    if (workspaceId) {
      try {
        const ws = await SwitchWorkspace(workspaceId);
        if (ws) {
          setWorkspaceName(ws.name || 'Workspace');
          setAgents(ws.agents || []);
          setMcpConfig(ws.mcpConfig);
          console.log(`Reloaded workspace "${ws.name}"`);
        }
      } catch (err) {
        console.error('Failed to reload workspace:', err);
      }
    }

    try {
      const workspaces = await GetAllWorkspaces();
      setAllWorkspaces(workspaces || []);
    } catch (err) {
      console.error('Failed to refresh workspace list:', err);
    }
  };

  // Reload workspace from disk (re-enriches agents from registry) — call after any dialog saves
  const refreshAgentsFromBackend = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const ws = await ReloadCurrentWorkspace();
      if (ws?.agents) {
        setAgents(ws.agents);
      }
    } catch (err) {
      console.error('Failed to refresh agents from backend:', err);
    }
  }, [workspaceId, setAgents]);

  const handleSaveMCPSettings = async (config: workspace.MCPConfig, updatedAgents: workspace.Agent[]) => {
    // Save slug, description, and enabled changes to the right places
    for (const updated of updatedAgents) {
      const original = agents.find(a => a.id === updated.id);
      if (!original) continue;

      // Description changed → save to registry meta (single source of truth)
      // Note: slug is NOT editable in MCP Settings — managed in Workspaces & Agents dialog
      if (updated.description !== original.description) {
        try {
          const info = await GetAgentMeta(original.folder);
          const meta = { ...(info?.meta || {}), AGENT_DESCRIPTION: updated.description || '' };
          await UpdateAgentMeta(original.folder, meta);
        } catch (err) {
          console.error('Failed to update agent description:', err);
        }
      }

      // MCPEnabled is per-workspace config — save via UpdateAgent
      if ((updated.mcpEnabled ?? true) !== (original.mcpEnabled ?? true)) {
        try {
          await UpdateAgent({ ...original, mcpEnabled: updated.mcpEnabled });
        } catch (err) {
          console.error('Failed to update agent enabled state:', err);
        }
      }
    }

    setMcpConfig(config);
    await refreshAgentsFromBackend(); // Reload from backend with fresh registry data
  };

  // Sifu pinned first, otherwise preserve user's insertion order — matches sidebar
  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      if (a.type === 'sifu' && b.type !== 'sifu') return -1;
      if (a.type !== 'sifu' && b.type === 'sifu') return 1;
      return 0; // Preserve original order
    });
  }, [agents]);

  // Keyboard shortcuts — uses sortedAgents so CMD-{n} matches sidebar order
  useKeyboardShortcuts({
    onHardReload: () => workspaceId ? handleSwitchWorkspace(workspaceId) : undefined,
    onNewWorkspace: handleNewWorkspace,
    onSelectAgent: handleAgentSelect,
    onToggleTerminal: () => setTerminalOpen(prev => !prev),
    agents: sortedAgents,
    settings,
    onSettingsChange: setSettings,
  });

  // Backend error event listeners (auth expired, rate limited)
  useErrorListeners({
    onAuthExpired: () => setShowAuthExpired(true),
    onRateLimited: (resetTime: string) => setRateLimitResetTime(resetTime),
  });

  // Menu event subscriptions
  useMenuEvents({
    onNewWorkspace: handleNewWorkspace,
    onSwitchWorkspace: handleSwitchWorkspace,
    onRenameWorkspace: () => setSaveDialogOpen(true),
    onDeleteWorkspace: () => {
      if (workspaceId && allWorkspaces.length > 1) {
        setConfirmDeleteWorkspaceId(workspaceId);
      }
    },
    onManageWorkspaces: () => setManageWorkspacesOpen(true),
    onNewSession: () => { if (selectedAgentId) setIsCreatingNewSessionExternally(true); },
    onSelectSession: () => { if (selectedAgentId) setOpenSessionsForAgentId(selectedAgentId); },
    onRenameAgent: () => {
      if (selectedAgent) {
        const newName = window.prompt('Rename agent:', selectedAgent.slug);
        if (newName && newName.trim() && newName !== selectedAgent.slug) {
          renameAgent(selectedAgentId!, newName.trim());
        }
      }
    },
    onRemoveAgent: () => { if (selectedAgentId) setConfirmRemoveAgentId(selectedAgentId); },
    onManageAgents: () => setManageAgentsOpen(true),
    onSwitchAgent: (agentId: string) => handleAgentSelect(agentId),
    onCheckUpdates: async () => {
      try {
        const updateInfo = await CheckForUpdates();
        if (updateInfo?.available) {
          notifications.showToast({
            type: 'info',
            title: `Downloading v${updateInfo.latestVersion}...`,
            message: `Update will be ready shortly`
          }, 5000);
          // Download in background — menu changes to "Restart to Update..."
          try {
            await DownloadUpdate(updateInfo.latestVersion);
            notifications.showToast({
              type: 'success',
              title: `v${updateInfo.latestVersion} Ready`,
              message: `Use ClaudeFu menu → Restart to Update`
            }, 8000);
          } catch (downloadErr) {
            console.error('Update download failed:', downloadErr);
            notifications.showToast({
              type: 'info',
              title: `Update Available: v${updateInfo.latestVersion}`,
              message: `Run: brew upgrade --cask claudefu`
            }, 8000);
          }
        } else {
          notifications.showToast({
            type: 'success',
            title: 'Up to Date',
            message: `You're running the latest version (v${updateInfo?.currentVersion || version})`
          }, 3000);
        }
      } catch (err) {
        console.error('Update check failed:', err);
      }
    },
    onApplyUpdate: async () => {
      try {
        await ApplyUpdateAndRestart();
      } catch (err) {
        console.error('Failed to apply update:', err);
        notifications.showToast({
          type: 'warning',
          title: 'Update Failed',
          message: `${err}`
        }, 8000);
      }
    },
  });

  // Startup View
  if (view === 'startup') {
    return <StartupView version={version} loadingStatus={loadingStatus} />;
  }

  // Auth View
  if (view === 'auth') {
    return (
      <AuthView
        authStatus={authStatus}
        version={version}
        onAuthenticated={() => loadData()}
        onContinue={() => setView('main')}
      />
    );
  }

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
          <span style={{ fontWeight: 600, color: '#d97757' }}>ClaudeFu</span>
          <span style={{ color: '#333' }}>/</span>
          <WorkspaceDropdown
            currentName={workspaceName}
            currentId={workspaceId}
            workspaces={allWorkspaces}
            onSelectWorkspace={handleSwitchWorkspace}
            onNewWorkspace={handleNewWorkspace}
            onRenameWorkspace={() => setSaveDialogOpen(true)}
            onDeleteWorkspace={() => {
              if (allWorkspaces.length > 1) {
                setConfirmDeleteWorkspaceId(workspaceId);
              }
            }}
            onManageWorkspaces={() => setManageWorkspacesOpen(true)}
          />
          {selectedAgent && (
            <>
              <span style={{ color: '#333' }}>/</span>
              <span style={{ color: '#888', fontSize: '0.9rem' }}>{selectedAgent.slug}</span>
              {selectedSessionId && (
                <>
                  <span style={{ color: '#333' }}>/</span>
                  <Tooltip
                    content={sessionDisplayName}
                    placement="bottom"
                    delay={300}
                  >
                    <span style={{
                      color: '#666',
                      fontSize: '0.85rem',
                      maxWidth: '200px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'inline-block',
                      verticalAlign: 'middle'
                    }}>
                      {sessionDisplayName.length > 30
                        ? sessionDisplayName.slice(0, 30) + '...'
                        : sessionDisplayName}
                    </span>
                  </Tooltip>
                  <Tooltip content="Switch session" placement="bottom" delay={100}>
                    <button
                      onClick={() => setOpenSessionsForAgentId(selectedAgentId || null)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '0.25rem',
                        marginLeft: '0.25rem',
                        color: '#555',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'color 0.15s ease'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#d97757')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </Tooltip>
                </>
              )}
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Ko-fi Support Link */}
          <button
            onClick={() => BrowserOpenURL('https://ko-fi.com/metaphori')}
            title="Support ClaudeFu on Ko-fi"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              opacity: 0.7,
              transition: 'opacity 0.2s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
          >
            <img src="/assets/ko-fi.png" alt="Support on Ko-fi" style={{ width: '26px', height: '26px' }} />
          </button>

          {/* Notification Bell */}
          <button
            onClick={notifications.openDialog}
            title={notifications.unreadCount > 0 ? `${notifications.unreadCount} notification${notifications.unreadCount > 1 ? 's' : ''} - click to view` : 'Notifications'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem',
              color: notifications.unreadCount > 0 ? '#d97757' : '#666',
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
              filter: notifications.unreadCount > 0 ? 'drop-shadow(0 0 6px #d97757)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {notifications.unreadCount > 0 && (
              <span style={{
                position: 'absolute',
                top: '-2px',
                right: '-2px',
                background: '#d97757',
                color: '#fff',
                fontSize: '0.65rem',
                fontWeight: 600,
                borderRadius: '50%',
                width: '16px',
                height: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
              </span>
            )}
          </button>
          <span style={{ fontSize: '0.8rem', color: '#666' }}>
            {authStatus?.hasClaudeCode && authStatus.claudeCodeSubscription && (
              <span style={{ color: '#4ade80' }}>
                Claude {authStatus.claudeCodeSubscription.charAt(0).toUpperCase() + authStatus.claudeCodeSubscription.slice(1)}
              </span>
            )}
            {authStatus?.hasApiKey && !authStatus.hasClaudeCode && (
              <span style={{ color: '#d97757' }}>API Key</span>
            )}
          </span>
          <button
            onClick={() => setTerminalOpen(prev => !prev)}
            title="Terminal (Ctrl+`)"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              opacity: terminalOpen ? 1 : 0.5,
              transition: 'opacity 0.2s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = terminalOpen ? '1' : '0.5')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="2" width="18" height="16" rx="2" stroke={terminalOpen ? '#d97757' : '#999'} strokeWidth="1.5" fill="none" />
              <path d="M5 7L9 10L5 13" stroke={terminalOpen ? '#d97757' : '#999'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="11" y1="13" x2="15" y2="13" stroke={terminalOpen ? '#d97757' : '#999'} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={() => setMcpSettingsOpen(true)}
            title="MCP Settings"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              opacity: 0.5,
              transition: 'opacity 0.2s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.5')}
          >
            <img
              src="/assets/mcp.png"
              alt="MCP Settings"
              style={{
                width: '22px',
                height: '22px',
                filter: 'invert(1)'
              }}
            />
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar - reduced props, uses context internally */}
        <Sidebar
          onAddAgent={handleAddAgent}
          onAgentSelect={handleAgentSelect}
          onSessionSelect={handleSessionSelect}
          openSessionsForAgentId={openSessionsForAgentId}
          onSessionsDialogClose={() => setOpenSessionsForAgentId(null)}
          onNewSessionStart={() => setIsCreatingNewSessionExternally(true)}
          onNewSessionComplete={() => setIsCreatingNewSessionExternally(false)}
          onOpenWorkspaceMeta={() => setWorkspaceMetaOpen(true)}
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
            <ChatView
              key={`${selectedAgentId}-${selectedSessionId}-${reloadKey}`}
              agentId={selectedAgentId}
              agentName={selectedAgent?.slug}
              folder={selectedFolder}
              sessionId={selectedSessionId}
              onSessionCreated={handleNewSessionCreated}
              initialMessage={pendingInitialMessage || undefined}
              isExternallyCreatingSession={isCreatingNewSessionExternally}
              draftsRef={draftsRef}
            />
          ) : (
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

      {/* Inline Terminal Panel */}
      {terminalOpen && (
        <TerminalPanelInline
          selectedFolder={selectedFolder ?? undefined}
          onClose={() => setTerminalOpen(false)}
        />
      )}

      {/* Save Workspace Dialog */}
      <InputDialog
        isOpen={saveDialogOpen}
        title="Rename Workspace"
        label="Workspace Name"
        value={workspaceName}
        placeholder="Enter workspace name"
        onSubmit={handleSaveWorkspaceName}
        onClose={() => setSaveDialogOpen(false)}
      />

      {/* Manage Workspaces Dialog */}
      <ManageWorkspacesDialog
        isOpen={manageWorkspacesOpen}
        onClose={() => setManageWorkspacesOpen(false)}
        workspaces={allWorkspaces}
        currentWorkspaceId={workspaceId}
        onSwitchWorkspace={handleSwitchWorkspace}
        onRenameWorkspace={handleRenameWorkspaceById}
        onDeleteWorkspace={handleDeleteWorkspace}
        onNewWorkspace={handleNewWorkspace}
      />

      {/* Manage Agents Dialog */}
      <ManageAgentsDialog
        isOpen={manageAgentsOpen}
        onClose={() => setManageAgentsOpen(false)}
        agents={agents}
        currentAgentId={selectedAgentId || null}
        onSwitchAgent={(agentId) => {
          const agent = agents.find(a => a.id === agentId);
          if (agent) {
            handleAgentSelect(agentId);
          }
        }}
        onAddAgent={handleAddAgentFromDialog}
        onAgentRemoved={(agentId) => {
          removeAgent(agentId);
          if (agentId === selectedAgentId) {
            clearSelection();
          }
        }}
        onAgentUpdated={(updatedAgent) => {
          renameAgent(updatedAgent.id, updatedAgent.slug || '');
        }}
      />

      {/* Confirm Delete Workspace Dialog */}
      <ConfirmDialog
        isOpen={!!confirmDeleteWorkspaceId}
        onClose={() => setConfirmDeleteWorkspaceId(null)}
        onConfirm={async () => {
          if (confirmDeleteWorkspaceId) {
            await handleDeleteWorkspace(confirmDeleteWorkspaceId);
            setConfirmDeleteWorkspaceId(null);
          }
        }}
        title="Delete Workspace"
        message={`Are you sure you want to delete "${allWorkspaces.find(ws => ws.id === confirmDeleteWorkspaceId)?.name || 'this workspace'}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />

      {/* Confirm Remove Agent Dialog */}
      <ConfirmDialog
        isOpen={!!confirmRemoveAgentId}
        onClose={() => setConfirmRemoveAgentId(null)}
        onConfirm={async () => {
          if (confirmRemoveAgentId) {
            try {
              await RemoveAgent(confirmRemoveAgentId);
              removeAgent(confirmRemoveAgentId);
              // Clear selection if removing current agent
              if (confirmRemoveAgentId === selectedAgentId) {
                clearSelection();
              }
              await RefreshMenu();
            } catch (err) {
              console.error('Failed to remove agent:', err);
            }
            setConfirmRemoveAgentId(null);
          }
        }}
        title="Remove Agent"
        message={`Remove "${agents.find(a => a.id === confirmRemoveAgentId)?.slug || 'this agent'}" from the workspace?`}
        confirmText="Remove"
        danger
      />

      {/* Auth Expired Dialog */}
      <ConfirmDialog
        isOpen={showAuthExpired}
        onClose={() => setShowAuthExpired(false)}
        onConfirm={() => setShowAuthExpired(false)}
        title="Authentication Expired"
        message="Your Claude OAuth token has expired. Please open Claude Code in a terminal and run /login to re-authenticate."
        confirmText="OK"
      />

      {/* Rate Limited Dialog */}
      <ConfirmDialog
        isOpen={rateLimitResetTime !== null}
        onClose={() => setRateLimitResetTime(null)}
        onConfirm={() => setRateLimitResetTime(null)}
        title="Rate Limit Reached"
        message={`You've hit your Claude usage limit.${rateLimitResetTime ? ` Resets ${rateLimitResetTime}.` : ''}`}
        confirmText="OK"
      />

      {/* MCP Settings Pane */}
      <MCPSettingsPane
        isOpen={mcpSettingsOpen}
        onClose={() => setMcpSettingsOpen(false)}
        agents={agents}
        mcpConfig={mcpConfig}
        onSave={handleSaveMCPSettings}
      />

      {/* Workspaces & Agents Meta Dialog */}
      <WorkspaceMetaDialog
        isOpen={workspaceMetaOpen}
        onClose={() => setWorkspaceMetaOpen(false)}
        onSaved={refreshAgentsFromBackend}
      />

      {/* Notifications Dialog */}
      <NotificationsDialog
        isOpen={notifications.notificationsDialogOpen}
        onClose={notifications.closeDialog}
        notifications={notifications.notifications}
        onClearAll={notifications.clearAll}
        onRemove={notifications.removeNotification}
      />

      {/* MCP Notification Toast */}
      <NotificationToast
        notification={notifications.notification}
        onDismiss={notifications.dismissToast}
      />

      {/* Scaffold Dialog */}
      {scaffoldDialog && (
        <ScaffoldDialog
          isOpen={true}
          onClose={() => {
            // On cancel: if this was Add Agent, don't add. If Select, just select without scaffold.
            if (!scaffoldDialog.isAddAgent && scaffoldDialog.pendingAgentId) {
              completeAgentSelect(scaffoldDialog.pendingAgentId);
            }
            setScaffoldDialog(null);
          }}
          folder={scaffoldDialog.folder}
          agentName={scaffoldDialog.name}
          check={scaffoldDialog.check}
          onConfirm={async (opts) => {
            const result = await ScaffoldAgent(scaffoldDialog.folder, scaffoldDialog.name, opts);
            // If a session was created, refresh so the runtime discovers it
            if (result?.sessionId && scaffoldDialog.pendingAgentId) {
              await RefreshSessions(scaffoldDialog.pendingAgentId);
            }
            if (scaffoldDialog.isAddAgent) {
              await completeAddAgent(scaffoldDialog.folder, scaffoldDialog.name, result?.sessionId);
            } else if (scaffoldDialog.pendingAgentId) {
              completeAgentSelect(scaffoldDialog.pendingAgentId, result?.sessionId);
            }
            setScaffoldDialog(null);
          }}
        />
      )}

      {/* MCP AskUserQuestion Dialog */}
      <MCPQuestionDialog />

      {/* MCP Permission Request Dialog */}
      <PermissionRequestDialog />
    </div>
  );
}

// Main App component with providers
function App() {
  return (
    <WorkspaceProvider>
      <SessionProvider>
        <MessagesProvider>
          <WailsEventHub />
          <QueueWatcher />
          <AppContent />
        </MessagesProvider>
      </SessionProvider>
    </WorkspaceProvider>
  );
}

export default App;
