import { useMemo } from 'react';
import { useWorkspace } from './useWorkspace';

/**
 * Derived hook that returns the display name for a session.
 * Priority:
 * 1. Custom name from sessionNames Map
 * 2. Session preview text
 * 3. Fallback to 'New conversation'
 *
 * This hook fixes the session name display bug by reactively
 * reading from the centralized sessionNames state.
 */
export function useSessionName(agentId: string | null, sessionId: string | null): string {
  const { sessionNames, agentSessions } = useWorkspace();

  const displayName = useMemo(() => {
    if (!agentId || !sessionId) return 'No session';

    // Check for custom name first
    const agentNames = sessionNames.get(agentId);
    const customName = agentNames?.get(sessionId);
    if (customName) return customName;

    // Fallback to session preview
    const sessions = agentSessions.get(agentId);
    const session = sessions?.find(s => s.id === sessionId);
    if (session?.preview) return session.preview;

    // Final fallback
    return 'New conversation';
  }, [agentId, sessionId, sessionNames, agentSessions]);

  return displayName;
}
