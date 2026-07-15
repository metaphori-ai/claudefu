import React from 'react';
import type { Message, ContentBlock, PendingQuestion } from './types';
import { MessageRow } from './MessageRow';

interface MessageListProps {
  messages: Message[];
  globalToolResultMap: Map<string, ContentBlock>;
  globalPendingQuestionMap: Map<string, PendingQuestion>;
  isCreatingSession: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  showScrollButton: boolean;
  showScrollTopButton: boolean;
  onScrollToBottom: () => void;
  onScrollToTop: () => void;
  onCompactionClick: (content: string) => void;
  onViewToolDetails: (toolCall: ContentBlock, result?: ContentBlock, timestamp?: string) => void;
  onQuestionAnswer?: (toolUseId: string, questions: any[], answers: Record<string, string>) => void;
  onQuestionSkip?: (toolUseId: string) => void;
  onAddPermission?: (toolName: string, command?: string) => void;
  onDeleteFromMessage?: (messageUUID: string) => void;
  // Turn-based pagination has moved to SessionTurnIndicator in the App.tsx
  // header. MessageList no longer needs hasMore / turnCount / turnsLoaded /
  // onLoadTurns / isLoadingMore / totalCount — they were used only by the
  // removed in-list Load Recent row.
}

export function MessageList({
  messages,
  globalToolResultMap,
  globalPendingQuestionMap,
  isCreatingSession,
  scrollContainerRef,
  messagesEndRef,
  showScrollButton,
  showScrollTopButton,
  onScrollToBottom,
  onScrollToTop,
  onCompactionClick,
  onViewToolDetails,
  onQuestionAnswer,
  onQuestionSkip,
  onAddPermission,
  onDeleteFromMessage
}: MessageListProps) {
  // Filter out tool_result_carrier messages and sort by timestamp
  const displayableMessages = messages
    .filter(msg => msg.type !== 'tool_result_carrier')
    .sort((a, b) => {
      // Sort by timestamp (ascending - oldest first)
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeA - timeB;
    });

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      {/* Scrollable Messages */}
      <div
        ref={scrollContainerRef}
        className="messages-scroll"
        style={{
          height: '100%',
          overflowY: 'scroll',
          padding: '1.5rem 2rem 2.5rem 2rem',
          textAlign: 'left'
        }}
      >
        {/* Load Recent row removed in v0.5.45 — moved to SessionTurnIndicator
            in the App.tsx header (compact "Turns n of m (x msg) [+] [-]"). */}

        {/* Creating new session indicator */}
        {isCreatingSession && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            padding: '2rem',
            color: '#888'
          }}>
            <span style={{
              display: 'inline-block',
              width: '16px',
              height: '16px',
              border: '2px solid #333',
              borderTopColor: '#d97757',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            Creating new session...
          </div>
        )}

        {displayableMessages.map((message, index) => {
          const canDelete = onDeleteFromMessage
            && message.type === 'user'
            && !message.isCompaction
            && message.uuid;

          // Show token stats only on the last assistant message before a user message (end of turn)
          const isLastAssistantInTurn = message.type === 'assistant'
            && (index === displayableMessages.length - 1 || displayableMessages[index + 1]?.type === 'user');

          return (
            <div key={message.uuid || index}>
              <MessageRow
                message={message}
                globalToolResultMap={globalToolResultMap}
                globalPendingQuestionMap={globalPendingQuestionMap}
                onCompactionClick={onCompactionClick}
                onViewToolDetails={onViewToolDetails}
                onQuestionAnswer={onQuestionAnswer}
                onQuestionSkip={onQuestionSkip}
                onAddPermission={onAddPermission}
                onDeleteTurn={canDelete ? () => onDeleteFromMessage(message.uuid) : undefined}
                showTokenStats={isLastAssistantInTurn}
              />
            </div>
          );
        })}

        <div style={{ height: '60px' }} /> {/* Bottom spacer */}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to top button — mirror of scroll-to-bottom, top-right of viewport.
          Conditional on the user being meaningfully scrolled away from the
          top; hides on tiny conversations that don't actually scroll. */}
      {showScrollTopButton && (
        <button
          onClick={onScrollToTop}
          style={{
            position: 'absolute',
            top: '1.5rem',
            right: '2.5rem',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            background: '#444',
            border: '1px solid #555',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            transition: 'all 0.15s ease',
            zIndex: 100
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#555';
            e.currentTarget.style.borderColor = '#666';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#444';
            e.currentTarget.style.borderColor = '#555';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          title="Scroll to top"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
        </button>
      )}

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={onScrollToBottom}
          style={{
            position: 'absolute',
            bottom: '1.5rem',
            right: '2.5rem',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            background: '#444',
            border: '1px solid #555',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            transition: 'all 0.15s ease',
            zIndex: 100
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#555';
            e.currentTarget.style.borderColor = '#666';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#444';
            e.currentTarget.style.borderColor = '#555';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          title="Scroll to bottom"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12l7 7 7-7"/>
          </svg>
        </button>
      )}
    </div>
  );
}
