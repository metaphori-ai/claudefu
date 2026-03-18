import React, { useState, useRef, useEffect } from 'react';

export interface ModelOption {
  id: string;
  label: string;
  shortLabel: string;
  separator?: boolean; // Show divider above this item
}

export const MODELS: ModelOption[] = [
  // 1M context window variants
  { id: 'claude-opus-4-6[1m]', label: 'Opus 4.6 [1M]', shortLabel: 'Opus [1M]' },
  { id: 'opusplan[1m]', label: 'Opus Plan [1M]', shortLabel: 'OpusPlan [1M]' },
  { id: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 [1M]', shortLabel: 'Sonnet [1M]' },
  // 200K context window variants
  { id: 'claude-opus-4-6', label: 'Opus 4.6', shortLabel: 'Opus 4.6', separator: true },
  { id: 'opusplan', label: 'Opus Plan', shortLabel: 'OpusPlan' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', shortLabel: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', shortLabel: 'Haiku 4.5' },
];

export const DEFAULT_MODEL_ID = 'claude-opus-4-6[1m]';

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

export function ModelSelector({ selectedModel, onModelChange }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'transparent',
          border: '1px solid #333',
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
          e.currentTarget.style.borderColor = '#555';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = '#999';
          e.currentTarget.style.borderColor = '#333';
        }}
      >
        {current.shortLabel}
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
          minWidth: '160px',
          overflow: 'hidden',
        }}>
          {MODELS.map(model => (
            <React.Fragment key={model.id}>
              {model.separator && (
                <div style={{ borderTop: '1px solid #2a2a2a', margin: '2px 0' }} />
              )}
              <button
                onClick={() => {
                  onModelChange(model.id);
                  setIsOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 12px',
                  background: model.id === selectedModel ? '#2a2a2a' : 'transparent',
                  border: 'none',
                  color: model.id === selectedModel ? '#d97757' : '#ccc',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  transition: 'background 0.1s ease',
                }}
                onMouseEnter={e => {
                  if (model.id !== selectedModel) {
                    e.currentTarget.style.background = '#252525';
                  }
                }}
                onMouseLeave={e => {
                  if (model.id !== selectedModel) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {model.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
