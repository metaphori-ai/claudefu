import { useState, useEffect, useCallback } from 'react';
import { DialogBase } from './DialogBase';
import { useSaveShortcut } from '../hooks';
import { GetSettings, SaveSettings } from '../../wailsjs/go/main/App';
import { settings } from '../../wailsjs/go/models';

interface GlobalSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EnvVar {
  key: string;
  value: string;
}

export function GlobalSettingsDialog({ isOpen, onClose }: GlobalSettingsDialogProps) {
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load settings when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const s = await GetSettings();
      // Convert map to array for easier editing
      const vars: EnvVar[] = [];
      if (s.claudeEnvVars) {
        for (const [key, value] of Object.entries(s.claudeEnvVars)) {
          vars.push({ key, value });
        }
      }
      setEnvVars(vars);
      setError(null);
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError('Failed to load settings');
    }
  };

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      // Get current settings first
      const currentSettings = await GetSettings();

      // Convert array back to map
      const envMap: Record<string, string> = {};
      for (const { key, value } of envVars) {
        if (key.trim()) {
          envMap[key.trim()] = value;
        }
      }

      // Create updated settings object
      const updatedSettings = new settings.Settings({
        ...currentSettings,
        claudeEnvVars: envMap,
      });

      await SaveSettings(updatedSettings);
      onClose();
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [envVars, onClose]);

  // CMD-S to save
  useSaveShortcut(isOpen, handleSave);

  const handleAddVar = () => {
    if (newKey.trim()) {
      // Check for duplicate keys
      if (envVars.some(v => v.key === newKey.trim())) {
        setError(`Key "${newKey.trim()}" already exists`);
        return;
      }
      setEnvVars([...envVars, { key: newKey.trim(), value: newValue }]);
      setNewKey('');
      setNewValue('');
      setError(null);
    }
  };

  const handleRemoveVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleUpdateVar = (index: number, field: 'key' | 'value', newVal: string) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: newVal };
    setEnvVars(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newKey.trim()) {
      e.preventDefault();
      handleAddVar();
    }
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </div>
      }
      width="650px"
      maxHeight="80vh"
    >
      {/* Content */}
      <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
        {/* Environment Variables Section */}
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.75rem'
          }}>
            <h3 style={{
              margin: 0,
              fontSize: '0.95rem',
              fontWeight: 600,
              color: '#ccc'
            }}>
              Claude CLI Environment Variables
            </h3>
          </div>

          <p style={{
            margin: '0 0 1rem 0',
            fontSize: '0.8rem',
            color: '#666',
            lineHeight: 1.5
          }}>
            These environment variables are passed to all Claude CLI processes.
            Useful for proxies (e.g., <code style={{
              background: '#0d0d0d',
              padding: '0.1rem 0.3rem',
              borderRadius: '3px',
              fontSize: '0.75rem'
            }}>ANTHROPIC_BASE_URL</code>).
          </p>

          {/* Existing Variables */}
          {envVars.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              {envVars.map((envVar, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    marginBottom: '0.5rem',
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="text"
                    value={envVar.key}
                    onChange={(e) => handleUpdateVar(index, 'key', e.target.value)}
                    placeholder="KEY"
                    style={{
                      width: '35%',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid #333',
                      background: '#0d0d0d',
                      color: '#fff',
                      fontSize: '0.85rem',
                      fontFamily: 'monospace',
                    }}
                  />
                  <span style={{ color: '#444' }}>=</span>
                  <input
                    type="text"
                    value={envVar.value}
                    onChange={(e) => handleUpdateVar(index, 'value', e.target.value)}
                    placeholder="value"
                    style={{
                      flex: 1,
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid #333',
                      background: '#0d0d0d',
                      color: '#fff',
                      fontSize: '0.85rem',
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    onClick={() => handleRemoveVar(index)}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '6px',
                      border: '1px solid #333',
                      background: 'transparent',
                      color: '#666',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#c53030';
                      e.currentTarget.style.color = '#c53030';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#333';
                      e.currentTarget.style.color = '#666';
                    }}
                    title="Remove"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add New Variable */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              padding: '0.75rem',
              background: '#151515',
              borderRadius: '8px',
              border: '1px solid #222',
            }}
          >
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="NEW_KEY"
              style={{
                width: '35%',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #333',
                background: '#0d0d0d',
                color: '#fff',
                fontSize: '0.85rem',
                fontFamily: 'monospace',
              }}
            />
            <span style={{ color: '#444' }}>=</span>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="value"
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #333',
                background: '#0d0d0d',
                color: '#fff',
                fontSize: '0.85rem',
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={handleAddVar}
              disabled={!newKey.trim()}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: 'none',
                background: newKey.trim() ? '#d97757' : '#333',
                color: newKey.trim() ? '#fff' : '#666',
                cursor: newKey.trim() ? 'pointer' : 'not-allowed',
                fontSize: '0.85rem',
                fontWeight: 500,
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: 'rgba(197, 48, 48, 0.1)',
            border: '1px solid #c53030',
            borderRadius: '6px',
            color: '#fc8181',
            fontSize: '0.85rem',
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          padding: '1rem 1.25rem',
          borderTop: '1px solid #333',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: '0.6rem 1.25rem',
            borderRadius: '6px',
            border: '1px solid #444',
            background: 'transparent',
            color: '#888',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: 500,
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            padding: '0.6rem 1.25rem',
            borderRadius: '6px',
            border: 'none',
            background: '#d97757',
            color: '#fff',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            fontSize: '0.9rem',
            fontWeight: 500,
            opacity: isSaving ? 0.7 : 1,
          }}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </DialogBase>
  );
}
