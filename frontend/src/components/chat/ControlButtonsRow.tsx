import React from 'react';
import { Tooltip } from '../Tooltip';
import { AttachmentPreviewRow } from './AttachmentPreviewRow';
import type { Attachment } from './types';

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
  onAttachmentRemove
}: ControlButtonsRowProps) {
  return (
    <div style={{
      display: 'flex',
      gap: '4px',
      marginBottom: '0.5rem',
      alignItems: 'center',
      paddingRight: 'calc(75px + 0.75rem)', // Align with textarea right edge
    }}>
      {/* New Session */}
      <Tooltip content={<>New Session {newSessionMode && <span style={{ color: '#d97757' }}>(ON)</span>}</>}>
        <button
          onClick={onNewSessionModeToggle}
          style={{
            background: 'transparent',
            border: 'none',
            color: newSessionMode ? '#d97757' : '#666',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s ease'
          }}
          onMouseEnter={(e) => { if (!newSessionMode) e.currentTarget.style.color = '#eb815e'; }}
          onMouseLeave={(e) => { if (!newSessionMode) e.currentTarget.style.color = '#666'; }}
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
          style={{
            background: 'transparent',
            border: 'none',
            color: planningMode ? '#d97757' : '#666',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s ease'
          }}
          onMouseEnter={(e) => { if (!planningMode) e.currentTarget.style.color = '#eb815e'; }}
          onMouseLeave={(e) => { if (!planningMode) e.currentTarget.style.color = '#666'; }}
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
          <button
            onClick={onViewPlan}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <img
              src="/assets/view-plan.png"
              width="18"
              height="18"
              alt="View Plan"
              style={{
                filter: 'invert(52%) sepia(45%) saturate(500%) hue-rotate(336deg) brightness(92%) contrast(88%)',
                transition: 'filter 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.filter = 'invert(62%) sepia(52%) saturate(600%) hue-rotate(336deg) brightness(95%) contrast(90%)'}
              onMouseLeave={(e) => e.currentTarget.style.filter = 'invert(52%) sepia(45%) saturate(500%) hue-rotate(336deg) brightness(92%) contrast(88%)'}
            />
          </button>
        </Tooltip>
      )}

      {/* Permissions */}
      <Tooltip content="Claude Permissions">
        <button
          onClick={onOpenPermissions}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <img
            src="/assets/view-permissions.png"
            width="18"
            height="18"
            alt="Permissions"
            style={{
              filter: 'invert(52%) sepia(45%) saturate(500%) hue-rotate(336deg) brightness(92%) contrast(88%)',
              transition: 'filter 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.filter = 'invert(62%) sepia(52%) saturate(600%) hue-rotate(336deg) brightness(95%) contrast(90%)'}
            onMouseLeave={(e) => e.currentTarget.style.filter = 'invert(52%) sepia(45%) saturate(500%) hue-rotate(336deg) brightness(92%) contrast(88%)'}
          />
        </button>
      </Tooltip>

      {/* CLAUDE.md - far right */}
      <Tooltip content="CLAUDE.md">
        <button
          onClick={onOpenClaudeSettings}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.7,
            transition: 'opacity 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
        >
          <img src="/assets/clawd.png" width="18" height="18" alt="CLAUDE.md" style={{ borderRadius: '2px' }} />
        </button>
      </Tooltip>
    </div>
  );
}
