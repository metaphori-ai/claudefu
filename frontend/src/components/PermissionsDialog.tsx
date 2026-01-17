import { useState, useEffect } from 'react';
import { DialogBase } from './DialogBase';
import { GetClaudePermissions, SaveClaudePermissions } from '../../wailsjs/go/main/App';

interface PermissionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;
}

// Core Claude Code tools (the 18 built-in tools)
const CORE_TOOLS = [
  { id: 'Read', label: 'Read', description: 'Read files' },
  { id: 'Write', label: 'Write', description: 'Write/create files' },
  { id: 'Edit', label: 'Edit', description: 'Edit existing files' },
  { id: 'Glob', label: 'Glob', description: 'Find files by pattern' },
  { id: 'Grep', label: 'Grep', description: 'Search file contents' },
  { id: 'Bash', label: 'Bash', description: 'Run shell commands' },
  { id: 'Task', label: 'Task', description: 'Launch subagents' },
  { id: 'WebSearch', label: 'WebSearch', description: 'Search the web' },
  { id: 'WebFetch', label: 'WebFetch', description: 'Fetch web content' },
  { id: 'NotebookEdit', label: 'NotebookEdit', description: 'Edit Jupyter notebooks' },
  { id: 'LSP', label: 'LSP', description: 'Language Server Protocol' },
  { id: 'TodoWrite', label: 'TodoWrite', description: 'Track task progress' },
  { id: 'EnterPlanMode', label: 'EnterPlanMode', description: 'Start planning mode' },
  { id: 'ExitPlanMode', label: 'ExitPlanMode', description: 'Submit plan for approval' },
  { id: 'AskUserQuestion', label: 'AskUserQuestion', description: 'Ask clarifying questions' },
  { id: 'Skill', label: 'Skill', description: 'Execute slash commands' },
  { id: 'KillShell', label: 'KillShell', description: 'Kill background shells' },
  { id: 'TaskOutput', label: 'TaskOutput', description: 'Get output from tasks' },
];

// Check if a permission is a core tool
function isCoreTool(perm: string): boolean {
  return CORE_TOOLS.some(t => t.id === perm);
}

// Check if a permission is a Bash pattern
function isBashPattern(perm: string): boolean {
  return perm.startsWith('Bash(') && perm.endsWith(')');
}

