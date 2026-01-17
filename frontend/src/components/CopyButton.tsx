import React, { useState, useEffect } from 'react';

interface CopyButtonProps {
  text: string;              // Text to copy
  id: string;                // Unique ID for copied state
  size?: number;             // Icon size (default 14)
  alwaysVisible?: boolean;   // If true, always shown (default: false = hover only)
}

export function CopyButton({ text, id, size = 14, alwaysVisible = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  // Clear copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={alwaysVisible ? 'copy-button-always' : 'copy-button-hover'}
      style={{
        background: copied ? '#16a34a22' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s ease',
        // For always-visible, set base opacity; for hover, let CSS handle it
        ...(alwaysVisible ? { opacity: 0.6 } : {}),
      }}
      onMouseEnter={(e) => {
        if (alwaysVisible) {
          e.currentTarget.style.opacity = '1';
        }
        if (!copied) {
          e.currentTarget.style.background = '#ffffff11';
        }
      }}
      onMouseLeave={(e) => {
        if (alwaysVisible) {
          e.currentTarget.style.opacity = '0.6';
        }
        if (!copied) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? (
        // Checkmark icon
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#22c55e"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        // Clipboard icon
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#888"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
