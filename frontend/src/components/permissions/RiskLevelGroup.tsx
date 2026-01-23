import { useState } from 'react';
import { RiskTier, RISK_TIER_CONFIG } from './types';

interface RiskLevelGroupProps {
  tier: RiskTier;
  permissions: string[];
  enabledPermissions: Set<string>;
  onToggleAll: (enable: boolean) => void;
  onToggleSingle: (permission: string) => void;
  // Custom set support - allows adding new permissions
  isCustomSet?: boolean;
  onAddCustom?: (permission: string, tier: RiskTier) => void;
  onRemoveCustom?: (permission: string) => void;
}

export function RiskLevelGroup({
  tier,
  permissions,
  enabledPermissions,
  onToggleAll,
  onToggleSingle,
  isCustomSet,
  onAddCustom,
  onRemoveCustom,
}: RiskLevelGroupProps) {
  const config = RISK_TIER_CONFIG[tier];
  const [newPermission, setNewPermission] = useState('');

  // Count enabled in this tier
  const enabledCount = permissions.filter(p => enabledPermissions.has(p)).length;
  const allEnabled = enabledCount === permissions.length && permissions.length > 0;
  const someEnabled = enabledCount > 0 && enabledCount < permissions.length;

  // For custom sets, always show the tier (so user can add to it)
  if (permissions.length === 0 && !isCustomSet) {
    return null;
  }

  const handleAddCustom = () => {
    const trimmed = newPermission.trim();
    if (trimmed && onAddCustom) {
      onAddCustom(trimmed, tier);
      setNewPermission('');
    }
  };

  return (
    <div style={{
      marginBottom: '1rem',
      border: '1px solid #2a2a2a',
      borderRadius: '8px',
      overflow: 'hidden',
      background: '#0d0d0d',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0.6rem 0.75rem',
        background: allEnabled ? config.bgEnabled : '#1a1a1a',
        borderBottom: '1px solid #2a2a2a',
        transition: 'background 0.15s ease',
      }}>
        {/* Check all checkbox */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          flex: 1,
        }}>
          <input
            type="checkbox"
            checked={allEnabled}
            ref={(el) => {
              if (el) el.indeterminate = someEnabled;
            }}
            onChange={() => onToggleAll(!allEnabled)}
            style={{
              accentColor: config.color,
              width: '14px',
              height: '14px',
              cursor: 'pointer',
            }}
          />
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: config.color,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            color: allEnabled ? config.color : '#ccc',
          }}>
            {config.label}
          </span>
          <span style={{
            fontSize: '0.7rem',
            color: '#666',
            marginLeft: '0.25rem',
          }}>
            ({enabledCount}/{permissions.length})
          </span>
        </label>

        {/* Description */}
        <span style={{
          fontSize: '0.7rem',
          color: '#555',
        }}>
          {config.description}
        </span>
      </div>

      {/* Permissions grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '0.25rem',
        padding: '0.5rem',
      }}>
        {permissions.map(perm => {
          const isEnabled = enabledPermissions.has(perm);
          return (
            <div
              key={perm}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.35rem 0.5rem',
                borderRadius: '4px',
                background: isEnabled ? (config.bgEnabled + '66') : 'transparent',
                transition: 'background 0.1s ease',
              }}
              onMouseEnter={(e) => {
                if (!isEnabled) e.currentTarget.style.background = '#1a1a1a';
              }}
              onMouseLeave={(e) => {
                if (!isEnabled) e.currentTarget.style.background = isEnabled ? (config.bgEnabled + '66') : 'transparent';
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => onToggleSingle(perm)}
                  style={{
                    accentColor: config.color,
                    width: '12px',
                    height: '12px',
                    cursor: 'pointer',
                  }}
                />
                <span style={{
                  fontSize: '0.72rem',
                  color: isEnabled ? '#ccc' : '#888',
                  fontFamily: 'monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {perm}
                </span>
              </label>
              {/* Remove button for custom set */}
              {isCustomSet && onRemoveCustom && (
                <button
                  onClick={() => onRemoveCustom(perm)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#666',
                    cursor: 'pointer',
                    padding: '0 0.25rem',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
                  title="Remove"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add custom permission input (only for Custom set) */}
      {isCustomSet && onAddCustom && (
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.5rem',
          borderTop: permissions.length > 0 ? '1px solid #2a2a2a' : 'none',
        }}>
          <input
            type="text"
            value={newPermission}
            onChange={(e) => setNewPermission(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
            placeholder="Bash(command:*)"
            style={{
              flex: 1,
              padding: '0.4rem 0.6rem',
              borderRadius: '4px',
              border: '1px solid #333',
              background: '#0a0a0a',
              color: '#ccc',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              outline: 'none',
            }}
          />
          <button
            onClick={handleAddCustom}
            disabled={!newPermission.trim()}
            style={{
              padding: '0.4rem 0.75rem',
              borderRadius: '4px',
              border: 'none',
              background: newPermission.trim() ? config.color : '#333',
              color: newPermission.trim() ? '#fff' : '#666',
              fontSize: '0.72rem',
              fontWeight: 500,
              cursor: newPermission.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
