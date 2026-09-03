import { useState, useEffect } from 'react';

interface RetryIndicatorProps {
  status: string;   // "waiting" | "retrying" | "cleared"
  attempt: number;
  delaySec: number;
}

/**
 * RetryIndicator — compact inline chip showing server-error retry state.
 *
 * Renders in the ControlButtonsRow spacer area (left of the right-side icons).
 * During "waiting": shows a live countdown so you can see progress. During
 * "retrying": shows the attempt in progress. Renders nothing when cleared.
 */
export function RetryIndicator({ status, attempt, delaySec }: RetryIndicatorProps) {
  const [countdown, setCountdown] = useState(delaySec);

  useEffect(() => {
    if (status !== 'waiting' || delaySec <= 0) {
      setCountdown(delaySec);
      return;
    }
    setCountdown(delaySec);
    const interval = setInterval(() => {
      setCountdown(prev => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, delaySec]);

  if (status === 'cleared' || !status) return null;

  const isWaiting = status === 'waiting';
  const label = isWaiting
    ? `Retry #${attempt} · ${countdown}s`
    : `Retry #${attempt}…`;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: '4px',
        border: '1px solid #d9775744',
        background: '#d9775712',
        fontSize: '0.68rem',
        fontFamily: 'monospace',
        color: '#d97757',
        whiteSpace: 'nowrap',
        animation: isWaiting ? undefined : 'retryPulse 1.5s ease-in-out infinite',
      }}
      title={isWaiting
        ? `Server error — retrying in ${countdown}s (attempt ${attempt}). Hit Stop to cancel.`
        : `Retrying now (attempt ${attempt})…`
      }
    >
      <style>{`
        @keyframes retryPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      {label}
    </div>
  );
}
