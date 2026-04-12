import { useState, useEffect, useMemo, useCallback } from 'react';
import { DialogBase } from './DialogBase';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import { useWorkspace } from '../hooks/useWorkspace';
import {
  GetMetaSchema, SaveMetaSchema,
  GetAllWorkspaceMeta, UpdateWorkspaceMeta,
  GetAllAgentMeta, UpdateAgentMeta,
  GetWorkspaceSifuFolder, SelectDirectory, SelectFile,
  GetWorkspaceAgentFolders, NormalizeDirPath,
  ReorderAgents, ReloadCurrentWorkspace,
} from '../../wailsjs/go/main/App';
import { workspace } from '../../wailsjs/go/models';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

type TabId = 'ws-schema' | 'agent-schema' | 'workspaces' | 'agents' | 'reorder' | 'cross-workspace';

interface WorkspaceMetaDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;  // Called after successful save — triggers agent refresh in parent
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

const READONLY_ATTRS = new Set(['WORKSPACE_ID', 'AGENT_ID', 'AGENT_FOLDER', 'AGENT_CLAUDE_PROJECT_FOLDER']);
const SYSTEM_WORKSPACE_ATTRS = new Set([
  'WORKSPACE_NAME', 'WORKSPACE_SLUG', 'WORKSPACE_ID',
  'WORKSPACE_SIFU_NAME', 'WORKSPACE_SIFU_SLUG',
]);
const SYSTEM_AGENT_ATTRS = new Set([
  'AGENT_SLUG', 'AGENT_ID',
  'AGENT_FOLDER', 'AGENT_CLAUDE_PROJECT_FOLDER',
]);
const AUTO_DERIVE: Record<string, string> = {
  WORKSPACE_NAME: 'WORKSPACE_SLUG',
  WORKSPACE_SIFU_NAME: 'WORKSPACE_SIFU_SLUG',
};

// Check if a workspace has any blank non-system meta values (needs attention)
function hasBlankMeta(info: workspace.WorkspaceInfo, schema: workspace.MetaSchema | null): boolean {
  if (!schema) return false;
  const customAttrs = schema.workspaceAttributes.filter(a => !a.system);
  if (customAttrs.length === 0) return false;
  return customAttrs.some(a => !info.meta?.[a.name]);
}

