import { useState, useCallback, useEffect, useRef } from 'react';
import { TerminalTab } from './TerminalTab';
import { CreateTerminal, CloseTerminal } from '../../../wailsjs/go/main/App';
import { EventsOn } from '../../../wailsjs/runtime/runtime';

interface TerminalInfo {
  id: string;
  label: string;
  folder: string;
}

interface TerminalPanelProps {
  selectedFolder?: string;
}

export function TerminalPanel({ selectedFolder }: TerminalPanelProps) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // Auto-create first terminal on mount (guard against strict mode double-fire)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    handleNewTerminal();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for terminal exits
  useEffect(() => {
    const cancel = EventsOn('terminal:exit', (payload: any) => {
      if (payload?.id) {
        // Keep tab visible but could mark as exited
      }
    });
    return () => cancel();
  }, []);

  const handleNewTerminal = useCallback(async () => {
    try {
      const folder = selectedFolder || '/';
      const info = await CreateTerminal(folder);
      if (info) {
        setTerminals(prev => [...prev, info]);
        setActiveId(info.id);
      }
    } catch (err) {
      console.error('Failed to create terminal:', err);
    }
  }, [selectedFolder]);

  const handleCloseTerminal = useCallback(async (id: string) => {
    try {
      await CloseTerminal(id);
    } catch {
      // Ignore errors on close
    }
    setTerminals(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeId && next.length > 0) {
        setActiveId(next[next.length - 1].id);
      } else if (next.length === 0) {
        setActiveId(null);
      }
      return next;
    });
  }, [activeId]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Terminal content area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {terminals.map((t) => (
          <TerminalTab
            key={t.id}
            id={t.id}
            isActive={t.id === activeId}
          />
        ))}
        {terminals.length === 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#555',
              fontSize: '0.85rem',
            }}
          >
            No terminals open
          </div>
        )}
      </div>

      {/* Right-side tab list (VS Code style) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: '#111',
          borderLeft: '1px solid #222',
          width: '140px',
          flexShrink: 0,
          overflow: 'auto',
        }}
      >
        {terminals.map((t) => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 8px',
              fontSize: '0.72rem',
              color: t.id === activeId ? '#fff' : '#888',
              background: t.id === activeId ? '#1a1a1a' : 'transparent',
              borderBottom: '1px solid #1a1a1a',
              borderLeft: t.id === activeId ? '2px solid #d97757' : '2px solid transparent',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span style={{ color: '#d97757', fontSize: '0.65rem' }}>❯</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCloseTerminal(t.id);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#555',
                cursor: 'pointer',
                fontSize: '0.8rem',
                padding: '0 2px',
                lineHeight: 1,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
            >
              ×
            </button>
          </div>
        ))}
        {/* New terminal button */}
        <button
          onClick={handleNewTerminal}
          style={{
            background: 'none',
            border: 'none',
            color: '#555',
            cursor: 'pointer',
            fontSize: '0.72rem',
            padding: '5px 8px',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#d97757')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
          title="New Terminal"
        >
          <span>+</span>
          <span>New</span>
        </button>
      </div>
    </div>
  );
}
