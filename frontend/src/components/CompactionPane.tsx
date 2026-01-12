import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SlideInPane } from './SlideInPane';

interface CompactionPaneProps {
  content: string;
  isOpen: boolean;
  onClose: () => void;
}

// Document icon SVG
const DocumentIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

export function CompactionPane({ content, isOpen, onClose }: CompactionPaneProps) {
  return (
    <SlideInPane
      isOpen={isOpen}
      onClose={onClose}
      title="Context Compaction Summary"
      titleColor="#6366f1"
      icon={<DocumentIcon />}
      storageKey="compaction"
      defaultWidth={600}
    >
      <div
        style={{
          color: '#ccc',
          fontSize: '0.9rem',
          lineHeight: '1.7',
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Headers
            h1({ children }) {
              return <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '1.5rem 0 0.75rem', color: '#fff' }}>{children}</h1>;
            },
            h2({ children }) {
              return <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '1.25rem 0 0.5rem', color: '#fff' }}>{children}</h2>;
            },
            h3({ children }) {
              return <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '1rem 0 0.5rem', color: '#fff' }}>{children}</h3>;
            },
            // Paragraphs
            p({ children }) {
              return <p style={{ margin: '0.75rem 0' }}>{children}</p>;
            },
            // Lists
            ul({ children }) {
              return <ul style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>{children}</ul>;
            },
            ol({ children }) {
              return <ol style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>{children}</ol>;
            },
            li({ children }) {
              return <li style={{ margin: '0.25rem 0' }}>{children}</li>;
            },
            // Code
            code({ className, children, ...props }) {
              const isInline = !className;
              if (isInline) {
                return (
                  <code
                    style={{
                      background: '#1a1a1a',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      fontSize: '0.85em',
                      color: '#f97316'
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
            pre({ children }) {
              return (
                <pre style={{ margin: '1rem 0', padding: 0, background: 'transparent' }}>
                  {children}
                </pre>
              );
            },
            // Strong/Bold
            strong({ children }) {
              return <strong style={{ color: '#fff', fontWeight: 600 }}>{children}</strong>;
            },
            // Blockquotes
            blockquote({ children }) {
              return (
                <blockquote style={{
                  margin: '1rem 0',
                  padding: '0.5rem 1rem',
                  borderLeft: '3px solid #6366f1',
                  color: '#888',
                  background: '#1a1a2e'
                }}>
                  {children}
                </blockquote>
              );
            },
            // Horizontal rules
            hr() {
              return <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '1.5rem 0' }} />;
            }
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </SlideInPane>
  );
}
