import { useState, useRef, useEffect } from 'react';
import { getSupportedEffortLevels, type EffortLevel } from './modelCatalog';

interface EffortSelectorProps {
  currentModel: string;        // active model (determines available levels)
  selectedEffort: string;      // current effort ("" = auto/default)
  agentDefaultEffort: string;  // saved default from AGENT_EFFORT meta
  onEffortChange: (level: string) => void;
  onSaveAsAgentDefault?: (level: string) => void | Promise<void>;
}

/**
 * EffortSelector — compact dropdown for adaptive-reasoning effort level.
 *
 * Renders nothing when the current model doesn't support effort (e.g. Haiku,
 * older 4.5 models). Same agent-default + override pattern as ModelSelector.
 *
 * The empty string ("") represents "auto / model default" and causes --effort
 * to be omitted from the CLI invocation.
 */
export function EffortSelector({
  currentModel,
  selectedEffort,
  agentDefaultEffort,
  onEffortChange,
  onSaveAsAgentDefault,
}: EffortSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const supported = getSupportedEffortLevels(currentModel);
  const isOverridden = selectedEffort !== agentDefaultEffort;

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

  // Model doesn't support effort — render nothing (selector hidden entirely).
  if (supported.length === 0) return null;

  // Options: "auto" (empty-string id) plus supported levels.
  const options: { id: string; label: string }[] = [
    { id: '', label: 'auto' },
    ...supported.map((lvl: EffortLevel) => ({ id: lvl, label: lvl })),
  ];

  const currentLabel = options.find(o => o.id === selectedEffort)?.label ?? 'auto';

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'transparent',
          border: `1px solid ${isOverridden ? '#d97757' : '#333'}`,
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
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = '#d97757';
          if (!isOverridden) e.currentTarget.style.borderColor = '#555';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = '#999';
          if (!isOverridden) e.currentTarget.style.borderColor = '#333';
        }}
        title={isOverridden ? 'Per-message effort override' : 'Agent default effort'}
      >
        {isOverridden && <span style={{ color: '#d97757' }}>●</span>}
        effort: {currentLabel}
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
          minWidth: '140px',
          overflow: 'hidden',
        }}>
          {options.map(opt => {
            const isSelected = opt.id === selectedEffort;
            const isDefault = opt.id === agentDefaultEffort;
            return (
              <button
                key={opt.id || 'auto'}
                onClick={() => {
                  onEffortChange(opt.id);
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '6px 12px',
                  background: isSelected ? '#2a2a2a' : 'transparent',
                  border: 'none',
                  color: isSelected ? '#d97757' : '#ccc',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                }}
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.background = '#252525';
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span>{opt.label}</span>
                {isDefault && (
                  <span style={{ color: '#666', fontSize: '0.6rem', marginLeft: '6px' }}>
                    (agent default)
                  </span>
                )}
              </button>
            );
          })}

          {/* Footer actions */}
          <div style={{ borderTop: '1px solid #2a2a2a', padding: '6px 12px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {isOverridden && (
              <button
                onClick={() => {
                  onEffortChange(agentDefaultEffort);
                  setIsOpen(false);
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid #444',
                  borderRadius: '3px',
                  color: '#999',
                  cursor: 'pointer',
                  fontSize: '0.65rem',
                  padding: '3px 8px',
                  fontFamily: 'monospace',
                }}
              >
                Reset
              </button>
            )}
            {onSaveAsAgentDefault && selectedEffort !== agentDefaultEffort && (
              <button
                onClick={async () => {
                  await onSaveAsAgentDefault(selectedEffort);
                  setIsOpen(false);
                }}
                style={{
                  background: '#d97757',
                  border: 'none',
                  borderRadius: '3px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.65rem',
                  padding: '3px 8px',
                  fontFamily: 'monospace',
                }}
              >
                Save as default
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
