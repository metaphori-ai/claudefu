// SplitButton component - Two-part button for Stop (red) and Queue (orange)
// Used when Claude is responding to allow both stopping and queueing messages

interface SplitButtonProps {
  onStop: () => void;
  onQueue: () => void;
  queueDisabled: boolean;  // Disable queue if empty input
  isCancelling?: boolean;  // Show spinner on stop button
}

export function SplitButton({ onStop, onQueue, queueDisabled, isCancelling = false }: SplitButtonProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '70px',
      minHeight: '100px',
      flexShrink: 0,
      boxSizing: 'border-box',
      gap: '0'
    }}>
      {/* Stop button - top half */}
      <button
        onClick={onStop}
        disabled={isCancelling}
        title="Stop Claude (ESC)"
        style={{
          flex: 1,
          width: '100%',
          borderRadius: '8px 8px 0 0',
          border: 'none',
          background: isCancelling ? '#444' : '#ef4444',
          color: isCancelling ? '#888' : '#fff',
          cursor: isCancelling ? 'not-allowed' : 'pointer',
          fontWeight: 500,
          fontSize: '12px',
          transition: 'background 0.15s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.25rem',
          boxSizing: 'border-box'
        }}
      >
        {isCancelling ? (
          <div style={{
            width: '14px',
            height: '14px',
            border: '2px solid #666',
            borderTopColor: '#ef4444',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
        ) : (
          <>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            Stop
          </>
        )}
      </button>

      {/* Queue button - bottom half */}
      <button
        onClick={onQueue}
        disabled={queueDisabled}
        title="Queue message (Enter)"
        style={{
          flex: 1,
          width: '100%',
          borderRadius: '0 0 8px 8px',
          border: 'none',
          background: queueDisabled ? '#333' : '#d97757',
          color: queueDisabled ? '#666' : '#fff',
          cursor: queueDisabled ? 'not-allowed' : 'pointer',
          fontWeight: 500,
          fontSize: '12px',
          transition: 'background 0.15s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.25rem',
          boxSizing: 'border-box'
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
        Queue
      </button>
    </div>
  );
}
