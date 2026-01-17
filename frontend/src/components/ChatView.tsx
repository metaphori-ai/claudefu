import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GetConversation, SetActiveSession, ClearActiveSession, SendMessage, MarkSessionViewed, NewSession, ReadPlanFile, GetPlanFilePath, AnswerQuestion } from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import { CompactionCard } from './CompactionCard';
import { CompactionPane } from './CompactionPane';
import { ToolCallBlock } from './ToolCallBlock';
import { ToolDetailPane } from './ToolDetailPane';
import { ImageBlock } from './ImageBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { SlideInPane } from './SlideInPane';
import { ClaudeSettingsDialog } from './ClaudeSettingsDialog';
import { PermissionsDialog } from './PermissionsDialog';

// ImageSource for image blocks
interface ImageSource {
  type: string;       // "base64", "file", "url"
  media_type?: string; // "image/png", "image/jpeg", etc.
  data: string;       // Base64 data, file path, or URL
}

// Content block type matches the Go types.ContentBlock
interface ContentBlock {
  type: string;
  // Text block
  text?: string;
  // Tool use block
  id?: string;        // Tool use ID
  name?: string;      // Tool name
  input?: any;        // Tool input parameters
  // Tool result block
  tool_use_id?: string; // References tool_use block ID
  content?: any;      // Result content (string or structured)
  is_error?: boolean;
  // Image block
  source?: ImageSource;
  // Thinking block
  thinking?: string;
  signature?: string;
}

// PendingQuestion from Go backend - indicates an AskUserQuestion that failed in --print mode
interface PendingQuestion {
  toolUseId: string;
  questions: any[];
}

// Message type with UI-specific fields
// We use a plain interface instead of extending types.Message because
// we create plain objects that don't have the class methods
interface Message {
  uuid: string;
  type: string;
  content: string;
  contentBlocks?: ContentBlock[];
  timestamp: string;
  isCompaction?: boolean;
  compactionPreview?: string;
  isPending?: boolean;  // True for optimistic messages sent from ClaudeFu
  isFailed?: boolean;   // True if send failed
  pendingQuestion?: PendingQuestion;  // Non-null if this message contains a failed AskUserQuestion
  isSynthetic?: boolean;  // True if model="<synthetic>" (e.g., "No response requested.")
}

interface ChatViewProps {
  agentId: string;
  folder: string;
  sessionId: string;
  onSessionCreated?: (newSessionId: string, initialMessage: string) => void;  // Called when a new session is created with user's message
  initialMessage?: string;  // Message to auto-send when ChatView mounts (for new session flow)
}

// CSS keyframes for spinner animation
const spinnerStyles = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

