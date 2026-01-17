import React, { useRef, useEffect } from 'react';

interface InputAreaProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  hasPendingQuestion: boolean;
}

export function InputArea({
  inputValue,
  onInputChange,
  onSend,
  isSending,
  hasPendingQuestion
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Calculate line height (approximately 1.5 * font size)
    const lineHeight = 22; // ~1.5 * 14px (0.9rem)
    const maxLines = 14;
    const maxHeight = lineHeight * maxLines;

    // Set height to scrollHeight, but cap at maxHeight
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;

    // Enable scrolling if content exceeds maxHeight
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  // Handle Enter key to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Handle input change with auto-resize
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(e.target.value);
    // Use setTimeout to ensure the DOM has updated
    setTimeout(adjustTextareaHeight, 0);
  };

  // Adjust height when inputValue changes (e.g., after send clears it)
  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue]);

  const isDisabled = isSending || hasPendingQuestion;
  const isSendDisabled = isSending || !inputValue.trim() || hasPendingQuestion;

  return (
    <div style={{
      display: 'flex',
      gap: '0.75rem'
    }}>
      <textarea
        ref={textareaRef}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={
          isSending ? 'Sending...' :
          hasPendingQuestion ? 'Claude has a question... please answer above ↑' :
          'Type a message... (Shift+Enter for newline)'
        }
        disabled={isDisabled}
        rows={1}
        style={{
          flex: 1,
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          border: '1px solid #333',
          background: '#0a0a0a',
          color: isSending ? '#666' : '#ccc',
          fontSize: '0.9rem',
          fontFamily: 'inherit',
          outline: 'none',
          resize: 'none',
          lineHeight: '1.5',
          minHeight: '44px',
          maxHeight: '308px', // ~14 lines
          overflowY: 'hidden'
        }}
      />
      <button
        onClick={onSend}
        disabled={isSendDisabled}
        style={{
          width: '70px',
          padding: '0.75rem 0',
          borderRadius: '8px',
          border: 'none',
          background: isSendDisabled ? '#333' : '#d97757',
          color: isSendDisabled ? '#666' : '#fff',
          cursor: isSendDisabled ? 'not-allowed' : 'pointer',
          fontWeight: 500,
          transition: 'background 0.15s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {isSending ? (
          <div style={{
            width: '16px',
            height: '16px',
            border: '2px solid #666',
            borderTopColor: '#d97757',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
        ) : 'Send'}
      </button>
    </div>
  );
}
