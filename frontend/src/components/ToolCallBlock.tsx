import { useState, useEffect } from 'react';

// CSS keyframes for pulse and spin animations
const pulseStyles = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

// Inject pulse animation styles
const injectStyles = () => {
  const styleId = 'toolcallblock-pulse-styles';
  if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = pulseStyles;
    document.head.appendChild(style);
  }
};

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

interface PendingQuestion {
  toolUseId: string;
  questions: any[];
}

interface ToolCallBlockProps {
  block: ContentBlock;
  result?: ContentBlock;
  onViewDetails: (block: ContentBlock, result?: ContentBlock) => void;
  pendingQuestion?: PendingQuestion;
  onAnswer?: (toolUseId: string, questions: any[], answers: Record<string, string>) => void;
  onSkip?: (toolUseId: string) => void;
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
  AskUserQuestion: { color: '#d97757', label: 'Question' },
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

// Render AskUserQuestion with rich formatting - supports both interactive and read-only modes
function AskUserQuestionBlock({ block, result, pendingQuestion, onAnswer, onSkip }: {
  block: ContentBlock;
  result?: ContentBlock;
  pendingQuestion?: PendingQuestion;
  onAnswer?: (toolUseId: string, questions: any[], answers: Record<string, string>) => void;
  onSkip?: (toolUseId: string) => void;
}) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Inject pulse animation styles
  useEffect(() => {
    injectStyles();
  }, []);

  // Use questions from pendingQuestion if available (already parsed by Go backend)
  const questions = pendingQuestion?.questions || block.input?.questions || [];
  const isPending = !!pendingQuestion;

  // Determine status: pending (waiting), skipped (is_error but conversation continued), or answered
  const isSkipped = !isPending && result?.is_error === true;
  const isAnswered = !isPending && !isSkipped;

  // Parse answers from result content for read-only mode
  let completedAnswers: Record<string, string> = {};
  if (!isPending && result?.content) {
    try {
      const content = typeof result.content === 'string'
        ? JSON.parse(result.content)
        : result.content;
      completedAnswers = content.answers || {};
    } catch {
      // If not JSON, it's an error or simple text
    }
  }

  // Check if all questions have been answered
  const allAnswered = questions.every((q: any) => {
    const key = q.question;
    return selectedAnswers[key] || customText[key];
  });

  // Handle option selection
  const handleOptionSelect = (question: string, option: string) => {
    setSelectedAnswers(prev => ({ ...prev, [question]: option }));
    setShowCustomInput(prev => ({ ...prev, [question]: false }));
    setCustomText(prev => ({ ...prev, [question]: '' }));
  };

  // Handle "Other" selection
  const handleOtherSelect = (question: string) => {
    setSelectedAnswers(prev => ({ ...prev, [question]: '' }));
    setShowCustomInput(prev => ({ ...prev, [question]: true }));
  };

  // Handle custom text change
  const handleCustomTextChange = (question: string, text: string) => {
    setCustomText(prev => ({ ...prev, [question]: text }));
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!pendingQuestion || !onAnswer || !allAnswered) return;