export function ChatView({ agentId, folder, sessionId, onSessionCreated, initialMessage }: ChatViewProps) {
  // Inject spinner animation styles
  useEffect(() => {
    const styleId = 'chatview-spinner-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = spinnerStyles;
      document.head.appendChild(style);
    }
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showDebugStats, setShowDebugStats] = useState(false);
  const [scrollDebug, setScrollDebug] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0, distanceFromBottom: 0, isNearBottom: true });

  // Toggle debug stats with Ctrl+D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        setShowDebugStats(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Compute debug stats
  const debugStats = React.useMemo(() => {
    const typeCounts: Record<string, number> = {};
    let userMsgCount = 0;
    let assistantMsgCount = 0;
    let toolResultCarrierCount = 0;
    for (const msg of messages) {
      typeCounts[msg.type] = (typeCounts[msg.type] || 0) + 1;
      if (msg.type === 'user') userMsgCount++;
      if (msg.type === 'assistant') assistantMsgCount++;
      if (msg.type === 'tool_result_carrier') toolResultCarrierCount++;
    }
    return {
      total: messages.length,
      typeCounts,
      userMsgCount,
      assistantMsgCount,
      toolResultCarrierCount,
      displayable: messages.filter(m => m.type !== 'tool_result_carrier').length
    };
  }, [messages]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compactionContent, setCompactionContent] = useState<string | null>(null);
  const [selectedToolCall, setSelectedToolCall] = useState<ContentBlock | null>(null);
  const [selectedToolResult, setSelectedToolResult] = useState<ContentBlock | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [forceScrollActive, setForceScrollActive] = useState(false);  // Force scroll until user scrolls away
  const forceScrollActiveRef = useRef<boolean>(false);  // Ref for use in closures

  // Toggle states for prompt controls
  const [newSessionMode, setNewSessionMode] = useState(false);
  const [planningMode, setPlanningMode] = useState(false);
  const [latestPlanFile, setLatestPlanFile] = useState<string | null>(null);
  const [planPaneOpen, setPlanPaneOpen] = useState(false);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [claudeSettingsOpen, setClaudeSettingsOpen] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);

  const pendingMessagesRef = useRef<Set<string>>(new Set());  // Track pending message content for deduplication
  const processedUUIDsRef = useRef<Set<string>>(new Set());   // Track already processed UUIDs to prevent duplicates
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);  // Debounce rapid fsnotify events
  const pendingEventDataRef = useRef<{ sessionId: string; messages: Message[] } | null>(null);  // Store pending event
  const watcherPausedRef = useRef<boolean>(false);  // Pause watcher during JSONL patching to avoid stale data
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      console.log('ChatView initSession:', { agentId, sessionId });

      // Clear tracking refs for new session
      pendingMessagesRef.current.clear();
      processedUUIDsRef.current.clear();

      // Set this as the active session for streaming events
      // The watcher is already running at the agent level
      console.log('Calling SetActiveSession with:', { agentId, sessionId });
      SetActiveSession(agentId, sessionId);

      // Mark session as viewed
      try {
        await MarkSessionViewed(agentId, sessionId);
      } catch (err) {
        console.error('Failed to mark session as viewed:', err);
      }

      // Load initial conversation
      await loadConversation();
    };

    initSession();

    // Listen for new messages and append them (EventEnvelope structure)
    // The watcher sends session:messages for the active session
    const handleSessionMessages = (envelope: { sessionId?: string; payload?: { messages?: Message[] } }) => {
      // Skip if watcher is paused (during JSONL patching)
      if (watcherPausedRef.current) {
        console.log('handleSessionMessages: SKIPPED (watcher paused for patching)');
        return;
      }

      const data = { sessionId: envelope.sessionId || '', messages: envelope.payload?.messages || [] };
      console.log('handleSessionMessages called:', {
        dataSessionId: data.sessionId,
        expectedSessionId: sessionId,
        messageCount: data.messages?.length
      });
      if (data.sessionId !== sessionId || !data.messages?.length) return;

      // Debounce: fsnotify fires multiple times for single file write
      // Store the latest event and process after a short delay
      pendingEventDataRef.current = data;
      if (debounceTimerRef.current) {
        console.log('Debouncing - clearing previous timer');
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        const eventData = pendingEventDataRef.current;
        if (!eventData) return;
        pendingEventDataRef.current = null;
        debounceTimerRef.current = null;
        processNewMessages(eventData);
      }, 50);  // 50ms debounce window
    };

    const processNewMessages = (data: { sessionId: string; messages: Message[] }) => {
      console.log('processNewMessages:', { messageCount: data.messages.length });

      // Capture scroll position BEFORE updating state
      // This way we know if user was at bottom before new messages arrived
      const wasNearBottom = isNearBottom();

      // IMPORTANT: Process messages and update refs OUTSIDE setMessages
      // React Strict Mode double-invokes the updater function, so it must be pure
      const messagesToAdd: Message[] = [];
      let sawNonUserMessage = false;
      let clearedPendingContent: string | null = null;

      for (const msg of data.messages) {
        console.log('Processing:', { uuid: msg.uuid.substring(0, 8), type: msg.type, processed: processedUUIDsRef.current.has(msg.uuid) });

        // Skip if already processed
        if (processedUUIDsRef.current.has(msg.uuid)) {
          continue;
        }
        // Mark as processed NOW (outside the callback)
        processedUUIDsRef.current.add(msg.uuid);

        if (msg.type !== 'user') {
          sawNonUserMessage = true;
        }

        // If we see a new user message from watcher (CLI input), activate force scroll
        if (msg.type === 'user' && !pendingMessagesRef.current.has(msg.content)) {
          forceScrollActiveRef.current = true;
          setForceScrollActive(true);
          console.log('FORCE SCROLL ACTIVATED (from watcher)');
        }

        const isPendingMatch = msg.type === 'user' && pendingMessagesRef.current.has(msg.content);
        if (isPendingMatch) {
          console.log('PENDING MATCH - replacing pending with real');
          clearedPendingContent = msg.content;
          pendingMessagesRef.current.delete(msg.content);
        }

        messagesToAdd.push(msg as Message);
      }

      // If nothing to do, skip state update entirely
      if (messagesToAdd.length === 0 && !sawNonUserMessage) {
        console.log('No new messages to add');
        return;
      }

      // Now call setMessages with a PURE updater function
      setMessages(prev => {
        console.log('setMessages prev:', { count: prev.length });

        // Filter out pending message if we got the real one
        let updatedMessages = prev;
        if (clearedPendingContent !== null) {
          updatedMessages = prev.filter(m => !(m.isPending && m.content === clearedPendingContent));
          console.log('Filtered pending, was:', prev.length, 'now:', updatedMessages.length);
        }

        // Clear spinner on remaining pending messages if we saw assistant response
        if (sawNonUserMessage) {
          updatedMessages = updatedMessages.map(m =>
            m.isPending ? { ...m, isPending: false } : m
          );
        }

        const finalMessages = [...updatedMessages, ...messagesToAdd];
        console.log('State update:', {
          prevCount: prev.length,
          newCount: messagesToAdd.length,
          finalCount: finalMessages.length,
          lastMsg: finalMessages[finalMessages.length - 1]?.content?.substring(0, 30)
        });

        return finalMessages;
      });

      // Mark as viewed since user is actively viewing this session
      // This clears the unread badge for messages we just displayed
      MarkSessionViewed(agentId, sessionId).catch(err => {
        console.error('Failed to mark session as viewed:', err);
      });

      // Refresh plan file path (backend extracts from new messages)
      GetPlanFilePath(agentId, sessionId).then(planPath => {
        if (planPath) {
          setLatestPlanFile(planPath);
        }
      }).catch(err => {
        console.error('Failed to get plan file path:', err);
      });

      // Scroll to bottom for NEW streaming messages
      // Force scroll if user sent a message and hasn't scrolled away
      // Otherwise only scroll if user WAS near bottom before update
      const forceActive = forceScrollActiveRef.current;
      const shouldScroll = wasNearBottom || forceActive;
      console.log('SCROLL CHECK:', { wasNearBottom, forceActive, shouldScroll });
      if (shouldScroll) {
        // Double-RAF to ensure DOM has fully updated after React commit
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
              console.log('SCROLLING TO BOTTOM:', scrollContainerRef.current.scrollHeight);
              scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
            }
          });
        });
      }
    };
    console.log('Registering EventsOn for session:messages');
    EventsOn('session:messages', handleSessionMessages);

    // Also listen for unread updates to verify events are working
    const debugUnread = (data: any) => {
      console.log('DEBUG unread:changed received:', data);
    };
    EventsOn('unread:changed', debugUnread);

    // Cleanup on unmount or session change
    return () => {
      console.log('ChatView cleanup - session:', sessionId);
      isMounted = false;
      EventsOff('session:messages');
      EventsOff('unread:changed');  // Remove debug listener
      // Clear debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      // Don't call ClearActiveSession here - it causes a race condition when
      // switching sessions within the same agent. The new SetActiveSession()
      // will overwrite the old values anyway.
    };
  }, [agentId, sessionId]);

  // Auto-send initialMessage when provided (for new session flow)
  const initialMessageSentRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !initialMessageSentRef.current && !isLoading) {
      initialMessageSentRef.current = true;
      console.log('Auto-sending initial message:', initialMessage);
      // Directly trigger the send logic
      const sendInitialMessage = async () => {
        setIsSending(true);
        // Create optimistic pending message
        const pendingMessage: Message = {
          type: 'user',
          content: initialMessage,
          timestamp: new Date().toISOString(),
          uuid: `pending-${Date.now()}`,
          isPending: true
        };
        pendingMessagesRef.current.add(initialMessage);
        forceScrollActiveRef.current = true;
        setForceScrollActive(true);
        setMessages(prev => [...prev, pendingMessage]);

        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
        });

        try {
          await SendMessage(agentId, sessionId, initialMessage, planningMode);
        } catch (err) {
          console.error('Failed to send initial message:', err);
          pendingMessagesRef.current.delete(initialMessage);
          setMessages(prev =>
            prev.map(m =>
              m.uuid === pendingMessage.uuid
                ? { ...m, isPending: false, isFailed: true }
                : m
            )
          );
        } finally {
          setIsSending(false);
        }
      };
      sendInitialMessage();
    }
  }, [initialMessage, isLoading, agentId, sessionId, planningMode]);

  // Note: Auto-scroll is handled explicitly:
  // - Initial load: scrolls after loadConversation completes
  // - Streaming: scrolls in handleSessionMessages

  const loadConversation = async () => {
    setIsLoading(true);
    setError(null);
    try {
      console.log('[DEBUG] loadConversation: fetching for', { agentId: agentId.substring(0, 8), sessionId: sessionId.substring(0, 8) });
      const msgs = await GetConversation(agentId, sessionId);

      // Debug: count message types
      const typeCounts: Record<string, number> = {};
      let userCount = 0;
      if (msgs) {
        for (const msg of msgs) {
          typeCounts[msg.type] = (typeCounts[msg.type] || 0) + 1;
          if (msg.type === 'user') userCount++;
        }
      }
      console.log('[DEBUG] loadConversation: received', {
        total: msgs?.length || 0,
        typeCounts,
        userCount,
        firstMsg: msgs?.[0]?.type,
        lastMsg: msgs?.[msgs?.length - 1]?.type
      });

      // DEBUG: Log tool_result blocks and their is_error values
      if (msgs) {
        for (const msg of msgs) {
          const blocks = msg.contentBlocks || [];
          for (const block of blocks) {
            if (block.type === 'tool_result') {
              console.log('[DEBUG] loadConversation tool_result:', {
                tool_use_id: block.tool_use_id?.substring(0, 15),
                is_error: block.is_error,
                is_error_type: typeof block.is_error,
                content_preview: typeof block.content === 'string' ? block.content.substring(0, 50) : 'non-string'
              });
            }
          }
        }
      }

      setMessages(msgs || []);

      // Get plan file path from backend (it extracts from messages during processing)
      const planPath = await GetPlanFilePath(agentId, sessionId);
      if (planPath) {
        console.log('Found plan file:', planPath);
        setLatestPlanFile(planPath);
      }

      // Initialize processedUUIDs with loaded messages to prevent re-processing
      if (msgs) {
        for (const msg of msgs) {
          if (msg.uuid) {
            processedUUIDsRef.current.add(msg.uuid);
          }
        }
      }
      // Scroll to bottom after initial load
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      });
    } catch (err) {
      console.error('[DEBUG] loadConversation error:', err);
      setError(`Failed to load conversation: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Check if user is scrolled near bottom (within 300px)
  const isNearBottom = () => {
    if (!scrollContainerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    return scrollHeight - scrollTop - clientHeight < 300;
  };

  // Scroll to bottom only if user is already near bottom
  const scrollToBottomIfNearBottom = () => {
    if (isNearBottom() && scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      });
    }
  };

  // Scroll to bottom (for button click) - also reactivates force scroll
  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      // Reactivate force scroll since user wants to follow
      forceScrollActiveRef.current = true;
      setForceScrollActive(true);
      console.log('FORCE SCROLL ACTIVATED (scroll to bottom button)');
    }
  };

  // Track scroll position to show/hide scroll button
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setShowScrollButton(distanceFromBottom > 150);

      // Turn off force scroll if user scrolls away from bottom
      if (distanceFromBottom > 300 && forceScrollActiveRef.current) {
        forceScrollActiveRef.current = false;
        setForceScrollActive(false);
        console.log('FORCE SCROLL DEACTIVATED (user scrolled away)');
      }

      // Update scroll debug info
      setScrollDebug({
        scrollTop: Math.round(scrollTop),
        scrollHeight: Math.round(scrollHeight),
        clientHeight: Math.round(clientHeight),
        distanceFromBottom: Math.round(distanceFromBottom),
        isNearBottom: distanceFromBottom < 300
      });
    };

    container.addEventListener('scroll', handleScroll);
    // Check initial state
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages]); // Re-attach when messages change

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Build a GLOBAL map of tool results by tool_use_id from ALL messages.
  // Tool results often come in separate messages from their tool_use blocks.
  const globalToolResultMap = React.useMemo(() => {
    const map = new Map<string, ContentBlock>();
    for (const msg of messages) {
      const blocks = msg.contentBlocks || [];
      for (const block of blocks) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          map.set(block.tool_use_id, block);
        }
      }
    }
    return map;
  }, [messages]);

  // Build a GLOBAL map of pending questions by tool_use_id.
  // The pendingQuestion is attached to the USER message with the failed tool_result,
  // but we need it when rendering the ASSISTANT message with the tool_use.
  const globalPendingQuestionMap = React.useMemo(() => {
    const map = new Map<string, PendingQuestion>();
    for (const msg of messages) {
      if (msg.pendingQuestion) {
        console.log('[DEBUG] Found pendingQuestion:', msg.pendingQuestion);
        map.set(msg.pendingQuestion.toolUseId, msg.pendingQuestion);
      }
    }
    console.log('[DEBUG] globalPendingQuestionMap size:', map.size);
    return map;
  }, [messages]);

  // Check if there's a pending question
  const hasPendingQuestion = globalPendingQuestionMap.size > 0;

  // Check if any AskUserQuestion was answered successfully (is_error=false)
  // This is used to filter out synthetic "No response requested." messages
  const hasSuccessfulAskUserQuestion = React.useMemo(() => {
    for (const msg of messages) {
      const blocks = msg.contentBlocks || [];
      for (const block of blocks) {
        // Find AskUserQuestion tool_use blocks
        if (block.type === 'tool_use' && block.name === 'AskUserQuestion' && block.id) {
          const result = globalToolResultMap.get(block.id);
          // Check if the result exists and is successful (is_error=false)
          if (result && result.is_error === false) {
            return true;
          }
        }
      }
    }
    return false;
  }, [messages, globalToolResultMap]);

  // Find the index of the message containing a pending question
  // We'll hide all messages AFTER this one (Claude's error response, etc.)
  const pendingQuestionMsgIdx = React.useMemo(() => {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.pendingQuestion && globalPendingQuestionMap.has(msg.pendingQuestion.toolUseId)) {
        return i;
      }
    }
    return -1;
  }, [messages, globalPendingQuestionMap]);

  // Filter messages: hide all messages AFTER the one with pending question
  // Also filter out synthetic messages when AskUserQuestion was answered successfully
  const messagesToRender = React.useMemo(() => {
    let filtered = pendingQuestionMsgIdx >= 0
      ? messages.slice(0, pendingQuestionMsgIdx + 1)
      : messages;

    // Filter out synthetic messages if AskUserQuestion was answered successfully
    if (hasSuccessfulAskUserQuestion) {
      filtered = filtered.filter(msg => !msg.isSynthetic);
    }

    return filtered;
  }, [messages, pendingQuestionMsgIdx, hasSuccessfulAskUserQuestion]);

  // Helper to convert ImageSource to displayable URL
  const getImageUrl = (source?: ImageSource): string | null => {
    if (!source) return null;
    switch (source.type) {
      case 'base64':
        return `data:${source.media_type || 'image/png'};base64,${source.data}`;
      case 'file':
      case 'url':
        return source.data;
      default:
        return null;
    }
  };

  // Handle viewing tool details
  const handleViewToolDetails = (toolCall: ContentBlock, result?: ContentBlock) => {
    setSelectedToolCall(toolCall);
    setSelectedToolResult(result || null);
  };

  // Handle answering a pending AskUserQuestion
  const handleQuestionAnswer = async (
    toolUseId: string,
    questions: any[],
    answers: Record<string, string>
  ) => {
    try {
      console.log('[PATCH] === START handleQuestionAnswer ===');
      console.log('[PATCH] toolUseId:', toolUseId);
      console.log('[PATCH] Current messages count:', messages.length);

      // PAUSE watcher events for this session to avoid stale data during patching
      watcherPausedRef.current = true;
      console.log('[PATCH] Watcher paused for patching');

      // Cancel any pending debounced watcher events - they have stale data
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        pendingEventDataRef.current = null;
        console.log('[PATCH] Cancelled pending debounced events');
      }

      // AnswerQuestion patches the JSONL, deletes stale messages, and resumes Claude
      // This waits for Claude CLI to complete
      console.log('[PATCH] Calling AnswerQuestion...');
      await AnswerQuestion(agentId, sessionId, toolUseId, questions, answers);
      console.log('[PATCH] AnswerQuestion completed');

      // Clear processed UUIDs so we can receive all messages fresh
      processedUUIDsRef.current.clear();
      console.log('[PATCH] Cleared processedUUIDs');

      // Reload conversation to get the patched messages
      console.log('[PATCH] Calling loadConversation...');
      await loadConversation();
      console.log('[PATCH] loadConversation completed');

      // RESUME watcher events now that we have clean state
      watcherPausedRef.current = false;
      console.log('[PATCH] Watcher resumed');
      console.log('[PATCH] === END handleQuestionAnswer ===');
    } catch (err) {
      console.error('[PATCH] Failed to answer question:', err);
      // Ensure watcher is resumed even on error
      watcherPausedRef.current = false;
    }
  };

  // Handle skipping a pending AskUserQuestion
  const handleQuestionSkip = async (toolUseId: string) => {
    try {
      // Send a message telling Claude the user skipped the question
      await SendMessage(agentId, sessionId, "I'm skipping this question. Please continue.", planningMode);
      // Clear processed UUIDs so we can receive all messages
      processedUUIDsRef.current.clear();
      // Reload to get updated state
      await loadConversation();
    } catch (err) {
      console.error('Failed to skip question:', err);
    }
  };

  // Handle sending a message to Claude
  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;

    const message = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    // If New Session mode, create session and hand off to parent
    if (newSessionMode) {
      try {
        console.log('Creating new session for agent:', agentId);
        // Show "Creating new session..." placeholder
        setIsCreatingSession(true);
        setMessages([]);
        const newSessionId = await NewSession(agentId);
        console.log('New session created:', newSessionId);
        setNewSessionMode(false);  // Reset toggle
        setIsCreatingSession(false);
        // Notify parent to switch and send the message
        if (onSessionCreated) {
          onSessionCreated(newSessionId, message);
        }
        // Parent will switch sessions and pass initialMessage to new ChatView
        // We're done here - don't send message ourselves
        setIsSending(false);
        return;
      } catch (err) {
        console.error('Failed to create new session:', err);
        setIsCreatingSession(false);
        setIsSending(false);
        setInputValue(message);  // Restore input
        // Reload messages since we cleared them
        loadConversation();
        return;
      }
    }

    let targetSessionId = sessionId;

    // Create optimistic pending message
    const pendingMessage: Message = {
      type: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      uuid: `pending-${Date.now()}`,
      isPending: true
    };

    // Track for deduplication when watcher confirms
    pendingMessagesRef.current.add(message);

    // Activate force scroll until user scrolls away
    forceScrollActiveRef.current = true;
    setForceScrollActive(true);
    console.log('FORCE SCROLL ACTIVATED (from UI)');

    // Add to messages immediately
    setMessages(prev => [...prev, pendingMessage]);

    // Scroll to show the new message
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    });

    try {
      await SendMessage(agentId, targetSessionId, message, planningMode);
      // Response comes via existing session:messages event from watcher
      // The pending message will be deduplicated when watcher emits it
    } catch (err) {
      console.error('Failed to send message:', err);
      // Remove from pending tracking
      pendingMessagesRef.current.delete(message);
      // Mark the message as failed (update isPending to show error)
      setMessages(prev =>
        prev.map(m =>
          m.uuid === pendingMessage.uuid
            ? { ...m, isPending: false, isFailed: true }
            : m
        )
      );
      // Restore the message to input
      setInputValue(message);
    } finally {
      setIsSending(false);
    }
  };

  // Ref for auto-resizing textarea
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
      handleSend();
    }
  };

  // Handle input change with auto-resize
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    // Use setTimeout to ensure the DOM has updated
    setTimeout(adjustTextareaHeight, 0);
  };

  // Adjust height when inputValue changes (e.g., after send clears it)
  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue]);

  // Parse text content for embedded image references like [Image: source: /path/to/file]
  const parseTextWithImages = (text: string): React.ReactNode[] => {
    const imagePattern = /\[Image: source: ([^\]]+)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = imagePattern.exec(text)) !== null) {
      // Add text before the image
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>
        );
      }
      // Add the image
      const imagePath = match[1].trim();
      parts.push(
        <div key={`img-${match.index}`} style={{ margin: '0.5rem 0' }}>
          <ImageBlock src={imagePath} />
        </div>
      );
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(
        <span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>
      );
    }

    return parts.length > 0 ? parts : [<span key="text">{text}</span>];
  };

  // Render content blocks with colored dots for continuation
  const renderContentBlocks = (blocks: ContentBlock[], fallbackContent: string) => {
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

    // Use global tool result map (tool results often come in separate messages)
    const toolResultMap = globalToolResultMap;

    // Filter out tool_result blocks (they'll be shown with their tool_use)
    const displayBlocks = blocks.filter(b => b.type !== 'tool_result');

    // Check if there's a pending AskUserQuestion in this message
    // If so, we should stop rendering blocks after it (Claude's "post-tool" response should be hidden)
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
          const isFirstBlock = idx === 0;

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
                    components={{
                      // Tables
                      table({ children }) {
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
                      thead({ children }) {
                        return <thead style={{ background: '#1a1a1a' }}>{children}</thead>;
                      },
                      tbody({ children }) {
                        return <tbody>{children}</tbody>;
                      },
                      tr({ children }) {
                        return <tr style={{ borderBottom: '1px solid #333' }}>{children}</tr>;
                      },
                      th({ children }) {
                        return (
                          <th style={{
                            padding: '0.5rem 0.75rem',
                            textAlign: 'left',
                            fontWeight: 600,
                            color: '#fff',
                            borderBottom: '2px solid #444'
                          }}>
                            {children}
                          </th>
                        );
                      },
                      td({ children }) {
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
                      code({ node, className, children, ...props }) {
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
                      // Preformatted blocks
                      pre({ children }) {
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
                      p({ children }) {
                        return (
                          <p style={{ margin: '0 0 0.75rem 0' }}>
                            {children}
                          </p>
                        );
                      },
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
                      // Links
                      a({ href, children }) {
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
                      blockquote({ children }) {
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
                      strong({ children }) {
                        return <strong style={{ color: '#fff', fontWeight: 600 }}>{children}</strong>;
                      },
                      // Emphasis/Italic
                      em({ children }) {
                        return <em style={{ fontStyle: 'italic' }}>{children}</em>;
                      }
                    }}
                  >
                    {block.text}
                  </ReactMarkdown>
                </div>
              </div>
            );
          }

          if (block.type === 'tool_use') {
            const result = block.id ? toolResultMap.get(block.id) : undefined;
            // Check if this is a pending AskUserQuestion that needs interactive UI
            const pendingQ = block.name === 'AskUserQuestion' && block.id
              ? globalPendingQuestionMap.get(block.id)
              : undefined;
            return (
              <ToolCallBlock
                key={idx}
                block={block}
                result={result}
                onViewDetails={handleViewToolDetails}
                pendingQuestion={pendingQ}
                onAnswer={pendingQ ? handleQuestionAnswer : undefined}
                onSkip={pendingQ ? handleQuestionSkip : undefined}
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
  };

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#666'
      }}>
        Loading conversation...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#f87171'
      }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    }}>
      {/* Debug Stats Overlay - toggle with Ctrl+D */}
      {showDebugStats && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          background: 'rgba(0, 0, 0, 0.9)',
          border: '1px solid #333',
          padding: '0.75rem 1rem',
          fontSize: '0.75rem',
          fontFamily: 'monospace',
          color: '#8f8',
          zIndex: 1000
        }}>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <span>Total: {debugStats.total}</span>
            <span>Displayable: {debugStats.displayable}</span>
            <span style={{ color: '#f97316' }}>User: {debugStats.userMsgCount}</span>
            <span style={{ color: '#77c' }}>Assistant: {debugStats.assistantMsgCount}</span>
            <span style={{ color: '#666' }}>Carriers: {debugStats.toolResultCarrierCount}</span>
          </div>
          <div style={{ marginTop: '0.5rem', color: '#888' }}>
            Types: {Object.entries(debugStats.typeCounts).map(([k, v]) => `${k}:${v}`).join(', ')}
          </div>
          <div style={{ marginTop: '0.5rem', color: '#6cf', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <span>scrollTop: {scrollDebug.scrollTop}</span>
            <span>scrollHeight: {scrollDebug.scrollHeight}</span>
            <span>clientHeight: {scrollDebug.clientHeight}</span>
            <span style={{ color: scrollDebug.isNearBottom ? '#8f8' : '#f88' }}>
              distFromBottom: {scrollDebug.distanceFromBottom} ({scrollDebug.isNearBottom ? 'NEAR' : 'FAR'})
            </span>
            <span style={{ color: forceScrollActive ? '#ff0' : '#666' }}>
              forceScroll: {forceScrollActive ? 'ACTIVE' : 'off'}
            </span>
          </div>
          <div style={{ marginTop: '0.25rem', color: '#666', fontSize: '0.65rem' }}>
            agentId: {agentId.substring(0, 8)}... | sessionId: {sessionId.substring(0, 8)}... | threshold: 300px | Press Ctrl+D to hide
          </div>
        </div>
      )}

      {/* Messages Area Wrapper */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Scrollable Messages */}
        <div
          ref={scrollContainerRef}
          className="messages-scroll"
          style={{
            height: '100%',
            overflowY: 'scroll',
            padding: '1.5rem 2rem 2.5rem 2rem', // Extra bottom padding for breathing room
            textAlign: 'left'
          }}
        >
          {/* Creating new session indicator */}
          {isCreatingSession && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              padding: '2rem',
              color: '#888'
            }}>
              <span style={{
                display: 'inline-block',
                width: '16px',
                height: '16px',
                border: '2px solid #333',
                borderTopColor: '#f97316',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              Creating new session...
            </div>
          )}

          {messagesToRender
            .filter(msg => msg.type !== 'tool_result_carrier') // Don't render carrier messages
            .map((message, index) => (
          <div key={message.uuid || index}>
            {/* Compaction Message */}
            {message.isCompaction ? (
              <CompactionCard
                preview={message.compactionPreview || "Click to view context summary"}
                timestamp={message.timestamp}
                onClick={() => setCompactionContent(message.content)}
              />
            ) : (
            <div
              style={{
                marginBottom: '1.5rem'
              }}
            >
            {/* Role Label - only show for user messages */}
            {message.type === 'user' && (
              <div style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: message.isFailed ? '#f87171' : '#f97316',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                You
                <span style={{
                  fontWeight: 400,
                  color: '#444',
                  textTransform: 'none',
                  letterSpacing: 'normal'
                }}>
                  {formatTime(message.timestamp)}
                </span>
                {/* Pending spinner */}
                {message.isPending && (
                  <span style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    border: '2px solid #333',
                    borderTopColor: '#f97316',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                )}
                {/* Failed indicator */}
                {message.isFailed && (
                  <span style={{ color: '#f87171', fontWeight: 400, textTransform: 'none' }}>
                    (failed to send)
                  </span>
                )}
              </div>
            )}

            {/* Message Content */}
            {message.type === 'user' ? (
              // User message - text with slight background, may include images
              <div style={{
                color: message.isFailed ? '#888' : '#ccc',
                fontSize: '0.9rem',
                lineHeight: '1.6',
                padding: '0.75rem 1rem',
                background: '#1a1a1a',
                borderRadius: '8px',
                borderLeft: `3px solid ${message.isFailed ? '#f87171' : message.isPending ? '#666' : '#f97316'}`,
                opacity: message.isPending ? 0.8 : 1
              }}>
                {/* Show images from content blocks */}
                {message.contentBlocks?.filter(b => b.type === 'image' && b.source).map((block, idx) => {
                  const imageUrl = getImageUrl(block.source);
                  return imageUrl ? (
                    <div key={`img-${idx}`} style={{ marginBottom: '0.75rem' }}>
                      <ImageBlock src={imageUrl} />
                    </div>
                  ) : null;
                })}
                {/* Parse text for embedded image references */}
                {parseTextWithImages(message.content)}
              </div>
            ) : (
              // Claude message - render content blocks (indented)
              <div style={{
                color: '#ccc',
                fontSize: '0.9rem',
                lineHeight: '1.7',
                marginLeft: '30px'
              }}>
                {renderContentBlocks(message.contentBlocks || [], message.content)}
              </div>
            )}
          </div>
            )}
          </div>
        ))}
          <div style={{ height: '60px' }} /> {/* Bottom spacer - padding at bottom of messages for the UI aesthetics */}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            style={{
              position: 'absolute',
              bottom: '1.5rem',
              right: '2.5rem',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: '#444',
              border: '1px solid #555',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              transition: 'all 0.15s ease',
              zIndex: 100
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#555';
              e.currentTarget.style.borderColor = '#666';
              e.currentTarget.style.transform = 'scale(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#444';
              e.currentTarget.style.borderColor = '#555';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            title="Scroll to bottom"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7"/>
            </svg>
          </button>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        padding: '0.5rem 2rem 1rem 2rem',
        borderTop: '1px solid #222',
        background: '#111'
      }}>
        {/* Toggle Icons Row */}
        <div style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '0.5rem',
          alignItems: 'center',
          paddingRight: 'calc(77px + 0.75rem)', // Align with textarea right edge (accounts for Send button + gap)
        }}>
          {/* New Session */}
          <button
            onClick={() => setNewSessionMode(!newSessionMode)}
            style={{
              background: 'transparent',
              border: 'none',
              color: newSessionMode ? '#f97316' : '#666',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease'
            }}
            title="New Session"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Streaming Mode (disabled placeholder) */}
          <button
            disabled
            style={{
              background: 'transparent',
              border: 'none',
              color: '#444',
              cursor: 'not-allowed',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.5
            }}
            title="Streaming Mode (coming soon)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </button>

          {/* Planning Mode */}
          <button
            onClick={() => setPlanningMode(!planningMode)}
            style={{
              background: 'transparent',
              border: 'none',
              color: planningMode ? '#f97316' : '#666',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease'
            }}
            title="Planning Mode"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              <line x1="9" y1="12" x2="15" y2="12" />
              <line x1="9" y1="16" x2="15" y2="16" />
            </svg>
          </button>

          {/* Spacer to push right-aligned icons */}
          <div style={{ flex: 1 }} />

          {/* Planning File (only visible when plan exists) */}
          {latestPlanFile && (
            <button
              onClick={async () => {
                try {
                  const content = await ReadPlanFile(latestPlanFile);
                  setPlanContent(content);
                  setPlanPaneOpen(true);
                } catch (err) {
                  console.error('Failed to read plan file:', err);
                }
              }}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="View Plan"
            >
              <img
                src="/assets/view-plan.png"
                width="18"
                height="18"
                alt="View Plan"
                style={{
                  filter: 'invert(40%)',
                  transition: 'filter 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.filter = 'invert(68%) sepia(61%) saturate(4000%) hue-rotate(1deg) brightness(103%) contrast(97%)'}
                onMouseLeave={(e) => e.currentTarget.style.filter = 'invert(40%)'}
              />
            </button>
          )}

          {/* Permissions */}
          <button
            onClick={() => setPermissionsDialogOpen(true)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Claude Permissions"
          >
            <img
              src="/assets/view-permissions.png"
              width="18"
              height="18"
              alt="Permissions"
              style={{
                filter: 'invert(40%)',
                transition: 'filter 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.filter = 'invert(68%) sepia(61%) saturate(4000%) hue-rotate(1deg) brightness(103%) contrast(97%)'}
              onMouseLeave={(e) => e.currentTarget.style.filter = 'invert(40%)'}
            />
          </button>

          {/* CLAUDE.md - far right */}
          <button
            onClick={() => setClaudeSettingsOpen(true)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.7,
              transition: 'opacity 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
            title="CLAUDE.md"
          >
            <img src="/assets/clawd.png" width="18" height="18" alt="CLAUDE.md" style={{ borderRadius: '2px' }} />
          </button>
        </div>

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
            disabled={isSending || hasPendingQuestion}
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
            onClick={handleSend}
            disabled={isSending || !inputValue.trim() || hasPendingQuestion}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: isSending || !inputValue.trim() || hasPendingQuestion ? '#333' : '#f97316',
              color: isSending || !inputValue.trim() || hasPendingQuestion ? '#666' : '#fff',
              cursor: isSending || !inputValue.trim() || hasPendingQuestion ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              transition: 'background 0.15s ease'
            }}
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>

      {/* Compaction Pane */}
      <CompactionPane
        content={compactionContent || ''}
        isOpen={!!compactionContent}
        onClose={() => setCompactionContent(null)}
      />

      {/* Tool Detail Pane */}
      <ToolDetailPane
        toolCall={selectedToolCall}
        toolResult={selectedToolResult}
        isOpen={!!selectedToolCall}
        onClose={() => {
          setSelectedToolCall(null);
          setSelectedToolResult(null);
        }}
        agentID={agentId}
        sessionID={sessionId}
      />

      {/* Plan File Pane */}
      <SlideInPane
        isOpen={planPaneOpen}
        onClose={() => {
          setPlanPaneOpen(false);
          setPlanContent(null);
        }}
        title="Plan"
        storageKey="planPaneWidth"
      >
        <div style={{ padding: '1rem', color: '#ccc' }}>
          {planContent ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {planContent}
            </ReactMarkdown>
          ) : (
            <div style={{ color: '#666' }}>Loading...</div>
          )}
        </div>
      </SlideInPane>

      {/* Claude Settings Dialog (CLAUDE.md) */}
      <ClaudeSettingsDialog
        isOpen={claudeSettingsOpen}
        onClose={() => setClaudeSettingsOpen(false)}
        folder={folder}
      />

      {/* Permissions Dialog */}
      <PermissionsDialog
        isOpen={permissionsDialogOpen}
        onClose={() => setPermissionsDialogOpen(false)}
        folder={folder}
      />
    </div>
  );
}
