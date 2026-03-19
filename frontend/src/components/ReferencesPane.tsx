import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SlideInPane } from './SlideInPane';
import { GetClaudeMD, GetGlobalClaudeMD, ReadFileContent } from '../../wailsjs/go/main/App';

interface AtReference {
  path: string;
  filename: string;
  source: 'local' | 'global';
  section?: string;
}

interface ReferencesPaneProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;
}

// Parse @/absolute/path references from CLAUDE.md content
function parseAtReferences(content: string, source: 'local' | 'global'): AtReference[] {
  const refs: AtReference[] = [];
  const lines = content.split('\n');
  let currentSection: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('# ') && trimmed.includes('-BEGIN')) {
      currentSection = trimmed.replace('# ', '');
    } else if (trimmed.startsWith('# ') && trimmed.includes('-END')) {
      currentSection = undefined;
    }

    const match = trimmed.match(/^@(\/[^\s]+)$/);
    if (match) {
      const path = match[1];
      refs.push({
        path,
        filename: path.split('/').pop() || path,
        source,
        section: currentSection,
      });
    }
  }

  return refs;
}

// @ icon SVG
const AtIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M16 12v1a3 3 0 0 0 6 0v-1a9 9 0 1 0-3.6 7.2" />
  </svg>
);

export function ReferencesPane({ isOpen, onClose, folder }: ReferencesPaneProps) {
  const [references, setReferences] = useState<AtReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRef, setSelectedRef] = useState<AtReference | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Load and parse references when pane opens
  useEffect(() => {
    if (!isOpen) return;
    setSelectedRef(null);
    setPreviewContent(null);
    setPreviewError(null);
    setLoading(true);

    Promise.all([
      GetClaudeMD(folder).catch(() => ''),
      GetGlobalClaudeMD().catch(() => ''),
    ]).then(([localMd, globalMd]) => {
      const localRefs = parseAtReferences(localMd, 'local');
      const globalRefs = parseAtReferences(globalMd, 'global');
      setReferences([...localRefs, ...globalRefs]);
      setLoading(false);
    });
  }, [isOpen, folder]);

  const handleSelectRef = async (ref: AtReference) => {
    setSelectedRef(ref);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const content = await ReadFileContent(ref.path);
      setPreviewContent(content);
    } catch (err: any) {
      setPreviewError(err?.message || 'Failed to read file');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleBack = () => {
    setSelectedRef(null);
    setPreviewContent(null);
    setPreviewError(null);
  };

  const localRefs = references.filter(r => r.source === 'local');
  const globalRefs = references.filter(r => r.source === 'global');
  const isMarkdown = selectedRef?.path.endsWith('.md');

  return (
    <SlideInPane
      isOpen={isOpen}
      onClose={onClose}
      title="@ References"
      titleColor="#d97757"
      icon={<AtIcon />}
      storageKey="referencesPane"
      defaultWidth={650}
    >
      {selectedRef ? (
        // Preview view
        <div>
          <button
            onClick={handleBack}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#d97757',
              cursor: 'pointer',
              fontSize: '0.8rem',
              padding: '0 0 0.75rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
            onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            References
          </button>

          <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '1rem', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {selectedRef.path}
          </div>

          {previewLoading && (
            <div style={{ color: '#888', fontSize: '0.8rem' }}>Loading...</div>
          )}

          {previewError && (
            <div style={{ color: '#ef4444', fontSize: '0.8rem' }}>{previewError}</div>
          )}

          {previewContent && (
            isMarkdown ? (
              <div style={{ color: '#ccc', fontSize: '0.85rem', lineHeight: '1.7' }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1({ children }) {
                      return <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '1.5rem 0 0.75rem', color: '#fff' }}>{children}</h1>;
                    },
                    h2({ children }) {
                      return <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '1.25rem 0 0.5rem', color: '#fff' }}>{children}</h2>;
                    },
                    h3({ children }) {
                      return <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '1rem 0 0.5rem', color: '#fff' }}>{children}</h3>;
                    },
                    p({ children }) {
                      return <p style={{ margin: '0.75rem 0' }}>{children}</p>;
                    },
                    ul({ children }) {
                      return <ul style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>{children}</ul>;
                    },
                    ol({ children }) {
                      return <ol style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>{children}</ol>;
                    },
                    li({ children }) {
                      return <li style={{ margin: '0.25rem 0' }}>{children}</li>;
                    },
                    code({ className, children, ...props }) {
                      const isInline = !className;
                      if (isInline) {
                        return (
                          <code style={{ background: '#1a1a1a', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.85em', color: '#d97757' }} {...props}>
                            {children}
                          </code>
                        );
                      }
                      return (
                        <code style={{ display: 'block', background: '#0a0a0a', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem', overflowX: 'auto', border: '1px solid #222' }} {...props}>
                          {children}
                        </code>
                      );
                    },
                    pre({ children }) {
                      return <pre style={{ margin: '1rem 0', padding: 0, background: 'transparent' }}>{children}</pre>;
                    },
                    strong({ children }) {
                      return <strong style={{ color: '#fff', fontWeight: 600 }}>{children}</strong>;
                    },
                    blockquote({ children }) {
                      return (
                        <blockquote style={{ margin: '1rem 0', padding: '0.5rem 1rem', borderLeft: '3px solid #d97757', color: '#888', background: '#1a1a1e' }}>
                          {children}
                        </blockquote>
                      );
                    },
                    hr() {
                      return <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '1.5rem 0' }} />;
                    },
                  }}
                >
                  {previewContent}
                </ReactMarkdown>
              </div>
            ) : (
              <pre style={{
                background: '#0a0a0a',
                border: '1px solid #222',
                borderRadius: '8px',
                padding: '1rem',
                color: '#ccc',
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {previewContent}
              </pre>
            )
          )}
        </div>
      ) : (
        // List view
        <div>
          {loading && (
            <div style={{ color: '#888', fontSize: '0.8rem' }}>Loading references...</div>
          )}

          {!loading && references.length === 0 && (
            <div style={{ color: '#666', fontSize: '0.8rem' }}>No @ references found in CLAUDE.md</div>
          )}

          {!loading && localRefs.length > 0 && (
            <ReferenceGroup label="Agent CLAUDE.md" count={localRefs.length} refs={localRefs} onSelect={handleSelectRef} />
          )}

          {!loading && globalRefs.length > 0 && (
            <ReferenceGroup
              label="Global CLAUDE.md"
              count={globalRefs.length}
              refs={globalRefs}
              onSelect={handleSelectRef}
              style={{ marginTop: localRefs.length > 0 ? '1.25rem' : 0 }}
            />
          )}
        </div>
      )}
    </SlideInPane>
  );
}

// Group of references with header
function ReferenceGroup({ label, count, refs, onSelect, style }: {
  label: string;
  count: number;
  refs: AtReference[];
  onSelect: (ref: AtReference) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div style={style}>
      <div style={{
        fontSize: '0.7rem',
        fontWeight: 600,
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '0.5rem',
      }}>
        {label} ({count})
      </div>
      {refs.map((ref, i) => (
        <button
          key={`${ref.source}-${i}`}
          onClick={() => onSelect(ref)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            borderRadius: '6px',
            padding: '8px 10px',
            cursor: 'pointer',
            transition: 'background 0.1s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#d97757' }}>
            {ref.filename}
          </div>
          <div style={{
            fontSize: '0.65rem',
            fontFamily: 'monospace',
            color: '#555',
            marginTop: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {ref.path}
          </div>
        </button>
      ))}
    </div>
  );
}
