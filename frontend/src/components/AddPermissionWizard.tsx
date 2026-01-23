import { useState, useEffect } from 'react';
import { DialogBase } from './DialogBase';
import { GetSetByCommand, GetClaudePermissions, SaveClaudePermissions } from '../../wailsjs/go/main/App';
import { permissions } from '../../wailsjs/go/models';

interface AddPermissionWizardProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;
  toolName: string;
  command?: string; // For Bash commands, the base command (e.g., "git")
}

type SuggestionType = 'specific' | 'all_command' | 'set_common' | 'set_permissive' | 'set_all';

interface Suggestion {
  type: SuggestionType;
  label: string;
  description: string;
  permissions: string[];
  recommended?: boolean;
}

export function AddPermissionWizard({
  isOpen,
  onClose,
  folder,
  toolName,
  command,
}: AddPermissionWizardProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestionType | null>(null);
  const [matchedSet, setMatchedSet] = useState<permissions.PermissionSet | null>(null);

  // Load suggestions when dialog opens
  useEffect(() => {
    if (isOpen && toolName) {
      loadSuggestions();
    }
  }, [isOpen, toolName, command]);

  const loadSuggestions = async () => {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setSelectedSuggestion(null);
    setMatchedSet(null);

    try {
      const newSuggestions: Suggestion[] = [];

      if (toolName === 'Bash' && command) {
        // Try to find a matching permission set
        const match = await GetSetByCommand(command);

        if (match?.set) {
          setMatchedSet(match.set);
          const set = match.set;

          // Suggestion 1: Add specific command pattern
          const specificPerm = `Bash(${command}:*)`;
          newSuggestions.push({
            type: 'specific',
            label: `Add "${command}" commands only`,
            description: `Allows: ${specificPerm}`,
            permissions: [specificPerm],
          });

          // Suggestion 2: Enable Common level for the set (Recommended)
          const commonCount = set.permissions.common?.length || 0;
          if (commonCount > 0) {
            newSuggestions.push({
              type: 'set_common',
              label: `Enable ${set.name} (Common)`,
              description: `${commonCount} read-only commands: status, log, list, etc.`,
              permissions: set.permissions.common || [],
              recommended: true,
            });
          }

          // Suggestion 3: Enable Common + Permissive
          const permissiveCount = set.permissions.permissive?.length || 0;
          if (permissiveCount > 0) {
            newSuggestions.push({
              type: 'set_permissive',
              label: `Enable ${set.name} (Common + Permissive)`,
              description: `${commonCount + permissiveCount} commands including local modifications`,
              permissions: [
                ...(set.permissions.common || []),
                ...(set.permissions.permissive || []),
              ],
            });
          }

          // Suggestion 4: Enable all levels (including YOLO)
          const yoloCount = set.permissions.yolo?.length || 0;
          if (yoloCount > 0) {
            newSuggestions.push({
              type: 'set_all',
              label: `Enable ${set.name} (All including YOLO)`,
              description: `⚠️ ${commonCount + permissiveCount + yoloCount} commands including remote/destructive operations`,
              permissions: [
                ...(set.permissions.common || []),
                ...(set.permissions.permissive || []),
                ...(set.permissions.yolo || []),
              ],
            });
          }
        } else {
          // No matching set, just offer specific command
          const specificPerm = `Bash(${command}:*)`;
          newSuggestions.push({
            type: 'specific',
            label: `Add "${command}" commands`,
            description: `Allows: ${specificPerm}`,
            permissions: [specificPerm],
            recommended: true,
          });

          // Also offer all commands for the base
          const allCommandPerm = `Bash(${command.split(' ')[0]}:*)`;
          if (allCommandPerm !== specificPerm) {
            newSuggestions.push({
              type: 'all_command',
              label: `Add all "${command.split(' ')[0]}" commands`,
              description: `Allows: ${allCommandPerm}`,
              permissions: [allCommandPerm],
            });
          }
        }
      } else {
        // Non-Bash tool - just add the tool itself
        newSuggestions.push({
          type: 'specific',
          label: `Add "${toolName}" tool`,
          description: `Allows the ${toolName} tool to be used`,
          permissions: [toolName],
          recommended: true,
        });
      }

      setSuggestions(newSuggestions);
      // Auto-select recommended option
      const recommended = newSuggestions.find(s => s.recommended);
      if (recommended) {
        setSelectedSuggestion(recommended.type);
      }
    } catch (err) {
      setError(`Failed to load suggestions: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPermission = async () => {
    if (!selectedSuggestion) return;

    const suggestion = suggestions.find(s => s.type === selectedSuggestion);
    if (!suggestion) return;

    setSaving(true);
    setError(null);

    try {
      // Load current permissions
      const current = await GetClaudePermissions(folder);
      const allowList = current.allow || [];
      const denyList = current.deny || [];
      const additionalDirs = current.additionalDirectories || [];

      // Add new permissions (avoid duplicates)
      const newAllowList = [...allowList];
      for (const perm of suggestion.permissions) {
        if (!newAllowList.includes(perm)) {
          newAllowList.push(perm);
        }
      }

      // Sort: Core Tools, then Bash patterns, then Others
      const coreTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Task', 'WebSearch', 'WebFetch', 'NotebookEdit', 'LSP', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'Skill', 'KillShell', 'TaskOutput'];
      const isCoreTool = (p: string) => coreTools.includes(p);
      const isBashPattern = (p: string) => p.startsWith('Bash(') && p.endsWith(')');

      const sortedCore = newAllowList.filter(isCoreTool).sort();
      const sortedBash = newAllowList.filter(isBashPattern).sort();
      const sortedOther = newAllowList.filter(p => !isCoreTool(p) && !isBashPattern(p)).sort();
      const sortedAllowList = [...sortedCore, ...sortedBash, ...sortedOther];

      // Save
      await SaveClaudePermissions(folder, sortedAllowList, denyList, additionalDirs);
      onClose();
    } catch (err) {
      setError(`Failed to save: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const displayCommand = command || toolName;

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title="Add Permission"
      width="450px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header info */}
        <div style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid #333',
          background: '#1a1a1a',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.35rem',
          }}>
            <span style={{ fontSize: '1rem' }}>🔒</span>
            <span style={{ color: '#f87171', fontSize: '0.85rem', fontFamily: 'monospace' }}>
              {displayCommand}
            </span>
            <span style={{ color: '#666', fontSize: '0.8rem' }}>was blocked</span>
          </div>
          <div style={{ color: '#888', fontSize: '0.75rem' }}>
            Select a permission option below to allow this command.
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>
          {loading ? (
            <div style={{ padding: '1rem', color: '#666', textAlign: 'center' }}>
              Loading suggestions...
            </div>
          ) : error ? (
            <div style={{ padding: '1rem', color: '#f87171', fontSize: '0.85rem' }}>
              {error}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {suggestions.map((suggestion) => {
                const isSelected = selectedSuggestion === suggestion.type;
                return (
                  <button
                    key={suggestion.type}
                    onClick={() => setSelectedSuggestion(suggestion.type)}
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: `1px solid ${isSelected ? '#d97757' : '#333'}`,
                      background: isSelected ? '#2a1a15' : '#1a1a1a',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.25rem',
                    }}>
                      <div style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        border: `2px solid ${isSelected ? '#d97757' : '#555'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {isSelected && (
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: '#d97757',
                          }} />
                        )}
                      </div>
                      <span style={{
                        color: isSelected ? '#d97757' : '#ccc',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                      }}>
                        {suggestion.label}
                      </span>
                      {suggestion.recommended && (
                        <span style={{
                          fontSize: '0.65rem',
                          color: '#22c55e',
                          background: '#14532d',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '3px',
                          fontWeight: 500,
                        }}>
                          Recommended
                        </span>
                      )}
                    </div>
                    <div style={{
                      color: '#888',
                      fontSize: '0.75rem',
                      marginLeft: '24px',
                    }}>
                      {suggestion.description}
                    </div>
                  </button>
                );
              })}

              {/* Show matched permission set info */}
              {matchedSet && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  background: '#111',
                  borderRadius: '4px',
                  border: '1px solid #222',
                }}>
                  <div style={{
                    fontSize: '0.65rem',
                    color: '#666',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '0.25rem',
                  }}>
                    Matched Permission Set
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'center',
                  }}>
                    <span style={{ color: '#aaa', fontSize: '0.8rem', fontWeight: 500 }}>
                      {matchedSet.name}
                    </span>
                    {matchedSet.description && (
                      <span style={{ color: '#555', fontSize: '0.7rem' }}>
                        — {matchedSet.description}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid #333',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.5rem',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid #444',
              background: 'transparent',
              color: '#888',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleAddPermission}
            disabled={!selectedSuggestion || saving}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: selectedSuggestion ? '#d97757' : '#333',
              color: selectedSuggestion ? '#fff' : '#666',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: selectedSuggestion && !saving ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Adding...' : 'Add Permission'}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
