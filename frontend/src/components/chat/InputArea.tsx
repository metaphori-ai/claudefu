import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import type { Attachment } from './types';
import { ATTACHMENT_LIMITS } from './types';
import { FilePicker } from './FilePicker';
import { SplitButton } from './SplitButton';
import { QueuedMessage } from '../../context/SessionContext';
import { ReadFileContent } from '../../../wailsjs/go/main/App';

// Fun verbs for the "Claude is thinking" placeholder
const CLAUDE_VERBS = [
  'Accomplishing', 'Actioning', 'Actualizing', 'Baking', 'Blipping', 'Blooping',
  'Bloviating', 'Booping', 'Brewing', 'Calculating', 'Cerebrating', 'Churning',
  'Clauding', 'Coalescing', 'Cogitating', 'Combobulating', 'Computing', 'Concocting',
  'Conjuring', 'Considering', 'Cooking', 'Crafting', 'Creating', 'Crunching',
  'Deciphering', 'Deliberating', 'Determining', 'Doing', 'Effecting', 'Elucidating',
  'Envisaging', 'Finagling', 'Flibbertigibbeting', 'Forging', 'Forming', 'Furling',
  'Gallivanting', 'Generating', 'Germinating', 'Hatching', 'Herding', 'Honking',
  'Hustling', 'Ideating', 'Inferring', 'Jiving', 'Manifesting', 'Marinating',
  'Meandering', 'Moseying', 'Mulling', 'Mustering', 'Musing', 'Noodling', 'Percolating',
  'Perusing', 'Philosophising', 'Pondering', 'Pontificating', 'Processing', 'Puttering',
  'Puzzling', 'Reticulating', 'Ruminating', 'Schlepping', 'Shucking', 'Simmering',
  'Skewing', 'Smooshing', 'Sparkling', 'Spinning', 'Stewing', 'Sussing', 'Synthesizing',
  'Thinking', 'Transmuting', 'Vibing', 'Wandering', 'Whatchamacalliting', 'Whatevering',
  'Wibbling', 'Working'
];

// Get 3 unique random verbs
function getRandomVerbs(): [string, string, string] {
  const shuffled = [...CLAUDE_VERBS].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1], shuffled[2]];
}

// Imperative handle interface for parent to control input
export interface InputAreaHandle {
  setValue: (value: string) => void;
  getValue: () => string;
  focus: () => void;
  clearAttachments: () => void;
}

interface InputAreaProps {
  agentId: string;  // Needed for FilePicker API
  folder: string;   // Agent folder for calculating relative paths
  onSend: (message: string, attachments: Attachment[]) => void;
  onCancel?: () => void;
  isSending: boolean;
  isWaitingForResponse?: boolean;
  isCancelling?: boolean;
  hasPendingQuestion: boolean;
  newSessionMode?: boolean;   // For status indicator chip
  planningMode?: boolean;     // For status indicator chip
  // Lifted attachment state (managed by parent, displayed in ControlButtonsRow)
  attachments: Attachment[];
  onAttachmentsChange: React.Dispatch<React.SetStateAction<Attachment[]>>;
  // Message queue props (for queuing messages while Claude is responding)
  queue: QueuedMessage[];
  onQueue: (content: string, attachments: Attachment[]) => void;
  onRemoveFromQueue: (id: string) => void;
  onEditQueueMessage: (message: QueuedMessage) => void;
}

// File picker state
interface FilePickerState {
  isOpen: boolean;
  isDoubleAt: boolean;   // @@ vs @
  triggerIndex: number;  // Position of @ in input
  query: string;         // Text after @
}

// FileInfo from backend
interface FileInfo {
  path: string;
  relPath: string;
  name: string;
  isDir: boolean;
  size: number;
  ext: string;
}

