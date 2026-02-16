import { useMemo } from 'react';
import { useSession } from './useSession';

/**
 * Derived hook that returns unread counts for a specific agent.
 */
export function useAgentUnread(agentId: string) {
  const { unreadTotals, inboxUnreadCounts, inboxTotalCounts, backlogCounts } = useSession();

  const counts = useMemo(() => ({
    sessionUnread: unreadTotals.get(agentId) || 0,
    inboxUnread: inboxUnreadCounts.get(agentId) || 0,
    inboxTotal: inboxTotalCounts.get(agentId) || 0,
    backlogCount: backlogCounts.get(agentId) || 0,
  }), [agentId, unreadTotals, inboxUnreadCounts, inboxTotalCounts, backlogCounts]);

  return counts;
}