export function PermissionsDialog({
  isOpen,
  onClose,
  folder,
}: PermissionsDialogProps) {
  // Permissions state
  const [allowList, setAllowList] = useState<string[]>([]);
  const [denyList, setDenyList] = useState<string[]>([]);
  const [additionalDirs, setAdditionalDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // New bash permission input
  const [newBashPerm, setNewBashPerm] = useState('');
  // New additional directory input
  const [newDir, setNewDir] = useState('');

  // Load data when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadPermissions();
    }
  }, [isOpen, folder]);

  // Clear saved indicator after delay
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  const loadPermissions = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await GetClaudePermissions(folder);
      setAllowList(result.allow || []);
      setDenyList(result.deny || []);
      setAdditionalDirs(result.additionalDirectories || []);
    } catch (err) {
      setError(`Failed to load: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Sort by groups: Core Tools first, then Bash, then Others (each alphabetized)
      const coreTools = allowList.filter(isCoreTool).sort((a, b) => a.localeCompare(b));
      const bashPerms = allowList.filter(isBashPattern).sort((a, b) => a.localeCompare(b));
      const others = allowList.filter(p => !isCoreTool(p) && !isBashPattern(p)).sort((a, b) => a.localeCompare(b));
      const sortedAllow = [...coreTools, ...bashPerms, ...others];
      const sortedDeny = [...denyList].sort((a, b) => a.localeCompare(b));
      const sortedDirs = [...additionalDirs].sort((a, b) => a.localeCompare(b));

      await SaveClaudePermissions(folder, sortedAllow, sortedDeny, sortedDirs);
      setSaved(true);
    } catch (err) {
      setError(`Failed to save: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  // Toggle a core tool
  const toggleCoreTool = (toolId: string) => {
    setAllowList(prev => {
      if (prev.includes(toolId)) {
        return prev.filter(p => p !== toolId);
      } else {
        return [...prev, toolId];
      }
    });
  };

  // Add a bash permission
  const addBashPermission = () => {
    const trimmed = newBashPerm.trim();
    if (!trimmed) return;
    const formatted = trimmed.startsWith('Bash(') ? trimmed : `Bash(${trimmed})`;
    if (!allowList.includes(formatted)) {
      setAllowList(prev => [...prev, formatted]);
    }
    setNewBashPerm('');
  };

  // Add an additional directory
  const addDirectory = () => {
    const trimmed = newDir.trim();
    if (!trimmed) return;
    if (!additionalDirs.includes(trimmed)) {
      setAdditionalDirs(prev => [...prev, trimmed]);
    }
    setNewDir('');
  };

  // Remove a permission
  const removePermission = (perm: string) => {
    setAllowList(prev => prev.filter(p => p !== perm));
  };

  // Remove a directory
  const removeDirectory = (dir: string) => {
    setAdditionalDirs(prev => prev.filter(d => d !== dir));
  };

  // Get bash permissions (filtered and sorted)
  const bashPermissions = allowList
    .filter(isBashPattern)
    .sort((a, b) => a.localeCompare(b));

  // Get other permissions (not core tools and not bash patterns)
  const otherPermissions = allowList
    .filter(p => !isCoreTool(p) && !isBashPattern(p))
    .sort((a, b) => a.localeCompare(b));

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title="Claude Permissions"
      width="600px"
      height="700px"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header with path */}
        <div style={{
          padding: '0.5rem 1rem',
          borderBottom: '1px solid #333',
          background: '#1a1a1a',
        }}>
          <div style={{
            fontSize: '0.7rem',
            color: '#666',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {folder}/.claude/settings.local.json
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>
          {loading ? (
            <div style={{ padding: '1rem', color: '#666', textAlign: 'center' }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ padding: '1rem', color: '#f87171', fontSize: '0.85rem' }}>
              {error}
            </div>
          ) : (
            <>
              {/* Core Tools Section */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#888',
                  marginBottom: '0.5rem',
                  fontWeight: 600,
                }}>
                  Core Tools
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '0.35rem',
                }}>
                  {CORE_TOOLS.map(tool => {
                    const isEnabled = allowList.includes(tool.id);
                    return (
                      <label
                        key={tool.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.35rem 0.5rem',
                          borderRadius: '4px',
                          background: isEnabled ? '#1a2e1a' : '#1a1a1a',
                          border: `1px solid ${isEnabled ? '#2d5a2d' : '#2a2a2a'}`,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        title={tool.description}
                      >
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => toggleCoreTool(tool.id)}
                          style={{
                            accentColor: '#f97316',
                            width: '14px',
                            height: '14px',
                            cursor: 'pointer',
                          }}
                        />
                        <span style={{
                          fontSize: '0.72rem',
                          color: isEnabled ? '#9fdf9f' : '#888',
                          fontFamily: 'monospace',
                        }}>
                          {tool.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Bash Permissions Section */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#888',
                  marginBottom: '0.5rem',
                  fontWeight: 600,
                }}>
                  Bash Permissions ({bashPermissions.length})
                </div>

                {/* Add new bash permission */}
                <div style={{
                  display: 'flex',
                  gap: '0.35rem',
                  marginBottom: '0.5rem',
                }}>
                  <input
                    type="text"
                    value={newBashPerm}
                    onChange={(e) => setNewBashPerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addBashPermission()}
                    placeholder="git status*"
                    style={{
                      flex: 1,
                      padding: '0.4rem 0.6rem',
                      borderRadius: '4px',
                      border: '1px solid #333',
                      background: '#0d0d0d',
                      color: '#ccc',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={addBashPermission}
                    style={{
                      padding: '0.4rem 0.75rem',
                      borderRadius: '4px',
                      border: 'none',
                      background: '#f97316',
                      color: '#fff',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Add
                  </button>
                </div>

                {/* Bash permissions list */}
                <div style={{
                  maxHeight: '120px',
                  overflowY: 'auto',
                  border: '1px solid #2a2a2a',
                  borderRadius: '4px',
                  background: '#0d0d0d',
                }}>
                  {bashPermissions.length === 0 ? (
                    <div style={{
                      padding: '0.75rem',
                      color: '#555',
                      fontSize: '0.75rem',
                      textAlign: 'center',
                    }}>
                      No Bash permissions configured
                    </div>
                  ) : (
                    bashPermissions.map(perm => (
                      <div
                        key={perm}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.3rem 0.5rem',
                          borderBottom: '1px solid #1a1a1a',
                        }}
                      >
                        <span style={{
                          fontSize: '0.7rem',
                          color: '#aaa',
                          fontFamily: 'monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {perm}
                        </span>
                        <button
                          onClick={() => removePermission(perm)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#666',
                            cursor: 'pointer',
                            padding: '0.15rem',
                            display: 'flex',
                            alignItems: 'center',
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
                          title="Remove"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Additional Directories Section */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#888',
                  marginBottom: '0.5rem',
                  fontWeight: 600,
                }}>
                  Additional Directories ({additionalDirs.length})
                </div>

                {/* Add new directory */}
                <div style={{
                  display: 'flex',
                  gap: '0.35rem',
                  marginBottom: '0.5rem',
                }}>
                  <input
                    type="text"
                    value={newDir}
                    onChange={(e) => setNewDir(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addDirectory()}
                    placeholder="/path/to/directory"
                    style={{
                      flex: 1,
                      padding: '0.4rem 0.6rem',
                      borderRadius: '4px',
                      border: '1px solid #333',
                      background: '#0d0d0d',
                      color: '#ccc',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={addDirectory}
                    style={{
                      padding: '0.4rem 0.75rem',
                      borderRadius: '4px',
                      border: 'none',
                      background: '#f97316',
                      color: '#fff',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Add
                  </button>
                </div>

                {/* Directories list */}
                <div style={{
                  maxHeight: '120px',
                  overflowY: 'auto',
                  border: '1px solid #2a2a2a',
                  borderRadius: '4px',
                  background: '#0d0d0d',
                }}>
                  {additionalDirs.length === 0 ? (
                    <div style={{
                      padding: '0.75rem',
                      color: '#555',
                      fontSize: '0.75rem',
                      textAlign: 'center',
                    }}>
                      No additional directories configured
                    </div>
                  ) : (
                    additionalDirs.map(dir => (
                      <div
                        key={dir}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.3rem 0.5rem',
                          borderBottom: '1px solid #1a1a1a',
                        }}
                      >
                        <span style={{
                          fontSize: '0.7rem',
                          color: '#aaa',
                          fontFamily: 'monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {dir}
                        </span>
                        <button
                          onClick={() => removeDirectory(dir)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#666',
                            cursor: 'pointer',
                            padding: '0.15rem',
                            display: 'flex',
                            alignItems: 'center',
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
                          title="Remove"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Other Permissions Section */}
              {otherPermissions.length > 0 && (
                <div>
                  <div style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#888',
                    marginBottom: '0.5rem',
                    fontWeight: 600,
                  }}>
                    Other ({otherPermissions.length})
                  </div>
                  <div style={{
                    maxHeight: '100px',
                    overflowY: 'auto',
                    border: '1px solid #2a2a2a',
                    borderRadius: '4px',
                    background: '#0d0d0d',
                  }}>
                    {otherPermissions.map(perm => (
                      <div
                        key={perm}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.3rem 0.5rem',
                          borderBottom: '1px solid #1a1a1a',
                        }}
                      >
                        <span style={{
                          fontSize: '0.7rem',
                          color: '#aaa',
                          fontFamily: 'monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {perm}
                        </span>
                        <button
                          onClick={() => removePermission(perm)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#666',
                            cursor: 'pointer',
                            padding: '0.15rem',
                            display: 'flex',
                            alignItems: 'center',
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
                          title="Remove"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid #333',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: saved ? '#16a34a' : '#f97316',
              color: '#fff',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            {saved ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </>
            ) : saving ? (
              'Saving...'
            ) : (
              'Save Permissions'
            )}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
