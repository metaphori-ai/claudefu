import { useState, useRef, useEffect, useCallback } from 'react';
import { GetOAuthKeys } from '../../../wailsjs/go/main/App';

interface KeyOption {
  id: string;
  label: string;
  available: boolean;
  sessionLimitedUntil: string;
  weeklyLimitedUntil: string;
  inRotation: boolean;
}

interface KeySelectorProps {
  selectedKey: string;               // "" = Auto (rotation), else pool key ID (pinned)
  onKeyChange: (keyId: string) => void;
}

function fmtReset(rfc3339: string): string {
  const d = new Date(rfc3339);
  if (isNaN(d.getTime())) return rfc3339;
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * KeySelector — OAuth pool key dropdown, sits right of EffortSelector.
 *
 * "" (Auto) is the default: one key per session (cache-greedy), auto-rotation
 * on 429 sorted by nearest weekly reset then session reset. Picking a key pins
 * it — always used, never auto-rotated; when it runs out, swap back to Auto or
 * to another key. Limited keys are dimmed with their reset in the tooltip but
 * stay selectable (pinning is an explicit override).
 *
 * Renders nothing when the pool is empty (feature invisible until keys are
 * added in Global Settings → OAuth Keys).
 */
export function KeySelector({ selectedKey, onKeyChange }: KeySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [keys, setKeys] = useState<KeyOption[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadKeys = useCallback(async () => {
    try {
      const result = await GetOAuthKeys();
      setKeys((result || []).map(k => ({
        id: k.id,
        label: k.label,
        available: k.available,
        sessionLimitedUntil: k.sessionLimitedUntil,
        weeklyLimitedUntil: k.weeklyLimitedUntil,
        inRotation: k.inRotation,
      })));
    } catch {
      // Pool unavailable — selector stays hidden.
      setKeys([]);
    }
  }, []);

  // Fetch on mount so the selector knows whether to render at all…
  useEffect(() => { loadKeys(); }, [loadKeys]);
  // …and refresh on open so limit badges reflect current state.
  useEffect(() => { if (isOpen) loadKeys(); }, [isOpen, loadKeys]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  // No pool configured — nothing to select.
  if (keys.length === 0) return null;

  const isPinned = selectedKey !== '';
  const currentLabel = isPinned
    ? (keys.find(k => k.id === selectedKey)?.label ?? 'unknown')
    : 'Auto';

  const limitTooltip = (k: KeyOption): string => {
    const parts: string[] = [];
    if (k.sessionLimitedUntil) parts.push(`session limited until ${fmtReset(k.sessionLimitedUntil)}`);
    if (k.weeklyLimitedUntil) parts.push(`weekly limited until ${fmtReset(k.weeklyLimitedUntil)}`);
    if (!k.inRotation) parts.push('out of rotation (manual only)');
    return parts.length > 0 ? parts.join(' · ') : 'available';
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'transparent',
          border: `1px solid ${isPinned ? '#d97757' : '#333'}`,
          borderRadius: '4px',
          color: '#999',
          cursor: 'pointer',
          padding: '2px 8px',
          fontSize: '0.7rem',
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          transition: 'color 0.15s ease, border-color 0.15s ease',
          whiteSpace: 'nowrap',
          maxWidth: '180px',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = '#d97757';
          if (!isPinned) e.currentTarget.style.borderColor = '#555';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = '#999';
          if (!isPinned) e.currentTarget.style.borderColor = '#333';
        }}
        title={isPinned
          ? 'Pinned OAuth key — used for every send, no auto-rotation on limit'
          : 'Auto — one key per session, rotates on 429 by nearest weekly reset'}
      >
        {isPinned && <span style={{ color: '#d97757' }}>●</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>key: {currentLabel}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '0',
          marginBottom: '4px',
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 100,
          minWidth: '220px',
          maxHeight: '320px',
          overflowY: 'auto',
        }}>
          {/* Auto row */}
          <button
            onClick={() => { onKeyChange(''); setIsOpen(false); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '6px 12px',
              background: !isPinned ? '#2a2a2a' : 'transparent',
              border: 'none',
              color: !isPinned ? '#d97757' : '#ccc',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              textAlign: 'left',
            }}
            onMouseEnter={e => { if (isPinned) e.currentTarget.style.background = '#252525'; }}
            onMouseLeave={e => { if (isPinned) e.currentTarget.style.background = 'transparent'; }}
            title="Rotate automatically on 429 — nearest weekly reset first, then session reset"
          >
            <span>Auto</span>
            <span style={{ color: '#666', fontSize: '0.6rem', marginLeft: '6px' }}>(rotation)</span>
          </button>

          <div style={{ borderTop: '1px solid #2a2a2a' }} />

          {keys.map(k => {
            const isSelected = k.id === selectedKey;
            const limited = !k.available;
            return (
              <button
                key={k.id}
                onClick={() => { onKeyChange(k.id); setIsOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '6px 12px',
                  background: isSelected ? '#2a2a2a' : 'transparent',
                  border: 'none',
                  color: isSelected ? '#d97757' : limited ? '#666' : '#ccc',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  opacity: limited ? 0.7 : 1,
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#252525'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                title={limitTooltip(k)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '8px', flexShrink: 0 }}>
                  {!k.inRotation && (
                    <span style={{ color: '#555', fontSize: '0.58rem' }}>manual</span>
                  )}
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: limited ? '#f87171' : '#3f9f5f',
                  }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
