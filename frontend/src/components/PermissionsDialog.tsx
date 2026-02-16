import { useState, useEffect, useCallback } from 'react';
import { DialogBase } from './DialogBase';
import {
  GetAgentPermissionsOrGlobal,
  SaveAgentPermissions,
  GetOrderedPermissionSets,
  HasExistingClaudeSettings,
  ImportFromClaudeSettings,
  SyncToClaudeSettings,
  RevertAgentToGlobal,
  HasAgentPermissions,
  GetGlobalDirectories,
  MergeToolsFromGlobal,
  EnableExperimentalFeature,
} from '../../wailsjs/go/main/App';
import { useSaveShortcut } from '../hooks';
import {
  ToolsTabContent,
  DirectoriesTabContent,
  ExperimentalTabContent,
  ClaudeFuPermissions,
  PermissionSet,
} from './permissions';

interface PermissionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;
}

type TabId = 'tools' | 'directories' | 'experimental';

export function PermissionsDialog({
  isOpen,
  onClose,
  folder,
}: PermissionsDialogProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('tools');

  // Permissions state
  const [permissions, setPermissions] = useState<ClaudeFuPermissions | null>(null);
  const [orderedSets, setOrderedSets] = useState<PermissionSet[]>([]);
  const [globalDirectories, setGlobalDirectories] = useState<string[]>([]);

  // Loading and saving state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Import banner state
  const [showImportBanner, setShowImportBanner] = useState(false);
  const [hasBlanketBash, setHasBlanketBash] = useState(false);

  // Load data when dialog opens
  useEffect(() => {
    if (isOpen && folder) {
      loadPermissions();
    }
  }, [isOpen, folder]);

  // Clear saved indicator after delay
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [saved]);

  const loadPermissions = async () => {
    setLoading(true);
    setError(null);
    setShowImportBanner(false);
    setHasBlanketBash(false);

    try {
      // Load global directories (for layered directory model)
      const globalDirs = await GetGlobalDirectories();
      setGlobalDirectories(globalDirs || []);

      // Load permission sets first
      const sets = await GetOrderedPermissionSets();
      // Convert Wails classes to plain objects
      const plainSets: PermissionSet[] = sets.map(s => ({
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

      // Check if agent has its own permissions
      const hasAgentPerms = await HasAgentPermissions(folder);

      if (!hasAgentPerms) {
        // No ClaudeFu permissions yet - check if Claude settings exist
        const hasClaudeSettings = await HasExistingClaudeSettings(folder);
        if (hasClaudeSettings) {
          setShowImportBanner(true);
        }
      }

      // Load permissions (will return global template if no agent-specific exists)
      const perms = await GetAgentPermissionsOrGlobal(folder);
      // Convert to plain object (v2 format - explicit tool arrays)
      const plainPerms: ClaudeFuPermissions = {
        version: perms.version || 2,
        inheritFromGlobal: perms.inheritFromGlobal,
        toolPermissions: perms.toolPermissions || {},
        additionalDirectories: perms.additionalDirectories || [],
        experimentalFeatures: perms.experimentalFeatures || {},
      };
      setPermissions(plainPerms);

      // Check for blanket Bash in claude-builtin yolo tier
      const builtinPerm = plainPerms.toolPermissions?.['claude-builtin'];
      const hasBlanket = builtinPerm?.yolo?.includes('Bash') || false;
      setHasBlanketBash(hasBlanket);
    } catch (err) {
      setError(`Failed to load permissions: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    if (!permissions) return;

    setSaving(true);
    setError(null);
    try {
      await SaveAgentPermissions(folder, permissions as any);
      setSaved(true);
    } catch (err) {
      setError(`Failed to save: ${err}`);
    } finally {
      setSaving(false);
    }
  }, [folder, permissions]);

  // CMD-S to save
  useSaveShortcut(isOpen, handleSave);

  // Handle import from Claude settings
  const handleImport = async () => {
    try {
      const result = await ImportFromClaudeSettings(folder);
      if (result.found && result.imported) {
        // Convert to plain object (v2 format)
        const plainPerms: ClaudeFuPermissions = {
          version: result.imported.version || 2,
          inheritFromGlobal: result.imported.inheritFromGlobal,
          toolPermissions: result.imported.toolPermissions || {},
          additionalDirectories: result.imported.additionalDirectories || [],
        };
        setPermissions(plainPerms);
        setShowImportBanner(false);
        setHasBlanketBash(result.hasBlanketBash || false);
      }
    } catch (err) {
      setError(`Failed to import: ${err}`);
    }
  };

  // Handle sync to Claude settings
  const handleSyncToClaude = async () => {
    try {
      // Save first to ensure we're syncing latest
      if (permissions) {
        await SaveAgentPermissions(folder, permissions as any);
      }
      await SyncToClaudeSettings(folder);
      setSaved(true);
    } catch (err) {
      setError(`Failed to sync: ${err}`);
    }
  };

  // Handle revert to global (only resets tools, preserves directories)
  const handleRevertToGlobal = async () => {
    try {
      await RevertAgentToGlobal(folder);
      // Reload permissions
      await loadPermissions();
    } catch (err) {
      setError(`Failed to revert: ${err}`);
    }
  };

  // Handle merge from global (additive - adds global tools without removing agent's)
  const handleMergeFromGlobal = async () => {
    try {
      await MergeToolsFromGlobal(folder);
      // Reload permissions
      await loadPermissions();
    } catch (err) {
      setError(`Failed to merge: ${err}`);
    }
  };

  // Handle convert blanket bash to permission sets (v2 format)
  const handleConvertBlanketBash = () => {
    if (!permissions) return;

    // Build new tool permissions with common + permissive enabled for all sets
    // and remove Bash from claude-builtin's yolo tier
    const newToolPermissions = { ...permissions.toolPermissions };

    orderedSets.forEach(set => {
      const currentPerm = newToolPermissions[set.id] || { common: [], permissive: [], yolo: [] };

      if (set.id === 'claude-builtin') {
        // Remove Bash from yolo tier
        newToolPermissions[set.id] = {
          common: [...set.permissions.common],
          permissive: [...set.permissions.permissive],
          yolo: (currentPerm.yolo || []).filter((t: string) => t !== 'Bash'),
        };
      } else {
        // Enable common + permissive for other sets
        newToolPermissions[set.id] = {
          common: [...set.permissions.common],
          permissive: [...set.permissions.permissive],
          yolo: [], // Don't enable yolo by default
        };
      }
    });

    setPermissions({
      ...permissions,
      toolPermissions: newToolPermissions,
    });
    setHasBlanketBash(false);
  };

  // Handle permissions change from ToolsTabContent
  const handlePermissionsChange = (newPerms: ClaudeFuPermissions) => {
    setPermissions(newPerms);
  };

  // Handle directories change
  const handleDirectoriesChange = (dirs: string[]) => {
    if (!permissions) return;
    setPermissions({
      ...permissions,
      additionalDirectories: dirs,
    });
  };

  // Handle experimental feature toggle
  const handleToggleExperimentalFeature = async (featureId: string, enabled: boolean) => {
    try {
      await EnableExperimentalFeature(folder, featureId, enabled);
      // Reload permissions to reflect the change
      await loadPermissions();
    } catch (err) {
      setError(`Failed to toggle feature: ${err}`);
    }
  };

  // Extract folder name for title
  const folderName = folder.split('/').pop() || folder;

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={`Permissions: ${folderName}`}
      width="900px"
      height="700px"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab Bar */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #333',
          background: '#0d0d0d',
          flexShrink: 0,
        }}>
          {(['tools', 'directories', 'experimental'] as TabId[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '0.6rem 1.25rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #d97757' : '2px solid transparent',
                color: activeTab === tab ? '#fff' : '#666',
                fontSize: '0.8rem',
                fontWeight: activeTab === tab ? 500 : 400,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ padding: '2rem', color: '#666', textAlign: 'center' }}>
              Loading permissions...
            </div>
          ) : error ? (
            <div style={{ padding: '1rem', color: '#f87171', fontSize: '0.85rem' }}>
              {error}
            </div>
          ) : permissions ? (
            <>
              {activeTab === 'tools' && (
                <ToolsTabContent
                  permissions={permissions}
                  onChange={handlePermissionsChange}
                  orderedSets={orderedSets}
                  showImportBanner={showImportBanner}
                  onImportClick={handleImport}
                  showBlanketBashWarning={hasBlanketBash}
                  onConvertBlanketBash={handleConvertBlanketBash}
                  onMergeFromGlobal={handleMergeFromGlobal}
                  onReplaceWithGlobal={handleRevertToGlobal}
                  onImportFromClaude={handleImport}
                  onSyncToClaude={handleSyncToClaude}
                />
              )}
              {activeTab === 'directories' && (
                <DirectoriesTabContent
                  globalDirectories={globalDirectories}
                  agentDirectories={permissions.additionalDirectories || []}
                  onChange={handleDirectoriesChange}
                />
              )}
              {activeTab === 'experimental' && (
                <ExperimentalTabContent
                  folder={folder}
                  experimentalFeatures={permissions.experimentalFeatures || {}}
                  onToggleFeature={handleToggleExperimentalFeature}
                />
              )}
            </>
          ) : null}
        </div>

        {/* Footer - only Save button (action buttons moved to Tools tab) */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid #333',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '0.5rem 1.25rem',
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
              'Save'
            )}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
