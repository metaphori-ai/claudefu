import { useState, useEffect } from 'react';
import {
  SelectWorkspaceFolder,
  GetSessions,
  GetAllSessionNames,
  SetSessionName,
  MarkSessionViewed,
  GetInboxMessages,
  GetInboxUnreadCount,
  GetInboxTotalCount,
  MarkInboxMessageRead,
  DeleteInboxMessage,
  InjectInboxMessage,
  NewSession,
} from '../../wailsjs/go/main/App';
import { AgentMenu } from './AgentMenu';
import { InputDialog } from './InputDialog';
import { SessionsDialog } from './SessionsDialog';
import { InboxDialog } from './InboxDialog';
import { workspace, types } from '../../wailsjs/go/models';
import { useWorkspace, useSession, useSessionName, useAgentUnread } from '../hooks';

type Session = types.Session;
type Agent = workspace.Agent;

interface SidebarProps {
  onAddAgent: (folder: string, name: string) => void;
  onAgentSelect: (agentId: string) => void;
  onSessionSelect: (agentId: string, sessionId: string, folder: string) => void;
}

export function Sidebar({
  onAddAgent,
  onAgentSelect,
  onSessionSelect,
}: SidebarProps) {
  // Use context hooks instead of local state
  const {
    agents,
    selectedAgentId,
    agentSessions,
    sessionNames,
    removeAgent,
    renameAgent,
    setAgentSessions,
    setSessionName: setSessionNameAction,
    setAllSessionNames,
  } = useWorkspace();

  const {
    selectedSessionId,
    inboxMessages,
    inboxDialogAgentId,
    openInboxDialog,
    closeInboxDialog,
    removeInboxMessage,
    updateInboxMessage,
    decrementInboxUnread,
    decrementInboxTotal,
    setInboxCounts,
  } = useSession();

  // Local UI state (not shared)
  const [isLoading, setIsLoading] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuAgentId, setMenuAgentId] = useState<string | null>(null);
  const [renameDialogAgent, setRenameDialogAgent] = useState<Agent | null>(null);
  const [renameSessionDialog, setRenameSessionDialog] = useState<{ agent: Agent; session: Session } | null>(null);
  const [sessionsDialogAgent, setSessionsDialogAgent] = useState<Agent | null>(null);

  // Load initial inbox counts for all agents
  useEffect(() => {
    const loadInboxCounts = async () => {
      for (const agent of agents) {
        try {
          const [unread, total] = await Promise.all([
            GetInboxUnreadCount(agent.id),
            GetInboxTotalCount(agent.id)
          ]);
          setInboxCounts(agent.id, unread, total);
        } catch (err) {
          // Ignore errors - MCP might not be enabled for this agent
        }
      }
    };
    loadInboxCounts();
  }, [agents, setInboxCounts]);

  // Load session names for all agents on mount and when agents change
  useEffect(() => {
    const loadAllSessionNames = async () => {
      for (const agent of agents) {
        try {
          const names = await GetAllSessionNames(agent.id);
          if (names && Object.keys(names).length > 0) {
            setAllSessionNames(agent.id, names);
          }
        } catch (err) {
          // Ignore errors
        }
      }
    };
    loadAllSessionNames();
  }, [agents, setAllSessionNames]);

  // Reload session names when selected agent changes (in case names weren't loaded yet)
  useEffect(() => {
    if (!selectedAgentId) return;
    const agent = agents.find(a => a.id === selectedAgentId);
    if (!agent?.selectedSessionId) return;

    // If we don't have the name for this session, reload names for this agent
    if (!sessionNames.get(selectedAgentId)?.has(agent.selectedSessionId)) {
      GetAllSessionNames(selectedAgentId).then(names => {
        if (names && Object.keys(names).length > 0) {
          setAllSessionNames(selectedAgentId, names);
        }
      }).catch(() => {});
    }
  }, [selectedAgentId, agents, sessionNames, setAllSessionNames]);

  const loadAgentSessions = async (agent: Agent) => {
    try {
      const sessions = await GetSessions(agent.id);
      // Sort by updatedAt descending (newest first)
      const sortedSessions = (sessions || []).sort((a, b) => {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      setAgentSessions(agent.id, sortedSessions);

      // Also load session names for this agent
      const names = await GetAllSessionNames(agent.id);
      setAllSessionNames(agent.id, names || {});
    } catch (err) {
      console.error('Failed to load sessions for', agent.name, err);
    }
  };

  const handleAddAgent = async () => {
    setIsLoading(true);
    try {
      const folder = await SelectWorkspaceFolder();
      if (folder) {
        // Extract folder name as default agent name
        const name = folder.split('/').pop() || 'Agent';
        onAddAgent(folder, name);
      }
    } catch (err) {
      console.error('Failed to add agent:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewSessions = async (agent: Agent) => {
    // Load sessions first, then open dialog
    await loadAgentSessions(agent);
    setSessionsDialogAgent(agent);
  };

  const handleSessionClick = async (agent: Agent, session: Session) => {
    // Close the sessions dialog
    setSessionsDialogAgent(null);

    // Mark session as viewed
    try {
      await MarkSessionViewed(agent.id, session.id);
    } catch (err) {
      console.error('Failed to mark session as viewed:', err);
    }
    onSessionSelect(agent.id, session.id, agent.folder);
  };

  const handleNewSession = async (agent: Agent) => {
    try {
      const newSessionId = await NewSession(agent.id);
      // Close the sessions dialog
      setSessionsDialogAgent(null);
      // Select the new session
      onSessionSelect(agent.id, newSessionId, agent.folder);
    } catch (err) {
      console.error('Failed to create new session:', err);
    }
  };

  // Get display name for a session (custom name or fallback to preview)
  const getSessionDisplayName = (agentId: string, session: Session) => {
    const agentNames = sessionNames.get(agentId);
    const customName = agentNames?.get(session.id);
    return customName || session.preview || 'New conversation';
  };

  // Handle renaming a session
  const handleRenameSession = async (agent: Agent, session: Session, newName: string) => {
    try {
      await SetSessionName(agent.id, session.id, newName);
      // Update context state
      setSessionNameAction(agent.id, session.id, newName);
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  };

  // Handle viewing inbox for an agent
  const handleViewInbox = async (agent: Agent) => {
    try {
      const messages = await GetInboxMessages(agent.id);
      openInboxDialog(agent.id, messages || []);
    } catch (err) {
      console.error('Failed to load inbox messages:', err);
    }
  };

  // Get the agent for the inbox dialog
  const inboxDialogAgent = inboxDialogAgentId
    ? agents.find(a => a.id === inboxDialogAgentId) || null
    : null;

  // Handle injecting an inbox message into the current session
  const handleInjectMessage = async (messageId: string) => {
    if (!inboxDialogAgentId || !selectedSessionId) return;
    try {
      await InjectInboxMessage(inboxDialogAgentId, messageId, selectedSessionId);
      // Remove from local list after injection
      const msg = inboxMessages.find(m => m.id === messageId);
      removeInboxMessage(messageId);
      // Update counts - message was deleted after injection
      if (msg && !msg.read) {
        decrementInboxUnread(inboxDialogAgentId);
      }
      decrementInboxTotal(inboxDialogAgentId);
    } catch (err) {
      console.error('Failed to inject message:', err);
    }
  };

  // Handle deleting an inbox message
  const handleDeleteInboxMessage = async (messageId: string) => {
    if (!inboxDialogAgentId) return;
    try {
      await DeleteInboxMessage(inboxDialogAgentId, messageId);
      // Remove from local list
      const msg = inboxMessages.find(m => m.id === messageId);
      removeInboxMessage(messageId);
      // Update counts
      if (msg && !msg.read) {
        decrementInboxUnread(inboxDialogAgentId);
      }
      decrementInboxTotal(inboxDialogAgentId);
    } catch (err) {
      console.error('Failed to delete inbox message:', err);
    }
  };

  // Handle marking an inbox message as read
  const handleMarkInboxRead = async (messageId: string) => {
    if (!inboxDialogAgentId) return;
    try {
      await MarkInboxMessageRead(inboxDialogAgentId, messageId);
      // Update local state
      updateInboxMessage(messageId, { read: true });
      // Update unread count
      decrementInboxUnread(inboxDialogAgentId);
    } catch (err) {
      console.error('Failed to mark message as read:', err);
    }
  };

  const startRename = (agent: Agent) => {
    setEditingAgentId(agent.id);
    setEditName(agent.name);
  };

  const finishRename = () => {
    if (editingAgentId && editName.trim()) {
      renameAgent(editingAgentId, editName.trim());
    }
    setEditingAgentId(null);
    setEditName('');
  };

  return (
    <aside style={{
      width: '280px',
      height: '100%',
      background: '#111',
      borderRight: '1px solid #222',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Agents List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {agents.length === 0 ? (
          <div style={{ padding: '1rem', color: '#444', fontSize: '0.85rem', textAlign: 'center' }}>
            No agents yet. Add a Claude Code project folder.
          </div>
        ) : (
          agents.map((agent, index) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              index={index}
              isSelected={selectedAgentId === agent.id}
              isEditing={editingAgentId === agent.id}
              editName={editName}
              menuOpen={menuAgentId === agent.id}
              onAgentSelect={onAgentSelect}
              onMenuToggle={(id) => setMenuAgentId(menuAgentId === id ? null : id)}
              onEditNameChange={setEditName}
              onStartRename={startRename}
              onFinishRename={finishRename}
              onViewSessions={handleViewSessions}
              onViewInbox={handleViewInbox}
              onRenameDialogOpen={(a) => {
                setMenuAgentId(null);
                setRenameDialogAgent(a);
              }}
              onRemove={(id) => {
                setMenuAgentId(null);
                removeAgent(id);
              }}
              onCloseMenu={() => setMenuAgentId(null)}
            />
          ))
        )}
      </div>

      {/* Add Agent Button */}
      <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #222' }}>
        <button
          onClick={handleAddAgent}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '0.6rem 1rem',
            borderRadius: '8px',
            border: '1px solid #333',
            background: 'transparent',
            color: '#888',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              e.currentTarget.style.background = '#f97316';
              e.currentTarget.style.borderColor = '#f97316';
              e.currentTarget.style.color = '#fff';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = '#333';
            e.currentTarget.style.color = '#888';
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>+</span>
          {isLoading ? 'Opening...' : 'Claude Code Agent'}
        </button>
      </div>

      {/* Sessions Dialog */}
      {sessionsDialogAgent && (
        <SessionsDialog
          isOpen={true}
          agentName={sessionsDialogAgent.name}
          sessions={agentSessions.get(sessionsDialogAgent.id) || []}
          sessionNames={sessionNames.get(sessionsDialogAgent.id) || new Map()}
          onSelectSession={(session) => handleSessionClick(sessionsDialogAgent, session)}
          onRenameSession={(session) => {
            setRenameSessionDialog({ agent: sessionsDialogAgent, session });
          }}
          onNewSession={() => handleNewSession(sessionsDialogAgent)}
          onRefresh={() => loadAgentSessions(sessionsDialogAgent)}
          onClose={() => setSessionsDialogAgent(null)}
        />
      )}

      {/* Rename Agent Dialog */}
      <InputDialog
        isOpen={!!renameDialogAgent}
        title="Rename Agent"
        label="Display Name"
        value={renameDialogAgent?.name || ''}
        placeholder="Enter agent name"
        onSubmit={(name) => {
          if (renameDialogAgent) {
            renameAgent(renameDialogAgent.id, name);
          }
          setRenameDialogAgent(null);
        }}
        onClose={() => setRenameDialogAgent(null)}
      />

      {/* Rename Session Dialog */}
      <InputDialog
        isOpen={!!renameSessionDialog}
        title="Rename Session"
        label="Session Name"
        value={renameSessionDialog ? getSessionDisplayName(renameSessionDialog.agent.id, renameSessionDialog.session) : ''}
        placeholder="Enter session name (or leave empty to use preview)"
        onSubmit={(name) => {
          if (renameSessionDialog) {
            handleRenameSession(renameSessionDialog.agent, renameSessionDialog.session, name);
          }
          setRenameSessionDialog(null);
        }}
        onClose={() => setRenameSessionDialog(null)}
      />

      {/* Inbox Dialog */}
      {inboxDialogAgent && (
        <InboxDialog
          isOpen={true}
          agentName={inboxDialogAgent.name}
          messages={inboxMessages}
          selectedSessionId={selectedSessionId}
          onInject={handleInjectMessage}
          onDelete={handleDeleteInboxMessage}
          onMarkRead={handleMarkInboxRead}
          onClose={closeInboxDialog}
        />
      )}
    </aside>
  );
}

// Extracted AgentRow component for better organization
interface AgentRowProps {
  agent: Agent;
  index: number;
  isSelected: boolean;
  isEditing: boolean;
  editName: string;
  menuOpen: boolean;
  onAgentSelect: (agentId: string) => void;
  onMenuToggle: (agentId: string) => void;
  onEditNameChange: (name: string) => void;
  onStartRename: (agent: Agent) => void;
  onFinishRename: () => void;
  onViewSessions: (agent: Agent) => void;
  onViewInbox: (agent: Agent) => void;
  onRenameDialogOpen: (agent: Agent) => void;
  onRemove: (agentId: string) => void;
  onCloseMenu: () => void;
}

function AgentRow({
  agent,
  index,
  isSelected,
  isEditing,
  editName,
  menuOpen,
  onAgentSelect,
  onMenuToggle,
  onEditNameChange,
  onStartRename,
  onFinishRename,
  onViewSessions,
  onViewInbox,
  onRenameDialogOpen,
  onRemove,
  onCloseMenu,
}: AgentRowProps) {
  const { sessionNames } = useWorkspace();
  const { sessionUnread, inboxUnread, inboxTotal } = useAgentUnread(agent.id);

  // Use the reactive hook for session name display
  const sessionDisplayName = useSessionName(agent.id, agent.selectedSessionId || null);

  const cmdNumber = index + 1;

  return (
    <div>
      {/* Agent Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.75rem 1rem',
          background: isSelected ? '#1a1a1a' : 'transparent',
          borderBottom: '1px solid #1a1a1a',
          position: 'relative',
          cursor: 'pointer'
        }}
        onClick={() => onAgentSelect(agent.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenuToggle(agent.id);
        }}
      >
        {/* CMD-n number */}
        <span style={{
          color: '#fff',
          fontSize: '0.75rem',
          fontFamily: 'monospace',
          fontWeight: 700,
          marginRight: '0.75rem',
          minWidth: '1rem',
        }}>
          {cmdNumber}
        </span>

        {/* Agent Name (editable) */}
        {isEditing ? (
          <input
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onBlur={onFinishRename}
            onKeyDown={(e) => e.key === 'Enter' && onFinishRename()}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              background: '#0a0a0a',
              border: '1px solid #333',
              borderRadius: '4px',
              padding: '0.25rem 0.5rem',
              color: '#fff',
              fontSize: '0.85rem',
              textAlign: 'center'
            }}
          />
        ) : (
          <span
            style={{
              flex: 1,
              color: isSelected ? '#f97316' : '#ccc',
              fontSize: '0.9rem',
              fontWeight: isSelected ? 500 : 400,
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRename(agent);
            }}
          >
            {agent.name}
          </span>
        )}

        {/* 3-dot Menu Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMenuToggle(agent.id);
          }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.25rem',
            color: '#666',
            fontSize: '1rem',
            lineHeight: 1,
            marginLeft: '0.75rem'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#ccc';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#666';
          }}
        >
          &#8942;
        </button>

        {/* Agent Menu Dropdown */}
        {menuOpen && (
          <AgentMenu
            onViewSessions={() => {
              onCloseMenu();
              onViewSessions(agent);
            }}
            onRename={() => onRenameDialogOpen(agent)}
            onRemove={() => onRemove(agent.id)}
            onClose={onCloseMenu}
          />
        )}
      </div>

      {/* Metadata Rows - Always visible */}
      <div style={{
        background: '#0d0d0d',
        borderBottom: '1px solid #1a1a1a',
        fontSize: '0.8rem',
      }}>
        {/* Inbox Row */}
        <div
          onClick={() => onViewInbox(agent)}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0.4rem 1rem 0.4rem 1.5rem',
            cursor: 'pointer',
            color: inboxUnread > 0 ? '#8b5cf6' : '#555',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#151515'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '0.5rem' }}>
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
          </svg>
          <span>Inbox ({inboxTotal})</span>
          {inboxUnread > 0 && (
            <span style={{
              marginLeft: '0.35rem',
              background: '#8b5cf6',
              color: '#fff',
              fontSize: '0.65rem',
              padding: '0.05rem 0.35rem',
              borderRadius: '6px',
              fontWeight: 600,
            }}>
              {inboxUnread} new
            </span>
          )}
        </div>

        {/* Session Row */}
        <div
          style={{
            padding: '0.4rem 1rem 0.4rem 1.5rem',
            color: '#555',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
          }}>
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginRight: 'auto',
            }}>
              {agent.selectedSessionId ? sessionDisplayName : 'No session'}
            </span>
            {sessionUnread > 0 && (
              <span style={{
                marginLeft: '0.35rem',
                background: '#f97316',
                color: '#fff',
                fontSize: '0.65rem',
                padding: '0.05rem 0.35rem',
                borderRadius: '6px',
                fontWeight: 600,
              }}>
                {sessionUnread}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewSessions(agent);
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0.2rem',
                marginLeft: '0.35rem',
                color: 'inherit',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#888'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#555'}
              title="Change session"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
              </svg>
            </button>
          </div>
          {/* MCP Slug - under session */}
          {agent.mcpEnabled && agent.mcpSlug && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: '0.25rem',
              color: '#444',
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '0.4rem' }}>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{agent.mcpSlug}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
