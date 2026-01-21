import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { InputDialog } from './components/InputDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ManageWorkspacesDialog } from './components/ManageWorkspacesDialog';
import { ManageAgentsDialog } from './components/ManageAgentsDialog';
import { WorkspaceDropdown } from './components/WorkspaceDropdown';
import { MCPSettingsPane } from './components/MCPSettingsPane';
import { DialogBase } from './components/DialogBase';
import { MCPQuestionDialog } from './components/MCPQuestionDialog';
import { WorkspaceProvider, SessionProvider, MessagesProvider } from './context';
import { useWorkspace, useSession, useSelectedAgent, useSessionName, WailsEventHub } from './hooks';
import { Tooltip } from './components/Tooltip';
import { debugLogger } from './utils/debugLogger';
import {
  GetAuthStatus,
  GetSettings,
  SaveSettings,
  SetAPIKey,
  GetConfigPath,
  StartHyperLogin,
  CompleteHyperLogin,
  Logout,
  SaveWorkspace,
  CreateWorkspace,
  GetAllWorkspaces,
  GetCurrentWorkspaceID,
  GetCurrentWorkspace,
  SwitchWorkspace,
  GetSessions,
  AddAgent,
  GetVersion,
  CheckForUpdates,
  RefreshMenu,
  DeleteWorkspace,
  RenameWorkspace,
  RemoveAgent,
  SelectWorkspaceFolder
} from "../wailsjs/go/main/App";
import { settings as settingsModel } from "../wailsjs/go/models";
import { EventsOn, BrowserOpenURL } from "../wailsjs/runtime/runtime";
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

type View = 'startup' | 'auth' | 'main';

