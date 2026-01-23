import { useState, useEffect } from 'react';
import { DialogBase } from './DialogBase';
import { useSession } from '../hooks/useSession';
import { AnswerPermissionRequest } from '../../wailsjs/go/main/App';

// CSS keyframes for pulse animation
const pulseStyles = `
  @keyframes mcp-permission-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;

// Inject styles
const injectStyles = () => {
  const styleId = 'mcp-permission-dialog-styles';
  if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = pulseStyles;
    document.head.appendChild(style);
  }
};

interface PermissionRequestDialogProps {
  // Dialog is open when mcpPendingPermission is not null (managed by context)
}

export function PermissionRequestDialog(_props: PermissionRequestDialogProps) {
  const { mcpPendingPermission, setMCPPendingPermission } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);

  // Inject styles on mount
  useEffect(() => {
    injectStyles();
  }, []);

  // Reset state when permission request changes
  useEffect(() => {
    if (mcpPendingPermission) {
      setIsSubmitting(false);
      setError(null);
      setDenyReason('');
      setShowDenyInput(false);
    }
  }, [mcpPendingPermission?.id]);

  if (!mcpPendingPermission) {
    return null;
  }

  // Handle grant (one time)
  const handleGrantOnce = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await AnswerPermissionRequest(mcpPendingPermission.id, true, false, '');
      console.log('[MCP:Permission] Granted once for', mcpPendingPermission.id.substring(0, 8));
      setMCPPendingPermission(null);
    } catch (err) {
      console.error('[MCP:Permission] Failed to grant:', err);
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle grant permanently (add to allow list)
  const handleGrantPermanently = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await AnswerPermissionRequest(mcpPendingPermission.id, true, true, '');
      console.log('[MCP:Permission] Granted permanently for', mcpPendingPermission.id.substring(0, 8));
      setMCPPendingPermission(null);
    } catch (err) {
      console.error('[MCP:Permission] Failed to grant permanently:', err);
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle deny
  const handleDeny = async () => {
    if (isSubmitting) return;

    // If we haven't shown the deny input yet, show it
    if (!showDenyInput) {
      setShowDenyInput(true);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await AnswerPermissionRequest(mcpPendingPermission.id, false, false, denyReason);
      console.log('[MCP:Permission] Denied for', mcpPendingPermission.id.substring(0, 8));
      setMCPPendingPermission(null);
    } catch (err) {
      console.error('[MCP:Permission] Failed to deny:', err);
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle close (same as deny without reason)
  const handleClose = () => {
    if (!isSubmitting) {
      // Quick deny without prompting for reason
      AnswerPermissionRequest(mcpPendingPermission.id, false, false, 'Dialog closed').then(() => {
        setMCPPendingPermission(null);
      }).catch(err => {
        console.error('[MCP:Permission] Failed to deny on close:', err);
      });
    }
  };

  return (
    <DialogBase
      isOpen={true}
      onClose={handleClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#d97757', fontSize: '1.1rem' }}>🔒</span>
          <span>Permission Request</span>
          <span style={{
            marginLeft: '0.5rem',
            fontSize: '0.75rem',
            color: '#888',
            fontWeight: 400
          }}>
            from {mcpPendingPermission.agentSlug}
          </span>
        </div>
      }
      width="500px"
      maxHeight="80vh"
    >
      <div style={{ padding: '1rem', overflow: 'auto', maxHeight: 'calc(80vh - 100px)' }}>
        {/* Waiting indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize: '0.75rem',
          color: '#d97757',
          background: 'rgba(217, 119, 87, 0.1)',
          padding: '0.4rem 0.75rem',
          borderRadius: '4px',
          marginBottom: '1rem',
          animation: 'mcp-permission-pulse 2s ease-in-out infinite'
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#d97757',
          }} />
          Claude is waiting for your decision
        </div>

        {/* Permission details */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '0.25rem'
          }}>
            Permission Requested
          </div>
          <div style={{
            fontSize: '0.9rem',
            color: '#eee',
            fontFamily: 'monospace',
            background: '#252525',
            padding: '0.6rem 0.85rem',
            borderRadius: '6px',
            border: '1px solid #333',
            wordBreak: 'break-all'
          }}>
            {mcpPendingPermission.permission}
          </div>
        </div>

        {/* Reason */}
        {mcpPendingPermission.reason && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: '#666',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.25rem'
            }}>
              Reason
            </div>
            <div style={{
              fontSize: '0.85rem',
              color: '#ccc',
              lineHeight: '1.5'
            }}>
              {mcpPendingPermission.reason}
            </div>
          </div>
        )}

        {/* Deny reason input (shown when user clicks Deny) */}
        {showDenyInput && (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: '#666',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.25rem'
            }}>
              Denial Reason (optional)
            </div>
            <input
              type="text"
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="Why are you denying this permission?"
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: '4px',
                background: '#252525',
                border: '1px solid #444',
                color: '#ccc',
                fontSize: '0.85rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleDeny();
                }
              }}
            />
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={{
            marginTop: '1rem',
            padding: '0.5rem 0.75rem',
            borderRadius: '4px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            fontSize: '0.8rem'
          }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            onClick={handleDeny}
            disabled={isSubmitting}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              background: showDenyInput ? '#5a2424' : 'transparent',
              border: `1px solid ${showDenyInput ? '#ef4444' : '#444'}`,
              color: showDenyInput ? '#ef4444' : '#888',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              opacity: isSubmitting ? 0.7 : 1
            }}
          >
            {showDenyInput ? 'Confirm Deny' : 'Deny'}
          </button>
          <button
            onClick={handleGrantOnce}
            disabled={isSubmitting}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              background: '#1a2f1a',
              border: '1px solid #34d399',
              color: '#34d399',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              opacity: isSubmitting ? 0.7 : 1
            }}
          >
            Grant Once
          </button>
          <button
            onClick={handleGrantPermanently}
            disabled={isSubmitting}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              background: isSubmitting ? '#333' : '#d97757',
              border: 'none',
              color: isSubmitting ? '#666' : '#fff',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {isSubmitting ? 'Processing...' : 'Grant Permanently'}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
