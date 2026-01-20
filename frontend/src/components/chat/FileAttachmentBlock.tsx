import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FileAttachmentBlockProps {
  filePath: string;
  content: string;
  extension: string;
}

// Get display filename from path
function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

// Count lines in content
function getLineCount(content: string): number {
  return content.split('\n').length;
}

// Check if extension should render as markdown
function isMarkdownFile(ext: string): boolean {
  return ['md', 'markdown', 'mdx'].includes(ext.toLowerCase());
}

// Get language for syntax highlighting hint
function getLanguageHint(ext: string): string {
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    json: 'json',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
    graphql: 'graphql',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
  };
  return langMap[ext.toLowerCase()] || ext || 'text';
}

export function FileAttachmentBlock({ filePath, content, extension }: FileAttachmentBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const fileName = getFileName(filePath);
  const lineCount = getLineCount(content);
  const isMarkdown = isMarkdownFile(extension);
  const langHint = getLanguageHint(extension);

  return (
    <div style={{
      margin: '0.5rem 0',
      border: '1px solid #333',
      borderRadius: '6px',
      overflow: 'hidden',
      background: '#1a1a1a',
    }}>
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 0.75rem',
          background: '#252525',
          border: 'none',
          cursor: 'pointer',
          color: '#ccc',
          fontSize: '0.85rem',
          textAlign: 'left',
        }}
      >
        {/* File icon */}
        <span style={{ fontSize: '1rem' }}>📎</span>

        {/* Filename */}
        <span style={{
          color: '#d97757',
          fontWeight: 500,
          fontFamily: 'ui-monospace, monospace',
        }}>
          {fileName}
        </span>

        {/* Line count */}
        <span style={{ color: '#666', fontSize: '0.8rem' }}>
          ({lineCount} lines)
        </span>

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* Expand/collapse indicator */}
        <span style={{
          color: '#666',
          transition: 'transform 0.2s ease',
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          ▼
        </span>
      </button>

      {/* Content - shown when expanded */}
      {isExpanded && (
        <div style={{
          padding: '0.75rem',
          maxHeight: '400px',
          overflow: 'auto',
          borderTop: '1px solid #333',
        }}>
          {isMarkdown ? (
            // Render markdown files with compact styling
            <div className="file-attachment-markdown" style={{
              fontSize: '0.85rem',
              lineHeight: '1.3',
              color: '#ccc',
            }}>
              {/* Scoped styles for compact markdown rendering */}
              <style>{`
                .file-attachment-markdown h1,
                .file-attachment-markdown h2,
                .file-attachment-markdown h3,
                .file-attachment-markdown h4,
                .file-attachment-markdown h5,
                .file-attachment-markdown h6 {
                  margin: 0.4em 0 0.2em 0;
                  line-height: 1.2;
                }
                .file-attachment-markdown p {
                  margin: 0.3em 0;
                }
                .file-attachment-markdown ul,
                .file-attachment-markdown ol {
                  margin: 0.3em 0;
                  padding: 0 0 0 1.5em;
                  line-height: 0.4;
                }
                .file-attachment-markdown li {
                  margin: 0;
                  padding: 0;
                  line-height: 1.4;
                }
                .file-attachment-markdown li > p {
                  margin: 0;
                }
                .file-attachment-markdown pre {
                  margin: 0.4em 0;
                  padding: 0.5em;
                  background: #252525;
                  border-radius: 4px;
                  overflow-x: auto;
                }
                .file-attachment-markdown code {
                  font-family: ui-monospace, monospace;
                  font-size: 0.9em;
                }
                .file-attachment-markdown hr {
                  margin: 0.4em 0;
                  border: none;
                  border-top: 1px solid #444;
                }
                .file-attachment-markdown blockquote {
                  margin: 0.3em 0;
                  padding-left: 0.75em;
                  border-left: 2px solid #d97757;
                  color: #999;
                }
              `}</style>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            // Render code files with syntax hint
            <pre style={{
              margin: 0,
              padding: 0,
              fontSize: '0.8rem',
              lineHeight: '1.5',
              fontFamily: 'ui-monospace, monospace',
              color: '#ccc',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              <code data-language={langHint}>
                {content}
              </code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