// Main app content that uses the context hooks
function AppContent() {
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

  // MCP notification state
  const [notification, setNotification] = useState<{
    type: 'info' | 'success' | 'warning' | 'question';
    message: string;
    title?: string;
    releaseUrl?: string;  // For update notifications
    releaseNotes?: string;  // Changelog/what's new
  } | null>(null);
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    type: 'info' | 'success' | 'warning' | 'question';
    message: string;
    title?: string;
    fromAgent?: string;
    timestamp: Date;
    read: boolean;
    releaseUrl?: string;  // For update notifications
    releaseNotes?: string;  // Changelog/what's new
  }>>([]);
  const [notificationsDialogOpen, setNotificationsDialogOpen] = useState(false);

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

  // Subscribe to mcp:notification events for toast notifications
  useEffect(() => {
    const unsubscribe = EventsOn('mcp:notification', (data: { payload?: { type?: string; message?: string; title?: string; from_agent?: string } }) => {
      if (data?.payload?.message) {
        const notifType = data.payload.type as 'info' | 'success' | 'warning' | 'question';
        // Show toast
        setNotification({
          type: notifType || 'info',
          message: data.payload.message,
          title: data.payload.title
        });
        // Add to notifications list
        const payload = data.payload!;
        setNotifications(prev => [{
          id: Date.now().toString(),
          type: notifType || 'info',
          message: payload.message!,
          title: payload.title,
          fromAgent: payload.from_agent,
          timestamp: new Date(),
          read: false
        }, ...prev].slice(0, 50)); // Keep last 50 notifications
        setTimeout(() => setNotification(null), 5000);
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Subscribe to menu events from native macOS menu
  useEffect(() => {
    const handlers = [
      EventsOn('menu:about', () => {
        // About is handled by macOS native About panel via mac.AboutInfo
      }),
      EventsOn('menu:how-it-works', () => {
        BrowserOpenURL('https://github.com/metaphori-ai/claudefu#readme');
      }),
      EventsOn('menu:settings', () => {
        // TODO: Open settings dialog when we have one
        console.log('[Menu] Settings clicked');
      }),
      EventsOn('menu:check-updates', async () => {
        try {
          const updateInfo = await CheckForUpdates();
          if (updateInfo?.available) {
            setNotification({
              type: 'info',
              title: `Update Available: v${updateInfo.latestVersion}`,
              message: `Run: brew upgrade --cask claudefu`,
              releaseUrl: updateInfo.releaseUrl,
              releaseNotes: updateInfo.releaseNotes
            });
            setTimeout(() => setNotification(null), 8000);
          } else {
            setNotification({
              type: 'success',
              title: 'Up to Date',
              message: `You're running the latest version (v${updateInfo?.currentVersion || version})`
            });
            setTimeout(() => setNotification(null), 3000);
          }
        } catch (err) {
          console.error('Update check failed:', err);
        }
      }),
      EventsOn('menu:new-session', () => {
        if (selectedAgentId) {
          setIsCreatingNewSessionExternally(true);
        }
      }),
      EventsOn('menu:select-session', () => {
        if (selectedAgentId) {
          setOpenSessionsForAgentId(selectedAgentId);
        }
      }),
      EventsOn('menu:rename-agent', () => {
        if (selectedAgent) {
          // Trigger rename dialog - use the same pattern as sidebar
          const newName = window.prompt('Rename agent:', selectedAgent.name);
          if (newName && newName.trim() && newName !== selectedAgent.name) {
            renameAgent(selectedAgentId!, newName.trim());
          }
        }
      }),
      EventsOn('menu:remove-agent', () => {
        if (selectedAgentId) {
          setConfirmRemoveAgentId(selectedAgentId);
        }
      }),
      EventsOn('menu:manage-agents', () => {
        setManageAgentsOpen(true);
      }),
      EventsOn('menu:new-workspace', async () => {
        // Inline new workspace logic (same as handleNewWorkspace)
        try {
          const ws = await CreateWorkspace('New Workspace');
          if (ws) {
            await SwitchWorkspace(ws.id);
            setWorkspace({
              id: ws.id,
              name: ws.name,
              agents: [],
            });
            clearSelection();
            const workspaces = await GetAllWorkspaces();
            setAllWorkspaces(workspaces || []);
            await RefreshMenu();
          }
        } catch (err) {
          console.error('Failed to create workspace:', err);
        }
      }),
      EventsOn('menu:rename-workspace', () => {
        setSaveDialogOpen(true);
      }),
      EventsOn('menu:delete-workspace', () => {
        if (workspaceId && allWorkspaces.length > 1) {
          setConfirmDeleteWorkspaceId(workspaceId);
        }
      }),
      EventsOn('menu:manage-workspaces', () => {
        setManageWorkspacesOpen(true);
      }),
      EventsOn('menu:switch-workspace', async (data: { workspaceId?: string }) => {
        if (data?.workspaceId) {
          // Inline workspace switch logic (same as handleSwitchWorkspace)
          setView('startup');
          setLoadingStatus('Switching workspace...');
          try {
            const ws = await SwitchWorkspace(data.workspaceId);
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
            await RefreshMenu();
            setView('main');
          } catch (err) {
            console.error('Failed to switch workspace:', err);
            setView('main');
          }
        }
      }),
      EventsOn('menu:switch-agent', (data: { agentId?: string }) => {
        if (data?.agentId) {
          // Inline agent selection logic (same as handleAgentSelect)
          const agent = agents.find(a => a.id === data.agentId);
          if (agent) {
            selectAgent(data.agentId);
            if (agent.selectedSessionId) {
              selectSession(agent.selectedSessionId, agent.folder);
            } else {
              clearSelection();
            }
            // Refresh menu to update Agent menu state
            RefreshMenu();
          }
        }
      }),
    ];

    return () => {
      handlers.forEach(unsub => unsub());
    };
  }, [selectedAgentId, selectedAgent, version, renameAgent, agents, selectAgent, selectSession, clearSelection, setView, setLoadingStatus, setWorkspace, setAllWorkspaces, workspaceId, allWorkspaces]);

  // Check for updates on startup (delayed to not block UI)
  useEffect(() => {
    const checkUpdates = async () => {
      try {
        // Wait a few seconds after startup before checking
        await new Promise(resolve => setTimeout(resolve, 3000));

        const updateInfo = await CheckForUpdates();
        if (updateInfo?.available) {
          // Extract first meaningful line from release notes for toast
          const notesPreview = updateInfo.releaseNotes
            ?.split('\n')
            .find(line => line.trim() && !line.startsWith('#') && !line.startsWith('*'))
            ?.substring(0, 80) || '';

          setNotification({
            type: 'info',
            title: `Update Available: v${updateInfo.latestVersion}`,
            message: `Run: brew upgrade --cask claudefu`,
            releaseUrl: updateInfo.releaseUrl,
            releaseNotes: updateInfo.releaseNotes
          });
          setNotifications(prev => [{
            id: `update-${Date.now()}`,
            type: 'info' as const,
            title: `Update Available: v${updateInfo.latestVersion}`,
            message: `You're on v${updateInfo.currentVersion}.\n\nUpgrade: brew upgrade --cask claudefu`,
            timestamp: new Date(),
            read: false,
            releaseUrl: updateInfo.releaseUrl,
            releaseNotes: updateInfo.releaseNotes
          }, ...prev]);
          // Keep toast longer for updates
          setTimeout(() => setNotification(null), 8000);
        }
      } catch (err) {
        // Silently ignore update check failures
        console.debug('Update check failed:', err);
      }
    };

    checkUpdates();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Note: CMD-S is handled by individual dialogs/panes when open
      // No global CMD-S handler here to avoid conflicts

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleNewWorkspace();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        handleReloadWorkspace();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (index < agents.length) {
          const agent = agents[index];
          // Select the agent (no toggle - if already selected, stay selected)
          selectAgent(agent.id);
          if (agent.selectedSessionId) {
            selectSession(agent.selectedSessionId, agent.folder);
          } else {
            clearSelection();
          }
        }
      }

      // Ctrl+Shift+D to toggle debug logging
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const newEnabled = !debugLogger.isEnabled();
        debugLogger.setEnabled(newEnabled);
        // Save to settings
        const newSettings = settingsModel.Settings.createFrom({
          ...settings,
          debugLogging: newEnabled
        });
        SaveSettings(newSettings).then(() => {
          setSettings(newSettings);
          console.log(`[ClaudeFu] Debug logging ${newEnabled ? 'ENABLED' : 'DISABLED'} (Ctrl+Shift+D to toggle)`);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [agents, selectedAgentId, selectAgent, selectSession, clearSelection, settings]);

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
      setMessage(`Error loading data: ${err}`);
      if (view === 'startup') {
        setPendingView('auth');
      } else {
        setView('auth');
      }
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
      const newAgent = await AddAgent(name, folder);
      addAgent(newAgent);

      const sessions = await GetSessions(newAgent.id);
      if (sessions && sessions.length > 0) {
        const newestSession = sessions[0];
        selectAgent(newAgent.id);
        selectSession(newestSession.id, folder);
        setAgentSelectedSession(newAgent.id, newestSession.id);
      } else {
        selectAgent(newAgent.id);
        clearSelection();
      }
      // Refresh native menu to show new agent
      RefreshMenu();
    } catch (err) {
      console.error('Failed to add agent:', err);
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

  const handleAgentSelect = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    // Select the agent (no toggle - if already selected, stay selected)
    selectAgent(agentId);
    if (agent.selectedSessionId) {
      selectSession(agent.selectedSessionId, agent.folder);
    } else {
      clearSelection();
    }
    // Refresh native menu to reflect agent selection
    RefreshMenu();
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

  const handleSaveMCPSettings = async (config: workspace.MCPConfig, updatedAgents: workspace.Agent[]) => {
    setMcpConfig(config);
    setAgents(updatedAgents);
    console.log('MCP settings saved:', config, updatedAgents.map(a => ({ name: a.name, slug: a.mcpSlug, enabled: a.mcpEnabled })));
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
        <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: '3rem' }}>
          {loadingStatus}
        </div>

        {/* Acknowledgments & Disclaimer */}
        <div style={{
          maxWidth: '550px',
          textAlign: 'center',
          padding: '0 2rem'
        }}>
          <div style={{ color: '#888', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Built on <a href="https://wails.io/" target="_blank" rel="noopener noreferrer" style={{ color: '#aaa', textDecoration: 'underline' }}>Wails</a> · Powered by <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener noreferrer" style={{ color: '#aaa', textDecoration: 'underline' }}>Claude Code</a> CLI
          </div>
          <div style={{ color: '#666', fontSize: '0.8rem', lineHeight: 1.6, marginBottom: '1rem' }}>
            ClaudeFu is an independent open source project and is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.
          </div>
          <div style={{ color: '#555', fontSize: '0.75rem' }}>
            This application requires a working Claude Code CLI installation. See <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener noreferrer" style={{ color: '#888', textDecoration: 'underline' }}>Claude Code</a> for setup.
          </div>
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
                background: '#d97757',
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
              <span style={{ color: '#888', fontSize: '0.9rem' }}>{selectedAgent.name}</span>
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
          {(() => {
            const unreadCount = notifications.filter(n => !n.read).length;
            return (
              <button
                onClick={() => {
                  setNotificationsDialogOpen(true);
                  // Mark all as read when opening
                  setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                }}
                title={unreadCount > 0 ? `${unreadCount} notification${unreadCount > 1 ? 's' : ''} - click to view` : 'Notifications'}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  color: unreadCount > 0 ? '#d97757' : '#666',
                  display: 'flex',
                  alignItems: 'center',
                  position: 'relative',
                  filter: unreadCount > 0 ? 'drop-shadow(0 0 6px #d97757)' : 'none',
                  transition: 'all 0.2s ease'
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unreadCount > 0 && (
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
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })()}
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
              agentName={selectedAgent?.name}
              folder={selectedFolder}
              sessionId={selectedSessionId}
              onSessionCreated={handleNewSessionCreated}
              initialMessage={pendingInitialMessage || undefined}
              isExternallyCreatingSession={isCreatingNewSessionExternally}
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
          renameAgent(updatedAgent.id, updatedAgent.name);
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
        message={`Remove "${agents.find(a => a.id === confirmRemoveAgentId)?.name || 'this agent'}" from the workspace?`}
        confirmText="Remove"
        danger
      />

      {/* MCP Settings Pane */}
      <MCPSettingsPane
        isOpen={mcpSettingsOpen}
        onClose={() => setMcpSettingsOpen(false)}
        agents={agents}
        mcpConfig={mcpConfig}
        onSave={handleSaveMCPSettings}
      />

      {/* Notifications Dialog */}
      <DialogBase
        isOpen={notificationsDialogOpen}
        onClose={() => setNotificationsDialogOpen(false)}
        title="Notifications"
        width="500px"
        maxHeight="600px"
        headerActions={
          notifications.length > 0 ? (
            <button
              onClick={() => setNotifications([])}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                fontSize: '0.8rem',
                padding: '0.25rem 0.5rem'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#eb815e')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
            >
              Clear All
            </button>
          ) : undefined
        }
      >
        <div style={{ maxHeight: '450px', overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#666', padding: '2rem' }}>
              No notifications yet
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => {
                  if (notif.releaseUrl) {
                    BrowserOpenURL(notif.releaseUrl);
                  }
                }}
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid #333',
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'flex-start',
                  cursor: notif.releaseUrl ? 'pointer' : 'default',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => notif.releaseUrl && (e.currentTarget.style.background = '#2a2a2a')}
                onMouseLeave={(e) => notif.releaseUrl && (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  color: notif.type === 'success' ? '#22c55e' :
                         notif.type === 'warning' ? '#f59e0b' :
                         notif.type === 'question' ? '#8b5cf6' : '#3b82f6',
                  fontSize: '1.1rem',
                  flexShrink: 0
                }}>
                  {notif.type === 'success' && '✓'}
                  {notif.type === 'warning' && '⚠'}
                  {notif.type === 'question' && '?'}
                  {notif.type === 'info' && 'ℹ'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <div>
                      {notif.title && (
                        <span style={{ fontWeight: 600, color: '#fff', marginRight: '0.5rem' }}>
                          {notif.title}
                        </span>
                      )}
                      {notif.fromAgent && (
                        <span style={{ fontSize: '0.75rem', color: '#d97757', background: '#2a1a0a', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                          {notif.fromAgent}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: '#555', whiteSpace: 'nowrap' }}>
                      {notif.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ color: '#aaa', fontSize: '0.85rem', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {notif.message}
                    {notif.releaseUrl && (
                      <span style={{ color: '#d97757', marginLeft: '0.5rem' }}>
                        View Release →
                      </span>
                    )}
                  </div>
                  {notif.releaseNotes && (
                    <details style={{ marginTop: '0.5rem' }}>
                      <summary style={{
                        color: '#888',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}>
                        What's New
                      </summary>
                      <div style={{
                        marginTop: '0.5rem',
                        padding: '0.5rem',
                        background: '#1a1a1a',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        color: '#999',
                        maxHeight: '150px',
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap'
                      }}>
                        {notif.releaseNotes}
                      </div>
                    </details>
                  )}
                </div>
                <button
                  onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#555',
                    cursor: 'pointer',
                    padding: '0',
                    fontSize: '0.9rem',
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#eb815e')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </DialogBase>

      {/* MCP Notification Toast */}
      {notification && (
        <div
          onClick={() => {
            if (notification.releaseUrl) {
              BrowserOpenURL(notification.releaseUrl);
              setNotification(null);
            }
          }}
          style={{
            position: 'fixed',
            top: '2rem',
            right: '2rem',
            background: notification.type === 'success' ? '#14532d' :
                       notification.type === 'warning' ? '#78350f' :
                       notification.type === 'question' ? '#4c1d95' : '#1e3a5f',
            border: `1px solid ${
              notification.type === 'success' ? '#22c55e' :
              notification.type === 'warning' ? '#f59e0b' :
              notification.type === 'question' ? '#8b5cf6' : '#3b82f6'
            }`,
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            maxWidth: '400px',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            cursor: notification.releaseUrl ? 'pointer' : 'default'
          }}
        >
          <div style={{
            color: notification.type === 'success' ? '#22c55e' :
                   notification.type === 'warning' ? '#f59e0b' :
                   notification.type === 'question' ? '#8b5cf6' : '#3b82f6',
            fontSize: '1.25rem'
          }}>
            {notification.type === 'success' && '✓'}
            {notification.type === 'warning' && '⚠'}
            {notification.type === 'question' && '?'}
            {notification.type === 'info' && 'ℹ'}
          </div>
          <div style={{ flex: 1 }}>
            {notification.title && (
              <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.25rem' }}>
                {notification.title}
              </div>
            )}
            <div style={{ color: '#ccc', fontSize: '0.9rem' }}>
              {notification.message}
            </div>
          </div>
          <button
            onClick={() => setNotification(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: '0'
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* MCP AskUserQuestion Dialog */}
      <MCPQuestionDialog />
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
          <AppContent />
        </MessagesProvider>
      </SessionProvider>
    </WorkspaceProvider>
  );
}

export default App;
