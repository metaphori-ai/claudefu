import React from 'react';
import type { Attachment } from './types';

interface AttachmentPreviewRowProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

// Get file icon based on extension
const getFileIcon = (ext?: string): string => {
  if (!ext) return '📄';
  const iconMap: Record<string, string> = {
    ts: '📘', tsx: '📘', js: '📒', jsx: '📒',
    py: '🐍', go: '🔵', rs: '🦀', rb: '💎',
    json: '📋', yaml: '📋', yml: '📋', xml: '📋',
    md: '📝', txt: '📄', html: '🌐', css: '🎨',
    sh: '💻', bash: '💻', sql: '🗄️'
  };
  return iconMap[ext.toLowerCase()] || '📄';
};

// Truncate filename for display
const truncateFilename = (name: string, maxLen: number = 20): string => {
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
      gap: '0.5rem',
      padding: '0.5rem 0',
      overflowX: 'auto',
      marginBottom: '0.5rem',
      flexWrap: 'wrap'
    }}>
      {attachments.map(att => (
        <div
          key={att.id}
          style={{
            position: 'relative',
            flexShrink: 0
          }}
        >
          {att.type === 'image' ? (
            // Image attachment - show thumbnail
            <img
              src={att.previewUrl}
              alt={att.fileName || 'Attachment'}
              style={{
                width: '60px',
                height: '60px',
                objectFit: 'cover',
                borderRadius: '6px',
                border: '1px solid #333'
              }}
            />
          ) : (
            // File attachment - show chip/pill
            <div
              title={att.filePath || att.fileName}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.375rem 0.625rem',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '6px',
                color: '#ccc',
                fontSize: '0.8rem',
                maxWidth: '180px'
              }}
            >
              <span style={{ fontSize: '1rem' }}>{getFileIcon(att.extension)}</span>
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {truncateFilename(att.fileName || 'file')}
              </span>
              <span style={{ color: '#666', fontSize: '0.7rem', flexShrink: 0 }}>
                {att.size < 1024 ? `${att.size}B` : `${(att.size / 1024).toFixed(1)}KB`}
              </span>
            </div>
          )}
          {/* Remove button */}
          <button
            onClick={() => onRemove(att.id)}
            style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              border: 'none',
              background: '#555',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              padding: 0
            }}
            title="Remove attachment"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
