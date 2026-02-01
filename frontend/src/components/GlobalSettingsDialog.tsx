import { useState, useEffect, useCallback } from 'react';
import { DialogBase } from './DialogBase';
import { useSaveShortcut } from '../hooks';
import {
  GetSettings,
  SaveSettings,
  GetGlobalPermissions,
  SaveGlobalPermissions,
  GetOrderedPermissionSets,
  GetGlobalClaudeMD,
  SaveGlobalClaudeMD,
  GetDefaultTemplateMD,
  SaveDefaultTemplateMD,
} from '../../wailsjs/go/main/App';
import { settings } from '../../wailsjs/go/models';
import {
  ToolsTabContent,
  DirectoriesTabContent,
  ClaudeFuPermissions,
  PermissionSet,
} from './permissions';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface GlobalSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EnvVar {
  key: string;
  value: string;
}

type TabId = 'env' | 'tools' | 'directories' | 'global-claude-md' | 'default-claude-md';

export function GlobalSettingsDialog({ isOpen, onClose }: GlobalSettingsDialogProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('env');

  // Environment Variables state
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // Global Permissions state
  const [globalPermissions, setGlobalPermissions] = useState<ClaudeFuPermissions | null>(null);
  const [orderedSets, setOrderedSets] = useState<PermissionSet[]>([]);

  // CLAUDE.md state
  const [globalClaudeMD, setGlobalClaudeMD] = useState('');
  const [defaultTemplateMD, setDefaultTemplateMD] = useState('');
  const [claudeMDViewMode, setClaudeMDViewMode] = useState<'edit' | 'preview'>('edit');
  const [mdSaved, setMdSaved] = useState(false);

  // Shared state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load settings when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadAllSettings();
    }
  }, [isOpen]);

  // Clear saved indicator
  useEffect(() => {
    if (mdSaved) {
      const timer = setTimeout(() => setMdSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [mdSaved]);

  const loadAllSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResult, permSetsResult, globalPermsResult] = await Promise.all([
        GetSettings(),
        GetOrderedPermissionSets(),
        GetGlobalPermissions(),
      ]);

      // Load CLAUDE.md files separately — these are non-critical
      let globalMD = '';
      let defaultMD = '';
      try { globalMD = await GetGlobalClaudeMD(); } catch { /* ok */ }
      try { defaultMD = await GetDefaultTemplateMD(); } catch { /* ok */ }

      // Convert settings env vars map to array
      const vars: EnvVar[] = [];
      if (settingsResult.claudeEnvVars) {
        for (const [key, value] of Object.entries(settingsResult.claudeEnvVars)) {
          vars.push({ key, value });
        }
      }
      setEnvVars(vars);

      // Convert permission sets to plain objects
      const plainSets: PermissionSet[] = permSetsResult.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        permissions: {
          common: s.permissions?.common || [],
          permissive: s.permissions?.permissive || [],
          yolo: s.permissions?.yolo || [],
        },
      }));
      setOrderedSets(plainSets);

      // Convert global permissions to plain object (v2 format)
      const plainPerms: ClaudeFuPermissions = {
        version: globalPermsResult.version || 2,
        inheritFromGlobal: globalPermsResult.inheritFromGlobal,
        toolPermissions: globalPermsResult.toolPermissions || {},
        additionalDirectories: globalPermsResult.additionalDirectories || [],
      };
      setGlobalPermissions(plainPerms);

      setGlobalClaudeMD(globalMD);
      setDefaultTemplateMD(defaultMD);
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      // CLAUDE.md tabs save independently
      if (activeTab === 'global-claude-md') {
        await SaveGlobalClaudeMD(globalClaudeMD);
        setMdSaved(true);
      } else if (activeTab === 'default-claude-md') {
        await SaveDefaultTemplateMD(defaultTemplateMD);
        setMdSaved(true);
      } else {
        // Save env + permissions for non-MD tabs
        const currentSettings = await GetSettings();
        const envMap: Record<string, string> = {};
        for (const { key, value } of envVars) {
          if (key.trim()) {
            envMap[key.trim()] = value;
          }
        }
        const updatedSettings = new settings.Settings({
          ...currentSettings,
          claudeEnvVars: envMap,
        });
        await Promise.all([
          SaveSettings(updatedSettings),
          globalPermissions ? SaveGlobalPermissions(globalPermissions as any) : Promise.resolve(),
        ]);
        onClose();
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [activeTab, envVars, globalPermissions, globalClaudeMD, defaultTemplateMD, onClose]);

  // CMD-S to save
  useSaveShortcut(isOpen, handleSave);

  const handleAddVar = () => {
    if (newKey.trim()) {
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

  const handlePermissionsChange = (newPerms: ClaudeFuPermissions) => {
    setGlobalPermissions(newPerms);
  };

  const handleDirectoriesChange = (dirs: string[]) => {
    if (!globalPermissions) return;
    setGlobalPermissions({
      ...globalPermissions,
      additionalDirectories: dirs,
    });
  };

  const isMDTab = activeTab === 'global-claude-md' || activeTab === 'default-claude-md';

  const renderEnvVarsTab = () => (
    <div style={{ padding: '1rem' }}>
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
  );

  const renderClaudeMDTab = (mdContent: string, setMdContent: (v: string) => void, pathLabel: string) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Path + view toggle */}
      <div style={{
        padding: '0.5rem 1rem',
        borderBottom: '1px solid #333',
        background: '#1a1a1a',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: '0.7rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pathLabel}
        </div>
        <div style={{ display: 'flex', gap: '2px', background: '#0d0d0d', borderRadius: '4px', padding: '2px' }}>
          <button
            onClick={() => setClaudeMDViewMode('edit')}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '3px',
              border: 'none',
              background: claudeMDViewMode === 'edit' ? '#333' : 'transparent',
              color: claudeMDViewMode === 'edit' ? '#fff' : '#666',
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
            onClick={() => setClaudeMDViewMode('preview')}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '3px',
              border: 'none',
              background: claudeMDViewMode === 'preview' ? '#333' : 'transparent',
              color: claudeMDViewMode === 'preview' ? '#fff' : '#666',
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
        {claudeMDViewMode === 'edit' ? (
          <textarea
            value={mdContent}
            onChange={(e) => setMdContent(e.target.value)}
            placeholder="# Instructions&#10;&#10;Add instructions here..."
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
            {mdContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {mdContent}
              </ReactMarkdown>
            ) : (
              <div style={{ color: '#666', fontStyle: 'italic' }}>
                No content to preview
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: 'env', label: 'Environment' },
    { id: 'tools', label: 'Tools' },
    { id: 'directories', label: 'Directories' },
    { id: 'global-claude-md', label: 'Global CLAUDE.md' },
    { id: 'default-claude-md', label: 'Default CLAUDE.md' },
  ];

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
          Global Settings
        </div>
      }
      width="900px"
      height="700px"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #333',
          background: '#0d0d0d',
          flexShrink: 0,
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setMdSaved(false); }}
              style={{
                padding: '0.6rem 1.25rem',
                border: 'none',
                background: 'transparent',
                color: activeTab === tab.id ? '#fff' : '#666',
                borderBottom: activeTab === tab.id ? '2px solid #d97757' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: activeTab === tab.id ? 500 : 400,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ padding: '2rem', color: '#666', textAlign: 'center' }}>
              Loading settings...
            </div>
          ) : (
            <>
              {activeTab === 'env' && renderEnvVarsTab()}
              {activeTab === 'tools' && globalPermissions && (
                <ToolsTabContent
                  permissions={globalPermissions}
                  onChange={handlePermissionsChange}
                  orderedSets={orderedSets}
                />
              )}
              {activeTab === 'directories' && globalPermissions && (
                <DirectoriesTabContent
                  globalDirectories={[]}
                  agentDirectories={globalPermissions.additionalDirectories || []}
                  onChange={handleDirectoriesChange}
                />
              )}
              {activeTab === 'global-claude-md' && renderClaudeMDTab(
                globalClaudeMD, setGlobalClaudeMD, '~/.claude/CLAUDE.md'
              )}
              {activeTab === 'default-claude-md' && renderClaudeMDTab(
                defaultTemplateMD, setDefaultTemplateMD, '~/.claudefu/default-templates/CLAUDE.md'
              )}
            </>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            margin: '0.75rem 1rem',
            padding: '0.75rem',
            background: 'rgba(197, 48, 48, 0.1)',
            border: '1px solid #c53030',
            borderRadius: '6px',
            color: '#fc8181',
            fontSize: '0.85rem',
            flexShrink: 0,
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            borderTop: '1px solid #333',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid #444',
              background: 'transparent',
              color: '#888',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              background: mdSaved ? '#16a34a' : '#d97757',
              color: '#fff',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
              opacity: isSaving ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            {mdSaved ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </>
            ) : isSaving ? (
              'Saving...'
            ) : isMDTab ? (
              'Save CLAUDE.md'
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
