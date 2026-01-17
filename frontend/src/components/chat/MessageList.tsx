import React, { useMemo } from 'react';
import type { Message, ContentBlock, PendingQuestion } from './types';
import { MessageRow } from './MessageRow';
import { isLastAssistantInResponse, getFullResponseText, findResponseGroupStart } from '../../utils/messageUtils';

interface MessageListProps {
  messages: Message[];
  globalToolResultMap: Map<string, ContentBlock>;
  globalPendingQuestionMap: Map<string, PendingQuestion>;
  isCreatingSession: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  showScrollButton: boolean;
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
  onScrollToBottom,
  onCompactionClick,
  onViewToolDetails,
  onQuestionAnswer,
  onQuestionSkip
}: MessageListProps) {
  // Filter out tool_result_carrier messages
  const displayableMessages = messages.filter(msg => msg.type !== 'tool_result_carrier');

  // Build map of last assistant message UUID → full response text for copy button
  const fullResponseMap = useMemo(() => {
    const map = new Map<string, string>();

    for (let i = 0; i < displayableMessages.length; i++) {
      if (isLastAssistantInResponse(displayableMessages, i)) {
        const startIdx = findResponseGroupStart(displayableMessages, i);
        const fullText = getFullResponseText(displayableMessages, startIdx);
        if (fullText.trim()) {
          map.set(displayableMessages[i].uuid, fullText);
        }
      }
    }

    return map;
  }, [displayableMessages]);

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
              fullResponseText={fullResponseMap.get(message.uuid)}
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
