import { useState, useMemo } from 'react';
import {
  PermissionSet,
  ClaudeFuPermissions,
  RiskTier,
  ToolPermission,
} from './types';
import { PresetListItem } from './PresetListItem';
import { RiskLevelGroup } from './RiskLevelGroup';

interface ToolsTabContentProps {
  permissions: ClaudeFuPermissions;
  onChange: (perms: ClaudeFuPermissions) => void;
  orderedSets: PermissionSet[];
  showImportBanner?: boolean;
  onImportClick?: () => void;
  showBlanketBashWarning?: boolean;
  onConvertBlanketBash?: () => void;
  // Action buttons (tools-only operations)
  onMergeFromGlobal?: () => void;
  onReplaceWithGlobal?: () => void;
  onImportFromClaude?: () => void;
  onSyncToClaude?: () => void;
}

// Helper to ensure we have a valid ToolPermission object
function ensureToolPermission(perm: ToolPermission | undefined): ToolPermission {
  return perm ?? { common: [], permissive: [], yolo: [] };
}

// Action button component
function ActionButton({
  onClick,
  icon,
  label,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '0.4rem 0.65rem',
        borderRadius: '4px',
        border: '1px solid #444',
        background: 'transparent',
        color: '#888',
        fontSize: '0.7rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#666';
        e.currentTarget.style.color = '#ccc';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#444';
        e.currentTarget.style.color = '#888';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// SVG Icons
const MergeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M6 21V9a9 9 0 0 0 9 9" />
  </svg>
);

const ReplaceIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

const ImportIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SyncIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

export function ToolsTabContent({
  permissions,
  onChange,
  orderedSets,
  showImportBanner,
  onImportClick,
  showBlanketBashWarning,
  onConvertBlanketBash,
  onMergeFromGlobal,
  onReplaceWithGlobal,
  onImportFromClaude,
  onSyncToClaude,
}: ToolsTabContentProps) {
  // Selected preset in the left sidebar
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    orderedSets.length > 0 ? orderedSets[0].id : ''
  );

  // Get the currently selected preset
  const selectedPreset = useMemo(() => {
    return orderedSets.find(s => s.id === selectedPresetId) || null;
  }, [selectedPresetId, orderedSets]);

  // Get the current ToolPermission for a preset (v2: explicit arrays)
  const getToolPermission = (presetId: string): ToolPermission => {
    return ensureToolPermission(permissions.toolPermissions?.[presetId]);
  };

  // Get all permissions enabled across all presets (for display)
  // V2: Simply iterate through all arrays
  const enabledPermissions = useMemo(() => {
    const enabled = new Set<string>();

    for (const toolPerm of Object.values(permissions.toolPermissions || {})) {
      const perm = ensureToolPermission(toolPerm);
      perm.common.forEach(p => enabled.add(p));
      perm.permissive.forEach(p => enabled.add(p));
      perm.yolo.forEach(p => enabled.add(p));
    }

    return enabled;
  }, [permissions]);

  // Handle toggling all permissions in a tier for the selected preset
  // V2: Directly set or clear the tier array
  const handleToggleTier = (tier: RiskTier, enable: boolean) => {
    if (!selectedPreset) return;

    const set = orderedSets.find(s => s.id === selectedPreset.id);
    if (!set) return;

    const current = getToolPermission(selectedPreset.id);

    // For Custom set, enabling is a no-op (permissions are already enabled)
    // Disabling clears all user-defined permissions in this tier
    let newTierArray: string[];
    if (selectedPreset.id === 'custom') {
      if (enable) {
        // Keep existing custom permissions (no-op)
        newTierArray = current[tier] || [];
      } else {
        // Clear all custom permissions in this tier
        newTierArray = [];
      }
    } else {
      // For built-in sets, use the set definition
      newTierArray = enable ? [...set.permissions[tier]] : [];
    }

    onChange({
      ...permissions,
      toolPermissions: {
        ...permissions.toolPermissions,
        [selectedPreset.id]: {
          ...current,
          [tier]: newTierArray,
        },
      },
    });
  };

  // Handle toggling a single permission
  // V2: Direct array manipulation - add or remove from the appropriate tier
  const handleToggleSingle = (permission: string, tier: RiskTier) => {
    if (!selectedPreset) return;

    const current = getToolPermission(selectedPreset.id);
    const tierArray = current[tier];
    const isEnabled = tierArray.includes(permission);

    const newTierArray = isEnabled
      ? tierArray.filter(p => p !== permission)  // Remove
      : [...tierArray, permission];              // Add

    onChange({
      ...permissions,
      toolPermissions: {
        ...permissions.toolPermissions,
        [selectedPreset.id]: {
          ...current,
          [tier]: newTierArray,
        },
      },
    });
  };

  // Get permissions for a tier from a preset's definition (available tools)
  // For Custom set, return what's in toolPermissions (user-defined)
  const getTierPermissions = (preset: PermissionSet, tier: RiskTier): string[] => {
    // For Custom set, the "available" permissions ARE what the user has added
    if (preset.id === 'custom') {
      const customPerms = permissions.toolPermissions?.['custom'];
      if (customPerms) {
        return customPerms[tier] || [];
      }
      return [];
    }
    if (!preset.permissions) return [];
    return preset.permissions[tier] || [];
  };

  // Handle adding a custom permission to the Custom set
  const handleAddCustomPermission = (permission: string, tier: RiskTier) => {
    const current = getToolPermission('custom');
    const tierArray = current[tier] || [];

    // Don't add duplicates
    if (tierArray.includes(permission)) return;

    onChange({
      ...permissions,
      toolPermissions: {
        ...permissions.toolPermissions,
        ['custom']: {
          ...current,
          [tier]: [...tierArray, permission],
        },
      },
    });
  };

  // Handle removing a custom permission from the Custom set
  const handleRemoveCustomPermission = (permission: string) => {
    const current = getToolPermission('custom');

    // Find which tier contains this permission and remove it
    const newCustom = { ...current };
    for (const tier of ['common', 'permissive', 'yolo'] as RiskTier[]) {
      const tierArray = newCustom[tier] || [];
      if (tierArray.includes(permission)) {
        newCustom[tier] = tierArray.filter(p => p !== permission);
        break;
      }
    }

    onChange({
      ...permissions,
      toolPermissions: {
        ...permissions.toolPermissions,
        ['custom']: newCustom,
      },
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Left Sidebar - Preset List */}
      <div style={{
        width: '200px',
        borderRight: '1px solid #333',
        overflow: 'auto',
        flexShrink: 0,
        background: '#0d0d0d',
      }}>
        {/* Presets header */}
        <div style={{
          padding: '0.75rem',
          borderBottom: '1px solid #222',
          fontSize: '0.7rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#666',
          fontWeight: 600,
        }}>
          Permission Sets
        </div>

        {/* Preset list */}
        {orderedSets.map(preset => (
          <PresetListItem
            key={preset.id}
            preset={preset}
            isSelected={selectedPresetId === preset.id}
            toolPermission={getToolPermission(preset.id)}
            onClick={() => setSelectedPresetId(preset.id)}
          />
        ))}
      </div>

      {/* Right Content - Permission Details */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Warning banners */}
        <div style={{ flexShrink: 0 }}>
          {/* Import banner */}
          {showImportBanner && onImportClick && (
            <div style={{
              padding: '0.6rem 0.8rem',
              margin: '0.75rem',
              marginBottom: 0,
              background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2744 100%)',
              border: '1px solid #2563eb',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
            }}>
              <span style={{ fontSize: '1rem' }}>📥</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 600 }}>
                  Existing permissions found
                </div>
                <div style={{ fontSize: '0.65rem', color: '#93c5fd', marginTop: '0.15rem' }}>
                  Import from Claude's settings.local.json
                </div>
              </div>
              <button
                onClick={onImportClick}
                style={{
                  padding: '0.35rem 0.65rem',
                  borderRadius: '4px',
                  border: 'none',
                  background: '#3b82f6',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Import
              </button>
            </div>
          )}

          {/* Blanket Bash warning */}
          {showBlanketBashWarning && onConvertBlanketBash && (
            <div style={{
              padding: '0.6rem 0.8rem',
              margin: '0.75rem',
              marginBottom: 0,
              background: 'linear-gradient(135deg, #422006 0%, #451a03 100%)',
              border: '1px solid #713f12',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
            }}>
              <span style={{ fontSize: '1rem' }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 600 }}>
                  Blanket "Bash" permission detected
                </div>
                <div style={{ fontSize: '0.65rem', color: '#d4a574', marginTop: '0.15rem' }}>
                  Consider using Permission Sets for safer, granular control
                </div>
              </div>
              <button
                onClick={onConvertBlanketBash}
                style={{
                  padding: '0.35rem 0.65rem',
                  borderRadius: '4px',
                  border: 'none',
                  background: '#d97757',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Convert to Sets
              </button>
            </div>
          )}

          {/* Action buttons row (tools-only operations) */}
          <div style={{
            display: 'flex',
            gap: '0.5rem',
            padding: '0.75rem',
            borderBottom: '1px solid #222',
            flexWrap: 'wrap',
          }}>
            {onMergeFromGlobal && (
              <ActionButton
                onClick={onMergeFromGlobal}
                icon={<MergeIcon />}
                label="Merge from Global"
                title="Add global tools to this agent (additive, never removes)"
              />
            )}
            {onReplaceWithGlobal && (
              <ActionButton
                onClick={onReplaceWithGlobal}
                icon={<ReplaceIcon />}
                label="Replace with Global"
                title="Reset tools to match global template (directories preserved)"
              />
            )}
            {onImportFromClaude && (
              <ActionButton
                onClick={onImportFromClaude}
                icon={<ImportIcon />}
                label="Import from Claude"
                title="Import from Claude's settings.local.json"
              />
            )}
            {onSyncToClaude && (
              <ActionButton
                onClick={onSyncToClaude}
                icon={<SyncIcon />}
                label="Sync to Claude"
                title="Write permissions to Claude's settings.local.json"
              />
            )}
          </div>
        </div>

        {/* Preset content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '0.75rem',
        }}>
          {selectedPreset ? (
            <>
              {/* Preset header */}
              <div style={{
                marginBottom: '0.75rem',
              }}>
                <div style={{
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: '#ccc',
                }}>
                  {selectedPreset.name}
                </div>
                {selectedPreset.description && (
                  <div style={{
                    fontSize: '0.75rem',
                    color: '#666',
                    marginTop: '0.25rem',
                  }}>
                    {selectedPreset.description}
                  </div>
                )}
              </div>

              {/* Risk level groups */}
              {(['common', 'permissive', 'yolo'] as RiskTier[]).map(tier => (
                <RiskLevelGroup
                  key={tier}
                  tier={tier}
                  permissions={getTierPermissions(selectedPreset, tier)}
                  enabledPermissions={enabledPermissions}
                  onToggleAll={(enable) => handleToggleTier(tier, enable)}
                  onToggleSingle={(perm) => handleToggleSingle(perm, tier)}
                  isCustomSet={selectedPreset.id === 'custom'}
                  onAddCustom={selectedPreset.id === 'custom' ? handleAddCustomPermission : undefined}
                  onRemoveCustom={selectedPreset.id === 'custom' ? handleRemoveCustomPermission : undefined}
                />
              ))}
            </>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#666',
              fontSize: '0.85rem',
            }}>
              Select a permission set from the sidebar
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
