import { useState, useEffect, useMemo, useRef } from 'react';
import { DialogBase } from './DialogBase';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import { GetBroadcastableAgents, BroadcastToInbox } from '../../wailsjs/go/main/App';
import { main } from '../../wailsjs/go/models';

interface BroadcastDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type Priority = 'normal' | 'high';

// Cross-workspace orange (matches MCPSettingsPane preview + WorkspaceMetaDialog convention)
const XWS_ORANGE = '#d97757';

export function BroadcastDialog({ isOpen, onClose }: BroadcastDialogProps) {
  const [agents, setAgents] = useState<main.BroadcastableAgent[]>([]);
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [fromName, setFromName] = useState('user');
  const [priority, setPriority] = useState<Priority>('normal');
  const [filter, setFilter] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [results, setResults] = useState<main.BroadcastResult[] | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Reset transient state on each open + load agent list
  useEffect(() => {
    if (!isOpen) return;
    setMessage('');
    setSelectedIDs(new Set());
    setFilter('');
    setResults(null);
    setIsSending(false);
    setPriority('normal');
    GetBroadcastableAgents()
      .then((list) => setAgents(list || []))
      .catch(() => setAgents([]));
    // Defer focus so DialogBase's mount animation is past
    setTimeout(() => messageRef.current?.focus(), 50);
  }, [isOpen]);

  // Split into workspace + cross-workspace and filter by search term
  const { workspaceAgents, crossAgents } = useMemo(() => {
    const lower = filter.trim().toLowerCase();
    const match = (a: main.BroadcastableAgent) =>
      !lower ||
      a.slug.toLowerCase().includes(lower) ||
      (a.description || '').toLowerCase().includes(lower) ||
      a.folder.toLowerCase().includes(lower);

    const ws: main.BroadcastableAgent[] = [];
    const xws: main.BroadcastableAgent[] = [];
    for (const a of agents) {
      if (!match(a)) continue;
      if (a.isCrossWorkspace) xws.push(a);
      else ws.push(a);
    }
    ws.sort((a, b) => a.slug.localeCompare(b.slug));
    xws.sort((a, b) => a.slug.localeCompare(b.slug));
    return { workspaceAgents: ws, crossAgents: xws };
  }, [agents, filter]);

  const toggle = (id: string) => {
    setSelectedIDs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectGroup = (group: main.BroadcastableAgent[], on: boolean) => {
    setSelectedIDs((prev) => {
      const next = new Set(prev);
      for (const a of group) {
        if (on) next.add(a.id);
        else next.delete(a.id);
      }
      return next;
    });
  };

  const canSend = message.trim().length > 0 && selectedIDs.size > 0 && !isSending;

  const handleSend = async () => {
    if (!canSend) return;
    setIsSending(true);
    setResults(null);
    try {
      const ids = Array.from(selectedIDs);
      const res = await BroadcastToInbox(ids, message, fromName || 'user', priority);
      setResults(res || []);
      // Auto-close on full success after a brief pause so the user sees the green confirm
      const allGood = (res || []).every((r) => r.success);
      if (allGood) {
        setTimeout(() => onClose(), 1500);
      }
    } catch (e) {
      setResults([
        {
          agentId: '',
          agentSlug: '(unknown)',
          success: false,
          error: e instanceof Error ? e.message : 'broadcast failed',
        } as main.BroadcastResult,
      ]);
    } finally {
      setIsSending(false);
    }
  };

  useSaveShortcut(isOpen, handleSend);

  const buttonStyle: React.CSSProperties = {
    background: '#2a2a2a',
    color: '#ccc',
    border: '1px solid #3a3a3a',
    borderRadius: '4px',
    padding: '4px 10px',
    fontSize: '0.75rem',
    cursor: 'pointer',
  };

  const renderAgentRow = (a: main.BroadcastableAgent) => {
    const checked = selectedIDs.has(a.id);
    const slugColor = a.isCrossWorkspace ? XWS_ORANGE : '#ccc';
    return (
      <label
        key={a.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          padding: '6px 8px',
          cursor: 'pointer',
          borderRadius: '4px',
          background: checked ? 'rgba(217,119,87,0.08)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!checked) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        }}
        onMouseLeave={(e) => {
          if (!checked) e.currentTarget.style.background = 'transparent';
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggle(a.id)}
          style={{ marginTop: '3px', accentColor: XWS_ORANGE }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ color: slugColor, fontWeight: 500, fontSize: '0.85rem' }}>
              {a.slug || '(no slug)'}
            </span>
            {a.isCrossWorkspace && (
              <span title="Cross-workspace agent" style={{ color: XWS_ORANGE, fontSize: '0.7rem' }}>
                ✦
              </span>
            )}
          </div>
          {a.description && (
            <div
              style={{
                color: '#888',
                fontSize: '0.7rem',
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {a.description}
            </div>
          )}
        </div>
      </label>
    );
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span>
          📣 Broadcast Message{' '}
          {selectedIDs.size > 0 && (
            <span style={{ color: '#888', fontWeight: 400, fontSize: '0.8rem' }}>
              — {selectedIDs.size} selected
            </span>
          )}
        </span>
      }
      width="640px"
      maxHeight="85vh"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px' }}>
        {/* From + Priority row */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
            <span style={{ color: '#888', fontSize: '0.75rem' }}>From:</span>
            <input
              type="text"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="user"
              style={{
                background: '#1a1a1a',
                border: '1px solid #333',
                color: '#ddd',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.8rem',
                width: '140px',
              }}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.75rem', color: '#888' }}>
            <span>Priority:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="bcast-prio"
                checked={priority === 'normal'}
                onChange={() => setPriority('normal')}
                style={{ accentColor: XWS_ORANGE }}
              />
              <span style={{ color: '#ccc' }}>Normal</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="bcast-prio"
                checked={priority === 'high'}
                onChange={() => setPriority('high')}
                style={{ accentColor: XWS_ORANGE }}
              />
              <span style={{ color: '#ccc' }}>High</span>
            </label>
          </div>
        </div>

        {/* Message textarea */}
        <textarea
          ref={messageRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message to broadcast to the selected agents' inboxes…"
          rows={8}
          style={{
            background: '#1a1a1a',
            border: '1px solid #333',
            color: '#ddd',
            padding: '10px 12px',
            borderRadius: '6px',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            fontSize: '0.85rem',
            lineHeight: 1.5,
            resize: 'vertical',
            minHeight: '120px',
          }}
        />

        {/* Recipients section */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <span style={{ color: '#aaa', fontSize: '0.8rem', fontWeight: 500 }}>Recipients</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={buttonStyle} onClick={() => selectGroup(workspaceAgents, true)}>
                All in Workspace
              </button>
              <button style={buttonStyle} onClick={() => selectGroup(crossAgents, true)}>
                All Cross-Workspace
              </button>
              <button style={buttonStyle} onClick={() => selectGroup([...workspaceAgents, ...crossAgents], true)}>
                All
              </button>
              <button style={buttonStyle} onClick={() => setSelectedIDs(new Set())}>
                Clear
              </button>
            </div>
          </div>

          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by slug or description…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#1a1a1a',
              border: '1px solid #333',
              color: '#ddd',
              padding: '6px 10px',
              borderRadius: '4px',
              fontSize: '0.8rem',
              marginBottom: '8px',
            }}
          />

          <div
            style={{
              maxHeight: '280px',
              overflowY: 'auto',
              border: '1px solid #2a2a2a',
              borderRadius: '6px',
              padding: '6px',
              background: '#141414',
            }}
          >
            {workspaceAgents.length === 0 && crossAgents.length === 0 && (
              <div style={{ color: '#666', fontSize: '0.8rem', padding: '12px', textAlign: 'center' }}>
                No agents match the filter.
              </div>
            )}
            {workspaceAgents.length > 0 && (
              <>
                <div
                  style={{
                    color: '#666',
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '4px 8px 6px',
                  }}
                >
                  Current Workspace
                </div>
                {workspaceAgents.map(renderAgentRow)}
              </>
            )}
            {crossAgents.length > 0 && (
              <>
                <div
                  style={{
                    color: XWS_ORANGE,
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '10px 8px 6px',
                    opacity: 0.8,
                  }}
                >
                  ✦ Cross-Workspace
                </div>
                {crossAgents.map(renderAgentRow)}
              </>
            )}
          </div>
        </div>

        {/* Per-agent results */}
        {results && results.length > 0 && (
          <div
            style={{
              border: '1px solid #2a2a2a',
              borderRadius: '6px',
              padding: '8px 10px',
              background: '#141414',
              maxHeight: '120px',
              overflowY: 'auto',
            }}
          >
            {results.map((r, i) => (
              <div
                key={`${r.agentId}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.78rem',
                  padding: '2px 0',
                  color: r.success ? '#7bc97b' : '#f47b7b',
                }}
              >
                <span>{r.success ? '✓' : '✗'}</span>
                <span style={{ color: '#ccc' }}>{r.agentSlug || r.agentId || '(unknown)'}</span>
                {r.error && <span style={{ color: '#888', fontSize: '0.7rem' }}>— {r.error}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              color: '#aaa',
              border: '1px solid #333',
              padding: '6px 14px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{
              background: canSend ? XWS_ORANGE : '#2a2a2a',
              color: canSend ? 'white' : '#666',
              border: 'none',
              padding: '6px 16px',
              borderRadius: '4px',
              cursor: canSend ? 'pointer' : 'not-allowed',
              fontSize: '0.85rem',
              fontWeight: 500,
            }}
            title="Send (⌘S)"
          >
            {isSending
              ? 'Sending…'
              : selectedIDs.size === 0
              ? 'Send'
              : `Send to ${selectedIDs.size} agent${selectedIDs.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
