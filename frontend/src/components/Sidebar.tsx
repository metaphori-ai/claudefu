import { useState, useEffect } from 'react';
import {
  SelectWorkspaceFolder,
  GetSessions,
  GetAllSessionNames,
  SetSessionName,
  MarkSessionViewed
} from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import { AgentMenu } from './AgentMenu';
import { InputDialog } from './InputDialog';
import { SessionsDialog } from './SessionsDialog';
import { types } from '../../wailsjs/go/models';

// Use the Wails-generated Session type
type Session = types.Session;

interface Agent {
  id: string;
  name: string;
  folder: string;
}

interface SidebarProps {
  agents: Agent[];
  onAddAgent: (folder: string, name: string) => void;
  onRenameAgent: (agentId: string, newName: string) => void;
  onRemoveAgent: (agentId: string) => void;
  onAgentSelect: (agentId: string) => void;
  onSessionSelect: (agentId: string, sessionId: string, folder: string) => void;
  selectedAgentId: string | null;
  selectedSessionId: string | null;
}

export function Sidebar({
  agents,
  onAddAgent,
  onRenameAgent,
  onRemoveAgent,
  onAgentSelect,
  onSessionSelect,
  selectedAgentId,
  selectedSessionId
}: SidebarProps) {
  const [agentSessions, setAgentSessions] = useState<Map<string, Session[]>>(new Map());
  const [sessionNames, setSessionNames] = useState<Map<string, Map<string, string>>>(new Map());
  // Unread counts: agentId -> total unread count for the agent
  const [unreadTotals, setUnreadTotals] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [menuAgentId, setMenuAgentId] = useState<string | null>(null);
  const [renameDialogAgent, setRenameDialogAgent] = useState<Agent | null>(null);
  const [renameSessionDialog, setRenameSessionDialog] = useState<{ agent: Agent; session: Session } | null>(null);
  const [sessionsDialogAgent, setSessionsDialogAgent] = useState<Agent | null>(null);

  // Listen for unread:changed events from the watcher (EventEnvelope structure)
  useEffect(() => {
    const handleUnreadChanged = (envelope: { agentId?: string; payload?: { agentTotal?: number } }) => {
      if (envelope && envelope.agentId && envelope.payload?.agentTotal !== undefined) {
        setUnreadTotals(prev => {
          const next = new Map(prev);
          next.set(envelope.agentId!, envelope.payload!.agentTotal!);
          return next;
        });
      }
    };

    EventsOn('unread:changed', handleUnreadChanged);

    return () => {
      EventsOff('unread:changed');
    };
  }, []);

  // Listen for session:discovered events (new sessions created externally or via CLI)
  useEffect(() => {
    const handleSessionDiscovered = (envelope: { agentId?: string; payload?: { session?: Session } }) => {
      if (!envelope?.agentId || !envelope?.payload?.session) return;

      const { agentId, payload: { session } } = envelope;

      // Skip subagent sessions
      if (session.id.startsWith('agent-')) return;

      // Add to session list for this agent
      setAgentSessions(prev => {
        const current = prev.get(agentId) || [];
        // Check if session already exists
        if (current.some(s => s.id === session.id)) return prev;

        // Add new session and sort by updatedAt descending
        const updated = [...current, session].sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        return new Map(prev).set(agentId, updated);
      });
    };

    EventsOn('session:discovered', handleSessionDiscovered);

    return () => {
      EventsOff('session:discovered');
    };
  }, []);

  const loadAgentSessions = async (agent: Agent) => {
    try {
      const sessions = await GetSessions(agent.id);
      // Sort by updatedAt descending (newest first)
      const sortedSessions = (sessions || []).sort((a, b) => {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      setAgentSessions(prev => new Map(prev).set(agent.id, sortedSessions));

      // Also load session names for this agent
      const names = await GetAllSessionNames(agent.id);
      setSessionNames(prev => new Map(prev).set(agent.id, new Map(Object.entries(names || {}))));
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

  // Get total unread count for an agent (from live event updates)
  const getAgentUnreadCount = (agentId: string) => {
    return unreadTotals.get(agentId) || 0;
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
      // Update local state
      setSessionNames(prev => {
        const next = new Map(prev);
        const agentNames = new Map(next.get(agent.id) || []);
        if (newName) {
          agentNames.set(session.id, newName);
        } else {
          agentNames.delete(session.id);
        }
        next.set(agent.id, agentNames);
        return next;
      });
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  };

  const startRename = (agent: Agent) => {
    setEditingAgentId(agent.id);
    setEditName(agent.name);
  };

  const finishRename = () => {
    if (editingAgentId && editName.trim()) {
      onRenameAgent(editingAgentId, editName.trim());
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
      {/* Add Agent Button */}
      <div style={{ padding: '1rem' }}>
        <button
          onClick={handleAddAgent}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: 'none',
            background: '#f97316',
            color: '#fff',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>+</span>
          {isLoading ? 'Opening...' : 'Claude Code Agent'}
        </button>
      </div>

      {/* Agents List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {agents.length === 0 ? (
          <div style={{ padding: '1rem', color: '#444', fontSize: '0.85rem', textAlign: 'center' }}>
            No agents yet. Add a Claude Code project folder.
          </div>
        ) : (
          agents.map(agent => {
            const isSelected = selectedAgentId === agent.id;

            return (
              <div key={agent.id}>
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
                    setMenuAgentId(menuAgentId === agent.id ? null : agent.id);
                  }}
                >
                  {/* Agent Name (editable) */}
                  {editingAgentId === agent.id ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={finishRename}
                      onKeyDown={(e) => e.key === 'Enter' && finishRename()}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1,
                        background: '#0a0a0a',
                        border: '1px solid #333',
                        borderRadius: '4px',
                        padding: '0.25rem 0.5rem',
                        color: '#fff',
                        fontSize: '0.85rem'
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        flex: 1,
                        color: isSelected ? '#f97316' : '#ccc',
                        fontSize: '0.9rem',
                        fontWeight: isSelected ? 500 : 400
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRename(agent);
                      }}
                    >
                      {agent.name}
                    </span>
                  )}

                  {/* Unread count badge */}
                  {getAgentUnreadCount(agent.id) > 0 && (
                    <span style={{
                      background: '#f97316',
                      color: '#fff',
                      fontSize: '0.65rem',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '8px',
                      marginLeft: '0.25rem',
                      fontWeight: 600,
                      minWidth: '1.2rem',
                      textAlign: 'center'
                    }}>
                      {getAgentUnreadCount(agent.id)}
                    </span>
                  )}

                  {/* 3-dot Menu Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuAgentId(menuAgentId === agent.id ? null : agent.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      color: '#666',
                      fontSize: '1rem',
                      lineHeight: 1,
                      marginLeft: '0.25rem'
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
                  {menuAgentId === agent.id && (
                    <AgentMenu
                      onViewSessions={() => {
                        setMenuAgentId(null);
                        handleViewSessions(agent);
                      }}
                      onRename={() => {
                        setMenuAgentId(null);
                        setRenameDialogAgent(agent);
                      }}
                      onRemove={() => {
                        setMenuAgentId(null);
                        onRemoveAgent(agent.id);
                      }}
                      onClose={() => setMenuAgentId(null)}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Workspace Info Footer */}
      <div style={{
        padding: '0.75rem 1rem',
        borderTop: '1px solid #222',
        fontSize: '0.75rem',
        color: '#444'
      }}>
        {agents.length} agent{agents.length !== 1 ? 's' : ''} in workspace
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
            onRenameAgent(renameDialogAgent.id, name);
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
    </aside>
  );
}
