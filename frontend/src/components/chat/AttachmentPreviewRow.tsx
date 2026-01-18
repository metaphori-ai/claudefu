import React from 'react';
import type { Attachment } from './types';

interface AttachmentPreviewRowProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

export function AttachmentPreviewRow({ attachments, onRemove }: AttachmentPreviewRowProps) {
  if (attachments.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
      padding: '0.5rem 0',
      overflowX: 'auto',
      marginBottom: '0.5rem'
    }}>
      {attachments.map(att => (
        <div
          key={att.id}
          style={{
            position: 'relative',
            flexShrink: 0
          }}
        >
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
