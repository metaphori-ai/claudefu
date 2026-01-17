import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ContentBlock, PendingQuestion } from './types';
import { getImageUrl } from '../../utils/messageUtils';
import { ToolCallBlock } from '../ToolCallBlock';
import { ImageBlock } from '../ImageBlock';
import { ThinkingBlock } from '../ThinkingBlock';

interface ContentBlockRendererProps {
  blocks: ContentBlock[];
  fallbackContent: string;
  globalToolResultMap: Map<string, ContentBlock>;
  globalPendingQuestionMap: Map<string, PendingQuestion>;
  onViewToolDetails: (toolCall: ContentBlock, result?: ContentBlock) => void;
  onQuestionAnswer?: (toolUseId: string, questions: any[], answers: Record<string, string>) => void;
  onQuestionSkip?: (toolUseId: string) => void;
}

// Markdown components configuration for consistent styling
const markdownComponents = {
  // Tables
  table({ children }: { children?: React.ReactNode }) {
    return (
      <table style={{
        borderCollapse: 'collapse',
        width: '100%',
        margin: '1rem 0',
        fontSize: '0.85rem'
      }}>
        {children}
      </table>
    );
  },
  thead({ children }: { children?: React.ReactNode }) {
    return <thead style={{ background: '#1a1a1a' }}>{children}</thead>;
  },
  tbody({ children }: { children?: React.ReactNode }) {
    return <tbody>{children}</tbody>;
  },
  tr({ children }: { children?: React.ReactNode }) {
    return <tr style={{ borderBottom: '1px solid #333' }}>{children}</tr>;
  },
  th({ children }: { children?: React.ReactNode }) {
    return (
      <th style={{
        padding: '0.5rem 0.75rem',
        textAlign: 'left' as const,
        fontWeight: 600,
        color: '#fff',
        borderBottom: '2px solid #444'
      }}>
        {children}
      </th>
    );
  },
  td({ children }: { children?: React.ReactNode }) {
    return (
      <td style={{
        padding: '0.5rem 0.75rem',
        borderBottom: '1px solid #222'
      }}>
        {children}
      </td>
    );
  },
  // Code blocks
  code({ node, className, children, ...props }: any) {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          style={{
            background: '#1a1a1a',
            padding: '0.15rem 0.4rem',
            borderRadius: '4px',
            fontSize: '0.85em',
            color: '#d97757'
          }}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          display: 'block',
          background: '#0a0a0a',
          padding: '1rem',
          borderRadius: '8px',
          fontSize: '0.85rem',
          overflowX: 'auto',
          border: '1px solid #222'
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  // Preformatted blocks
  pre({ children }: { children?: React.ReactNode }) {
    return (
      <pre style={{
        margin: '1rem 0',
        padding: 0,
        background: 'transparent'
      }}>
        {children}
      </pre>
    );
  },
  // Paragraphs - only bottom margin so first line aligns with dot
  p({ children }: { children?: React.ReactNode }) {
    return (
      <p style={{ margin: '0 0 0.75rem 0' }}>
        {children}
      </p>
    );
  },
  // Headers
  h1({ children }: { children?: React.ReactNode }) {
    return <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '1.5rem 0 0.75rem', color: '#fff' }}>{children}</h1>;
  },
  h2({ children }: { children?: React.ReactNode }) {
    return <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '1.25rem 0 0.5rem', color: '#fff' }}>{children}</h2>;
  },
  h3({ children }: { children?: React.ReactNode }) {
    return <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '1rem 0 0.5rem', color: '#fff' }}>{children}</h3>;
  },
  // Lists
  ul({ children }: { children?: React.ReactNode }) {
    return <ul style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>{children}</ul>;
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>{children}</ol>;
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li style={{ margin: '0.25rem 0' }}>{children}</li>;
  },
  // Links
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return (
      <a
        href={href}
        style={{ color: '#60a5fa', textDecoration: 'underline' }}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  // Blockquotes
  blockquote({ children }: { children?: React.ReactNode }) {
    return (
      <blockquote style={{
        margin: '1rem 0',
        padding: '0.5rem 1rem',
        borderLeft: '3px solid #333',
        color: '#888'
      }}>
        {children}
      </blockquote>
    );
  },
  // Horizontal rules
  hr() {
    return <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '1.5rem 0' }} />;
  },
  // Strong/Bold
  strong({ children }: { children?: React.ReactNode }) {
    return <strong style={{ color: '#fff', fontWeight: 600 }}>{children}</strong>;
  },
  // Emphasis/Italic
  em({ children }: { children?: React.ReactNode }) {
    return <em style={{ fontStyle: 'italic' }}>{children}</em>;
  }
};

export function ContentBlockRenderer({
  blocks,
  fallbackContent,
  globalToolResultMap,
  globalPendingQuestionMap,
  onViewToolDetails,
  onQuestionAnswer,
  onQuestionSkip
}: ContentBlockRendererProps) {
  // If no blocks, fall back to plain content
  if (!blocks || blocks.length === 0) {
    return (
      <div className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {fallbackContent}
        </ReactMarkdown>
      </div>
    );
  }

  // Filter out tool_result blocks (they'll be shown with their tool_use)
  const displayBlocks = blocks.filter(b => b.type !== 'tool_result');

  // Check if there's a pending AskUserQuestion in this message
  let pendingQuestionIdx = -1;
  for (let i = 0; i < displayBlocks.length; i++) {
    const block = displayBlocks[i];
    if (block.type === 'tool_use' && block.name === 'AskUserQuestion' && block.id) {
      if (globalPendingQuestionMap.has(block.id)) {
        pendingQuestionIdx = i;
        break;
      }
    }
  }

  // If there's a pending question, only render blocks UP TO AND INCLUDING the question
  const blocksToRender = pendingQuestionIdx >= 0
    ? displayBlocks.slice(0, pendingQuestionIdx + 1)
    : displayBlocks;

  return (
    <>
      {blocksToRender.map((block, idx) => {
        if (block.type === 'text' && block.text) {
          return (
            <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              {/* Colored dot for Claude text messages */}
              <span style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                background: '#77c',
                marginTop: '0.55em',
                marginRight: '2px',
                marginLeft: '2px',
                flexShrink: 0
              }} />
              <div className="markdown-content" style={{ flex: 1 }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {block.text}
                </ReactMarkdown>
              </div>
            </div>
          );
        }

        if (block.type === 'tool_use') {
          const result = block.id ? globalToolResultMap.get(block.id) : undefined;
          // Check if this is a pending AskUserQuestion that needs interactive UI
          const pendingQ = block.name === 'AskUserQuestion' && block.id
            ? globalPendingQuestionMap.get(block.id)
            : undefined;
          return (
            <ToolCallBlock
              key={idx}
              block={block}
              result={result}
              onViewDetails={onViewToolDetails}
              pendingQuestion={pendingQ}
              onAnswer={pendingQ ? onQuestionAnswer : undefined}
              onSkip={pendingQ ? onQuestionSkip : undefined}
            />
          );
        }

        if (block.type === 'image' && block.source) {
          const imageUrl = getImageUrl(block.source);
          if (imageUrl) {
            return (
              <div key={idx} style={{ marginBottom: '0.75rem' }}>
                <ImageBlock src={imageUrl} />
              </div>
            );
          }
        }

        if (block.type === 'thinking' && block.thinking) {
          return (
            <ThinkingBlock
              key={idx}
              content={block.thinking}
              initiallyCollapsed={true}
            />
          );
        }

        return null;
      })}
    </>
  );
}
