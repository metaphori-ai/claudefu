import { useState, useEffect } from 'react';
import { DialogBase } from './DialogBase';
import { GetClaudeMD, SaveClaudeMD } from '../../wailsjs/go/main/App';

interface ClaudeSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;  // Agent folder for CLAUDE.md location
}

export function ClaudeSettingsDialog({
  isOpen,
  onClose,
  folder,
}: ClaudeSettingsDialogProps) {
  // CLAUDE.md state
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Load data when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadClaudeMD();
    }
  }, [isOpen, folder]);

  // Clear saved indicator after delay
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  const loadClaudeMD = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await GetClaudeMD(folder);
      setContent(data);
    } catch (err) {
      // File might not exist, which is fine
      setContent('');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await SaveClaudeMD(folder, content);
      setSaved(true);
    } catch (err) {
      setError(`Failed to save: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title="CLAUDE.md"
      width="700px"
      height="600px"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header with path */}
        <div style={{
          padding: '0.5rem 1rem',
          borderBottom: '1px solid #333',
          background: '#1a1a1a',
        }}>
          <div style={{
            fontSize: '0.7rem',
            color: '#666',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {folder}/CLAUDE.md
          </div>
        </div>

        {/* Editor */}
        <div style={{ flex: 1, padding: '0.5rem', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '1rem', color: '#666', textAlign: 'center' }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ padding: '1rem', color: '#f87171', fontSize: '0.85rem' }}>
              {error}
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# Project Instructions&#10;&#10;Add custom instructions for Claude here..."
              style={{
                width: '100%',
                height: '100%',
                padding: '0.75rem',
                borderRadius: '6px',
                border: '1px solid #333',
                background: '#0d0d0d',
                color: '#ccc',
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                lineHeight: 1.5,
                resize: 'none',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => e.target.style.borderColor = '#f97316'}
              onBlur={(e) => e.target.style.borderColor = '#333'}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid #333',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: saved ? '#16a34a' : '#f97316',
              color: '#fff',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            {saved ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </>
            ) : saving ? (
              'Saving...'
            ) : (
              'Save CLAUDE.md'
            )}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
