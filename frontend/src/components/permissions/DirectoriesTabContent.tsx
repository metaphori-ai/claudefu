import { useState, useCallback } from 'react';
import { SelectDirectory, NormalizeDirPath } from '../../../wailsjs/go/main/App';

// Extracted outside component to prevent unmount/remount on parent re-render
function DirectoryRow({
  dir,
  isLast,
  readOnly = false,
  onRemove,
  isCopied,
  onCopy,
}: {
  dir: string;
  isLast: boolean;
  readOnly?: boolean;
  onRemove?: () => void;
  isCopied: boolean;
  onCopy: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.6rem 0.75rem',
        borderBottom: isLast ? 'none' : '1px solid #1a1a1a',
        opacity: readOnly ? 0.7 : 1,
      }}
    >
      {/* Directory icon and path */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        flex: 1,
        minWidth: 0,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={readOnly ? '#555' : '#666'} strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{
          fontSize: '0.8rem',
          color: readOnly ? '#777' : '#aaa',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {dir}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
        {/* Copy path button */}
        <button
          onClick={onCopy}
          style={{
            background: 'none',
            border: 'none',
            color: isCopied ? '#4ade80' : '#555',
            cursor: 'pointer',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
          }}
          onMouseEnter={(e) => { if (!isCopied) e.currentTarget.style.color = '#888'; }}
          onMouseLeave={(e) => { if (!isCopied) e.currentTarget.style.color = '#555'; }}
          title={isCopied ? 'Copied!' : 'Copy path'}
        >
          {isCopied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>

        {/* Remove button - only for editable directories */}
        {!readOnly && onRemove && (
          <button
            onClick={onRemove}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
            title="Remove"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {/* Lock icon for read-only */}
        {readOnly && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" style={{ flexShrink: 0 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )}
      </div>
    </div>
  );
}

interface DirectoriesTabContentProps {
  globalDirectories: string[];  // Read-only, from global permissions
  agentDirectories: string[];   // Editable, agent-specific
  onChange: (dirs: string[]) => void;  // Only changes agent directories
}

export function DirectoriesTabContent({
  globalDirectories,
  agentDirectories,
  onChange,
}: DirectoriesTabContentProps) {
  const [newDir, setNewDir] = useState('');
  const [copiedDir, setCopiedDir] = useState<string | null>(null);

  const handleAdd = async () => {
    const trimmed = newDir.trim();
    if (!trimmed) return;
    // Normalize path (e.g., /Users/jasdeep/svml → ~/svml)
    const normalized = await NormalizeDirPath(trimmed);
    // Check both global and agent lists to avoid duplicates
    if (!agentDirectories.includes(normalized) && !globalDirectories.includes(normalized)) {
      onChange([...agentDirectories, normalized]);
    }
    setNewDir('');
  };

  const handleRemove = (dir: string) => {
    onChange(agentDirectories.filter(d => d !== dir));
  };

  const handleBrowse = async () => {
    try {
      const selected = await SelectDirectory('Select Directory');
      if (!selected) return;
      // Normalize path (e.g., /Users/jasdeep/svml → ~/svml)
      const normalized = await NormalizeDirPath(selected);
      if (!agentDirectories.includes(normalized) && !globalDirectories.includes(normalized)) {
        onChange([...agentDirectories, normalized]);
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  };

  const handleCopyDir = useCallback((dir: string) => {
    navigator.clipboard.writeText(dir).then(() => {
      setCopiedDir(dir);
      setTimeout(() => setCopiedDir(null), 2000);
    });
  }, []);

  // Shared styles for directory list sections
  const listContainerStyle = {
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    background: '#0d0d0d',
    overflow: 'auto' as const,
    maxHeight: '200px',
  };

  const emptyStateStyle = {
    padding: '1.5rem',
    color: '#555',
    fontSize: '0.85rem',
    textAlign: 'center' as const,
  };

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflow: 'auto', flex: 1, minHeight: 0 }}>
      {/* Description */}
      <div style={{
        fontSize: '0.8rem',
        color: '#666',
        lineHeight: 1.5,
      }}>
        Directories passed to Claude via <code style={{
          background: '#1a1a1a',
          padding: '0.1rem 0.3rem',
          borderRadius: '3px',
          fontSize: '0.75rem',
        }}>--add-dir</code> flags. Global directories apply to all agents. Agent directories are specific to this agent.
      </div>

      {/* ==================== GLOBAL DIRECTORIES (Read-only) ==================== */}
      <div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.5rem',
        }}>
          <div style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: '#888',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Global Directories
          </div>
          <span style={{
            fontSize: '0.7rem',
            color: '#555',
            fontStyle: 'italic',
          }}>
            Edit in Global Settings
          </span>
        </div>

        <div style={listContainerStyle}>
          {globalDirectories.length === 0 ? (
            <div style={emptyStateStyle}>
              No global directories configured
            </div>
          ) : (
            globalDirectories.map((dir, index) => (
              <DirectoryRow
                key={`global-${dir}`}
                dir={dir}
                isLast={index === globalDirectories.length - 1}
                readOnly
                isCopied={copiedDir === dir}
                onCopy={() => handleCopyDir(dir)}
              />
            ))
          )}
        </div>
      </div>

      {/* ==================== AGENT DIRECTORIES (Editable) ==================== */}
      <div>
        <div style={{
          fontSize: '0.85rem',
          fontWeight: 600,
          color: '#ccc',
          marginBottom: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Agent Directories
        </div>

        {/* Add directory input */}
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.75rem',
        }}>
          <input
            type="text"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="~/path or /absolute/path"
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #333',
              background: '#0d0d0d',
              color: '#ccc',
              fontSize: '0.85rem',
              fontFamily: 'monospace',
              outline: 'none',
            }}
          />
          <button
            onClick={handleBrowse}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #444',
              background: 'transparent',
              color: '#888',
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#666';
              e.currentTarget.style.color = '#ccc';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#444';
              e.currentTarget.style.color = '#888';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Browse
          </button>
          <button
            onClick={handleAdd}
            disabled={!newDir.trim()}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: 'none',
              background: newDir.trim() ? '#d97757' : '#333',
              color: newDir.trim() ? '#fff' : '#666',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: newDir.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Add
          </button>
        </div>

        {/* Agent directories list */}
        <div style={listContainerStyle}>
          {agentDirectories.length === 0 ? (
            <div style={emptyStateStyle}>
              No agent-specific directories
            </div>
          ) : (
            agentDirectories.map((dir, index) => (
              <DirectoryRow
                key={`agent-${dir}`}
                dir={dir}
                isLast={index === agentDirectories.length - 1}
                onRemove={() => handleRemove(dir)}
                isCopied={copiedDir === dir}
                onCopy={() => handleCopyDir(dir)}
              />
            ))
          )}
        </div>

        {/* Count indicator */}
        {agentDirectories.length > 0 && (
          <div style={{
            marginTop: '0.5rem',
            fontSize: '0.7rem',
            color: '#555',
            textAlign: 'right',
          }}>
            {agentDirectories.length} agent director{agentDirectories.length === 1 ? 'y' : 'ies'}
          </div>
        )}
      </div>

      {/* ==================== EFFECTIVE SUMMARY ==================== */}
      <div style={{
        padding: '0.75rem',
        background: '#1a1a1a',
        borderRadius: '6px',
        fontSize: '0.75rem',
        color: '#666',
      }}>
        <strong style={{ color: '#888' }}>Effective directories at runtime:</strong>{' '}
        {globalDirectories.length + agentDirectories.length} total
        {globalDirectories.length > 0 && agentDirectories.length > 0 && (
          <span> ({globalDirectories.length} global + {agentDirectories.length} agent)</span>
        )}
      </div>
    </div>
  );
}
