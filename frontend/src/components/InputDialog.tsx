import { useState, useEffect, useRef } from 'react';

interface InputDialogProps {
  isOpen: boolean;
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export function InputDialog({
  isOpen,
  title,
  label,
  value,
  placeholder,
  onSubmit,
  onClose
}: InputDialogProps) {
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInputValue(value);
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [isOpen, value]);

  const handleSubmit = () => {
    if (inputValue.trim()) {
      onSubmit(inputValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* Dialog */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#1a1a1a',
            borderRadius: '12px',
            border: '1px solid #333',
            width: '400px',
            maxWidth: '90vw',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)'
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem 1.25rem',
              borderBottom: '1px solid #333'
            }}
          >
            <span style={{ fontWeight: 600, color: '#fff', fontSize: '1rem' }}>
              {title}
            </span>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#888"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '1.25rem' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.85rem',
                color: '#888',
                marginBottom: '0.5rem'
              }}
            >
              {label}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: '1px solid #444',
                background: '#0d0d0d',
                color: '#fff',
                fontSize: '0.95rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#f97316';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#444';
              }}
            />
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              padding: '1rem 1.25rem',
              borderTop: '1px solid #333'
            }}
          >
            <button
              onClick={onClose}
              style={{
                padding: '0.6rem 1.25rem',
                borderRadius: '6px',
                border: '1px solid #444',
                background: 'transparent',
                color: '#888',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 500
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim()}
              style={{
                padding: '0.6rem 1.25rem',
                borderRadius: '6px',
                border: 'none',
                background: inputValue.trim() ? '#f97316' : '#444',
                color: inputValue.trim() ? '#fff' : '#666',
                cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                fontSize: '0.9rem',
                fontWeight: 500
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