    setIsSubmitting(true);
    setHasSubmitted(true);  // Hide button immediately
    try {
      // Build answers map: question text -> answer
      const answers: Record<string, string> = {};
      for (const q of questions) {
        const key = q.question;
        answers[key] = customText[key] || selectedAnswers[key] || '';
      }

      await onAnswer(pendingQuestion.toolUseId, questions, answers);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle skip
  const handleSkip = () => {
    if (!pendingQuestion || !onSkip) return;
    setHasSubmitted(true);  // Hide buttons immediately
    onSkip(pendingQuestion.toolUseId);
  };

  if (!questions || questions.length === 0) return null;

  return (
    <div style={{
      margin: '0.5rem 0',
      background: '#1a1a1a',
      border: `1px solid ${isPending ? '#d97757' : '#333'}`,
      borderRadius: '8px',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '0.5rem 0.75rem',
        background: isPending ? '#2a1a0a' : '#222',
        borderBottom: `1px solid ${isPending ? '#d97757' : '#333'}`,
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        <span style={{ color: '#d97757', fontSize: '0.9rem' }}>?</span>
        <span style={{
          color: '#d97757',
          fontWeight: 500,
          fontSize: '0.85rem'
        }}>
          {isPending ? 'Question' : 'Question'}
        </span>
        {/* Status indicator */}
        {isPending && (
          <span style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.75rem',
            color: '#d97757',
            background: 'rgba(249, 115, 22, 0.15)',
            padding: '0.2rem 0.5rem',
            borderRadius: '4px',
            animation: 'pulse 2s ease-in-out infinite'
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#d97757',
              animation: 'pulse 1.5s ease-in-out infinite'
            }} />
            Waiting for your answer
          </span>
        )}
        {isSkipped && (
          <span style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: '#666',
            background: 'rgba(100, 100, 100, 0.15)',
            padding: '0.2rem 0.5rem',
            borderRadius: '4px'
          }}>
            Skipped
          </span>
        )}
        {isAnswered && (
          <span style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: '#34d399',
            background: 'rgba(52, 211, 153, 0.15)',
            padding: '0.2rem 0.5rem',
            borderRadius: '4px'
          }}>
            ✓ Answered
          </span>
        )}
      </div>

      {/* Questions */}
      <div style={{ padding: '0.75rem' }}>
        {questions.map((q: any, qIdx: number) => {
          const questionKey = q.question;
          const completedAnswer = completedAnswers[questionKey];
          const selectedAnswer = selectedAnswers[questionKey];
          const isCustom = showCustomInput[questionKey];

          return (
            <div key={qIdx} style={{ marginBottom: qIdx < questions.length - 1 ? '1rem' : 0 }}>
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

              {/* Options - vertical layout with descriptions */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
              }}>
                {q.options?.map((opt: any, optIdx: number) => {
                  const isSelected = isPending
                    ? selectedAnswer === opt.label
                    : completedAnswer === opt.label;

                  // For skipped questions, dim non-selected options
                  const isSkippedUnselected = isSkipped && !isSelected;

                  return (
                    <button
                      key={optIdx}
                      onClick={isPending ? () => handleOptionSelect(questionKey, opt.label) : undefined}
                      disabled={!isPending}
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        background: isSelected ? '#1a2f1a' : '#252525',
                        border: `1px solid ${isSelected ? '#34d399' : '#333'}`,
                        color: isSelected ? '#34d399' : isSkippedUnselected ? '#555' : '#ccc',
                        cursor: isPending ? 'pointer' : 'default',
                        transition: 'all 0.15s ease',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '0.25rem',
                        opacity: isSkippedUnselected ? 0.5 : 1
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {isSelected && <span style={{ color: '#34d399' }}>✓</span>}
                        <span style={{ fontWeight: 500 }}>{opt.label}</span>
                      </div>
                      {opt.description && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: isSelected ? '#6ee7b7' : '#666',
                          marginLeft: isSelected ? '1rem' : '0'
                        }}>
                          {opt.description}
                        </span>
                      )}
                    </button>
                  );
                })}

                {/* Other option for pending questions */}
                {isPending && (
                  <button
                    onClick={() => handleOtherSelect(questionKey)}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      background: isCustom ? '#1a2f1a' : '#252525',
                      border: `1px solid ${isCustom ? '#34d399' : '#333'}`,
                      color: isCustom ? '#34d399' : '#ccc',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      textAlign: 'left'
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>Other...</span>
                    <span style={{ fontSize: '0.75rem', color: '#666', display: 'block', marginTop: '0.25rem' }}>
                      Enter a custom response
                    </span>
                  </button>
                )}
              </div>

              {/* Custom text input for "Other" */}
              {isPending && isCustom && (
                <div style={{ marginTop: '0.5rem' }}>
                  <input
                    type="text"
                    value={customText[questionKey] || ''}
                    onChange={(e) => handleCustomTextChange(questionKey, e.target.value)}
                    placeholder="Type your answer..."
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      background: '#252525',
                      border: '1px solid #444',
                      color: '#ccc',
                      fontSize: '0.85rem',
                      outline: 'none'
                    }}
                    autoFocus
                  />
                </div>
              )}

              {/* Show completed answer if it's "Other" (custom response) - read-only mode */}
              {!isPending && completedAnswer && !q.options?.find((o: any) => o.label === completedAnswer) && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  background: '#1a2f1a',
                  border: '1px solid #34d399',
                  color: '#34d399'
                }}>
                  ✓ {completedAnswer}
                </div>
              )}
            </div>
          );
        })}

        {/* Submit/Skip buttons for pending questions */}
        {isPending && !hasSubmitted && (
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button
              onClick={handleSkip}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                background: 'transparent',
                border: '1px solid #444',
                color: '#888',
                fontSize: '0.85rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              disabled={!allAnswered || isSubmitting}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                background: allAnswered ? '#d97757' : '#333',
                border: 'none',
                color: allAnswered ? '#fff' : '#666',
                fontSize: '0.85rem',
                fontWeight: 500,
                cursor: allAnswered && !isSubmitting ? 'pointer' : 'not-allowed',
                opacity: isSubmitting ? 0.7 : 1,
                transition: 'all 0.15s ease'
              }}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Answer'}
            </button>
          </div>
        )}

        {/* Submitting indicator */}
        {isPending && hasSubmitted && (
          <div style={{
            marginTop: '1rem',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '0.5rem',
            color: '#888',
            fontSize: '0.85rem'
          }}>
            <span style={{
              display: 'inline-block',
              width: '12px',
              height: '12px',
              border: '2px solid #333',
              borderTopColor: '#d97757',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            Submitting...
          </div>
        )}
      </div>
    </div>
  );
}

export function ToolCallBlock({ block, result, onViewDetails, pendingQuestion, onAnswer, onSkip }: ToolCallBlockProps) {
  const config = getToolConfig(block.name || '');
  const summary = getToolSummary(block.name || '', block.input);
  const resultStr = result ? contentToString(result.content) : undefined;
  const resultSummary = result ? getResultSummary(block.name || '', resultStr, result.is_error || false) : null;

  // Special rendering for AskUserQuestion
  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionBlock block={block} result={result} pendingQuestion={pendingQuestion} onAnswer={onAnswer} onSkip={onSkip} />;
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
