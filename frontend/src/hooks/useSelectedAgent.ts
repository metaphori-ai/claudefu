import { useMemo } from 'react';
import { useWorkspace } from './useWorkspace';

/**
 * Derived hook that returns the currently selected agent.
 * Returns null if no agent is selected.
 */
export function useSelectedAgent() {
  const { agents, selectedAgentId } = useWorkspace();

  const selectedAgent = useMemo(() => {
    if (!selectedAgentId) return null;
    return agents.find(a => a.id === selectedAgentId) || null;
  }, [agents, selectedAgentId]);

  return selectedAgent;
}
