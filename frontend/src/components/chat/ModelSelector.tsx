import React, { useState, useRef, useEffect } from 'react';
import {
  MODEL_CATALOG,
  type ModelEntry,
  getModelEntry,
} from './modelCatalog';

// Re-export catalog-derived pieces so existing imports continue to work.
export type { ModelEntry };

// Legacy shim: some older callers may still import these names.
// Prefer importing from modelCatalog directly.
export const MODELS = MODEL_CATALOG;
export const DEFAULT_MODEL_ID = ''; // empty = CLI default

interface ModelSelectorProps {
  selectedModel: string;
  agentDefaultModel: string;
  onModelChange: (modelId: string) => void;
}

/**
 * ModelSelector — dropdown picker for Claude model selection.
 *
 * Semantics:
 *   - `agentDefaultModel` is the saved default from AGENT_MODEL meta.
 *   - `selectedModel` is the current choice (initialized to agentDefaultModel;
 *     may diverge as a per-message override).
 *   - "●" indicator on the trigger appears when selectedModel ≠ agentDefaultModel.
 *   - The save-as-default action lives OUTSIDE this component — as a disk icon
 *     in ControlButtonsRow — so users don't have to open the dropdown to persist.
 *   - To revert to the agent default, pick the row labeled "(agent default)".
 */
export function ModelSelector({
  selectedModel,
  agentDefaultModel,
  onModelChange,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = getModelEntry(selectedModel) ?? MODEL_CATALOG[0];
  const isOverridden = selectedModel !== agentDefaultModel;

  // Close on outside click / ESC.
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

  // Group entries by alias vs explicit.
  const aliases = MODEL_CATALOG.filter(m => m.group === 'alias');
  const explicit = MODEL_CATALOG.filter(m => m.group === 'explicit');

  const renderRow = (model: ModelEntry) => {
    const isSelected = model.id === selectedModel;
    const isDefault = model.id === agentDefaultModel;
    return (
      <button
        key={model.id || 'cli-default'}
        onClick={() => {
          onModelChange(model.id);
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
          transition: 'background 0.1s ease',
        }}
        onMouseEnter={e => {
          if (!isSelected) e.currentTarget.style.background = '#252525';
        }}
        onMouseLeave={e => {
          if (!isSelected) e.currentTarget.style.background = 'transparent';
        }}
        title={model.description}
      >
        <span>
          {model.label}
          {isDefault && (
            <span style={{ color: '#666', fontSize: '0.6rem', marginLeft: '6px' }}>
              (agent default)
            </span>
          )}
        </span>
        {model.extraUsage && (
          <span style={{ color: '#f0ad4e', fontSize: '0.7rem', marginLeft: '8px' }} title="Extra usage — not included on Max plans">
            $
          </span>
        )}
      </button>
    );
  };

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
        title={isOverridden ? 'Per-message override — differs from agent default' : 'Agent default'}
      >
        {isOverridden && <span style={{ color: '#d97757' }}>●</span>}
        {current.label || 'Empty/Default'}
        {current.extraUsage && <span style={{ color: '#f0ad4e' }}>$</span>}
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
          maxHeight: '400px',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>
          <div style={{ padding: '4px 12px', fontSize: '0.6rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Aliases
          </div>
          {aliases.map(renderRow)}

          <div style={{ borderTop: '1px solid #2a2a2a', margin: '4px 0' }} />
          <div style={{ padding: '4px 12px', fontSize: '0.6rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Specific Versions
          </div>
          {explicit.map(renderRow)}
        </div>
      )}
    </div>
  );
}
