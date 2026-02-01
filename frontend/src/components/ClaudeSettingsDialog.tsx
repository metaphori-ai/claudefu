import { useState, useEffect, useCallback } from 'react';
import { DialogBase } from './DialogBase';
import { GetClaudeMD, SaveClaudeMD, GetGlobalClaudeMD, SaveGlobalClaudeMD } from '../../wailsjs/go/main/App';
import { useSaveShortcut } from '../hooks';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ClaudeSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;  // Agent folder for CLAUDE.md location
  agentName?: string;  // Agent display name for title
}

export function ClaudeSettingsDialog({
  isOpen,
  onClose,
  folder,
  agentName,
}: ClaudeSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<'local' | 'global'>('local');
  const [localContent, setLocalContent] = useState('');
  const [globalContent, setGlobalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');

  // Load data when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadBoth();
    }
  }, [isOpen, folder]);

  // Clear saved indicator after delay
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  const loadBoth = async () => {
    setLoading(true);
    setError(null);
    try {
      let local = '';
      let global = '';
      try { local = await GetClaudeMD(folder); } catch { /* ok */ }
      try { global = await GetGlobalClaudeMD(); } catch { /* ok */ }
      setLocalContent(local);
      setGlobalContent(global);
    } finally {
      setLoading(false);
    }
  };

  const content = activeTab === 'local' ? localContent : globalContent;
  const setContent = activeTab === 'local' ? setLocalContent : setGlobalContent;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      if (activeTab === 'local') {
        await SaveClaudeMD(folder, localContent);
      } else {
        await SaveGlobalClaudeMD(globalContent);
      }
      setSaved(true);
    } catch (err) {
      setError(`Failed to save: ${err}`);
    } finally {
      setSaving(false);
    }
  }, [activeTab, folder, localContent, globalContent]);

  // CMD-S to save
  useSaveShortcut(isOpen, handleSave);

  const displayTitle = agentName ? `${agentName} // CLAUDE.md` : 'CLAUDE.md';
  const pathDisplay = activeTab === 'local' ? `${folder}/CLAUDE.md` : '~/.claude/CLAUDE.md';

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={displayTitle}
      width="850px"
      height="600px"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab Bar */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #333',
          background: '#0d0d0d',
          flexShrink: 0,
        }}>
          {(['local', 'global'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSaved(false); }}
              style={{
                padding: '0.6rem 1.25rem',
                border: 'none',
                background: 'transparent',
                color: activeTab === tab ? '#fff' : '#666',
                borderBottom: activeTab === tab ? '2px solid #d97757' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: activeTab === tab ? 500 : 400,
              }}
            >
              {tab === 'local' ? 'Local' : 'Global'}
            </button>
          ))}
        </div>

        {/* Header with path and view toggle */}
        <div style={{
          padding: '0.5rem 1rem',
          borderBottom: '1px solid #333',
          background: '#1a1a1a',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{
            fontSize: '0.7rem',
            color: '#666',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {pathDisplay}
          </div>
          {/* View Mode Toggle */}
          <div style={{ display: 'flex', gap: '2px', background: '#0d0d0d', borderRadius: '4px', padding: '2px' }}>
            <button
              onClick={() => setViewMode('edit')}
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '3px',
                border: 'none',
                background: viewMode === 'edit' ? '#333' : 'transparent',
                color: viewMode === 'edit' ? '#fff' : '#666',
                fontSize: '0.7rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
            <button
              onClick={() => setViewMode('preview')}
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '3px',
                border: 'none',
                background: viewMode === 'preview' ? '#333' : 'transparent',
                color: viewMode === 'preview' ? '#fff' : '#666',
                fontSize: '0.7rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Preview
            </button>
          </div>
        </div>

        {/* Editor or Preview */}
        <div style={{ flex: 1, padding: '0.5rem', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '1rem', color: '#666', textAlign: 'center' }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ padding: '1rem', color: '#f87171', fontSize: '0.85rem' }}>
              {error}
            </div>
          ) : viewMode === 'edit' ? (
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
              onFocus={(e) => e.target.style.borderColor = '#d97757'}
              onBlur={(e) => e.target.style.borderColor = '#333'}
            />
          ) : (
            <div
              className="markdown-content"
              style={{
                width: '100%',
                height: '100%',
                padding: '0.75rem',
                borderRadius: '6px',
                border: '1px solid #333',
                background: '#0d0d0d',
                color: '#ccc',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                overflow: 'auto',
                boxSizing: 'border-box',
                textAlign: 'left',
              }}
            >
              {content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              ) : (
                <div style={{ color: '#666', fontStyle: 'italic' }}>
                  No content to preview
                </div>
              )}
            </div>
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
              background: saved ? '#16a34a' : '#d97757',
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
