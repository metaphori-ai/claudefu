import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal
} from '@floating-ui/react';
import { ListFiles } from '../../../wailsjs/go/main/App';

// FileInfo matches Go FileInfo struct
interface FileInfo {
  path: string;    // Full absolute path
  relPath: string; // Relative path for display
  name: string;    // Filename only
  isDir: boolean;  // True if directory
  size: number;    // File size in bytes
  ext: string;     // Extension without dot
}

interface FilePickerProps {
  query: string;                              // Current search query (text after @)
  agentId: string;                            // For ListFiles API
  isDoubleAt: boolean;                        // True if @@ (attachment mode)
  anchorRef: React.RefObject<HTMLElement>;    // Element to anchor to (textarea)
  onSelect: (file: FileInfo, isAttachment: boolean) => void;
  onCancel: () => void;
}

// File extension to icon mapping
const getFileIcon = (file: FileInfo): string => {
  if (file.isDir) return '📁';

  const ext = file.ext.toLowerCase();
  const iconMap: Record<string, string> = {
    // Code files
    ts: '📘', tsx: '📘', js: '📒', jsx: '📒',
    py: '🐍', go: '🔵', rs: '🦀', rb: '💎',
    java: '☕', kt: '🟣', swift: '🧡', c: '🔧', cpp: '🔧', h: '🔧',
    cs: '🟢', php: '🐘',
    // Web
    html: '🌐', css: '🎨', scss: '🎨', sass: '🎨', less: '🎨',
    // Data
    json: '📋', yaml: '📋', yml: '📋', xml: '📋', toml: '📋',
    csv: '📊', sql: '🗄️',
    // Docs
    md: '📝', txt: '📄', pdf: '📕', doc: '📘', docx: '📘',
    // Config
    env: '⚙️', gitignore: '⚙️', dockerfile: '🐳',
    // Shell
    sh: '💻', bash: '💻', zsh: '💻',
    // Images
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
  };

  return iconMap[ext] || '📄';
};

// Format file size for display
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

// Highlight matching text in path
const highlightMatch = (text: string, query: string): React.ReactNode => {
  if (!query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <span style={{ color: '#d97757', fontWeight: 600 }}>
        {text.slice(index, index + query.length)}
      </span>
      {text.slice(index + query.length)}
    </>
  );
};

export function FilePicker({
  query,
  agentId,
  isDoubleAt,
  anchorRef,
  onSelect,
  onCancel
}: FilePickerProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number>();
  const requestIdRef = useRef(0); // Track request order to handle race conditions

  // Floating UI setup for smart positioning
  const { refs, floatingStyles } = useFloating({
    placement: 'top-start',
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ['bottom-start'] }),
      shift({ padding: 8 })
    ],
    whileElementsMounted: autoUpdate
  });

  // Sync anchor ref with floating reference
  useEffect(() => {
    if (anchorRef.current) {
      refs.setReference(anchorRef.current);
    }
  }, [anchorRef, refs]);

  // Fetch files with debounce (using request counter to handle race conditions)
  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }

    // Increment request ID - only the latest request should update state
    const thisRequestId = ++requestIdRef.current;

    debounceRef.current = window.setTimeout(async () => {
      console.log('[FilePicker] Fetching files for query:', JSON.stringify(query), 'requestId:', thisRequestId);
      setIsLoading(true);
      setError(null);

      try {
        const results = await ListFiles(agentId, query, 100);
        console.log('[FilePicker] Got results:', results?.length, 'for query:', JSON.stringify(query), 'requestId:', thisRequestId, 'current:', requestIdRef.current);
        // Only update if this is still the latest request (prevents race condition)
        if (requestIdRef.current === thisRequestId) {
          setFiles(results || []);
          setSelectedIndex(0);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[FilePicker] ListFiles error for query:', JSON.stringify(query), 'error:', err);
        if (requestIdRef.current === thisRequestId) {
          setError('Failed to load files');
          setFiles([]);
          setIsLoading(false);
        }
      }
    }, 150);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [agentId, query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && files.length > 0) {
      const selectedItem = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, files.length]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, files.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (files[selectedIndex]) {
          onSelect(files[selectedIndex], isDoubleAt);
        }
        break;
      case 'Escape':
      case ' ':  // Space cancels
        e.preventDefault();
        onCancel();
        break;
      case 'Tab':
        e.preventDefault();
        onCancel();
        break;
    }
  }, [files, selectedIndex, isDoubleAt, onSelect, onCancel]);

  // Attach keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Handle click outside to cancel
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const floatingEl = refs.floating.current;
      const referenceEl = anchorRef.current;

      if (floatingEl && !floatingEl.contains(target) &&
          referenceEl && !referenceEl.contains(target)) {
        onCancel();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [refs.floating, anchorRef, onCancel]);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{
          ...floatingStyles,
          zIndex: 1000,
          width: '400px',
          maxHeight: '300px',
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: '#141414'
        }}>
          <span style={{ color: '#d97757', fontWeight: 600 }}>
            {isDoubleAt ? '@@' : '@'}
          </span>
          <span style={{ color: '#888', fontSize: '0.8rem' }}>
            {isDoubleAt ? 'Attach file content' : 'Insert file path'}
          </span>
          {query && (
            <span style={{
              marginLeft: 'auto',
              color: '#666',
              fontSize: '0.75rem'
            }}>
              "{query}"
            </span>
          )}
        </div>

        {/* File list */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.25rem 0'
          }}
        >
          {isLoading && files.length === 0 ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: '#666'
            }}>
              <div style={{
                width: '20px',
                height: '20px',
                border: '2px solid #333',
                borderTopColor: '#d97757',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 0.5rem'
              }} />
              Loading...
            </div>
          ) : error ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: '#f87171'
            }}>
              {error}
            </div>
          ) : files.length === 0 ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: '#666'
            }}>
              No files found
              {query && <div style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>
                Try a different search
              </div>}
            </div>
          ) : (
            files.map((file, index) => (
              <div
                key={file.path}
                onClick={() => onSelect(file, isDoubleAt)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: index === selectedIndex ? '#2a2a2a' : 'transparent',
                  borderLeft: index === selectedIndex ? '2px solid #d97757' : '2px solid transparent'
                }}
              >
                {/* File icon */}
                <span style={{ fontSize: '1rem', width: '1.25rem', textAlign: 'center' }}>
                  {getFileIcon(file)}
                </span>

                {/* File path */}
                <span style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: '#ccc',
                  fontSize: '0.85rem'
                }}>
                  {highlightMatch(file.relPath, query)}
                </span>

                {/* File size (not for directories) */}
                {!file.isDir && (
                  <span style={{
                    color: '#555',
                    fontSize: '0.75rem',
                    flexShrink: 0
                  }}>
                    {formatSize(file.size)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer with hints */}
        <div style={{
          padding: '0.4rem 0.75rem',
          borderTop: '1px solid #333',
          background: '#141414',
          display: 'flex',
          gap: '1rem',
          color: '#555',
          fontSize: '0.7rem'
        }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc cancel</span>
        </div>
      </div>
    </FloatingPortal>
  );
}
