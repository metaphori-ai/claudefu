interface CompactionCardProps {
  preview: string;
  timestamp?: string;
  onClick: () => void;
}

export function CompactionCard({ preview, timestamp, onClick }: CompactionCardProps) {
  const formatTime = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '1rem 1.25rem',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        borderRadius: '8px',
        borderLeft: '3px solid #6366f1',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        marginBottom: '1.5rem'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'linear-gradient(135deg, #1e1e3a 0%, #1a2744 100%)';
        e.currentTarget.style.transform = 'translateX(4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
        e.currentTarget.style.transform = 'translateX(0)';
      }}
    >
      {/* Document Icon */}
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          background: 'rgba(99, 102, 241, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6366f1"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>

      {/* Text Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#6366f1',
          marginBottom: '0.25rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          Context Compaction
          {timestamp && (
            <span style={{
              fontWeight: 400,
              color: '#444',
              marginLeft: '0.75rem',
              textTransform: 'none',
              letterSpacing: 'normal'
            }}>
              {formatTime(timestamp)}
            </span>
          )}
        </div>
        <div style={{
          color: '#a0a0a0',
          fontSize: '0.85rem'
        }}>
          {preview}
        </div>
      </div>

      {/* Chevron */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#6366f1"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>
  );
}
