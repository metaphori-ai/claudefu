import { useEffect, useRef } from 'react';
import { DialogBase } from './DialogBase';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus confirm button when dialog opens
  useEffect(() => {
    if (isOpen && confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }
  }, [isOpen]);

  // Enter key to confirm
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm]);

  const buttonBaseStyle = {
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };

  const cancelButtonStyle = {
    ...buttonBaseStyle,
    background: '#2a2a2a',
    border: '1px solid #444',
    color: '#ccc',
  };

  const confirmButtonStyle = {
    ...buttonBaseStyle,
    background: danger ? '#dc2626' : '#d97757',
    border: 'none',
    color: '#fff',
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width="400px"
    >
      {/* Message Body */}
      <div
        style={{
          padding: '1.5rem 1.25rem',
          color: '#ccc',
          fontSize: '0.9375rem',
          lineHeight: 1.5,
        }}
      >
        {message}
      </div>

      {/* Footer with buttons */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          padding: '1rem 1.25rem',
          borderTop: '1px solid #333',
        }}
      >
        <button
          onClick={onClose}
          style={cancelButtonStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#333';
            e.currentTarget.style.borderColor = '#555';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#2a2a2a';
            e.currentTarget.style.borderColor = '#444';
          }}
        >
          {cancelText}
        </button>
        <button
          ref={confirmButtonRef}
          onClick={onConfirm}
          style={confirmButtonStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = danger ? '#b91c1c' : '#eb815e';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = danger ? '#dc2626' : '#d97757';
          }}
        >
          {confirmText}
        </button>
      </div>
    </DialogBase>
  );
}
