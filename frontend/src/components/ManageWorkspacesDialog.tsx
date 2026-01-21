import { useState, useEffect } from 'react';
import { DialogBase } from './DialogBase';
import { InputDialog } from './InputDialog';
import { ConfirmDialog } from './ConfirmDialog';

interface WorkspaceSummary {
  id: string;
  name: string;
  lastOpened: string;
}

interface ManageWorkspacesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  onRenameWorkspace: (id: string, newName: string) => void;
  onDeleteWorkspace: (id: string) => Promise<void>;
  onNewWorkspace: () => void;
}

export function ManageWorkspacesDialog({
  isOpen,
  onClose,
  workspaces,
  currentWorkspaceId,
  onSwitchWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onNewWorkspace,
}: ManageWorkspacesDialogProps) {
  const [renameWorkspace, setRenameWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Local selection - doesn't switch until user clicks "Switch"
  const [selectedId, setSelectedId] = useState<string>(currentWorkspaceId);

  // Reset selection when dialog opens or current workspace changes
  const resetSelection = () => setSelectedId(currentWorkspaceId);

  // Reset selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedId(currentWorkspaceId);
    }
  }, [isOpen, currentWorkspaceId]);

  // Check if selection has changed from current
  const hasSelectionChanged = selectedId !== currentWorkspaceId;

  const handleSwitch = () => {
    if (hasSelectionChanged) {
      onSwitchWorkspace(selectedId);
    }
    onClose();
  };

  const workspaceToDelete = deleteWorkspaceId
    ? workspaces.find((ws) => ws.id === deleteWorkspaceId)
    : null;

  const handleDelete = async () => {
    if (!deleteWorkspaceId) return;
    setIsDeleting(true);
    try {
      await onDeleteWorkspace(deleteWorkspaceId);
      setDeleteWorkspaceId(null);
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const canDelete = workspaces.length > 1;

  return (
    <>
      <DialogBase
        isOpen={isOpen}
        onClose={() => {
          resetSelection();
          onClose();
        }}
        title="Manage Workspaces"
        width="480px"
        maxHeight="70vh"
      >
        {/* Workspace List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.5rem 0',
          }}
        >
          {workspaces.map((ws) => {
            const isCurrent = ws.id === currentWorkspaceId;
            const isSelected = ws.id === selectedId;
            return (
              <div
                key={ws.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem 1.25rem',
                  gap: '0.75rem',
                  cursor: 'pointer',
                  borderBottom: '1px solid #2a2a2a',
                  background: isSelected ? '#1a1a1a' : 'transparent',
                }}
                onClick={() => setSelectedId(ws.id)}
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

                {/* Workspace name */}
                <span
                  style={{
                    flex: 1,
                    color: isSelected ? '#fff' : '#ccc',
                    fontWeight: isSelected ? 500 : 400,
                    fontSize: '0.9375rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ws.name}
                  {isCurrent && !isSelected && (
                    <span style={{ color: '#666', fontSize: '0.75rem', marginLeft: '0.5rem' }}>(current)</span>
                  )}
                </span>

                {/* Action buttons */}
                <div
                  style={{ display: 'flex', gap: '0.25rem' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Rename button */}
                  <button
                    onClick={() => setRenameWorkspace({ id: ws.id, name: ws.name })}
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
                    title="Rename workspace"
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
                    onClick={() => canDelete && setDeleteWorkspaceId(ws.id)}
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
                    title={canDelete ? 'Delete workspace' : 'Cannot delete the only workspace'}
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
              onNewWorkspace();
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
            New Workspace
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: '#666', fontSize: '0.8125rem' }}>
              {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
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
        isOpen={!!renameWorkspace}
        title="Rename Workspace"
        label="Workspace Name"
        value={renameWorkspace?.name || ''}
        placeholder="Enter workspace name"
        onSubmit={(newName) => {
          if (renameWorkspace) {
            onRenameWorkspace(renameWorkspace.id, newName);
          }
          setRenameWorkspace(null);
        }}
        onClose={() => setRenameWorkspace(null)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteWorkspaceId && !isDeleting}
        onClose={() => setDeleteWorkspaceId(null)}
        onConfirm={handleDelete}
        title="Delete Workspace"
        message={`Are you sure you want to delete "${workspaceToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </>
  );
}
