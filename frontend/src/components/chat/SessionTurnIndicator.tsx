import React, { useState, useCallback } from 'react';
import { GetConversationByTurns } from '../../../wailsjs/go/main/App';
import { useMessages } from '../../hooks/useMessages';
import { Tooltip } from '../Tooltip';

interface SessionTurnIndicatorProps {
  agentId: string;
  sessionId: string;
}

/**
 * Compact session pagination indicator for the top header bar.
 *
 *   Turns 25 of 85 (147 msg) [+] [-]
 *
 * - `25` = turnsLoaded (currently rendered turns)
 * - `85` = turnCount (total real-user prompts in the session file)
 * - `147 msg` = jsonlLineCount (raw JSONL line count — every line, all types)
 * - `[+]` loads ONE additional turn (turnsLoaded + 1).
 * - `[-]` drops ONE turn from the view (turnsLoaded - 1, min 1).
 *
 * Single-step semantics chosen because users anchor on what *they* said — tool
 * calls and assistant chunks between two user prompts aren't part of their
 * mental model of "how far back am I looking?". One click = one of their
 * prompts forward or backward.
 *
 * Self-contained: reads MessagesContext via useMessages and triggers backend
 * reloads itself, so the parent (App.tsx header) only needs to drop it in
 * with agentId + sessionId.
 *
 * RULES OF HOOKS: every hook is called unconditionally at the top of the
 * component. The "not yet loaded" early return lives strictly AFTER all hooks
 * so the call order is stable across initialLoadDone transitions.
 */
export function SessionTurnIndicator({ agentId, sessionId }: SessionTurnIndicatorProps) {
  // ---- hooks (always called, in stable order) ----
  const { getSessionMessages, setMessages: setContextMessages } = useMessages();
  const [isLoading, setIsLoading] = useState(false);

  const loadTurns = useCallback(async (turnLimit: number) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const result = await GetConversationByTurns(agentId, sessionId, turnLimit);
      const messageList = result?.messages || [];
      setContextMessages(
        agentId,
        sessionId,
        messageList,
        result?.totalCount || messageList.length,
        result?.hasMoreTurns || false,
        result?.displayCount || messageList.length,
        result?.turnCount || 0,
        result?.turnsLoaded || 0,
        result?.hasMoreTurns || false,
        result?.jsonlLineCount || 0,
      );
    } catch (err) {
      console.error('[SessionTurnIndicator] Failed to load turns:', err);
    } finally {
      setIsLoading(false);
    }
  }, [agentId, sessionId, isLoading, setContextMessages]);

  // ---- derived state (post-hooks) ----
  const sessionData = getSessionMessages(agentId, sessionId);

  // Don't render until the session has loaded at least once. Hidden ≠ no hooks
  // — every hook above ran already this render, so toggling back to visible on
  // the next render keeps the call order identical.
  if (!sessionData || !sessionData.initialLoadDone) {
    return null;
  }

  const turnsLoaded = sessionData.turnsLoaded ?? 0;
  const turnCount = sessionData.turnCount ?? 0;
  const jsonlLineCount = sessionData.jsonlLineCount ?? 0;

  // Single-step semantics.
  // [+] disabled when we're already showing everything.
  // [-] disabled at 1 (going to 0 would mean "load all" per the backend
  // sentinel — opposite of what the user wants when trimming).
  const canIncrease = turnCount > 0 && turnsLoaded < turnCount;
  const canDecrease = turnsLoaded > 1;

  const baseBtn: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    padding: '0 0.3rem',
    fontSize: '0.85rem',
    fontFamily: 'ui-monospace, monospace',
    lineHeight: 1,
    transition: 'color 0.15s ease',
  };
  const disabledBtn: React.CSSProperties = {
    ...baseBtn,
    color: '#333',
    cursor: 'default',
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        marginLeft: '0.5rem',
        padding: '0.15rem 0.5rem',
        background: '#1a1a1a',
        border: '1px solid #222',
        borderRadius: '4px',
        color: '#666',
        fontSize: '0.75rem',
        fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'nowrap',
      }}
    >
      <Tooltip
        content={`Turns: ${turnsLoaded} loaded of ${turnCount} total · ${jsonlLineCount} raw JSONL lines`}
        placement="bottom"
        delay={300}
      >
        <span>
          Turns {turnsLoaded} of {turnCount}{' '}
          <span style={{ color: '#555' }}>({jsonlLineCount} msg)</span>
        </span>
      </Tooltip>
      <Tooltip
        content={canIncrease ? `Load 1 more turn (show ${turnsLoaded + 1})` : 'All turns loaded'}
        placement="bottom"
        delay={300}
      >
        <button
          style={!canIncrease || isLoading ? disabledBtn : baseBtn}
          disabled={!canIncrease || isLoading}
          onClick={() => canIncrease && loadTurns(turnsLoaded + 1)}
          onMouseEnter={(e) => {
            if (canIncrease && !isLoading) e.currentTarget.style.color = '#d97757';
          }}
          onMouseLeave={(e) => {
            if (canIncrease && !isLoading) e.currentTarget.style.color = '#666';
          }}
          aria-label="Load one more turn"
        >
          +
        </button>
      </Tooltip>
      <Tooltip
        content={canDecrease ? `Show 1 fewer turn (down to ${turnsLoaded - 1})` : 'Already at 1 turn'}
        placement="bottom"
        delay={300}
      >
        <button
          style={!canDecrease || isLoading ? disabledBtn : baseBtn}
          disabled={!canDecrease || isLoading}
          onClick={() => canDecrease && loadTurns(turnsLoaded - 1)}
          onMouseEnter={(e) => {
            if (canDecrease && !isLoading) e.currentTarget.style.color = '#d97757';
          }}
          onMouseLeave={(e) => {
            if (canDecrease && !isLoading) e.currentTarget.style.color = '#666';
          }}
          aria-label="Show one fewer turn"
        >
          −
        </button>
      </Tooltip>
      {isLoading && (
        <span
          style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            border: '2px solid #333',
            borderTopColor: '#d97757',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginLeft: '0.15rem',
          }}
        />
      )}
    </div>
  );
}
