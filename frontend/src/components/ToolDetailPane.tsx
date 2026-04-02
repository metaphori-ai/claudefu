import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GetSubagentConversation } from '../../wailsjs/go/main/App';
import { types } from '../../wailsjs/go/models';
import { SlideInPane } from './SlideInPane';

interface ContentBlock {
  type: string;
  text?: string;
  // Tool use
  id?: string;
  name?: string;
  input?: any;
  // Tool result
  tool_use_id?: string;
  content?: any;
  is_error?: boolean;
}

interface ToolDetailPaneProps {
  toolCall: ContentBlock | null;
  toolResult: ContentBlock | null;
  isOpen: boolean;
  onClose: () => void;
  // Context for loading subagent conversations
  agentID?: string;
  sessionID?: string;
}

// Tool colors and labels
const TOOL_CONFIG: Record<string, { color: string; label: string }> = {
  Read: { color: '#60a5fa', label: 'Read' },
  Write: { color: '#34d399', label: 'Write' },
  Edit: { color: '#fbbf24', label: 'Edit' },
  Bash: { color: '#a78bfa', label: 'Bash' },
  Glob: { color: '#f472b6', label: 'Glob' },
  Grep: { color: '#f472b6', label: 'Grep' },
  WebFetch: { color: '#38bdf8', label: 'WebFetch' },
  WebSearch: { color: '#38bdf8', label: 'WebSearch' },
  Task: { color: '#fb923c', label: 'Agent' },
  TodoWrite: { color: '#4ade80', label: 'TodoWrite' },
  LSP: { color: '#c084fc', label: 'LSP' },
  NotebookEdit: { color: '#fbbf24', label: 'NotebookEdit' },
  AskUserQuestion: { color: '#d97757', label: 'Question' },
  EnterPlanMode: { color: '#60a5fa', label: 'Plan' },
  ExitPlanMode: { color: '#4ade80', label: 'Exit Plan' },
};

function getToolConfig(toolName: string) {
  return TOOL_CONFIG[toolName] || { color: '#888', label: toolName };
}

function formatInput(toolName: string, input: any): string {
  if (!input) return '';

  switch (toolName) {
    case 'Read':
      let readStr = `file_path: ${input.file_path || 'N/A'}`;
      if (input.offset) readStr += `\noffset: ${input.offset}`;
      if (input.limit) readStr += `\nlimit: ${input.limit}`;
      return readStr;

    case 'Write':
      return `file_path: ${input.file_path || 'N/A'}\n\nContent:\n${input.content || ''}`;

    case 'Edit':
      return `file_path: ${input.file_path || 'N/A'}\n\nold_string:\n${input.old_string || ''}\n\nnew_string:\n${input.new_string || ''}`;

    case 'Bash':
      let bashStr = `command: ${input.command || 'N/A'}`;
      if (input.description) bashStr = `description: ${input.description}\n\n${bashStr}`;
      if (input.timeout) bashStr += `\ntimeout: ${input.timeout}ms`;
      return bashStr;

    case 'Glob':
      let globStr = `pattern: ${input.pattern || 'N/A'}`;
      if (input.path) globStr += `\npath: ${input.path}`;
      return globStr;

    case 'Grep':
      let grepStr = `pattern: ${input.pattern || 'N/A'}`;
      if (input.path) grepStr += `\npath: ${input.path}`;
      if (input.glob) grepStr += `\nglob: ${input.glob}`;
      return grepStr;

    case 'WebFetch':
      return `url: ${input.url || 'N/A'}\nprompt: ${input.prompt || 'N/A'}`;

    case 'WebSearch':
      return `query: ${input.query || 'N/A'}`;

    case 'Task':
      // Task input is rendered as structured JSX via renderTaskInput(), not plain text
      return '';

    case 'TodoWrite':
      const todos = input.todos;
      if (Array.isArray(todos)) {
        return todos.map((t: any, i: number) =>
          `${i + 1}. [${t.status}] ${t.content}`
        ).join('\n');
      }
      return JSON.stringify(input, null, 2);

    default:
      return JSON.stringify(input, null, 2);
  }
}

// Helper to convert content to string
function contentToString(content: any): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
}

