import { useState } from 'react';

interface CustomPatternsEditorProps {
  title: string;
  description: string;
  patterns: string[];
  placeholder: string;
  onChange: (patterns: string[]) => void;
  formatInput?: (value: string) => string; // Optional formatter (e.g., wrap in Bash())
}

export function CustomPatternsEditor({
  title,
  description,
  patterns,
  placeholder,
  onChange,
  formatInput,
}: CustomPatternsEditorProps) {
  const [newPattern, setNewPattern] = useState('');

  const handleAdd = () => {
    const trimmed = newPattern.trim();
    if (!trimmed) return;

    const formatted = formatInput ? formatInput(trimmed) : trimmed;
    if (!patterns.includes(formatted)) {
      onChange([...patterns, formatted]);
    }
    setNewPattern('');
  };

  const handleRemove = (pattern: string) => {
    onChange(patterns.filter(p => p !== pattern));
  };

  return (
    <div>
      {/* Header */}
      <div style={{
        fontSize: '0.7rem',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: '#888',
        marginBottom: '0.4rem',
        fontWeight: 600,
      }}>
        {title} ({patterns.length})
      </div>

      {/* Description */}
      <div style={{
        fontSize: '0.7rem',
        color: '#555',
        marginBottom: '0.5rem',
      }}>
        {description}
      </div>

      {/* Add new pattern */}
      <div style={{
        display: 'flex',
        gap: '0.35rem',
        marginBottom: '0.5rem',
      }}>
        <input
          type="text"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          style={{
            flex: 1,
            padding: '0.4rem 0.6rem',
            borderRadius: '4px',
            border: '1px solid #333',
            background: '#0d0d0d',
            color: '#ccc',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            outline: 'none',
          }}
        />
        <button
          onClick={handleAdd}
          disabled={!newPattern.trim()}
          style={{
            padding: '0.4rem 0.75rem',
            borderRadius: '4px',
            border: 'none',
            background: newPattern.trim() ? '#d97757' : '#333',
            color: newPattern.trim() ? '#fff' : '#666',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: newPattern.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Add
        </button>
      </div>

      {/* Patterns list */}
      <div style={{
        maxHeight: '180px',
        overflowY: 'auto',
        border: '1px solid #2a2a2a',
        borderRadius: '4px',
        background: '#0d0d0d',
      }}>
        {patterns.length === 0 ? (
          <div style={{
            padding: '0.75rem',
            color: '#555',
            fontSize: '0.75rem',
            textAlign: 'center',
          }}>
            No patterns configured
          </div>
        ) : (
          patterns.map((pattern, index) => (
            <div
              key={`${pattern}-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.3rem 0.5rem',
                borderBottom: index < patterns.length - 1 ? '1px solid #1a1a1a' : 'none',
              }}
            >
              <span style={{
                fontSize: '0.7rem',
                color: '#aaa',
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {pattern}
              </span>
              <button
                onClick={() => handleRemove(pattern)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  padding: '0.15rem',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
                title="Remove"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