// Check if an agent has any blank custom meta values (needs attention)
function hasBlankAgentMeta(info: workspace.AgentInfo, schema: workspace.MetaSchema | null): boolean {
  if (!schema) return false;
  const customAttrs = schema.agentAttributes.filter(a => !a.system);
  if (customAttrs.length === 0) return false;
  return customAttrs.some(a => !info.meta?.[a.name]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkspaceMetaDialog({ isOpen, onClose, onSaved }: WorkspaceMetaDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('workspaces');
  const [schema, setSchema] = useState<workspace.MetaSchema | null>(null);
  const [workspaceInfos, setWorkspaceInfos] = useState<Record<string, workspace.WorkspaceInfo>>({});
  const [agentInfos, setAgentInfos] = useState<Record<string, workspace.AgentInfo>>({});
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Schema add-attribute state
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrType, setNewAttrType] = useState<string>('text');
  const [newAttrDesc, setNewAttrDesc] = useState('');

  // Workspace tab: dropdown selector
  const [selectedWsId, setSelectedWsId] = useState<string>('');
  const [wsDraft, setWsDraft] = useState<Record<string, string>>({});
  const [sifuFolder, setSifuFolder] = useState('');

  // Agent tab: dropdown selector + workspace filter
  const [selectedAgentFolder, setSelectedAgentFolder] = useState<string>('');
  const [agentDraft, setAgentDraft] = useState<Record<string, string>>({});
  const [agentWsFilter, setAgentWsFilter] = useState<string>('');
  const [wsAgentFolders, setWsAgentFolders] = useState<string[] | null>(null); // null = "all"

  // Reorder tab: local ordered copy of agents (committed on save)
  const [reorderList, setReorderList] = useState<{ id: string; slug: string; type: string }[]>([]);
  const [reorderDirty, setReorderDirty] = useState(false);

  // Cross-workspace tab: tracks toggled changes (folder → true/false)
  const [crossWsDraft, setCrossWsDraft] = useState<Record<string, boolean>>({});

  const { workspaceId, agents } = useWorkspace();

  // Saved indicator (2s green flash)
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  // Load all data on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);

    Promise.all([
      GetMetaSchema(),
      GetAllWorkspaceMeta(),
      GetAllAgentMeta(),
    ]).then(async ([schemaResult, wsResult, agResult]) => {
      setSchema(schemaResult);
      setWorkspaceInfos(wsResult);
      setAgentInfos(agResult);
      setWsDraft({});
      setAgentDraft({});

      // Auto-select current workspace
      if (wsResult[workspaceId]) {
        setSelectedWsId(workspaceId);
      } else {
        const ids = Object.keys(wsResult);
        setSelectedWsId(ids.length > 0 ? ids[0] : '');
      }

      // Default workspace filter to current workspace
      setAgentWsFilter(workspaceId || 'all');

      // Start with "Select Agent" (empty) — user picks from dropdown
      setSelectedAgentFolder('');

      // Initialize reorder list — auto-promote sifu to top if misplaced
      const mapped = agents.map(a => ({ id: a.id, slug: a.slug || a.id.slice(0, 8), type: a.type || 'agent' }));
      let sifuPromoted = false;
      if (mapped.length > 0 && mapped[0].type !== 'sifu') {
        const sifuIdx = mapped.findIndex(a => a.type === 'sifu');
        if (sifuIdx > 0) {
          const [sifu] = mapped.splice(sifuIdx, 1);
          mapped.unshift(sifu);
          sifuPromoted = true;
        }
      }
      setReorderList(mapped);
      setReorderDirty(false);

      // Auto-save sifu promotion (correction, not user choice)
      if (sifuPromoted) {
        ReorderAgents(mapped.map(a => a.id)).then(() => {
          ReloadCurrentWorkspace().then(() => onSaved?.());
        }).catch(err => console.error('Failed to auto-promote sifu:', err));
      }

      setLoading(false);
    }).catch(err => {
      console.error('Failed to load meta data:', err);
      setError('Failed to load data');
      setLoading(false);
    });
  }, [isOpen, workspaceId]);

  // Load sifu folder base path once when workspace changes
  useEffect(() => {
    if (!selectedWsId) { setSifuFolder(''); return; }
    GetWorkspaceSifuFolder(selectedWsId).then(setSifuFolder).catch(() => setSifuFolder(''));
  }, [selectedWsId]);

  // Clear drafts when selection changes
  useEffect(() => { setWsDraft({}); }, [selectedWsId]);
  useEffect(() => { setAgentDraft({}); }, [selectedAgentFolder]);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      // Save schema (only on schema/workspace/agent tabs — not cross-workspace or reorder)
      if (schema && activeTab !== 'cross-workspace' && activeTab !== 'reorder') {
        await SaveMetaSchema(schema);
      }

      // Save workspace draft if has changes — merge draft into existing meta
      if (selectedWsId && Object.keys(wsDraft).length > 0) {
        const existing = workspaceInfos[selectedWsId];
        if (existing) {
          const mergedMeta: Record<string, string> = { ...(existing.meta || {}), ...wsDraft };
          await UpdateWorkspaceMeta(selectedWsId, mergedMeta);
        }
      }

      // Save agent draft if has changes — merge ALL draft values into meta (system + custom)
      if (selectedAgentFolder && Object.keys(agentDraft).length > 0) {
        const existing = agentInfos[selectedAgentFolder];
        if (existing) {
          const meta: Record<string, string> = { ...(existing.meta || {}), ...agentDraft };
          // Remove read-only fields that shouldn't be saved (they're derived)
          delete meta['AGENT_ID'];
          delete meta['AGENT_FOLDER'];
          delete meta['AGENT_CLAUDE_PROJECT_FOLDER'];
          await UpdateAgentMeta(selectedAgentFolder, meta);
        }
      }

      // Save cross-workspace toggles
      if (Object.keys(crossWsDraft).length > 0) {
        for (const [folder, enabled] of Object.entries(crossWsDraft)) {
          const existing = agentInfos[folder];
          if (existing) {
            const meta: Record<string, string> = { ...(existing.meta || {}) };
            meta['AGENT_CROSS_WORKSPACE'] = enabled ? 'true' : '';
            delete meta['AGENT_ID'];
            delete meta['AGENT_FOLDER'];
            delete meta['AGENT_CLAUDE_PROJECT_FOLDER'];
            await UpdateAgentMeta(folder, meta);
          }
        }
      }

      // Save reorder if dirty
      if (reorderDirty) {
        await ReorderAgents(reorderList.map(a => a.id));
        setReorderDirty(false);
      }

      setSaved(true);
      onSaved?.(); // Trigger agent refresh in parent (App.tsx)

      // Reload data to reflect saved state
      const [wsResult, agResult] = await Promise.all([
        GetAllWorkspaceMeta(),
        GetAllAgentMeta(),
      ]);
      setWorkspaceInfos(wsResult);
      setAgentInfos(agResult);
      setWsDraft({});
      setAgentDraft({});
      setCrossWsDraft({});
    } catch (err: any) {
      const errMsg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
      console.error('WorkspaceMetaDialog save failed:', errMsg);
      setError(`Failed to save: ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  }, [schema, selectedWsId, wsDraft, selectedAgentFolder, agentDraft, workspaceInfos, agentInfos, reorderDirty, reorderList, crossWsDraft]);

  useSaveShortcut(isOpen, handleSave);

  // ---------------------------------------------------------------------------
  // Value getters/setters
  // ---------------------------------------------------------------------------

  const getWsValue = (attrName: string): string => {
    if (attrName in wsDraft) return wsDraft[attrName];
    const info = workspaceInfos[selectedWsId];
    if (!info) return '';
    if (attrName === 'WORKSPACE_ID') return info.id || '';
    return info.meta?.[attrName] || '';
  };

  // Derive sifu folder reactively from draft slug (updates on every keystroke)
  const derivedSifuFolder = useMemo(() => {
    if (!sifuFolder) return '';
    const draftSlug = getWsValue('WORKSPACE_SIFU_SLUG');
    if (!draftSlug) return '';
    const parts = sifuFolder.split('/');
    parts[parts.length - 1] = draftSlug;
    return parts.join('/');
  }, [sifuFolder, wsDraft, selectedWsId, workspaceInfos]);

  const setWsValue = (attrName: string, value: string) => {
    const newDraft = { ...wsDraft, [attrName]: value };
    // Auto-derive slug from name — only if slug hasn't been manually edited
    const deriveTo = AUTO_DERIVE[attrName];
    if (deriveTo) {
      const info = workspaceInfos[selectedWsId];
      // Get the original stored slug (not from draft)
      const originalSlug = info?.meta?.[deriveTo] || '';
      // Get the original source name to see if slug was auto-derived
      const originalSource = info?.meta?.[attrName] || '';
      const slugWasAutoDerived = !originalSlug || originalSlug === slugify(originalSource || '');
      // Only auto-derive if user hasn't manually customized the slug
      const slugManuallyEdited = deriveTo in wsDraft && wsDraft[deriveTo] !== slugify(wsDraft[attrName] || originalSource || '');
      if (slugWasAutoDerived && !slugManuallyEdited) {
        newDraft[deriveTo] = slugify(value);
      }
    }
    setWsDraft(newDraft);
  };

  const getAgentValue = (attrName: string): string => {
    if (attrName in agentDraft) return agentDraft[attrName];
    const info = agentInfos[selectedAgentFolder];
    if (!info) return '';
    switch (attrName) {
      case 'AGENT_ID': return info.id || '';
      case 'AGENT_FOLDER': return selectedAgentFolder;
      case 'AGENT_CLAUDE_PROJECT_FOLDER': {
        const encoded = selectedAgentFolder.replace(/[^a-zA-Z0-9]/g, '-');
        return `~/.claude/projects/${encoded}/`;
      }
      default: return info.meta?.[attrName] || '';
    }
  };

  const setAgentValue = (attrName: string, value: string) => {
    setAgentDraft(prev => ({ ...prev, [attrName]: value }));
  };

  // Load agent folders when workspace filter changes
  useEffect(() => {
    if (agentWsFilter === 'all') {
      setWsAgentFolders(null);
      return;
    }
    GetWorkspaceAgentFolders(agentWsFilter)
      .then(folders => setWsAgentFolders(folders))
      .catch(() => setWsAgentFolders([]));
  }, [agentWsFilter]);

  // Filtered agents for dropdown
  const filteredAgentFolders = useMemo(() => {
    const allFolders = Object.keys(agentInfos).sort();
    if (!wsAgentFolders) return allFolders;
    const folderSet = new Set(wsAgentFolders);
    return allFolders.filter(f => folderSet.has(f));
  }, [agentInfos, wsAgentFolders]);

  // ---------------------------------------------------------------------------
  // Schema tab handlers
  // ---------------------------------------------------------------------------

  const handleAddAttribute = (entityType: 'workspace' | 'agent') => {
    if (!schema || !newAttrName.trim()) return;
    const name = newAttrName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const finalName = entityType === 'agent' && !name.startsWith('AGENT_') ? `AGENT_${name}` : name;

    const list = entityType === 'workspace' ? schema.workspaceAttributes : schema.agentAttributes;
    if (list.some(a => a.name === finalName)) {
      setError(`Attribute "${finalName}" already exists`);
      return;
    }

    const attr = new workspace.MetaAttribute({
      name: finalName,
      type: newAttrType,
      description: newAttrDesc.trim() || finalName,
      system: false,
    });

    const updated = { ...schema };
    if (entityType === 'workspace') {
      updated.workspaceAttributes = [...schema.workspaceAttributes, attr];
    } else {
      updated.agentAttributes = [...schema.agentAttributes, attr];
    }
    setSchema(updated as workspace.MetaSchema);
    setNewAttrName('');
    setNewAttrDesc('');
    setError(null);
  };

  const handleRemoveAttribute = (entityType: 'workspace' | 'agent', name: string) => {
    if (!schema) return;
    const updated = { ...schema };
    if (entityType === 'workspace') {
      updated.workspaceAttributes = schema.workspaceAttributes.filter(a => a.name !== name);
    } else {
      updated.agentAttributes = schema.agentAttributes.filter(a => a.name !== name);
    }
    setSchema(updated as workspace.MetaSchema);
  };

  // ---------------------------------------------------------------------------
  // Render: attribute input field
  // ---------------------------------------------------------------------------

  const renderField = (
    attr: workspace.MetaAttribute,
    getValue: (name: string) => string,
    setValue: (name: string, value: string) => void,
  ) => {
    const isReadonly = READONLY_ATTRS.has(attr.name);
    const value = getValue(attr.name);

    return (
      <div key={attr.name} style={{ marginBottom: '0.75rem' }}>
        <label style={{
          display: 'flex', alignItems: 'baseline', gap: '0.5rem',
          fontSize: '0.7rem', fontWeight: 600, color: '#888',
          marginBottom: '0.25rem', letterSpacing: '0.03em',
        }}>
          <span>{attr.description || attr.name}</span>
          <span style={{ fontWeight: 400, color: '#444', fontFamily: 'monospace', fontSize: '0.6rem' }}>{attr.name}</span>
        </label>

        {attr.type === 'textarea' ? (
          <textarea
            value={value}
            onChange={e => setValue(attr.name, e.target.value)}
            readOnly={isReadonly}
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '0.5rem 0.6rem', borderRadius: '4px',
              border: `1px solid ${isReadonly ? '#222' : '#333'}`,
              background: isReadonly ? '#0a0a0a' : '#0d0d0d',
              color: isReadonly ? '#555' : '#ccc',
              fontSize: '0.8rem', fontFamily: 'monospace',
              resize: 'vertical', outline: 'none',
            }}
            onFocus={e => { if (!isReadonly) e.currentTarget.style.borderColor = '#d97757'; }}
            onBlur={e => { e.currentTarget.style.borderColor = isReadonly ? '#222' : '#333'; }}
          />
        ) : (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <input
              type="text"
              value={value}
              onChange={e => setValue(attr.name, e.target.value)}
              readOnly={isReadonly}
              style={{
                flex: 1, padding: '0.5rem 0.6rem', borderRadius: '4px',
                border: `1px solid ${isReadonly ? '#222' : '#333'}`,
                background: isReadonly ? '#0a0a0a' : '#0d0d0d',
                color: isReadonly ? '#555' : '#ccc',
                fontSize: '0.8rem', fontFamily: 'monospace', outline: 'none',
              }}
              onFocus={e => { if (!isReadonly) e.currentTarget.style.borderColor = '#d97757'; }}
              onBlur={e => { e.currentTarget.style.borderColor = isReadonly ? '#222' : '#333'; }}
            />
            {(attr.type === 'folder' || attr.type === 'file') && !isReadonly && (
              <button
                onClick={async () => {
                  try {
                    const selected = attr.type === 'folder'
                      ? await SelectDirectory('Select Folder')
                      : await SelectFile('Select File');
                    if (selected) {
                      const normalized = await NormalizeDirPath(selected);
                      setValue(attr.name, normalized);
                    }
                  } catch { /* cancelled */ }
                }}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: '4px',
                  border: '1px solid #333', background: '#1a1a1a',
                  color: '#888', cursor: 'pointer', fontSize: '0.75rem',
                  whiteSpace: 'nowrap',
                }}
              >
                Browse
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: schema attribute list
  // ---------------------------------------------------------------------------

  const renderSchemaList = (entityType: 'workspace' | 'agent', attrs: workspace.MetaAttribute[]) => (
    <div style={{ padding: '1rem' }}>
      {attrs.map(attr => (
        <div key={attr.name} style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.4rem 0.5rem', borderRadius: '4px',
          background: attr.system ? 'transparent' : '#111',
          marginBottom: '0.25rem',
        }}>
          {attr.system ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ) : (
            <span style={{ width: 12 }} />
          )}
          <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: attr.system ? '#555' : '#d97757', minWidth: '200px' }}>
            {attr.name}
          </span>
          <span style={{
            fontSize: '0.6rem', padding: '0.1rem 0.4rem', borderRadius: '3px',
            background: '#1a1a1a', color: '#666',
          }}>
            {attr.type}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#555', flex: 1 }}>
            {attr.description}
          </span>
          {!attr.system && (
            <button
              onClick={() => handleRemoveAttribute(entityType, attr.name)}
              style={{
                background: 'transparent', border: 'none', color: '#555',
                cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem',
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}

      {/* Add new attribute */}
      <div style={{ borderTop: '1px solid #222', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#888', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
          Add Custom Attribute
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newAttrName}
            onChange={e => setNewAttrName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            placeholder={entityType === 'agent' ? 'AGENT_ATTRIBUTE_NAME' : 'ATTRIBUTE_NAME'}
            style={{
              flex: 1, minWidth: '150px', padding: '0.4rem 0.6rem', borderRadius: '4px',
              border: '1px solid #333', background: '#0d0d0d', color: '#ccc',
              fontSize: '0.75rem', fontFamily: 'monospace',
            }}
          />
          <select
            value={newAttrType}
            onChange={e => setNewAttrType(e.target.value)}
            style={{
              padding: '0.4rem', borderRadius: '4px', border: '1px solid #333',
              background: '#0d0d0d', color: '#ccc', fontSize: '0.75rem',
            }}
          >
            <option value="text">text</option>
            <option value="textarea">textarea</option>
            <option value="folder">folder</option>
            <option value="file">file</option>
          </select>
          <input
            type="text"
            value={newAttrDesc}
            onChange={e => setNewAttrDesc(e.target.value)}
            placeholder="Description"
            style={{
              flex: 2, minWidth: '150px', padding: '0.4rem 0.6rem', borderRadius: '4px',
              border: '1px solid #333', background: '#0d0d0d', color: '#ccc',
              fontSize: '0.75rem',
            }}
          />
          <button
            onClick={() => handleAddAttribute(entityType)}
            disabled={!newAttrName.trim()}
            style={{
              padding: '0.4rem 0.75rem', borderRadius: '4px',
              border: 'none', background: newAttrName.trim() ? '#d97757' : '#333',
              color: '#fff', cursor: newAttrName.trim() ? 'pointer' : 'default',
              fontSize: '0.75rem', fontWeight: 600,
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: workspaces tab
  // ---------------------------------------------------------------------------

  const wsIds = useMemo(() =>
    Object.keys(workspaceInfos).sort((a, b) =>
      (workspaceInfos[a].meta?.WORKSPACE_NAME || '').localeCompare(workspaceInfos[b].meta?.WORKSPACE_NAME || '')
    ), [workspaceInfos]);

  const renderWorkspacesTab = () => {
    if (!schema) return null;

    return (
      <div style={{ padding: '1rem' }}>
        {/* Workspace selector dropdown */}
        <div style={{ marginBottom: '1rem' }}>
          <select
            value={selectedWsId}
            onChange={e => setSelectedWsId(e.target.value)}
            style={{
              width: '100%', height: '44px', padding: '0 0.75rem', borderRadius: '6px',
              border: '1px solid #333', background: '#151515', color: '#ccc',
              fontSize: '1rem', fontWeight: 500, outline: 'none',
              cursor: 'pointer',
            }}
          >
            {wsIds.map(id => {
              const info = workspaceInfos[id];
              const needsAttention = hasBlankMeta(info, schema);
              return (
                <option key={id} value={id}>
                  {info.meta?.WORKSPACE_NAME || id}{id === workspaceId ? ' (current)' : ''}{needsAttention ? ' *' : ''}
                </option>
              );
            })}
          </select>
        </div>

        {/* Fields for selected workspace */}
        {selectedWsId && (
          <div>
            {schema.workspaceAttributes.map(attr =>
              renderField(attr, getWsValue, setWsValue)
            )}

            {/* Derived Sifu Folder */}
            {derivedSifuFolder && (
              <div style={{ marginTop: '0.5rem' }}>
                <label style={{
                  display: 'block', fontSize: '0.7rem', fontWeight: 600,
                  color: '#888', marginBottom: '0.25rem', letterSpacing: '0.03em',
                }}>
                  Sifu Folder (derived)
                </label>
                <div style={{
                  padding: '0.5rem 0.6rem', borderRadius: '4px',
                  border: '1px solid #222', background: '#0a0a0a',
                  color: '#555', fontSize: '0.8rem', fontFamily: 'monospace',
                }}>
                  {derivedSifuFolder}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: agents tab
  // ---------------------------------------------------------------------------

  const renderAgentsTab = () => {
    if (!schema) return null;

    return (
      <div style={{ padding: '1rem' }}>
        {/* Filter + Agent selector row */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <select
            value={selectedAgentFolder}
            onChange={e => setSelectedAgentFolder(e.target.value)}
            style={{
              flex: 1, padding: '0.75rem 0.75rem', borderRadius: '6px',
              border: '1px solid #333', background: '#151515', color: '#ccc',
              fontSize: '1rem', fontWeight: 500, outline: 'none',
              appearance: 'auto', cursor: 'pointer',
            }}
          >
            <option value="">Select Agent</option>
            {filteredAgentFolders.map(folder => {
              const info = agentInfos[folder];
              const needsAttention = info ? hasBlankAgentMeta(info, schema) : true;
              const name = info?.meta?.AGENT_SLUG || folder.split('/').pop() || folder;
              return (
                <option key={folder} value={folder}>
                  {name}{needsAttention ? ' *' : ''}
                </option>
              );
            })}
          </select>

          <select
            value={agentWsFilter}
            onChange={e => {
              setAgentWsFilter(e.target.value);
              setSelectedAgentFolder(''); // Reset to "Select Agent"
              setAgentDraft({});
            }}
            style={{
              height: '44px', padding: '0 0.75rem', borderRadius: '6px',
              border: '1px solid #333', background: '#151515', color: '#888',
              fontSize: '0.8rem', outline: 'none', minWidth: '140px',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Agents</option>
            {Object.entries(workspaceInfos).map(([id, info]) => (
              <option key={id} value={id}>{info.meta?.WORKSPACE_NAME || id}</option>
            ))}
          </select>
        </div>

        {/* Fields for selected agent */}
        {selectedAgentFolder && (
          <div>
            {schema.agentAttributes.map(attr =>
              renderField(attr, getAgentValue, setAgentValue)
            )}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: reorder tab
  // ---------------------------------------------------------------------------

  const moveAgent = useCallback((index: number, direction: 'up' | 'down') => {
    setReorderList(prev => {
      const next = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      // Don't swap into/out of sifu position (index 0 if sifu)
      if (next[index].type === 'sifu' || next[targetIndex].type === 'sifu') return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
    setReorderDirty(true);
  }, []);

  const handleSaveReorder = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      await ReorderAgents(reorderList.map(a => a.id));
      // Reload workspace so context picks up the new order
      const ws = await ReloadCurrentWorkspace();
      if (ws) {
        setReorderList(ws.agents.map((a: any) => ({
          id: a.id, slug: a.slug || a.id.slice(0, 8), type: a.type || 'agent',
        })));
      }
      setReorderDirty(false);
      setSaved(true);
      onSaved?.();
    } catch (err: any) {
      const errMsg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
      console.error('WorkspaceMetaDialog reorder failed:', errMsg);
      setError(`Failed to reorder: ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  }, [reorderList, onSaved]);

  // ---------------------------------------------------------------------------
  // Cross-Workspace Tab
  // ---------------------------------------------------------------------------

  const renderCrossWorkspaceTab = () => {
    // Sort agents alphabetically by slug
    const sortedAgents = Object.entries(agentInfos)
      .filter(([, info]) => info.meta?.['AGENT_TYPE'] !== 'sifu') // Exclude sifu agents
      .sort(([, a], [, b]) => (a.meta?.['AGENT_SLUG'] || '').localeCompare(b.meta?.['AGENT_SLUG'] || ''));

    return (
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ fontSize: '0.8rem', color: '#666', lineHeight: 1.5 }}>
          Enable agents for cross-workspace messaging. Enabled agents are visible to <code style={{ color: '#d97757', fontSize: '0.8rem' }}>AgentMessage</code> from
          any workspace on any machine.
        </div>

        {sortedAgents.length === 0 ? (
          <div style={{ color: '#555', fontSize: '0.85rem', padding: '1rem', textAlign: 'center' }}>
            No agents registered.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {sortedAgents.map(([folder, info]) => {
              const slug = info.meta?.['AGENT_SLUG'] || folder.split('/').pop() || folder;
              const desc = info.meta?.['AGENT_DESCRIPTION'] || '';
              // Draft overrides stored value
              const isEnabled = crossWsDraft.hasOwnProperty(folder)
                ? crossWsDraft[folder]
                : (info.meta?.['AGENT_CROSS_WORKSPACE'] || '').toLowerCase() === 'true';

              return (
                <label
                  key={folder}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: isEnabled ? 'rgba(217, 119, 87, 0.08)' : 'transparent',
                    border: `1px solid ${isEnabled ? '#d9775733' : '#1a1a1a'}`,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = isEnabled ? 'rgba(217, 119, 87, 0.12)' : '#151515'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isEnabled ? 'rgba(217, 119, 87, 0.08)' : 'transparent'; }}
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => {
                      setCrossWsDraft(prev => ({ ...prev, [folder]: e.target.checked }));
                    }}
                    style={{ width: '16px', height: '16px', accentColor: '#d97757', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: isEnabled ? '#d97757' : '#ccc', fontWeight: 500, fontSize: '0.85rem' }}>
                      {slug}
                    </span>
                    {desc && (
                      <span style={{ color: '#555', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                        — {desc}
                      </span>
                    )}
                  </div>
                  <span style={{
                    fontSize: '0.65rem',
                    fontFamily: 'ui-monospace, monospace',
                    color: '#444',
                    flexShrink: 0,
                  }}>
                    {folder.split('/').slice(-2).join('/')}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderReorderTab = () => {
    // Find where non-sifu agents start
    const sifuCount = reorderList.filter(a => a.type === 'sifu').length;

    return (
      <div style={{ padding: '1rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.75rem' }}>
          Drag order determines sidebar position and CMD+{'{n}'} shortcuts.
          {sifuCount > 0 && ' Sifu agents are always pinned first.'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {reorderList.map((agent, index) => {
            const isSifu = agent.type === 'sifu';
            const isFirst = isSifu ? true : index === sifuCount;
            const isLast = index === reorderList.length - 1;

            return (
              <div
                key={agent.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.75rem', borderRadius: '6px',
                  background: isSifu ? 'rgba(217, 119, 87, 0.08)' : '#151515',
                  border: `1px solid ${isSifu ? 'rgba(217, 119, 87, 0.2)' : '#222'}`,
                }}
              >
                {/* Position number */}
                <span style={{
                  fontSize: '0.7rem', color: '#555', fontFamily: 'monospace',
                  minWidth: '1.2rem', textAlign: 'right',
                }}>
                  {index + 1}
                </span>

                {/* Agent slug */}
                <span style={{
                  flex: 1, fontSize: '0.85rem',
                  color: isSifu ? '#d97757' : '#ccc',
                  fontWeight: isSifu ? 600 : 400,
                }}>
                  {agent.slug}
                </span>

                {/* Sifu badge or up/down buttons */}
                {isSifu ? (
                  <span style={{
                    fontSize: '0.65rem', color: '#d97757', opacity: 0.6,
                    fontStyle: 'italic',
                  }}>
                    pinned
                  </span>
                ) : (
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button
                      onClick={() => moveAgent(index, 'up')}
                      disabled={isFirst}
                      style={{
                        width: '24px', height: '24px', borderRadius: '4px',
                        border: '1px solid #333', background: 'transparent',
                        color: isFirst ? '#333' : '#888',
                        cursor: isFirst ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', padding: 0,
                      }}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveAgent(index, 'down')}
                      disabled={isLast}
                      style={{
                        width: '24px', height: '24px', borderRadius: '4px',
                        border: '1px solid #333', background: 'transparent',
                        color: isLast ? '#333' : '#888',
                        cursor: isLast ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', padding: 0,
                      }}
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Apply button (only when dirty) */}
        {reorderDirty && (
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleSaveReorder}
              disabled={isSaving}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: '6px',
                border: 'none', background: '#d97757', color: '#fff',
                cursor: isSaving ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem', fontWeight: 500,
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? 'Saving...' : 'Apply Order'}
            </button>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  const tabs: { id: TabId; label: string }[] = [
    { id: 'ws-schema', label: 'Workspace Schema' },
    { id: 'agent-schema', label: 'Agent Schema' },
    { id: 'workspaces', label: 'Workspaces' },
    { id: 'agents', label: 'Agents' },
    { id: 'cross-workspace', label: 'Cross-Workspace' },
    { id: 'reorder', label: 'Reorder' },
  ];

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          Workspaces & Agents
        </div>
      }
      width="900px"
      height="700px"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: '0', borderBottom: '1px solid #222',
          flexShrink: 0, padding: '0 1rem',
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid #d97757' : '2px solid transparent',
                color: activeTab === tab.id ? '#d97757' : '#888',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: activeTab === tab.id ? 600 : 400,
                transition: 'color 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', textAlign: 'left' }}>
          {loading ? (
            <div style={{ padding: '2rem', color: '#666', textAlign: 'center' }}>Loading...</div>
          ) : (
            <>
              {activeTab === 'ws-schema' && schema && renderSchemaList('workspace', schema.workspaceAttributes)}
              {activeTab === 'agent-schema' && schema && renderSchemaList('agent', schema.agentAttributes)}
              {activeTab === 'workspaces' && renderWorkspacesTab()}
              {activeTab === 'agents' && renderAgentsTab()}
              {activeTab === 'cross-workspace' && renderCrossWorkspaceTab()}
              {activeTab === 'reorder' && renderReorderTab()}
            </>
          )}
        </div>

        {/* Footer with Save button (matches GlobalSettingsDialog pattern) */}
        <div style={{
          padding: '0.75rem 1rem', borderTop: '1px solid #222',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: '0.5rem', flexShrink: 0,
        }}>
          {error && (
            <span style={{ color: '#ef4444', fontSize: '0.75rem', marginRight: 'auto' }}>{error}</span>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem', borderRadius: '6px',
              border: '1px solid #333', background: 'transparent',
              color: '#888', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '0.5rem 1.25rem', borderRadius: '6px',
              border: 'none',
              background: saved ? '#16a34a' : '#d97757',
              color: '#fff',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem', fontWeight: 500,
              opacity: isSaving ? 0.7 : 1,
              display: 'flex', alignItems: 'center', gap: '0.4rem',
            }}
          >
            {saved ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </>
            ) : isSaving ? (
              'Saving...'
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
