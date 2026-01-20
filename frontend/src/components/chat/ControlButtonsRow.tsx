import React from 'react';
import { Tooltip } from '../Tooltip';
import { AttachmentPreviewRow } from './AttachmentPreviewRow';
import type { Attachment } from './types';

// CSS for button hover effects - avoids issues with Tooltip's FloatingUI handlers
const controlButtonStyles = `
  .control-toggle-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease;
  }
  .control-toggle-btn:not(.active):hover {
    color: #eb815e !important;
  }

  /* Icon buttons (PNG images) - dimmer default, brighter on hover */
  .control-icon-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .control-icon-btn img {
    transition: filter 0.15s ease, opacity 0.15s ease;
  }
  /* View Plan & Permissions - glow on hover */
  .control-icon-btn.orange-icon img {
    transition: filter 0.15s ease;
  }
  .control-icon-btn.orange-icon:hover img {
    filter: drop-shadow(0 0 3px rgba(217, 119, 87, 0.9)) drop-shadow(0 0 6px rgba(217, 119, 87, 0.6));
  }
  /* CLAUDE.md avatar - glow on hover */
  .control-icon-btn.avatar-icon img {
    transition: filter 0.15s ease;
  }
  .control-icon-btn.avatar-icon:hover img {
    filter: drop-shadow(0 0 3px rgba(217, 119, 87, 0.9)) drop-shadow(0 0 6px rgba(217, 119, 87, 0.6));
  }
`;

interface ControlButtonsRowProps {
  newSessionMode: boolean;
  onNewSessionModeToggle: () => void;
  planningMode: boolean;
  onPlanningModeToggle: () => void;
  latestPlanFile: string | null;
  onViewPlan: () => void;
  onOpenPermissions: () => void;
  onOpenClaudeSettings: () => void;
  // Attachments to show in the spacer area
  attachments?: Attachment[];
  onAttachmentRemove?: (id: string) => void;
  // Show dancing Clawd when Claude is thinking
  isSending?: boolean;
}

export function ControlButtonsRow({
  newSessionMode,
  onNewSessionModeToggle,
  planningMode,
  onPlanningModeToggle,
  latestPlanFile,
  onViewPlan,
  onOpenPermissions,
  onOpenClaudeSettings,
  attachments = [],
  onAttachmentRemove,
  isSending = false
}: ControlButtonsRowProps) {
  return (
    <div style={{
      display: 'flex',
      gap: '4px',
      marginBottom: '0.5rem',
      alignItems: 'center',
      paddingRight: 'calc(75px + 0.75rem)', // Align with textarea right edge
    }}>
      {/* Inject CSS for button hover - avoids FloatingUI event handler conflicts */}
      <style>{controlButtonStyles}</style>

      {/* New Session */}
      <Tooltip content={<>New Session {newSessionMode && <span style={{ color: '#d97757' }}>(ON)</span>}</>}>
        <button
          onClick={onNewSessionModeToggle}
          className={`control-toggle-btn ${newSessionMode ? 'active' : ''}`}
          style={{ color: newSessionMode ? '#d97757' : '#666' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </Tooltip>

      {/* Planning Mode */}
      <Tooltip content={<>Planning Mode {planningMode && <span style={{ color: '#d97757' }}>(ON)</span>}</>}>
        <button
          onClick={onPlanningModeToggle}
          className={`control-toggle-btn ${planningMode ? 'active' : ''}`}
          style={{ color: planningMode ? '#d97757' : '#666' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            <line x1="9" y1="12" x2="15" y2="12" />
            <line x1="9" y1="16" x2="15" y2="16" />
          </svg>
        </button>
      </Tooltip>

      {/* Spacer area - also shows attachments if any */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', marginLeft: '8px' }}>
        {attachments.length > 0 && onAttachmentRemove && (
          <AttachmentPreviewRow
            attachments={attachments}
            onRemove={onAttachmentRemove}
          />
        )}
      </div>

      {/* Planning File (only visible when plan exists) */}
      {latestPlanFile && (
        <Tooltip content="View Plan">
          <button onClick={onViewPlan} className="control-icon-btn orange-icon">
            <img src="/assets/view-plan.png" width="18" height="18" alt="View Plan" />
          </button>
        </Tooltip>
      )}

      {/* Permissions */}
      <Tooltip content="Claude Permissions">
        <button onClick={onOpenPermissions} className="control-icon-btn orange-icon">
          <img src="/assets/view-permissions.png" width="18" height="18" alt="Permissions" />
        </button>
      </Tooltip>

      {/* CLAUDE.md - far right (dances when thinking!) */}
      <Tooltip content="CLAUDE.md">
        <button onClick={onOpenClaudeSettings} className="control-icon-btn avatar-icon">
          <img
            src={isSending ? "/assets/clawd-dance.gif" : "/assets/clawd.png"}
            width="18"
            height="18"
            alt="CLAUDE.md"
            style={{ borderRadius: '2px' }}
          />
        </button>
      </Tooltip>
    </div>
  );
}
