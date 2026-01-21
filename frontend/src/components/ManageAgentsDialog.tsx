import { useState, useEffect } from 'react';
import { DialogBase } from './DialogBase';
import { InputDialog } from './InputDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { UpdateAgent, RemoveAgent, RefreshMenu } from '../../wailsjs/go/main/App';
import { workspace } from '../../wailsjs/go/models';

interface ManageAgentsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agents: workspace.Agent[];
  currentAgentId: string | null;
  onSwitchAgent: (id: string) => void;
  onAddAgent: () => void;
  onAgentRemoved: (id: string) => void;
  onAgentUpdated: (agent: workspace.Agent) => void;
}

export function ManageAgentsDialog({
  isOpen,
  onClose,
  agents,
  currentAgentId,
  onSwitchAgent,
  onAddAgent,
  onAgentRemoved,
  onAgentUpdated,
}: ManageAgentsDialogProps) {
  const [renameAgent, setRenameAgent] = useState<{ id: string; name: string } | null>(null);
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Local selection - doesn't switch until user clicks "Switch"
  const [selectedId, setSelectedId] = useState<string | null>(currentAgentId);

  // Reset selection when dialog opens or current agent changes
  useEffect(() => {
    if (isOpen) {
      setSelectedId(currentAgentId);
    }
  }, [isOpen, currentAgentId]);

  const resetSelection = () => setSelectedId(currentAgentId);

  // Check if selection has changed from current
  const hasSelectionChanged = selectedId !== currentAgentId && selectedId !== null;

  const handleSwitch = () => {
    if (hasSelectionChanged && selectedId) {
      onSwitchAgent(selectedId);
    }
    onClose();
  };

  const agentToDelete = deleteAgentId
    ? agents.find((a) => a.id === deleteAgentId)
    : null;

  const handleDelete = async () => {
    if (!deleteAgentId) return;
    setIsDeleting(true);
    try {
      await RemoveAgent(deleteAgentId);
      onAgentRemoved(deleteAgentId);
      await RefreshMenu();
      setDeleteAgentId(null);
      // If we deleted the selected one, clear selection
      if (selectedId === deleteAgentId) {
        setSelectedId(agents.find(a => a.id !== deleteAgentId)?.id || null);
      }
    } catch (err) {
      console.error('Failed to delete agent:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRename = async (newName: string) => {
    if (!renameAgent) return;
    const agent = agents.find(a => a.id === renameAgent.id);
    if (!agent) return;

    try {
      const updatedAgent = { ...agent, name: newName };
      await UpdateAgent(updatedAgent);
      onAgentUpdated(updatedAgent as workspace.Agent);
      await RefreshMenu();
    } catch (err) {
      console.error('Failed to rename agent:', err);
    }
    setRenameAgent(null);
  };

  const canDelete = agents.length > 1;

  return (
    <>
      <DialogBase
        isOpen={isOpen}
        onClose={() => {
          resetSelection();
          onClose();
        }}
        title="Manage Agents"
        width="520px"
        maxHeight="70vh"
      >
        {/* Agent List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.5rem 0',
          }}
        >
          {agents.map((agent) => {
            const isCurrent = agent.id === currentAgentId;
            const isSelected = agent.id === selectedId;
            return (
              <div
                key={agent.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem 1.25rem',
                  gap: '0.75rem',
                  cursor: 'pointer',
                  borderBottom: '1px solid #2a2a2a',
                  background: isSelected ? '#1a1a1a' : 'transparent',
                }}
                onClick={() => setSelectedId(agent.id)}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = '#1f1f1f';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                {/* Radio indicator */}
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: `2px solid ${isSelected ? '#d97757' : '#555'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#d97757',
                      }}
                    />
                  )}
                </div>

                {/* Agent info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      color: isSelected ? '#fff' : '#ccc',
                      fontWeight: isSelected ? 500 : 400,
                      fontSize: '0.9375rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.name}
                    {isCurrent && !isSelected && (
                      <span style={{ color: '#666', fontSize: '0.75rem', marginLeft: '0.5rem' }}>(current)</span>
                    )}
                  </div>
                  <div
                    style={{
                      color: '#666',
                      fontSize: '0.75rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: '2px',
                    }}
                  >
                    {agent.folder}
                  </div>
                </div>

                {/* Action buttons */}
                <div
                  style={{ display: 'flex', gap: '0.25rem' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Rename button */}
                  <button
                    onClick={() => setRenameAgent({ id: agent.id, name: agent.name })}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '0.375rem',
                      cursor: 'pointer',
                      color: '#666',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#999';
                      e.currentTarget.style.background = '#2a2a2a';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#666';
                      e.currentTarget.style.background = 'none';
                    }}
                    title="Rename agent"
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
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => canDelete && setDeleteAgentId(agent.id)}
                    disabled={!canDelete}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '0.375rem',
                      cursor: canDelete ? 'pointer' : 'not-allowed',
                      color: canDelete ? '#666' : '#444',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '4px',
                      opacity: canDelete ? 1 : 0.5,
                    }}
                    onMouseEnter={(e) => {
                      if (canDelete) {
                        e.currentTarget.style.color = '#dc2626';
                        e.currentTarget.style.background = '#2a2a2a';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = canDelete ? '#666' : '#444';
                      e.currentTarget.style.background = 'none';
                    }}
                    title={canDelete ? 'Remove agent' : 'Cannot remove the only agent'}
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
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem 1.25rem',
            borderTop: '1px solid #333',
          }}
        >
          <button
            onClick={() => {
              onAddAgent();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid #444',
              background: 'transparent',
              color: '#ccc',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#2a2a2a';
              e.currentTarget.style.borderColor = '#555';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = '#444';
            }}
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
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Agent
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: '#666', fontSize: '0.8125rem' }}>
              {agents.length} agent{agents.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={handleSwitch}
              disabled={!hasSelectionChanged}
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: '6px',
                border: 'none',
                background: hasSelectionChanged ? '#d97757' : '#333',
                color: hasSelectionChanged ? '#fff' : '#666',
                cursor: hasSelectionChanged ? 'pointer' : 'not-allowed',
                fontSize: '0.875rem',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (hasSelectionChanged) {
                  e.currentTarget.style.background = '#eb815e';
                }
              }}
              onMouseLeave={(e) => {
                if (hasSelectionChanged) {
                  e.currentTarget.style.background = '#d97757';
                }
              }}
            >
              Switch
            </button>
          </div>
        </div>
      </DialogBase>

      {/* Rename Dialog */}
      <InputDialog
        isOpen={!!renameAgent}
        title="Rename Agent"
        label="Agent Name"
        value={renameAgent?.name || ''}
        placeholder="Enter agent name"
        onSubmit={handleRename}
        onClose={() => setRenameAgent(null)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteAgentId && !isDeleting}
        onClose={() => setDeleteAgentId(null)}
        onConfirm={handleDelete}
        title="Remove Agent"
        message={`Are you sure you want to remove "${agentToDelete?.name}"? This will not delete any files, but will remove the agent from this workspace.`}
        confirmText="Remove"
        danger
      />
    </>
  );
}