// Helper: Convert file to base64 (without data: prefix)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove "data:image/png;base64," prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const InputArea = forwardRef<InputAreaHandle, InputAreaProps>(function InputArea({
  agentId,
  folder,
  onSend,
  onCancel,
  isSending,
  isWaitingForResponse = false,
  isCancelling = false,
  hasPendingQuestion,
  newSessionMode = false,
  planningMode = false,
  attachments,
  onAttachmentsChange,
  queue,
  onQueue,
  onRemoveFromQueue,
  onEditQueueMessage
}, ref) {
  // Input state lives here - isolated from parent re-renders
  const [inputValue, setInputValue] = useState('');
  // Attachments state is lifted to parent, we use onAttachmentsChange to update
  const setAttachments = onAttachmentsChange;
  const [isDragOver, setIsDragOver] = useState(false);
  const [filePickerState, setFilePickerState] = useState<FilePickerState | null>(null);
  // Random verbs for "Claude is thinking" placeholder
  const [thinkingVerbs, setThinkingVerbs] = useState<[string, string, string]>(getRandomVerbs);
  // Track @file references for substitution: displayPath -> fullPath
  const [filePathMap, setFilePathMap] = useState<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate total attachment size
  const totalSize = attachments.reduce((sum, att) => sum + att.size, 0);

  // Expose imperative methods to parent
  useImperativeHandle(ref, () => ({
    setValue: (value: string) => setInputValue(value),
    getValue: () => inputValue,
    focus: () => textareaRef.current?.focus(),
    clearAttachments: () => onAttachmentsChange([])
  }), [inputValue, onAttachmentsChange]);

  // Process and add files as attachments
  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      // Validate type
      if (!ATTACHMENT_LIMITS.SUPPORTED_TYPES.includes(file.type as typeof ATTACHMENT_LIMITS.SUPPORTED_TYPES[number])) {
        console.warn(`Unsupported file type: ${file.type}. Supported: ${ATTACHMENT_LIMITS.SUPPORTED_TYPES.join(', ')}`);
        continue;
      }

      // Check limits (use functional update to get current state)
      setAttachments(prev => {
        if (prev.length >= ATTACHMENT_LIMITS.MAX_IMAGES) {
          console.warn(`Maximum ${ATTACHMENT_LIMITS.MAX_IMAGES} images allowed`);
          return prev;
        }
        const currentSize = prev.reduce((sum, att) => sum + att.size, 0);
        if (currentSize + file.size > ATTACHMENT_LIMITS.MAX_TOTAL_SIZE) {
          console.warn(`Maximum total size ${ATTACHMENT_LIMITS.MAX_TOTAL_SIZE / 1024 / 1024}MB exceeded`);
          return prev;
        }
        return prev; // Return unchanged, we'll update asynchronously
      });

      // Check limits synchronously before async work
      if (attachments.length >= ATTACHMENT_LIMITS.MAX_IMAGES) {
        console.warn(`Maximum ${ATTACHMENT_LIMITS.MAX_IMAGES} images allowed`);
        break;
      }
      if (totalSize + file.size > ATTACHMENT_LIMITS.MAX_TOTAL_SIZE) {
        console.warn(`Maximum total size ${ATTACHMENT_LIMITS.MAX_TOTAL_SIZE / 1024 / 1024}MB exceeded`);
        break;
      }

      try {
        // Read and encode file
        const base64Data = await fileToBase64(file);
        const attachment: Attachment = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'image',
          mediaType: file.type,
          data: base64Data,
          previewUrl: `data:${file.type};base64,${base64Data}`,
          fileName: file.name,
          size: file.size
        };

        setAttachments(prev => [...prev, attachment]);
      } catch (err) {
        console.error('Failed to process file:', file.name, err);
      }
    }
  }, [attachments.length, totalSize]);

  // Handle paste events (Cmd+V with image)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageItems: File[] = [];

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageItems.push(file);
      }
    }

    if (imageItems.length > 0) {
      e.preventDefault(); // Prevent pasting image as text
      processFiles(imageItems);
    }
  }, [processFiles]);

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  // Handle file input change
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      // Reset input so same file can be selected again
      e.target.value = '';
    }
  }, [processFiles]);

  // Remove attachment
  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(att => att.id !== id));
  }, []);

  // Handle file selection from FilePicker (@ reference)
  const handleFilePickerSelect = useCallback(async (file: FileInfo, isAttachment: boolean) => {
    if (!filePickerState) return;

    const { triggerIndex, isDoubleAt } = filePickerState;

    // Calculate where the @ pattern ends (triggerIndex is start of @, add @ or @@ length + query length)
    const atLength = isDoubleAt ? 2 : 1;
    const patternEnd = triggerIndex + atLength + filePickerState.query.length;

    // Calculate display path for @ references (not @@)
    // - Files in agent folder: @/relative/path
    // - Files outside agent folder: @/full/absolute/path
    let displayPath: string;
    if (file.path.startsWith(folder)) {
      // File is inside agent folder - show relative path
      const relativePath = file.path.slice(folder.length);
      displayPath = '@' + relativePath; // e.g., @/CLAUDE.md or @/src/App.tsx
    } else {
      // File is outside agent folder - show full path
      displayPath = '@' + file.path; // e.g., @/Users/jasdeep/svml/tda-documents/...
    }

    // Build new input value: text before @ + display path + space + text after pattern
    const beforeAt = inputValue.slice(0, triggerIndex);
    const afterPattern = inputValue.slice(patternEnd);
    const newValue = beforeAt + displayPath + ' ' + afterPattern;

    // Track the mapping for substitution on submit (only for single @, not @@)
    if (!isDoubleAt) {
      setFilePathMap(prev => {
        const newMap = new Map(prev);
        newMap.set(displayPath, file.path);
        return newMap;
      });
    }

    setInputValue(newValue);
    setFilePickerState(null);

    // If @@, also load file content as attachment
    if (isAttachment && !file.isDir) {
      try {
        const content = await ReadFileContent(file.path);

        // Add file attachment
        const attachment: Attachment = {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'file' as const,
          mediaType: `text/${file.ext || 'plain'}`,
          data: content,
          previewUrl: '', // No preview for files
          fileName: file.name,
          size: content.length,
          filePath: file.path,
          extension: file.ext
        };

        setAttachments(prev => [...prev, attachment]);
      } catch (err) {
        console.error('[InputArea] Failed to read file:', file.path, err);
        // Still insert the path even if content read fails
      }
    }

    // Refocus textarea and adjust height
    setTimeout(() => {
      textareaRef.current?.focus();
      adjustTextareaHeight();
    }, 0);
  }, [filePickerState, inputValue]);

  // Cancel file picker
  const handleFilePickerCancel = useCallback(() => {
    setFilePickerState(null);
    textareaRef.current?.focus();
  }, []);

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

  // Handle send - substitute @paths, clear input, and notify parent
  const handleSend = () => {
    let message = inputValue.trim();
    if ((!message && attachments.length === 0) || isSending) return;

    // Substitute @display paths with [file:fullPath] format before sending
    // This format enables nice display in YOU messages and is clear to Claude
    // Only substitutes paths that were selected from FilePicker (tracked in filePathMap)
    filePathMap.forEach((fullPath, displayPath) => {
      // Use global replace in case same file is referenced multiple times
      message = message.split(displayPath).join(`[file:${fullPath}]`);
    });

    const toSend = [...attachments];
    setInputValue('');
    setAttachments([]);
    setFilePathMap(new Map()); // Clear the tracking map
    onSend(message, toSend);
  };

  // Handle queue action - add message to queue and clear input
  const handleQueue = useCallback(() => {
    const message = inputValue.trim();
    if (!message && attachments.length === 0) return;

    // Substitute @display paths before queueing (same as handleSend)
    let processedMessage = message;
    filePathMap.forEach((fullPath, displayPath) => {
      processedMessage = processedMessage.split(displayPath).join(`[file:${fullPath}]`);
    });

    onQueue(processedMessage, [...attachments]);
    setInputValue('');
    setAttachments([]);
    setFilePathMap(new Map());
  }, [inputValue, attachments, filePathMap, onQueue]);

  // Handle Enter key to send/queue, Shift+Enter for newline, ArrowUp to edit queue
  // Don't submit if FilePicker is open (it handles Enter for selection)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ArrowUp: Edit last queued message if cursor is on first line
    if (e.key === 'ArrowUp' && queue.length > 0) {
      const textarea = e.target as HTMLTextAreaElement;
      const cursorLine = inputValue.substring(0, textarea.selectionStart).split('\n').length;

      if (cursorLine === 1) {
        e.preventDefault();
        const lastQueued = queue[queue.length - 1];
        onEditQueueMessage(lastQueued);
        // Load content into textarea
        setInputValue(lastQueued.content);
        setAttachments(lastQueued.attachments || []);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // If FilePicker is open, don't submit - let FilePicker handle Enter
      if (filePickerState?.isOpen) {
        return; // FilePicker's global handler will catch this
      }
      e.preventDefault();

      // If Claude is responding, queue instead of send
      if (isSending) {
        handleQueue();
      } else {
        handleSend();
      }
    }
  };

  // Handle input change with auto-resize and @ detection
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? value.length;

    // Detect @ or @@ pattern before cursor
    const beforeCursor = value.slice(0, cursorPos);
    // Match @@ or @ followed by non-whitespace characters at end of beforeCursor
    // Must be preceded by whitespace or start of string
    const atMatch = beforeCursor.match(/(?:^|[\s])@@?([^\s@]*)$/);

    if (atMatch) {
      const fullMatch = atMatch[0];
      const isDoubleAt = fullMatch.includes('@@');
      const query = atMatch[1]; // Text after @
      // Calculate trigger index - position of the @ in the input
      const triggerIndex = cursorPos - fullMatch.length + (fullMatch.startsWith(' ') || fullMatch.startsWith('\n') || fullMatch.startsWith('\t') ? 1 : 0);

      setFilePickerState({
        isOpen: true,
        isDoubleAt,
        triggerIndex,
        query
      });
    } else {
      // Close file picker if pattern no longer matches
      setFilePickerState(null);
    }

    setInputValue(value);
    // Use setTimeout to ensure the DOM has updated
    setTimeout(adjustTextareaHeight, 0);
  };

  // Adjust height when inputValue changes (e.g., after send clears it)
  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue]);

  // Generate new random verbs when sending starts
  useEffect(() => {
    if (isSending) {
      setThinkingVerbs(getRandomVerbs());
    }
  }, [isSending]);

  // ESC and Ctrl+C handler for cancelling Claude response
  // Use isSending since SendMessage blocks until Claude finishes
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isSending || !onCancel) return;

      // ESC key to cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }

      // Ctrl+C to cancel (only when textarea is not focused or empty)
      if (e.ctrlKey && e.key === 'c') {
        const selection = window.getSelection()?.toString();
        // Only cancel if nothing is selected (otherwise it's a copy operation)
        if (!selection) {
          e.preventDefault();
          onCancel();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isSending, onCancel]);

  // Only disable for pending questions - allow typing while Claude is thinking
  const isDisabled = hasPendingQuestion;
  const isSendDisabled = isSending || (!inputValue.trim() && attachments.length === 0) || hasPendingQuestion;
  // Show split button (Stop + Queue) when isSending is true
  const showSplitButton = isSending;
  // Queue button is disabled if input is empty
  const isQueueDisabled = (!inputValue.trim() && attachments.length === 0);

  // Diagonal stripe pattern for "waiting" state
  const waitingBackground = isSending
    ? `repeating-linear-gradient(
        -45deg,
        #0a0a0a,
        #0a0a0a 8px,
        #0f0f0f 8px,
        #0f0f0f 16px
      )`
    : '#0a0a0a';

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        border: isDragOver ? '2px dashed #d97757' : '2px dashed transparent',
        borderRadius: '12px',
        padding: isDragOver ? '0.5rem' : '0',
        transition: 'border-color 0.15s ease, padding 0.15s ease',
        margin: isDragOver ? '-0.5rem' : '0'
      }}
    >
      {/* Queue display - styled exactly like YOU messages */}
      {queue.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          {queue.map((msg, index) => (
            <div key={msg.id} style={{ marginBottom: index < queue.length - 1 ? '12px' : '0' }}>
              {/* Header exactly like user message: YOU in orange, then gray text */}
              <div style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{ color: '#d97757' }}>You</span>
                <span style={{
                  fontWeight: 400,
                  color: '#444',
                  textTransform: 'none',
                  letterSpacing: 'normal'
                }}>
                  Queued #{index + 1}
                </span>
                {msg.attachments && msg.attachments.length > 0 && (
                  <span style={{ color: '#666', display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 400 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    {msg.attachments.length}
                  </span>
                )}
              </div>
              {/* Message bubble exactly like user message */}
              <div
                onClick={() => {
                  onEditQueueMessage(msg);
                  setInputValue(msg.content);
                  setAttachments(msg.attachments || []);
                }}
                style={{
                  color: '#ccc',
                  fontSize: '0.9rem',
                  lineHeight: '1.6',
                  padding: '0.75rem 1rem',
                  background: '#1a1a1a',
                  borderRadius: '8px',
                  borderLeft: '3px solid #d97757',
                  cursor: 'pointer',
                  position: 'relative',
                  textAlign: 'left'
                }}
              >
                <div style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>
                  {msg.content || '(empty)'}
                </div>
                {/* Delete button - top right corner */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFromQueue(msg.id);
                  }}
                  title="Remove from queue"
                  style={{
                    position: 'absolute',
                    top: '6px',
                    right: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: '#444',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                    transition: 'color 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ef4444';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#444';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACHMENT_LIMITS.SUPPORTED_TYPES.join(',')}
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      <div style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'stretch'
      }}>
        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled || attachments.length >= ATTACHMENT_LIMITS.MAX_IMAGES}
          title="Attach images (or drag & drop, or paste)"
          style={{
            width: '44px',
            minHeight: '100px',
            borderRadius: '8px',
            border: '1px solid #333',
            background: '#1a1a1a',
            color: isDisabled ? '#444' : '#888',
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s ease',
            flexShrink: 0,
            boxSizing: 'border-box'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>

        {/* Textarea wrapper for floating status chip */}
        <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isSending ? `Claude is ${thinkingVerbs[0]}, ${thinkingVerbs[1]} and ${thinkingVerbs[2]}... type your next message!` :
              hasPendingQuestion ? 'Claude has a question... please answer above ↑' :
              'Type a message... (Shift+Enter for newline)'
            }
            disabled={isDisabled}
            rows={1}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: isSending ? '1px solid #444' : '1px solid #333',
              background: waitingBackground,
              color: '#ccc',
              fontSize: '0.85rem',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'none',
              lineHeight: '1.5',
              minHeight: '100px',  // ~5 lines
              maxHeight: '308px', // ~14 lines
              overflowY: 'hidden',
              boxSizing: 'border-box',
              flex: 1
            }}
          />
          {/* Dancing Clawd watermark - centered in textarea while thinking */}
          {isSending && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              opacity: 0.25,
              pointerEvents: 'none',
              zIndex: 1
            }}>
              <img
                src="/assets/clawd-dance.gif"
                width="60"
                height="60"
                alt=""
                style={{ display: 'block' }}
              />
            </div>
          )}
          {/* Floating status chip - bottom right of textarea */}
          {(newSessionMode || planningMode) && (
            <div style={{
              position: 'absolute',
              bottom: '6px',
              right: '8px',
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              padding: '2px 8px',
              background: 'rgba(10, 10, 10, 0.9)',
              borderRadius: '4px',
              border: '1px solid #333',
              fontSize: '0.65rem',
              color: '#d97757',
              pointerEvents: 'none'
            }}>
              {newSessionMode && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ fontSize: '1em' }}>+</span> Create New Session
                </span>
              )}
              {newSessionMode && planningMode && (
                <span style={{ color: '#444' }}>•</span>
              )}
              {planningMode && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    <line x1="9" y1="12" x2="15" y2="12" />
                    <line x1="9" y1="16" x2="15" y2="16" />
                  </svg>
                  Planning Mode
                </span>
              )}
            </div>
          )}
        </div>
        {showSplitButton ? (
          <SplitButton
            onStop={onCancel || (() => {})}
            onQueue={handleQueue}
            queueDisabled={isQueueDisabled}
            isCancelling={isCancelling}
          />
        ) : (
          <button
            onClick={handleSend}
            disabled={isSendDisabled}
            style={{
              width: '70px',
              minHeight: '100px',
              borderRadius: '8px',
              border: 'none',
              background: isSendDisabled ? '#333' : '#d97757',
              color: isSendDisabled ? '#666' : '#fff',
              cursor: isSendDisabled ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              transition: 'background 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxSizing: 'border-box'
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
        )}
      </div>

      {/* Drag overlay */}
      {isDragOver && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(217, 119, 87, 0.1)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}>
          <span style={{
            color: '#d97757',
            fontWeight: 500,
            fontSize: '0.9rem'
          }}>
            Drop images here
          </span>
        </div>
      )}

      {/* File Picker for @ references */}
      {filePickerState?.isOpen && (
        <FilePicker
          query={filePickerState.query}
          agentId={agentId}
          isDoubleAt={filePickerState.isDoubleAt}
          anchorRef={textareaRef as React.RefObject<HTMLElement>}
          onSelect={handleFilePickerSelect}
          onCancel={handleFilePickerCancel}
        />
      )}
    </div>
  );
});
