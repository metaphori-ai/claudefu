import { Tooltip } from './Tooltip';

interface RiskLevelButtonProps {
  level: 'common' | 'permissive' | 'yolo';
  count: number;
  enabled: boolean;
  permissions: string[];
  onToggle: () => void;
}

const LEVEL_CONFIG = {
  common: {
    label: 'Common',
    emoji: '🟢',
    color: '#22c55e',
    bgEnabled: '#14532d',
    borderEnabled: '#166534',
    bgDisabled: '#1a1a1a',
    borderDisabled: '#2a2a2a',
    description: 'Everyday read-only commands',
  },
  permissive: {
    label: 'Permissive',
    emoji: '🟡',
    color: '#eab308',
    bgEnabled: '#422006',
    borderEnabled: '#713f12',
    bgDisabled: '#1a1a1a',
    borderDisabled: '#2a2a2a',
    description: 'Can modify local state',
  },
  yolo: {
    label: 'YOLO',
    emoji: '🔴',
    color: '#ef4444',
    bgEnabled: '#450a0a',
    borderEnabled: '#7f1d1d',
    bgDisabled: '#1a1a1a',
    borderDisabled: '#2a2a2a',
    description: 'Remote changes, force operations, no take-backs!',
  },
};

export function RiskLevelButton({
  level,
  count,
  enabled,
  permissions,
  onToggle,
}: RiskLevelButtonProps) {
  const config = LEVEL_CONFIG[level];

  // Format permissions for tooltip
  const tooltipContent = (
    <div style={{ maxWidth: '280px' }}>
      <div style={{
        fontWeight: 600,
        marginBottom: '0.4rem',
        color: config.color,
        position: 'sticky',
        top: 0,
        background: '#1a1a1a',
        paddingBottom: '0.25rem',
      }}>
        {config.emoji} {config.label} ({count})
      </div>
      <div style={{
        fontSize: '0.7rem',
        color: '#888',
        marginBottom: '0.5rem',
      }}>
        {config.description}
      </div>
      <div style={{
        fontSize: '0.65rem',
        fontFamily: 'monospace',
        color: '#aaa',
      }}>
        {permissions.map((perm, i) => (
          <div key={i} style={{ marginBottom: '0.15rem' }}>
            {perm}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} placement="top">
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: '0.3rem 0.5rem',
          borderRadius: '4px',
          border: `1px solid ${enabled ? config.borderEnabled : config.borderDisabled}`,
          background: enabled ? config.bgEnabled : config.bgDisabled,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          minWidth: '85px',
        }}
      >
        <span style={{ fontSize: '0.7rem' }}>{config.emoji}</span>
        <span style={{
          fontSize: '0.65rem',
          color: enabled ? config.color : '#666',
          fontWeight: enabled ? 600 : 400,
        }}>
          {config.label}
        </span>
        <span style={{
          fontSize: '0.6rem',
          color: enabled ? '#888' : '#555',
          marginLeft: 'auto',
        }}>
          {count}
        </span>
      </button>
    </Tooltip>
  );
}
