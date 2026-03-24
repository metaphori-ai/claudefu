import { useState, useEffect, useMemo } from 'react';
import { DialogBase } from './DialogBase';
import { GetAllAgentMeta } from '../../wailsjs/go/main/App';
import { workspace } from '../../wailsjs/go/models';

interface AddAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAgent: (folder: string, slug: string) => void;
  onBrowseNew: () => void;
  currentAgentFolders: Set<string>;
}

export function AddAgentDialog({
  isOpen, onClose, onSelectAgent, onBrowseNew, currentAgentFolders,
}: AddAgentDialogProps) {
  const [allAgents, setAllAgents] = useState<Record<string, workspace.AgentInfo>>({});
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // Load all agents from registry on open
  useEffect(() => {
    if (!isOpen) return;
    setFilter('');
    setLoading(true);
    GetAllAgentMeta()
      .then(result => {
        setAllAgents(result || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isOpen]);

  // Available agents = all registry agents minus ones already in workspace
  const availableAgents = useMemo(() => {
    return Object.entries(allAgents)
      .filter(([folder]) => !currentAgentFolders.has(folder))
      .map(([folder, info]) => ({
        folder,
        slug: info.meta?.AGENT_SLUG || folder.split('/').pop() || folder,
        description: info.meta?.AGENT_DESCRIPTION || '',
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }, [allAgents, currentAgentFolders]);

  // Filtered by search
  const filteredAgents = useMemo(() => {
    if (!filter) return availableAgents;
    const lower = filter.toLowerCase();
    return availableAgents.filter(a =>
      a.slug.toLowerCase().includes(lower) || a.folder.toLowerCase().includes(lower)
    );
  }, [availableAgents, filter]);

  // Normalize folder for display (~/... instead of /Users/...)
  const displayFolder = (folder: string): string => {
    const home = '/Users/';
    if (folder.startsWith(home)) {
      const afterUsers = folder.substring(home.length);
      const slashIdx = afterUsers.indexOf('/');
      if (slashIdx >= 0) {
        return '~' + afterUsers.substring(slashIdx);
      }
    }
    return folder;
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title="Add Agent"
      width="500px"
      height="600px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Filter input + New Agent button */}
        <div style={{ padding: '0.75rem 1rem 0.5rem', flexShrink: 0, display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter agents..."
            autoFocus
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #333',
              background: '#0d0d0d',
              color: '#ccc',
              fontSize: '0.85rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#d97757'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#333'; }}
          />
          <button
            onClick={onBrowseNew}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #333',
              background: 'transparent',
              color: '#d97757',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#d97757';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.borderColor = '#d97757';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#d97757';
              e.currentTarget.style.borderColor = '#333';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New
          </button>
        </div>

        {/* Agent list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 0.5rem' }}>
          {loading && (
            <div style={{ padding: '2rem', color: '#666', textAlign: 'center', fontSize: '0.8rem' }}>
              Loading agents...
            </div>
          )}

          {!loading && filteredAgents.length === 0 && availableAgents.length === 0 && (
            <div style={{ padding: '2rem', color: '#555', textAlign: 'center', fontSize: '0.8rem' }}>
              No other agents in registry. Use "+ New Agent" below to add one.
            </div>
          )}

          {!loading && filteredAgents.length === 0 && availableAgents.length > 0 && (
            <div style={{ padding: '2rem', color: '#555', textAlign: 'center', fontSize: '0.8rem' }}>
              No agents match "{filter}"
            </div>
          )}

          {filteredAgents.map(agent => (
            <button
              key={agent.folder}
              onClick={() => onSelectAgent(agent.folder, agent.slug)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                borderRadius: '6px',
                padding: '0.6rem 0.75rem',
                cursor: 'pointer',
                transition: 'background 0.1s ease',
                marginBottom: '2px',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{
                fontSize: '0.85rem',
                fontFamily: 'monospace',
                color: '#d97757',
                fontWeight: 500,
              }}>
                {agent.slug}
              </div>
              <div style={{
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                color: '#555',
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {displayFolder(agent.folder)}
              </div>
            </button>
          ))}
        </div>

      </div>
    </DialogBase>
  );
}
