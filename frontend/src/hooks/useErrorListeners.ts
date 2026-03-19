import { useEffect } from 'react';

interface ErrorListenerConfig {
  onAuthExpired: () => void;
  onRateLimited: (resetTime: string) => void;
}

/**
 * Listens for backend error events dispatched as custom DOM events by useWailsEvents.
 * Separate from useKeyboardShortcuts to maintain clear naming (NAMES principle).
 *
 * Events handled:
 * - claudefu:auth-expired — OAuth token expired, show re-login dialog
 * - claudefu:rate-limited — Usage limit hit, show reset time dialog
 */
export function useErrorListeners(config: ErrorListenerConfig) {
  const { onAuthExpired, onRateLimited } = config;

  // Listen for auth:expired events from backend
  useEffect(() => {
    const handleAuthExpired = () => {
      onAuthExpired();
    };
    window.addEventListener('claudefu:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('claudefu:auth-expired', handleAuthExpired);
  }, [onAuthExpired]);

  // Listen for rate:limited events from backend
  useEffect(() => {
    const handleRateLimited = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onRateLimited(detail?.resetTime || '');
    };
    window.addEventListener('claudefu:rate-limited', handleRateLimited);
    return () => window.removeEventListener('claudefu:rate-limited', handleRateLimited);
  }, [onRateLimited]);
}
