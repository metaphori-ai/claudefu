import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GetConversation, SetActiveSession, SendMessage, MarkSessionViewed, NewSession, ReadPlanFile, GetPlanFilePath, AnswerQuestion } from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

// Extracted components
import { MessageList } from './chat/MessageList';
import { DebugStatsOverlay } from './chat/DebugStatsOverlay';
import { InputArea, InputAreaHandle } from './chat/InputArea';
import { ControlButtonsRow } from './chat/ControlButtonsRow';
import type { Message, ContentBlock, PendingQuestion, ChatViewProps } from './chat/types';

// Existing components
import { CompactionPane } from './CompactionPane';
import { ToolDetailPane } from './ToolDetailPane';
import { SlideInPane } from './SlideInPane';
import { ClaudeSettingsDialog } from './ClaudeSettingsDialog';
import { PermissionsDialog } from './PermissionsDialog';

// Hooks
import { useScrollManagement } from '../hooks/useScrollManagement';

// Utilities
import { buildToolResultMap, buildPendingQuestionMap, computeDebugStats, filterMessagesToRender } from '../utils/messageUtils';

// CSS keyframes for spinner animation
const spinnerStyles = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

export function ChatView({ agentId, agentName, folder, sessionId, onSessionCreated, initialMessage }: ChatViewProps) {
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

  // Core message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showDebugStats, setShowDebugStats] = useState(false);
  const [compactionContent, setCompactionContent] = useState<string | null>(null);
  const [selectedToolCall, setSelectedToolCall] = useState<ContentBlock | null>(null);
  const [selectedToolResult, setSelectedToolResult] = useState<ContentBlock | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Ref for InputArea imperative control (setValue, focus)
  const inputAreaRef = useRef<InputAreaHandle>(null);

  // Toggle states for prompt controls
  const [newSessionMode, setNewSessionMode] = useState(false);
  const [planningMode, setPlanningMode] = useState(false);
  const [latestPlanFile, setLatestPlanFile] = useState<string | null>(null);
  const [planPaneOpen, setPlanPaneOpen] = useState(false);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [claudeSettingsOpen, setClaudeSettingsOpen] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);

  // Refs for message processing
  const pendingMessagesRef = useRef<Set<string>>(new Set());
  const processedUUIDsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventDataRef = useRef<{ sessionId: string; messages: Message[] } | null>(null);
  const watcherPausedRef = useRef<boolean>(false);

  // Use scroll management hook
  const scroll = useScrollManagement(messages);

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

  // Computed values from messages
  const debugStats = useMemo(() => computeDebugStats(messages), [messages]);
  const globalToolResultMap = useMemo(() => buildToolResultMap(messages), [messages]);
  const globalPendingQuestionMap = useMemo(() => buildPendingQuestionMap(messages), [messages]);
  const hasPendingQuestion = globalPendingQuestionMap.size > 0;
  const messagesToRender = useMemo(
    () => filterMessagesToRender(messages, globalPendingQuestionMap, globalToolResultMap),
    [messages, globalPendingQuestionMap, globalToolResultMap]
  );

  // Load conversation function
  const loadConversation = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const msgs = await GetConversation(agentId, sessionId);
      setMessages(msgs || []);

      // Get plan file path from backend
      const planPath = await GetPlanFilePath(agentId, sessionId);
      if (planPath) {
        setLatestPlanFile(planPath);
      }

      // Initialize processedUUIDs with loaded messages
      if (msgs) {
        for (const msg of msgs) {
          if (msg.uuid) {
            processedUUIDsRef.current.add(msg.uuid);
          }
        }
      }

      // Scroll to bottom after initial load
      scroll.scrollToBottomRAF();
    } catch (err) {
      setError(`Failed to load conversation: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Session initialization and event handling
  useEffect(() => {
    const initSession = async () => {
      pendingMessagesRef.current.clear();
      processedUUIDsRef.current.clear();
      SetActiveSession(agentId, sessionId);

      try {
        await MarkSessionViewed(agentId, sessionId);
      } catch (err) {
        console.error('Failed to mark session as viewed:', err);
      }

      await loadConversation();
    };

    initSession();

    // Handle new messages from watcher
    const handleSessionMessages = (envelope: { sessionId?: string; payload?: { messages?: Message[] } }) => {
      if (watcherPausedRef.current) return;

      const data = { sessionId: envelope.sessionId || '', messages: envelope.payload?.messages || [] };
      if (data.sessionId !== sessionId || !data.messages?.length) return;

      // Debounce rapid fsnotify events
      pendingEventDataRef.current = data;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        const eventData = pendingEventDataRef.current;
        if (!eventData) return;
        pendingEventDataRef.current = null;
        debounceTimerRef.current = null;
        processNewMessages(eventData);
      }, 50);
    };

    const processNewMessages = (data: { sessionId: string; messages: Message[] }) => {
      const wasNearBottom = scroll.isNearBottom();
      const messagesToAdd: Message[] = [];
      let sawNonUserMessage = false;
      let clearedPendingContent: string | null = null;

      for (const msg of data.messages) {
        if (processedUUIDsRef.current.has(msg.uuid)) continue;
        processedUUIDsRef.current.add(msg.uuid);

        if (msg.type !== 'user') {
          sawNonUserMessage = true;
        }

        // If we see a new user message from watcher (CLI input), activate force scroll
        if (msg.type === 'user' && !pendingMessagesRef.current.has(msg.content)) {
          scroll.activateForceScroll();
        }

        const isPendingMatch = msg.type === 'user' && pendingMessagesRef.current.has(msg.content);
        if (isPendingMatch) {
          clearedPendingContent = msg.content;
          pendingMessagesRef.current.delete(msg.content);
        }

        messagesToAdd.push(msg as Message);
      }

      if (messagesToAdd.length === 0 && !sawNonUserMessage) return;

      setMessages(prev => {
        let updatedMessages = prev;
        if (clearedPendingContent !== null) {
          updatedMessages = prev.filter(m => !(m.isPending && m.content === clearedPendingContent));
        }
        if (sawNonUserMessage) {
          updatedMessages = updatedMessages.map(m =>
            m.isPending ? { ...m, isPending: false } : m
          );
        }
        return [...updatedMessages, ...messagesToAdd];
      });

      MarkSessionViewed(agentId, sessionId).catch(() => {});
      GetPlanFilePath(agentId, sessionId).then(planPath => {
        if (planPath) setLatestPlanFile(planPath);
      }).catch(() => {});

      // Scroll behavior
      const shouldScroll = wasNearBottom || scroll.forceScrollActiveRef.current;
      if (shouldScroll) {
        scroll.scrollToBottomDoubleRAF();
      }
    };

    EventsOn('session:messages', handleSessionMessages);

    return () => {
      EventsOff('session:messages');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [agentId, sessionId]);

  // Auto-send initialMessage when provided
  const initialMessageSentRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !initialMessageSentRef.current && !isLoading) {
      initialMessageSentRef.current = true;
      const sendInitialMessage = async () => {
        setIsSending(true);
        const pendingMessage: Message = {
          type: 'user',
          content: initialMessage,
          timestamp: new Date().toISOString(),
          uuid: `pending-${Date.now()}`,
          isPending: true
        };
        pendingMessagesRef.current.add(initialMessage);
        scroll.activateForceScroll();
        setMessages(prev => [...prev, pendingMessage]);
        scroll.scrollToBottomRAF();

        try {
          await SendMessage(agentId, sessionId, initialMessage, planningMode);
        } catch (err) {
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

  // Handle viewing tool details
  const handleViewToolDetails = (toolCall: ContentBlock, result?: ContentBlock) => {
    setSelectedToolCall(toolCall);
    setSelectedToolResult(result || null);
  };

  // Handle answering a pending question
  const handleQuestionAnswer = async (
    toolUseId: string,
    questions: any[],
    answers: Record<string, string>
  ) => {
    try {
      watcherPausedRef.current = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        pendingEventDataRef.current = null;
      }
      await AnswerQuestion(agentId, sessionId, toolUseId, questions, answers);
      processedUUIDsRef.current.clear();
      await loadConversation();
      watcherPausedRef.current = false;
    } catch (err) {
      console.error('Failed to answer question:', err);
      watcherPausedRef.current = false;
    }
  };

  // Handle skipping a pending question
  const handleQuestionSkip = async (toolUseId: string) => {
    try {
      await SendMessage(agentId, sessionId, "I'm skipping this question. Please continue.", planningMode);
      processedUUIDsRef.current.clear();
      await loadConversation();
    } catch (err) {
      console.error('Failed to skip question:', err);
    }
  };

  // Handle sending a message (receives message from InputArea)
  const handleSend = async (message: string) => {
    if (!message || isSending) return;

    setIsSending(true);

    if (newSessionMode) {
      try {
        setIsCreatingSession(true);
        setMessages([]);
        const newSessionId = await NewSession(agentId);
        setNewSessionMode(false);
        setIsCreatingSession(false);
        if (onSessionCreated) {
          onSessionCreated(newSessionId, message);
        }
        setIsSending(false);
        return;
      } catch (err) {
        console.error('Failed to create new session:', err);
        setIsCreatingSession(false);
        setIsSending(false);
        // Restore message to input on failure
        inputAreaRef.current?.setValue(message);
        loadConversation();
        return;
      }
    }

    const pendingMessage: Message = {
      type: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      uuid: `pending-${Date.now()}`,
      isPending: true
    };

    pendingMessagesRef.current.add(message);
    scroll.activateForceScroll();
    setMessages(prev => [...prev, pendingMessage]);
    scroll.scrollToBottomRAF();

    try {
      await SendMessage(agentId, sessionId, message, planningMode);
    } catch (err) {
      console.error('Failed to send message:', err);
      pendingMessagesRef.current.delete(message);
      setMessages(prev =>
        prev.map(m =>
          m.uuid === pendingMessage.uuid
            ? { ...m, isPending: false, isFailed: true }
            : m
        )
      );
      // Restore message to input on failure
      inputAreaRef.current?.setValue(message);
    } finally {
      setIsSending(false);
    }
  };

  // Handle opening plan pane
  const handleViewPlan = async () => {
    if (!latestPlanFile) return;
    try {
      const content = await ReadPlanFile(latestPlanFile);
      setPlanContent(content);
      setPlanPaneOpen(true);
    } catch (err) {
      console.error('Failed to read plan file:', err);
    }
  };

  // Loading state
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

  // Error state
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
      {/* Debug Stats Overlay */}
      {showDebugStats && (
        <DebugStatsOverlay
          debugStats={debugStats}
          scrollDebug={scroll.scrollDebug}
          forceScrollActive={scroll.forceScrollActive}
          agentId={agentId}
          sessionId={sessionId}
        />
      )}

      {/* Messages Area */}
      <MessageList
        messages={messagesToRender}
        globalToolResultMap={globalToolResultMap}
        globalPendingQuestionMap={globalPendingQuestionMap}
        isCreatingSession={isCreatingSession}
        scrollContainerRef={scroll.scrollContainerRef}
        messagesEndRef={scroll.messagesEndRef}
        showScrollButton={scroll.showScrollButton}
        onScrollToBottom={scroll.scrollToBottom}
        onCompactionClick={setCompactionContent}
        onViewToolDetails={handleViewToolDetails}
        onQuestionAnswer={handleQuestionAnswer}
        onQuestionSkip={handleQuestionSkip}
      />

      {/* Input Area */}
      <div style={{
        padding: '0.5rem 2rem 1rem 2rem',
        borderTop: '1px solid #222',
        background: '#111'
      }}>
        <ControlButtonsRow
          newSessionMode={newSessionMode}
          onNewSessionModeToggle={() => setNewSessionMode(!newSessionMode)}
          planningMode={planningMode}
          onPlanningModeToggle={() => setPlanningMode(!planningMode)}
          latestPlanFile={latestPlanFile}
          onViewPlan={handleViewPlan}
          onOpenPermissions={() => setPermissionsDialogOpen(true)}
          onOpenClaudeSettings={() => setClaudeSettingsOpen(true)}
        />
        <InputArea
          ref={inputAreaRef}
          onSend={handleSend}
          isSending={isSending}
          hasPendingQuestion={hasPendingQuestion}
        />
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
        agentName={agentName}
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
