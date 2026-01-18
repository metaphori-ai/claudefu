import { useState, useEffect } from 'react';
import { DialogBase } from './DialogBase';
import { useSession } from '../hooks/useSession';
import { AnswerMCPQuestion, SkipMCPQuestion } from '../../wailsjs/go/main/App';

// CSS keyframes for pulse animation
const pulseStyles = `
  @keyframes mcp-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;

// Inject styles
const injectStyles = () => {
  const styleId = 'mcp-question-dialog-styles';
  if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = pulseStyles;
    document.head.appendChild(style);
  }
};

interface MCPQuestionDialogProps {
  // Dialog is open when mcpPendingQuestion is not null (managed by context)
}

export function MCPQuestionDialog(_props: MCPQuestionDialogProps) {
  const { mcpPendingQuestion, setMCPPendingQuestion } = useSession();
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inject styles on mount
  useEffect(() => {
    injectStyles();
  }, []);

  // Reset state when question changes
  useEffect(() => {
    if (mcpPendingQuestion) {
      setSelectedAnswers({});
      setCustomText({});
      setShowCustomInput({});
      setIsSubmitting(false);
      setError(null);
    }
  }, [mcpPendingQuestion?.id]);

  if (!mcpPendingQuestion) {
    return null;
  }

  const questions = mcpPendingQuestion.questions || [];

  // Check if all questions have been answered
  const allAnswered = questions.every((q) => {
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
    if (!allAnswered || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Build answers map: question text -> answer
      const answers: Record<string, string> = {};
      for (const q of questions) {
        const key = q.question;
        answers[key] = customText[key] || selectedAnswers[key] || '';
      }

      await AnswerMCPQuestion(mcpPendingQuestion.id, answers);
      console.log('[MCP:AskUser] Submitted answer for question', mcpPendingQuestion.id.substring(0, 8));
      setMCPPendingQuestion(null); // Close dialog
    } catch (err) {
      console.error('[MCP:AskUser] Failed to submit answer:', err);
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle skip
  const handleSkip = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await SkipMCPQuestion(mcpPendingQuestion.id);
      console.log('[MCP:AskUser] Skipped question', mcpPendingQuestion.id.substring(0, 8));
      setMCPPendingQuestion(null); // Close dialog
    } catch (err) {
      console.error('[MCP:AskUser] Failed to skip question:', err);
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle close (same as skip)
  const handleClose = () => {
    if (!isSubmitting) {
      handleSkip();
    }
  };

  return (
    <DialogBase
      isOpen={true}
      onClose={handleClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#d97757', fontSize: '1.1rem' }}>?</span>
          <span>Agent Question</span>
          <span style={{
            marginLeft: '0.5rem',
            fontSize: '0.75rem',
            color: '#888',
            fontWeight: 400
          }}>
            from {mcpPendingQuestion.agentSlug}
          </span>
        </div>
      }
      width="500px"
      maxHeight="80vh"
    >
      <div style={{ padding: '1rem', overflow: 'auto', maxHeight: 'calc(80vh - 100px)' }}>
        {/* Waiting indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize: '0.75rem',
          color: '#d97757',
          background: 'rgba(217, 119, 87, 0.1)',
          padding: '0.4rem 0.75rem',
          borderRadius: '4px',
          marginBottom: '1rem',
          animation: 'mcp-pulse 2s ease-in-out infinite'
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#d97757',
          }} />
          Claude is waiting for your answer
        </div>

        {/* Questions */}
        {questions.map((q, qIdx) => {
          const questionKey = q.question;
          const selectedAnswer = selectedAnswers[questionKey];
          const isCustom = showCustomInput[questionKey];

          return (
            <div key={qIdx} style={{ marginBottom: qIdx < questions.length - 1 ? '1.5rem' : 0 }}>
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
                fontSize: '0.9rem',
                color: '#eee',
                marginBottom: '0.75rem'
              }}>
                {q.question}
              </div>

              {/* Options */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
              }}>
                {q.options?.map((opt: { label: string; description: string }, optIdx: number) => {
                  const isSelected = selectedAnswer === opt.label;

                  return (
                    <button
                      key={optIdx}
                      onClick={() => handleOptionSelect(questionKey, opt.label)}
                      disabled={isSubmitting}
                      style={{
                        padding: '0.6rem 0.85rem',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        background: isSelected ? '#1a2f1a' : '#252525',
                        border: `1px solid ${isSelected ? '#34d399' : '#333'}`,
                        color: isSelected ? '#34d399' : '#ccc',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s ease',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '0.25rem',
                        opacity: isSubmitting ? 0.7 : 1
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

                {/* Other option */}
                <button
                  onClick={() => handleOtherSelect(questionKey)}
                  disabled={isSubmitting}
                  style={{
                    padding: '0.6rem 0.85rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    background: isCustom ? '#1a2f1a' : '#252525',
                    border: `1px solid ${isCustom ? '#34d399' : '#333'}`,
                    color: isCustom ? '#34d399' : '#ccc',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                    textAlign: 'left',
                    opacity: isSubmitting ? 0.7 : 1
                  }}
                >
                  <span style={{ fontWeight: 500 }}>Other...</span>
                  <span style={{ fontSize: '0.75rem', color: '#666', display: 'block', marginTop: '0.25rem' }}>
                    Enter a custom response
                  </span>
                </button>
              </div>

              {/* Custom text input */}
              {isCustom && (
                <div style={{ marginTop: '0.5rem' }}>
                  <input
                    type="text"
                    value={customText[questionKey] || ''}
                    onChange={(e) => handleCustomTextChange(questionKey, e.target.value)}
                    placeholder="Type your answer..."
                    disabled={isSubmitting}
                    style={{
                      width: '100%',
                      padding: '0.6rem',
                      borderRadius: '4px',
                      background: '#252525',
                      border: '1px solid #444',
                      color: '#ccc',
                      fontSize: '0.85rem',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    autoFocus
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Error message */}
        {error && (
          <div style={{
            marginTop: '1rem',
            padding: '0.5rem 0.75rem',
            borderRadius: '4px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            fontSize: '0.8rem'
          }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            onClick={handleSkip}
            disabled={isSubmitting}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              background: 'transparent',
              border: '1px solid #444',
              color: '#888',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              opacity: isSubmitting ? 0.7 : 1
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
              background: allAnswered && !isSubmitting ? '#d97757' : '#333',
              border: 'none',
              color: allAnswered && !isSubmitting ? '#fff' : '#666',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: allAnswered && !isSubmitting ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s ease'
            }}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Answer'}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
