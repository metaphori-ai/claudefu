import { useState } from 'react';

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

interface ToolCallBlockProps {
  block: ContentBlock;
  result?: ContentBlock;
  onViewDetails: (block: ContentBlock, result?: ContentBlock) => void;
}

// Tool colors
const TOOL_CONFIG: Record<string, { color: string; label: string }> = {
  Read: { color: '#60a5fa', label: 'Read' },
  Write: { color: '#34d399', label: 'Write' },
  Edit: { color: '#fbbf24', label: 'Edit' },
  Bash: { color: '#a78bfa', label: 'Bash' },
  Glob: { color: '#f472b6', label: 'Glob' },
  Grep: { color: '#f472b6', label: 'Grep' },
  WebFetch: { color: '#38bdf8', label: 'WebFetch' },
  WebSearch: { color: '#38bdf8', label: 'WebSearch' },
  Task: { color: '#fb923c', label: 'Subagent' },
  TodoWrite: { color: '#4ade80', label: 'TodoWrite' },
  LSP: { color: '#c084fc', label: 'LSP' },
  NotebookEdit: { color: '#fbbf24', label: 'NotebookEdit' },
  AskUserQuestion: { color: '#f97316', label: 'Question' },
  EnterPlanMode: { color: '#60a5fa', label: 'Plan' },
  ExitPlanMode: { color: '#4ade80', label: 'Exit Plan' },
};

function getToolConfig(toolName: string) {
  return TOOL_CONFIG[toolName] || { color: '#888', label: toolName };
}

function getToolSummary(toolName: string, input: any): string {
  if (!input) return '';

  switch (toolName) {
    case 'Read':
      return input.file_path || '';
    case 'Write':
      return input.file_path || '';
    case 'Edit':
      return input.file_path || '';
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
    case 'Glob':
      return input.pattern || '';
    case 'Grep':
      return `${input.pattern || ''} ${input.path ? `in ${input.path}` : ''}`;
    case 'WebFetch':
      return input.url || '';
    case 'WebSearch':
      return input.query || '';
    case 'Task':
      return input.description || '';
    case 'TodoWrite':
      const todos = input.todos;
      return Array.isArray(todos) ? `${todos.length} items` : '';
    case 'LSP':
      return `${input.operation || ''} at ${input.filePath || ''}`;
    default:
      return '';
  }
}

function getResultSummary(toolName: string, result: string | undefined, isError: boolean): string {
  if (isError) return 'Error';
  if (!result) return 'Done';

  // Count lines for file reads
  if (toolName === 'Read') {
    const lines = result.split('\n').length;
    return `${lines} lines`;
  }

  // For Glob, count matches
  if (toolName === 'Glob') {
    const matches = result.split('\n').filter(l => l.trim()).length;
    return `${matches} files`;
  }

  // For Bash, show truncated output or success
  if (toolName === 'Bash') {
    if (result.trim().length === 0) return 'Done';
    const lines = result.split('\n').length;
    return lines > 1 ? `${lines} lines` : 'Done';
  }

  return 'Done';
}

// Helper to convert content to string
function contentToString(content: any): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
}

// Render AskUserQuestion with rich formatting
function AskUserQuestionBlock({ block, result }: { block: ContentBlock; result?: ContentBlock }) {
  const input = block.input;
  if (!input || !input.questions) return null;

  // Parse answers from result content (can be JSON string or object)
  let answers: Record<string, string> = {};
  if (result?.content) {
    try {
      const content = typeof result.content === 'string'
        ? JSON.parse(result.content)
        : result.content;
      answers = content.answers || {};
    } catch {
      // If not JSON, try to parse as simple text
    }
  }

  return (
    <div style={{
      margin: '0.5rem 0',
      background: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '8px',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '0.5rem 0.75rem',
        background: '#222',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        <span style={{ color: '#f97316', fontSize: '0.9rem' }}>?</span>
        <span style={{
          color: '#f97316',
          fontWeight: 500,
          fontSize: '0.85rem'
        }}>
          Question
        </span>
      </div>

      {/* Questions */}
      <div style={{ padding: '0.75rem' }}>
        {input.questions.map((q: any, qIdx: number) => {
          const answer = q.header ? answers[q.header] : undefined;

          return (
            <div key={qIdx} style={{ marginBottom: qIdx < input.questions.length - 1 ? '1rem' : 0 }}>
              {/* Question header */}
              {q.header && (
                <div style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: '#666',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.25rem'
                }}>
                  {q.header}
                </div>
              )}

              {/* Question text */}
              <div style={{
                fontSize: '0.85rem',
                color: '#ccc',
                marginBottom: '0.5rem'
              }}>
                {q.question}
              </div>

              {/* Options */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}>
                {q.options?.map((opt: any, optIdx: number) => {
                  const isSelected = answer === opt.label;
                  return (
                    <div
                      key={optIdx}
                      style={{
                        padding: '0.35rem 0.6rem',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        background: isSelected ? '#1a2f1a' : '#252525',
                        border: `1px solid ${isSelected ? '#34d399' : '#333'}`,
                        color: isSelected ? '#34d399' : '#888'
                      }}
                      title={opt.description}
                    >
                      {isSelected && <span style={{ marginRight: '0.25rem' }}>✓</span>}
                      {opt.label}
                    </div>
                  );
                })}
              </div>

              {/* Show answer if it's "Other" (custom response) */}
              {answer && !q.options?.find((o: any) => o.label === answer) && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  background: '#1a2f1a',
                  border: '1px solid #34d399',
                  color: '#34d399'
                }}>
                  ✓ {answer}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ToolCallBlock({ block, result, onViewDetails }: ToolCallBlockProps) {
  const config = getToolConfig(block.name || '');
  const summary = getToolSummary(block.name || '', block.input);
  const resultStr = result ? contentToString(result.content) : undefined;
  const resultSummary = result ? getResultSummary(block.name || '', resultStr, result.is_error || false) : null;

  // Special rendering for AskUserQuestion
  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionBlock block={block} result={result} />;
  }

  return (
    <button
      onClick={() => onViewDetails(block, result)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        margin: '0.5rem 0',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '6px',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        maxWidth: '600px',
        transition: 'all 0.15s ease'
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
      {/* Tool Name */}
      <span style={{
        color: config.color,
        fontWeight: 500,
        fontSize: '0.85rem',
        flexShrink: 0
      }}>
        {config.label}
      </span>

      {/* Summary */}
      <span style={{
        color: '#888',
        fontSize: '0.8rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1
      }}>
        {summary}
      </span>

      {/* Result indicator */}
      {resultSummary && (
        <span style={{
          color: result?.is_error ? '#f87171' : '#666',
          fontSize: '0.75rem',
          flexShrink: 0,
          padding: '0.15rem 0.5rem',
          background: result?.is_error ? '#2a1a1a' : '#222',
          borderRadius: '4px'
        }}>
          {resultSummary}
        </span>
      )}

      {/* Expand arrow */}
      <span style={{
        color: '#555',
        fontSize: '0.7rem',
        flexShrink: 0
      }}>
        ▶
      </span>
    </button>
  );
}