export function ToolDetailPane({ toolCall, toolResult, isOpen, onClose, agentID, sessionID }: ToolDetailPaneProps) {
  const [subagentMessages, setSubagentMessages] = useState<types.Message[]>([]);
  const [loadingSubagent, setLoadingSubagent] = useState(false);
  const [subagentExpanded, setSubagentExpanded] = useState(false);
  const [subagentError, setSubagentError] = useState<string | null>(null);
  const [subagentStatus, setSubagentStatus] = useState<'idle' | 'running' | 'completed'>('idle');

  // Extract subagent ID from Task tool result (memoize for stability)
  const subagentId = toolCall?.name === 'Task' && toolResult?.content
    ? (() => {
        const content = typeof toolResult.content === 'string'
          ? toolResult.content
          : JSON.stringify(toolResult.content);
        const match = content.match(/agentId:\s*([a-zA-Z0-9-]+)/);
        if (match) {
          const id = match[1];
          return id.startsWith('agent-') ? id : `agent-${id}`;
        }
        return null;
      })()
    : null;

  // Subscribe to live subagent messages via DOM events
  useEffect(() => {
    if (!isOpen || toolCall?.name !== 'Task') return;

    const handleMessages = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.messages) return;
      // Accept messages for any subagent in this session (we may not know the ID yet)
      setSubagentMessages(prev => [...prev, ...detail.messages]);
      setSubagentStatus('running');
      // Auto-expand when live messages arrive
      setSubagentExpanded(true);
    };

    const handleStarted = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setSubagentStatus('running');
        setSubagentExpanded(true);
      }
    };

    const handleCompleted = () => {
      setSubagentStatus('completed');
    };

    window.addEventListener('claudefu:subagent-messages', handleMessages);
    window.addEventListener('claudefu:subagent-started', handleStarted);
    window.addEventListener('claudefu:subagent-completed', handleCompleted);
    return () => {
      window.removeEventListener('claudefu:subagent-messages', handleMessages);
      window.removeEventListener('claudefu:subagent-started', handleStarted);
      window.removeEventListener('claudefu:subagent-completed', handleCompleted);
    };
  }, [isOpen, toolCall?.name]);

  // Reset state when tool changes
  useEffect(() => {
    setSubagentMessages([]);
    setSubagentStatus('idle');
    setSubagentError(null);
  }, [toolCall?.id]);

  // Load subagent conversation on demand (for completed subagents)
  const loadSubagentConversation = useCallback(async () => {
    if (!agentID || !sessionID || !subagentId) return;

    setLoadingSubagent(true);
    setSubagentError(null);
    try {
      const messages = await GetSubagentConversation(agentID, sessionID, subagentId);
      setSubagentMessages(messages || []);
      setSubagentStatus('completed');
    } catch (err) {
      setSubagentError(err instanceof Error ? err.message : 'Failed to load subagent conversation');
    } finally {
      setLoadingSubagent(false);
    }
  }, [agentID, sessionID, subagentId]);

  if (!toolCall) return null;

  const config = getToolConfig(toolCall.name || '');

  // For Task tool, derive a better title with subagent_type
  const paneTitle = toolCall.name === 'Task' && toolCall.input?.subagent_type
    ? `${toolCall.input.subagent_type.charAt(0).toUpperCase() + toolCall.input.subagent_type.slice(1)} Agent`
    : config.label;

  return (
    <SlideInPane
      isOpen={isOpen}
      onClose={onClose}
      title={paneTitle}
      titleColor={config.color}
      storageKey="toolDetail"
      defaultWidth={600}
    >
      {/* Input Section */}
      <div style={{ marginBottom: '1.5rem' }}>
        {toolCall.name === 'Task' && toolCall.input ? (
          // Structured Task/Agent input display
          <div>
            {/* Subagent type badge + description header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {toolCall.input.subagent_type && (
                <span style={{
                  padding: '0.2rem 0.6rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: 'rgba(251, 146, 60, 0.15)',
                  color: '#fb923c',
                  border: '1px solid rgba(251, 146, 60, 0.3)',
                  textTransform: 'capitalize',
                }}>
                  {toolCall.input.subagent_type}
                </span>
              )}
              {toolCall.input.description && (
                <span style={{ fontSize: '0.9rem', color: '#ccc', fontWeight: 500 }}>
                  {toolCall.input.description}
                </span>
              )}
            </div>

            {/* Prompt as readable text */}
            {toolCall.input.prompt && (
              <div style={{
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '1rem',
                fontSize: '0.8rem',
                color: '#bbb',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflow: 'auto',
                maxHeight: '300px',
                lineHeight: 1.5,
                textAlign: 'left',
              }}>
                {toolCall.input.prompt}
              </div>
            )}
          </div>
        ) : (
          // Default input display for all other tools
          <>
            <h3 style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#666',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.75rem'
            }}>
              Input
            </h3>
            <pre style={{
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '1rem',
              margin: 0,
              fontSize: '0.8rem',
              color: '#ccc',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'auto',
              maxHeight: '300px',
              textAlign: 'left'
            }}>
              {formatInput(toolCall.name || '', toolCall.input)}
            </pre>
          </>
        )}
      </div>

      {/* Result Section */}
      {toolResult && (
        <div>
          <h3 style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: toolResult.is_error ? '#f87171' : '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '0.75rem'
          }}>
            {toolResult.is_error ? 'Error' : 'Result'}
          </h3>
          <div style={{
            background: toolResult.is_error ? '#1a1111' : '#1a1a1a',
            border: `1px solid ${toolResult.is_error ? '#4a2222' : '#333'}`,
            borderRadius: '8px',
            padding: '1rem',
            fontSize: '0.8rem',
            color: toolResult.is_error ? '#f87171' : '#ccc',
            overflow: 'auto',
            maxHeight: '500px',
            textAlign: 'left'
          }}>
            {toolCall.name === 'Read' || toolCall.name === 'Bash' || toolCall.name === 'Grep' || toolCall.name === 'Glob' ? (
              <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                textAlign: 'left'
              }}>
                {contentToString(toolResult.content) || '(empty)'}
              </pre>
            ) : (
              <div className="markdown-content" style={{ textAlign: 'left' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {contentToString(toolResult.content) || '(empty)'}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subagent Conversation Section (for Task tool) */}
      {toolCall.name === 'Task' && (subagentId || subagentMessages.length > 0 || subagentStatus === 'running') && (
        <div style={{ marginTop: '1.5rem' }}>
          <button
            onClick={() => {
              if (!subagentExpanded && subagentMessages.length === 0 && !loadingSubagent && subagentId) {
                loadSubagentConversation();
              }
              setSubagentExpanded(!subagentExpanded);
            }}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              color: '#fb923c'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#252525';
              e.currentTarget.style.borderColor = '#444';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.borderColor = '#333';
            }}
          >
            <span style={{ fontWeight: 500, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Agent Conversation
              {subagentMessages.length > 0 && (
                <span style={{ fontSize: '0.7rem', color: '#888', fontWeight: 400 }}>
                  ({subagentMessages.length} messages)
                </span>
              )}
              {subagentStatus === 'running' && (
                <span style={{
                  fontSize: '0.65rem', color: '#fb923c',
                  background: 'rgba(251, 146, 60, 0.15)',
                  padding: '0.1rem 0.4rem', borderRadius: '3px',
                }}>
                  LIVE
                </span>
              )}
            </span>
            <span style={{ color: '#666', fontSize: '0.7rem' }}>
              {subagentExpanded ? '▼' : '▶'}
            </span>
          </button>

          {subagentExpanded && (
            <div style={{
              marginTop: '0.5rem',
              background: '#151515',
              border: '1px solid #333',
              borderRadius: '8px',
              maxHeight: '400px',
              overflow: 'auto'
            }}>
              {loadingSubagent ? (
                <div style={{ padding: '1rem', color: '#888', fontSize: '0.8rem' }}>
                  Loading subagent conversation...
                </div>
              ) : subagentError ? (
                <div style={{ padding: '1rem', color: '#f87171', fontSize: '0.8rem' }}>
                  {subagentError}
                </div>
              ) : subagentMessages.length === 0 ? (
                <div style={{ padding: '1rem', color: '#888', fontSize: '0.8rem' }}>
                  No messages found
                </div>
              ) : (
                <div style={{ padding: '0.75rem' }}>
                  {subagentMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      style={{
                        marginBottom: idx < subagentMessages.length - 1 ? '0.75rem' : 0,
                        padding: '0.5rem 0.75rem',
                        background: msg.type === 'user' ? '#1a2a1a' : '#1a1a2a',
                        borderRadius: '6px',
                        borderLeft: `3px solid ${msg.type === 'user' ? '#34d399' : '#60a5fa'}`
                      }}
                    >
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: msg.type === 'user' ? '#34d399' : '#60a5fa',
                        marginBottom: '0.25rem',
                        textTransform: 'uppercase'
                      }}>
                        {msg.type}
                      </div>
                      <div style={{
                        fontSize: '0.8rem',
                        color: '#ccc',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}>
                        {msg.content || '(no content)'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </SlideInPane>
  );
}
