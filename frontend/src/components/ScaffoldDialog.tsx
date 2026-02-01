import { useState } from 'react';
import { DialogBase } from './DialogBase';
import { scaffold } from '../../wailsjs/go/models';

interface ScaffoldDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;
  agentName: string;
  check: scaffold.ScaffoldCheck;
  onConfirm: (opts: scaffold.ScaffoldOptions) => Promise<void>;
}

interface CheckItem {
  key: 'projectsDir' | 'claudeMD' | 'permissions';
  label: string;
  description: string;
  exists: boolean;
}

export function ScaffoldDialog({
  isOpen,
  onClose,
  folder,
  agentName,
  check,
  onConfirm,
}: ScaffoldDialogProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({
    projectsDir: !check.hasProjectsDir,
    claudeMD: !check.hasClaudeMD,
    permissions: !check.hasPermissions,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const items: CheckItem[] = [
    {
      key: 'projectsDir',
      label: 'Claude Projects Directory',
      description: '~/.claude/projects/ with sessions-index.json',
      exists: check.hasProjectsDir,
    },
    {
      key: 'claudeMD',
      label: 'CLAUDE.md',
      description: 'Project instructions from default template',
      exists: check.hasClaudeMD,
    },
    {
      key: 'permissions',
      label: 'Permissions',
      description: 'ClaudeFu permissions from global defaults',
      exists: check.hasPermissions,
    },
  ];

  const allExist = items.every(i => i.exists);
  const anySelected = Object.values(selected).some(Boolean);

  const handleToggle = (key: string) => {
    setSelected(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const opts = new scaffold.ScaffoldOptions({
        projectsDir: selected.projectsDir || false,
        claudeMD: selected.claudeMD || false,
        permissions: selected.permissions || false,
      });
      await onConfirm(opts);
      onClose();
    } catch (err) {
      console.error('Scaffold failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const buttonBaseStyle: React.CSSProperties = {
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={`Initialize: ${agentName}`}
      width="460px"
    >
      {/* Body */}
      <div style={{ padding: '1rem 1.25rem' }}>
        <div style={{ color: '#999', fontSize: '0.8rem', marginBottom: '1rem', wordBreak: 'break-all' }}>
          {folder}
        </div>

        {allExist ? (
          <div style={{ color: '#6ec87a', fontSize: '0.9375rem', textAlign: 'center', padding: '1.5rem 0' }}>
            All set! Agent folder is fully configured.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {items.map(item => (
              <div
                key={item.key}
                onClick={() => !item.exists && handleToggle(item.key)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '6px',
                  cursor: item.exists ? 'default' : 'pointer',
                  opacity: item.exists ? 0.5 : 1,
                  background: !item.exists && selected[item.key] ? 'rgba(217, 119, 87, 0.08)' : 'transparent',
                  transition: 'background 0.15s ease',
                }}
              >
                {/* Checkbox / check icon */}
                <div style={{
                  width: 18,
                  height: 18,
                  borderRadius: '4px',
                  border: item.exists
                    ? '2px solid #6ec87a'
                    : selected[item.key]
                      ? '2px solid #d97757'
                      : '2px solid #555',
                  background: item.exists
                    ? '#6ec87a'
                    : selected[item.key]
                      ? '#d97757'
                      : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '1px',
                  transition: 'all 0.15s ease',
                }}>
                  {(item.exists || selected[item.key]) && (
                    <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                      <path d="M1 4.5L4 7.5L10 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>

                {/* Label + description */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: item.exists ? '#888' : '#ddd',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}>
                    {item.label}
                    {item.exists && (
                      <span style={{ fontSize: '0.7rem', color: '#6ec87a', fontWeight: 400 }}>exists</span>
                    )}
                    {!item.exists && selected[item.key] && (
                      <span style={{ fontSize: '0.7rem', color: '#d97757', fontWeight: 400 }}>will create</span>
                    )}
                  </div>
                  <div style={{ color: '#777', fontSize: '0.75rem', marginTop: '2px' }}>
                    {item.description}
                  </div>
                </div>
              </div>
            ))}

            {/* Sessions info row (not toggleable) */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
              padding: '0.625rem 0.75rem',
              opacity: 0.5,
            }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: '4px',
                border: `2px solid ${check.hasSessions ? '#6ec87a' : '#555'}`,
                background: check.hasSessions ? '#6ec87a' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '1px',
              }}>
                {check.hasSessions && (
                  <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                    <path d="M1 4.5L4 7.5L10 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#888', fontSize: '0.875rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Sessions
                  <span style={{ fontSize: '0.7rem', color: check.hasSessions ? '#6ec87a' : '#777', fontWeight: 400 }}>
                    {check.hasSessions ? 'found' : 'none yet'}
                  </span>
                </div>
                <div style={{ color: '#777', fontSize: '0.75rem', marginTop: '2px' }}>
                  Existing Claude Code conversations
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '0.75rem',
        padding: '1rem 1.25rem',
        borderTop: '1px solid #333',
      }}>
        <button
          onClick={onClose}
          style={{
            ...buttonBaseStyle,
            background: '#2a2a2a',
            border: '1px solid #444',
            color: '#ccc',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#2a2a2a'; }}
        >
          {allExist ? 'Close' : 'Cancel'}
        </button>
        {!allExist && (
          <button
            onClick={handleConfirm}
            disabled={!anySelected || isSubmitting}
            style={{
              ...buttonBaseStyle,
              background: anySelected ? '#d97757' : '#555',
              border: 'none',
              color: '#fff',
              opacity: anySelected && !isSubmitting ? 1 : 0.5,
              cursor: anySelected && !isSubmitting ? 'pointer' : 'default',
            }}
            onMouseEnter={(e) => { if (anySelected && !isSubmitting) e.currentTarget.style.background = '#eb815e'; }}
            onMouseLeave={(e) => { if (anySelected && !isSubmitting) e.currentTarget.style.background = '#d97757'; }}
          >
            {isSubmitting ? 'Initializing...' : 'Initialize'}
          </button>
        )}
      </div>
    </DialogBase>
  );
}
