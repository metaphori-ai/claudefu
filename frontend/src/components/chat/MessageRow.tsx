import React from 'react';
import type { Message, ContentBlock, PendingQuestion } from './types';
import { formatTime, getImageUrl } from '../../utils/messageUtils';
import { CompactionCard } from '../CompactionCard';
import { ImageBlock } from '../ImageBlock';
import { ContentBlockRenderer } from './ContentBlockRenderer';

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
        <div style={{
          color: message.isFailed ? '#888' : '#ccc',
          fontSize: '0.9rem',
          lineHeight: '1.6',
          padding: '0.75rem 1rem',
          background: '#1a1a1a',
          borderRadius: '8px',
          borderLeft: `3px solid ${message.isFailed ? '#f87171' : message.isPending ? '#666' : '#d97757'}`,
          opacity: message.isPending ? 0.8 : 1
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
          {parseTextWithImages(message.content)}
        </div>
      ) : (
        // Claude message - render content blocks (indented)
        <div style={{
          color: '#ccc',
          fontSize: '0.9rem',
          lineHeight: '1.7',
          marginLeft: '30px'
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
      )}
    </div>
  );
}
