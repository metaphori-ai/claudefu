import { useState, useEffect } from 'react';
import { ReadImageAsDataURL } from '../../wailsjs/go/main/App';

interface ImageBlockProps {
  src: string;
}

export function ImageBlock({ src }: ImageBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      try {
        // If it's already a data URL or http URL, use directly
        if (src.startsWith('data:') || src.startsWith('http')) {
          setImageUrl(src);
          setIsLoading(false);
          return;
        }

        // Load local file via Go backend
        const dataUrl = await ReadImageAsDataURL(src);
        if (mounted) {
          setImageUrl(dataUrl);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('Failed to load image:', err);
        if (mounted) {
          setImageError(true);
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      mounted = false;
    };
  }, [src]);

  if (isLoading) {
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        background: '#1a1a1a',
        borderRadius: '6px',
        color: '#666',
        fontSize: '0.85rem'
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
        </svg>
        Loading image...
      </div>
    );
  }

  if (imageError || !imageUrl) {
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        background: '#1a1a1a',
        borderRadius: '6px',
        color: '#888',
        fontSize: '0.85rem'
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        Image: {src.startsWith('data:') ? '(embedded)' : src.split('/').pop()}
      </div>
    );
  }

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Thumbnail */}
      <img
        src={imageUrl}
        alt="Attached image"
        onError={() => setImageError(true)}
        style={{
          maxWidth: '120px',
          maxHeight: '80px',
          borderRadius: '6px',
          border: '1px solid #333',
          cursor: 'pointer',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          transform: isHovered ? 'scale(1.02)' : 'scale(1)',
          boxShadow: isHovered ? '0 4px 12px rgba(0, 0, 0, 0.4)' : 'none'
        }}
      />

      {/* Hover preview - larger image */}
      {isHovered && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1000,
            background: '#0a0a0a',
            padding: '1rem',
            borderRadius: '12px',
            border: '1px solid #333',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            pointerEvents: 'none'
          }}
        >
          <img
            src={imageUrl}
            alt="Attached image (preview)"
            style={{
              maxWidth: '80vw',
              maxHeight: '70vh',
              borderRadius: '8px'
            }}
          />
          {/* Only show filename for file paths, not data URLs */}
          {!src.startsWith('data:') && (
            <div style={{
              marginTop: '0.5rem',
              fontSize: '0.75rem',
              color: '#666',
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '400px'
            }}>
              {src.split('/').pop()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
