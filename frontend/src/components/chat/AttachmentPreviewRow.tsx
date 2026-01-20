import React from 'react';
import { Tooltip } from '../Tooltip';
import type { Attachment } from './types';

interface AttachmentPreviewRowProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

// Truncate filename for display
const truncateFilename = (name: string, maxLen: number = 16): string => {
  if (name.length <= maxLen) return name;
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const base = name.slice(0, name.length - (ext ? ext.length + 1 : 0));
  const truncatedBase = base.slice(0, maxLen - 3 - (ext ? ext.length + 1 : 0));
  return `${truncatedBase}...${ext ? '.' + ext : ''}`;
};

export function AttachmentPreviewRow({ attachments, onRemove }: AttachmentPreviewRowProps) {
  if (attachments.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      gap: '6px',
      alignItems: 'center',
      flexWrap: 'wrap'
    }}>
      {attachments.map(att => (
        <Tooltip
          key={att.id}
          content={
            <div style={{ whiteSpace: 'nowrap' }}>
              <div style={{ fontWeight: 500, marginBottom: '2px' }}>
                {att.filePath || att.fileName}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#888' }}>
                {att.type === 'image' ? att.mediaType : (att.extension ? `.${att.extension} file` : 'file')}
                {' • '}
                {att.size < 1024 ? `${att.size} bytes` : att.size < 1024 * 1024 ? `${(att.size / 1024).toFixed(1)} KB` : `${(att.size / (1024 * 1024)).toFixed(1)} MB`}
              </div>
            </div>
          }
          placement="top"
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: '26px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '4px',
              overflow: 'hidden',
              flexShrink: 0
            }}
          >
          {att.type === 'image' ? (
            // Image attachment - small thumbnail
            <>
              <img
                src={att.previewUrl}
                alt={att.fileName || 'Attachment'}
                style={{
                  width: '24px',
                  height: '24px',
                  objectFit: 'cover'
                }}
              />
              <span style={{
                padding: '0 6px',
                fontSize: '0.65rem',
                color: '#999',
                maxWidth: '140px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {truncateFilename(att.fileName || 'image', 20)}
              </span>
            </>
          ) : (
            // File attachment - compact chip
            <>
              {/* Placeholder for icon - user will add SVGs later */}
              <div style={{
                minWidth: '28px',
                height: '24px',
                padding: '0 4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#252525',
                fontSize: '0.55rem',
                color: '#888',
                fontWeight: 600,
                boxSizing: 'border-box'
              }}>
                {(att.extension || 'file').slice(0, 4).toUpperCase()}
              </div>
              <span style={{
                padding: '0 6px',
                fontSize: '0.65rem',
                color: '#ccc',
                maxWidth: '160px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {truncateFilename(att.fileName || 'file', 24)}
              </span>
              <span style={{
                fontSize: '0.55rem',
                color: '#666',
                paddingRight: '4px'
              }}>
                {att.size < 1024 ? `${att.size}B` : `${(att.size / 1024).toFixed(0)}KB`}
              </span>
            </>
          )}
          {/* Integrated X button on right */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(att.id);
            }}
            style={{
              width: '24px',
              height: '24px',
              border: 'none',
              borderLeft: '1px solid #333',
              background: 'transparent',
              color: '#666',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              padding: 0,
              transition: 'color 0.15s ease, background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#333';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#666';
            }}
          >
            ×
          </button>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
