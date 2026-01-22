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
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onScrollToBottom: () => void;
  onCompactionClick: (content: string) => void;
  onViewToolDetails: (toolCall: ContentBlock, result?: ContentBlock) => void;
  onQuestionAnswer?: (toolUseId: string, questions: any[], answers: Record<string, string>) => void;
  onQuestionSkip?: (toolUseId: string) => void;
}

export function MessageList({
  messages,
  globalToolResultMap,
  globalPendingQuestionMap,
  isCreatingSession,
  scrollContainerRef,
  messagesEndRef,
  showScrollButton,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onScrollToBottom,
  onCompactionClick,
  onViewToolDetails,
  onQuestionAnswer,
  onQuestionSkip
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
        {/* Load More button (at top) */}
        {hasMore && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '0.75rem 0 1.5rem 0'
          }}>
            <button
              onClick={onLoadMore}
              disabled={isLoadingMore}
              style={{
                background: '#2a2a2a',
                border: '1px solid #444',
                borderRadius: '6px',
                padding: '0.5rem 1.25rem',
                color: isLoadingMore ? '#666' : '#aaa',
                cursor: isLoadingMore ? 'default' : 'pointer',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                if (!isLoadingMore) {
                  e.currentTarget.style.background = '#333';
                  e.currentTarget.style.borderColor = '#555';
                  e.currentTarget.style.color = '#ccc';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#2a2a2a';
                e.currentTarget.style.borderColor = '#444';
                e.currentTarget.style.color = isLoadingMore ? '#666' : '#aaa';
              }}
            >
              {isLoadingMore ? (
                <>
                  <span style={{
                    display: 'inline-block',
                    width: '14px',
                    height: '14px',
                    border: '2px solid #444',
                    borderTopColor: '#d97757',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                  Loading...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7"/>
                  </svg>
                  Load older messages
                </>
              )}
            </button>
          </div>
        )}

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

        {displayableMessages.map((message, index) => (
          <div key={message.uuid || index}>
            <MessageRow
              message={message}
              globalToolResultMap={globalToolResultMap}
              globalPendingQuestionMap={globalPendingQuestionMap}
              onCompactionClick={onCompactionClick}
              onViewToolDetails={onViewToolDetails}
              onQuestionAnswer={onQuestionAnswer}
              onQuestionSkip={onQuestionSkip}
            />
          </div>
        ))}

        <div style={{ height: '60px' }} /> {/* Bottom spacer */}
        <div ref={messagesEndRef} />
      </div>

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
