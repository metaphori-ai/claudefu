import { useEffect } from 'react';

export interface ApiErrorDetail {
  status?: number;
  result?: string;
  resolvedModel?: string;
  userModel?: string;
}

interface ErrorListenerConfig {
  onAuthExpired: () => void;
  onApiError: (detail: ApiErrorDetail) => void;
}

/**
 * Listens for backend error events dispatched as custom DOM events by useWailsEvents.
 * Separate from useKeyboardShortcuts to maintain clear naming (NAMES principle).
 *
 * Events handled:
 * - claudefu:auth-expired — OAuth token expired, show re-login dialog
 * - claudefu:api-error — Any Claude CLI API error (rate limits, 1M context disabled,
 *                        invalid model, etc.). Dialog adapts content based on status
 *                        code and result message.
 */
export function useErrorListeners(config: ErrorListenerConfig) {
  const { onAuthExpired, onApiError } = config;

  // Listen for auth:expired events from backend
  useEffect(() => {
    const handleAuthExpired = () => {
      onAuthExpired();
    };
    window.addEventListener('claudefu:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('claudefu:auth-expired', handleAuthExpired);
  }, [onAuthExpired]);

  // Listen for claude:api-error events from backend
  useEffect(() => {
    const handleApiError = (e: Event) => {
      const detail = (e as CustomEvent).detail as ApiErrorDetail;
      onApiError(detail || {});
    };
    window.addEventListener('claudefu:api-error', handleApiError);
    return () => window.removeEventListener('claudefu:api-error', handleApiError);
  }, [onApiError]);
}
