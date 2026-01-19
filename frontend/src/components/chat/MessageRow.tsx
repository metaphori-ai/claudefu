import React, { useState } from 'react';
import type { Message, ContentBlock, PendingQuestion } from './types';
import { formatTime, getImageUrl, getMessageText } from '../../utils/messageUtils';
import { CompactionCard } from '../CompactionCard';
import { ImageBlock } from '../ImageBlock';
import { ContentBlockRenderer } from './ContentBlockRenderer';
import { CopyButton } from '../CopyButton';

interface MessageRowProps {
  message: Message;
  globalToolResultMap: Map<string, ContentBlock>;
  globalPendingQuestionMap: Map<string, PendingQuestion>;
  onCompactionClick: (content: string) => void;
  onViewToolDetails: (toolCall: ContentBlock, result?: ContentBlock) => void;
  onQuestionAnswer?: (toolUseId: string, questions: any[], answers: Record<string, string>) => void;
  onQuestionSkip?: (toolUseId: string) => void;
}

// Parse text content for embedded image references like [Image: source: /path/to/file]
function parseTextWithImages(text: string): React.ReactNode[] {
  const imagePattern = /\[Image: source: ([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = imagePattern.exec(text)) !== null) {
    // Add text before the image
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>
      );
    }
    // Add the image
    const imagePath = match[1].trim();
    parts.push(
      <div key={`img-${match.index}`} style={{ margin: '0.5rem 0' }}>
        <ImageBlock src={imagePath} />
      </div>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>
    );
  }

  return parts.length > 0 ? parts : [<span key="text">{text}</span>];
}

export function MessageRow({
  message,
  globalToolResultMap,
  globalPendingQuestionMap,
  onCompactionClick,
  onViewToolDetails,
  onQuestionAnswer,
  onQuestionSkip
}: MessageRowProps) {
  // Expand/collapse state for long user messages
  const [isExpanded, setIsExpanded] = useState(false);
  // Hover state for showing copy buttons
  const [isHovered, setIsHovered] = useState(false);

  // Check if this is a cancellation marker message
  const isCancellationMarker = message.type === 'user' && message.content.startsWith('[CANCELLED]');

  // Compaction Message
  if (message.isCompaction) {
    return (
      <CompactionCard
        preview={message.compactionPreview || "Click to view context summary"}
        timestamp={message.timestamp}
        onClick={() => onCompactionClick(message.content)}
      />
    );
  }

  // Cancellation Marker - subtle distinct style
  if (isCancellationMarker) {
    return (
      <div style={{
        marginBottom: '1.5rem',
        display: 'flex',
        justifyContent: 'center'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.4rem 0.75rem',
          background: '#1a1a1a',
          borderRadius: '4px',
          border: '1px solid #333',
          color: '#666',
          fontSize: '0.75rem'
        }}>
          {/* Small stop icon */}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="#ef4444">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
          <span>Response interrupted</span>
          <span style={{ color: '#444' }}>•</span>
          <span style={{ color: '#444' }}>{formatTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {/* Role Label - only show for user messages */}
      {message.type === 'user' && (
        <div style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: message.isFailed ? '#f87171' : '#d97757',
          marginBottom: '0.5rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          You
          <span style={{
            fontWeight: 400,
            color: '#444',
            textTransform: 'none',
            letterSpacing: 'normal'
          }}>
            {formatTime(message.timestamp)}
          </span>
          {/* Pending spinner */}
          {message.isPending && (
            <span style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              border: '2px solid #333',
              borderTopColor: '#d97757',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
          )}
          {/* Failed indicator */}
          {message.isFailed && (
            <span style={{ color: '#f87171', fontWeight: 400, textTransform: 'none' }}>
              (failed to send)
            </span>
          )}
        </div>
      )}

      {/* Message Content */}
      {message.type === 'user' ? (
        // User message - text with slight background, may include images
        (() => {
          const lines = message.content.split('\n');
          const lineCount = lines.length;
          const isLongMessage = lineCount > 6;
          const displayContent = isLongMessage && !isExpanded
            ? lines.slice(0, 6).join('\n') + '...'
            : message.content;

          return (
            <div
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <div style={{
                color: message.isFailed ? '#888' : '#ccc',
                fontSize: '0.9rem',
                lineHeight: '1.6',
                padding: '0.75rem 1rem',
                background: '#1a1a1a',
                borderRadius: '8px',
                borderLeft: `3px solid ${message.isFailed ? '#f87171' : message.isPending ? '#666' : '#d97757'}`,
                opacity: message.isPending ? 0.8 : 1,
                whiteSpace: 'pre-wrap'  // Preserve newlines
              }}>
                {/* Show images from content blocks */}
                {message.contentBlocks?.filter(b => b.type === 'image' && b.source).map((block, idx) => {
                  const imageUrl = getImageUrl(block.source);
                  return imageUrl ? (
                    <div key={`img-${idx}`} style={{ marginBottom: '0.75rem' }}>
                      <ImageBlock src={imageUrl} />
                    </div>
                  ) : null;
                })}
                {/* Parse text for embedded image references */}
                {parseTextWithImages(displayContent)}
              </div>
              {/* Expand/collapse for long messages */}
              {isLongMessage && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#d97757',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    padding: '0.25rem 0',
                    marginTop: '0.25rem'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                  {isExpanded ? 'Show less' : `Show more (${lineCount} lines)`}
                </button>
              )}
              {/* Copy button for user message (show on hover) */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s ease' }}>
                <CopyButton text={message.content} id={message.uuid} alwaysVisible />
              </div>
            </div>
          );
        })()
      ) : (
        // Claude message - render content blocks (indented)
        (() => {
          const messageText = getMessageText(message);
          const hasTextContent = messageText.trim().length > 0;

          return (
            <div
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              style={{ marginLeft: '30px' }}
            >
              <div style={{
                color: '#ccc',
                fontSize: '0.9rem',
                lineHeight: '1.7'
              }}>
                <ContentBlockRenderer
                  blocks={message.contentBlocks || []}
                  fallbackContent={message.content}
                  globalToolResultMap={globalToolResultMap}
                  globalPendingQuestionMap={globalPendingQuestionMap}
                  onViewToolDetails={onViewToolDetails}
                  onQuestionAnswer={onQuestionAnswer}
                  onQuestionSkip={onQuestionSkip}
                />
              </div>
              {/* Copy button for individual assistant message (show on hover, only if has text) */}
              {hasTextContent && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px', opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s ease' }}>
                  <CopyButton text={messageText} id={message.uuid} alwaysVisible />
                </div>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}
