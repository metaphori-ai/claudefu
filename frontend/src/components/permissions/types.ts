// Shared types for permission components
// We define plain interfaces here instead of using the Wails-generated classes
// to avoid class method requirements when spreading objects

// Permission set definition (from backend)
export interface PermissionTiers {
  common: string[];
  permissive: string[];
  yolo: string[];
}

export interface PermissionSet {
  id: string;
  name: string;
  description?: string;
  permissions: PermissionTiers;
}

// Tool permission entry - V2 format with explicit arrays per tier
export interface ToolPermission {
  common: string[];
  permissive: string[];
  yolo: string[];
}

// Main permission structure (mirrors Go struct) - V2 format
export interface ClaudeFuPermissions {
  version: number;
  inheritFromGlobal?: boolean;
  toolPermissions: Record<string, ToolPermission>;
  additionalDirectories: string[];
}

// Risk level tiers for display
export type RiskTier = 'common' | 'permissive' | 'yolo';

// Risk tier configuration for styling
// Colors are desaturated to match the main orange (#d97757) saturation level
export const RISK_TIER_CONFIG: Record<RiskTier, {
  label: string;
  emoji: string;
  color: string;
  bgEnabled: string;
  borderEnabled: string;
  description: string;
}> = {
  common: {
    label: 'Common',
    emoji: '🟢',
    color: '#5d9e6e',      // Muted sage green
    bgEnabled: '#1a2e1f',
    borderEnabled: '#2d4a34',
    description: 'Safe, read-only operations',
  },
  permissive: {
    label: 'Permissive',
    emoji: '🟡',
    color: '#c9a248',      // Muted amber
    bgEnabled: '#2e2510',
    borderEnabled: '#4a3d1a',
    description: 'Can modify local state',
  },
  yolo: {
    label: 'YOLO',
    emoji: '🔴',
    color: '#c96868',      // Muted coral red
    bgEnabled: '#2e1515',
    borderEnabled: '#4a2020',
    description: 'Remote changes, force operations',
  },
};
