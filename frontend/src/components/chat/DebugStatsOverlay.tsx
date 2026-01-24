import React, { useState, useEffect } from 'react';
import type { DebugStats } from '../../utils/messageUtils';
import type { ScrollDebugInfo } from '../../utils/scrollUtils';

interface DebugStatsOverlayProps {
  debugStats: DebugStats;
  scrollDebug: ScrollDebugInfo;
  forceScrollActive: boolean;
  agentId: string;
  sessionId: string;
}

export function DebugStatsOverlay({
  debugStats,
  scrollDebug,
  forceScrollActive,
  agentId,
  sessionId
}: DebugStatsOverlayProps) {
  const [lastCliCommand, setLastCliCommand] = useState<string | null>(null);

  // Listen for debug CLI command events
  useEffect(() => {
    const handleCliCommand = (event: CustomEvent<{ command: string; sessionId: string }>) => {
      setLastCliCommand(event.detail.command);
    };

    window.addEventListener('claudefu:debug-cli-command', handleCliCommand as EventListener);
    return () => {
      window.removeEventListener('claudefu:debug-cli-command', handleCliCommand as EventListener);
    };
  }, []);

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      background: 'rgba(0, 0, 0, 0.9)',
      border: '1px solid #333',
      padding: '0.75rem 1rem',
      fontSize: '0.75rem',
      fontFamily: 'monospace',
      color: '#8f8',
      zIndex: 1000
    }}>
      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <span>Total: {debugStats.total}</span>
        <span>Displayable: {debugStats.displayable}</span>
        <span style={{ color: '#d97757' }}>User: {debugStats.userMsgCount}</span>
        <span style={{ color: '#77c' }}>Assistant: {debugStats.assistantMsgCount}</span>
        <span style={{ color: '#666' }}>Carriers: {debugStats.toolResultCarrierCount}</span>
      </div>
      <div style={{ marginTop: '0.5rem', color: '#888' }}>
        Types: {Object.entries(debugStats.typeCounts).map(([k, v]) => `${k}:${v}`).join(', ')}
      </div>
      <div style={{ marginTop: '0.5rem', color: '#6cf', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <span>scrollTop: {scrollDebug.scrollTop}</span>
        <span>scrollHeight: {scrollDebug.scrollHeight}</span>
        <span>clientHeight: {scrollDebug.clientHeight}</span>
        <span style={{ color: scrollDebug.isNearBottom ? '#8f8' : '#f88' }}>
          distFromBottom: {scrollDebug.distanceFromBottom} ({scrollDebug.isNearBottom ? 'NEAR' : 'FAR'})
        </span>
        <span style={{ color: forceScrollActive ? '#ff0' : '#666' }}>
          forceScroll: {forceScrollActive ? 'ACTIVE' : 'off'}
        </span>
      </div>
      {lastCliCommand && (
        <div style={{ marginTop: '0.5rem', color: '#f8f', fontSize: '0.65rem', wordBreak: 'break-all' }}>
          <span style={{ color: '#888' }}>Last CLI:</span> {lastCliCommand}
        </div>
      )}
      <div style={{ marginTop: '0.25rem', color: '#666', fontSize: '0.65rem' }}>
        agentId: {agentId.substring(0, 8)}... | sessionId: {sessionId.substring(0, 8)}... | threshold: 300px | Press Ctrl+D to hide
      </div>
    </div>
  );
}
