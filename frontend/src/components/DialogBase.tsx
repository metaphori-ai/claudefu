import { useEffect, ReactNode } from 'react';

interface DialogBaseProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  headerActions?: ReactNode;  // Additional buttons/controls in header (before X button)
  width?: string;
  height?: string;
  maxWidth?: string;
  maxHeight?: string;
  children: ReactNode;
}

export function DialogBase({
  isOpen,
  onClose,
  title,
  headerActions,
  width = '400px',
  height,
  maxWidth = '90vw',
  maxHeight = '90vh',
  children,
}: DialogBaseProps) {
  // ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Dialog */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#1a1a1a',
            borderRadius: '12px',
            border: '1px solid #333',
            width,
            height,
            maxWidth,
            maxHeight,
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem 1.25rem',
              borderBottom: '1px solid #333',
              flexShrink: 0,
            }}
          >
            <div style={{ fontWeight: 600, color: '#fff', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {headerActions}
              <button
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#666',
                  fontSize: '1.25rem',
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#888'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Content */}
          {children}
        </div>
      </div>
    </>
  );
}
