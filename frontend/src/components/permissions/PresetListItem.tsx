import { PermissionSet, ToolPermission, RISK_TIER_CONFIG } from './types';

interface PresetListItemProps {
  preset: PermissionSet;
  isSelected: boolean;
  toolPermission: ToolPermission;
  onClick: () => void;
}

export function PresetListItem({
  preset,
  isSelected,
  toolPermission,
  onClick,
}: PresetListItemProps) {
  // Get status indicator color (matches the highest enabled tier)
  // V2: Check array lengths instead of level string
  const getStatusColor = (): string | null => {
    const hasYolo = toolPermission.yolo.length > 0;
    const hasPermissive = toolPermission.permissive.length > 0;
    const hasCommon = toolPermission.common.length > 0;

    if (hasYolo) return RISK_TIER_CONFIG.yolo.color;
    if (hasPermissive) return RISK_TIER_CONFIG.permissive.color;
    if (hasCommon) return RISK_TIER_CONFIG.common.color;
    return null; // Nothing enabled
  };

  // Check if any permissions are enabled
  const hasAnyEnabled = toolPermission.common.length > 0 ||
    toolPermission.permissive.length > 0 ||
    toolPermission.yolo.length > 0;

  const statusColor = getStatusColor();

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '0.6rem 0.75rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        background: isSelected ? '#252525' : 'transparent',
        border: 'none',
        borderLeft: isSelected ? '2px solid #d97757' : '2px solid transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s ease',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = '#1f1f1f';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'transparent';
      }}
    >
      {/* Status indicator dot */}
      <span style={{
        width: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {statusColor && (
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: statusColor,
          }} />
        )}
      </span>

      {/* Name */}
      <span style={{
        flex: 1,
        fontSize: '0.8rem',
        color: isSelected ? '#fff' : (hasAnyEnabled ? '#ccc' : '#888'),
        fontWeight: isSelected ? 500 : 400,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {preset.name}
      </span>

      {/* Selected arrow */}
      {isSelected && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#d97757" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </button>
  );
}
