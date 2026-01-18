import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GetConversationPaged, SetActiveSession, SendMessage, MarkSessionViewed, NewSession, ReadPlanFile, GetPlanFilePath, AnswerQuestion } from '../../wailsjs/go/main/App';
import { types } from '../../wailsjs/go/models';

// Extracted components
import { MessageList } from './chat/MessageList';
import { DebugStatsOverlay } from './chat/DebugStatsOverlay';
import { InputArea, InputAreaHandle } from './chat/InputArea';
import { ControlButtonsRow } from './chat/ControlButtonsRow';
import type { Message, ContentBlock, PendingQuestion, ChatViewProps, Attachment } from './chat/types';

// Existing components
import { CompactionPane } from './CompactionPane';
import { ToolDetailPane } from './ToolDetailPane';
import { SlideInPane } from './SlideInPane';
import { ClaudeSettingsDialog } from './ClaudeSettingsDialog';
import { PermissionsDialog } from './PermissionsDialog';

// Hooks
import { useScrollManagement } from '../hooks/useScrollManagement';
import { useMessages } from '../hooks/useMessages';

// Utilities
import { buildToolResultMap, buildPendingQuestionMap, computeDebugStats, filterMessagesToRender } from '../utils/messageUtils';
import { debugLogger, startDebugCycle, logDebug, endDebugCycle } from '../utils/debugLogger';

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

  // Use MessagesContext for centralized message state
  const {
    getSessionMessages,
    setMessages: setContextMessages,
    prependMessages: prependContextMessages,
    setLoading: setContextLoading,
    markInitialLoadDone,
    addPendingMessage,
    clearSession: clearContextSession,
  } = useMessages();

  // Get session messages from context
  const sessionData = getSessionMessages(agentId, sessionId);
  const messages = sessionData?.messages || [];
  const isContextLoading = sessionData?.isLoading ?? false;
  const hasMore = sessionData?.hasMore ?? false;
  const initialLoadDone = sessionData?.initialLoadDone ?? false;

  // Local loading state for initial render before context is populated
  const [localLoading, setLocalLoading] = useState(!initialLoadDone);
  const [error, setError] = useState<string | null>(null);

  // Combined loading state
  const isLoading = localLoading || isContextLoading;

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

  // Refs for special flows (AnswerQuestion needs to pause watcher)
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

  // Load conversation function (initial load with pagination)
  const loadConversation = async (forceReload = false) => {
    // Check if already loaded (skip fetch if cached)
    if (!forceReload && initialLoadDone) {
      setLocalLoading(false);
      scroll.scrollToBottomRAF();
      return;
    }

    setLocalLoading(true);
    setContextLoading(agentId, sessionId, true);
    setError(null);

    try {
      // Load most recent 50 messages (limit=50, offset=0)
      const result = await GetConversationPaged(agentId, sessionId, 50, 0);
      const messageList = result?.messages || [];
      const totalCount = result?.totalCount || messageList.length;
      const hasMoreMessages = result?.hasMore || false;
      setContextMessages(agentId, sessionId, messageList, totalCount, hasMoreMessages);

      // Get plan file path from backend
      const planPath = await GetPlanFilePath(agentId, sessionId);
      if (planPath) {
        setLatestPlanFile(planPath);
      }

      // Scroll to bottom after initial load
      scroll.scrollToBottomRAF();
    } catch (err) {
      setError(`Failed to load conversation: ${err}`);
    } finally {
      setLocalLoading(false);
      setContextLoading(agentId, sessionId, false);
    }
  };

  // Load more (older) messages
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      // Calculate offset: skip the messages we already have
      const currentCount = messages.length;
      const result = await GetConversationPaged(agentId, sessionId, 50, currentCount);
      const olderMessages = result?.messages || [];
      const hasMoreMessages = result?.hasMore || false;

      if (olderMessages.length > 0) {
        // Capture scroll position before prepending
        const scrollContainer = scroll.scrollContainerRef.current;
        const scrollHeightBefore = scrollContainer?.scrollHeight || 0;

        prependContextMessages(agentId, sessionId, olderMessages, hasMoreMessages);

        // Restore scroll position after DOM update
        requestAnimationFrame(() => {
          if (scrollContainer) {
            const scrollHeightAfter = scrollContainer.scrollHeight;
            scrollContainer.scrollTop = scrollHeightAfter - scrollHeightBefore;
          }
        });
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Session initialization - event handling is now in WailsEventHub
  useEffect(() => {
    const initSession = async () => {
      try {
        await SetActiveSession(agentId, sessionId);
      } catch (err) {
        // Conflict: another agent from same folder already has this session active
        console.error('Failed to set active session:', err);
        setError(String(err));
        return;
      }

      try {
        await MarkSessionViewed(agentId, sessionId);
      } catch (err) {
        console.error('Failed to mark session as viewed:', err);
      }

      await loadConversation();
    };

    initSession();
  }, [agentId, sessionId]);

  // Track last message count to detect new messages
  const lastMessageCountRef = useRef(messages.length);
  const pendingCycleRef = useRef(false);

  // Scroll when messages change (from context updates via WailsEventHub)
  useEffect(() => {
    if (messages.length > 0) {
      const wasNearBottom = scroll.isNearBottom();
      const shouldScroll = wasNearBottom || scroll.forceScrollActiveRef.current;
      if (shouldScroll) {
        scroll.scrollToBottomDoubleRAF();
      }

      // Check for new messages since last render
      const newMessageCount = messages.length - lastMessageCountRef.current;
      if (newMessageCount > 0 && debugLogger.isCycleActive()) {
        // Log new messages arriving
        const newMessages = messages.slice(-newMessageCount);
        for (const msg of newMessages) {
          logDebug('ChatView', 'MESSAGE_RECEIVED', {
            type: msg.type,
            uuid: msg.uuid?.substring(0, 8),
            isPending: msg.isPending,
            contentLength: msg.content?.length,
          });
        }

        // Check if we got an assistant message (potential cycle end)
        const hasNewAssistant = newMessages.some(m => m.type === 'assistant' && !m.isPending);
        if (hasNewAssistant) {
          // End cycle when assistant message arrives
          endDebugCycle('assistant_message_received');
        }
      }
      lastMessageCountRef.current = messages.length;

      // Update plan file path when messages change
      GetPlanFilePath(agentId, sessionId).then(planPath => {
        if (planPath) setLatestPlanFile(planPath);
      }).catch(() => {});
    }
  }, [messages.length, agentId, sessionId]);

  // Auto-send initialMessage when provided
  const initialMessageSentRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !initialMessageSentRef.current && !isLoading && initialLoadDone) {
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
        addPendingMessage(agentId, sessionId, initialMessage, pendingMessage);
        scroll.activateForceScroll();
        scroll.scrollToBottomRAF();

        try {
          await SendMessage(agentId, sessionId, initialMessage, [], planningMode);
        } catch (err) {
          // On failure, the message stays in pending state
          // Context will handle cleanup when confirmed message arrives
          console.error('Failed to send initial message:', err);
        } finally {
          setIsSending(false);
        }
      };
      sendInitialMessage();
    }
  }, [initialMessage, isLoading, initialLoadDone, agentId, sessionId, planningMode, addPendingMessage]);

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
      await AnswerQuestion(agentId, sessionId, toolUseId, questions, answers);
      // Clear and reload from context
      clearContextSession(agentId, sessionId);
      await loadConversation(true); // Force reload
      watcherPausedRef.current = false;
    } catch (err) {
      console.error('Failed to answer question:', err);
      watcherPausedRef.current = false;
    }
  };

  // Handle skipping a pending question
  const handleQuestionSkip = async (toolUseId: string) => {
    try {
      await SendMessage(agentId, sessionId, "I'm skipping this question. Please continue.", [], planningMode);
      // Clear and reload from context
      clearContextSession(agentId, sessionId);
      await loadConversation(true); // Force reload
    } catch (err) {
      console.error('Failed to skip question:', err);
    }
  };

  // Handle sending a message (receives message from InputArea)
  const handleSend = async (message: string, attachments: Attachment[] = []) => {
    console.log('=== USER PROMPT START ===', {
      timestamp: new Date().toISOString(),
      messageLength: message.length,
      attachmentCount: attachments.length,
      sessionId: sessionId.substring(0, 8),
    });
    if ((!message && attachments.length === 0) || isSending) return;

    // Start debug cycle for this prompt
    startDebugCycle(message, {
      agentId,
      sessionId,
      attachmentCount: attachments.length,
      planningMode,
      newSessionMode,
    });

    // Convert frontend attachments to backend format
    const backendAttachments: types.Attachment[] = attachments.map(att => ({
      type: att.type,
      media_type: att.mediaType,
      data: att.data
    }));
    logDebug('ChatView', 'SEND_START', {
      messageLength: message.length,
      attachments: attachments.length,
      backendAttachments: backendAttachments.length,
    });

    setIsSending(true);

    if (newSessionMode) {
      try {
        setIsCreatingSession(true);
        clearContextSession(agentId, sessionId);
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
        loadConversation(true);
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

    addPendingMessage(agentId, sessionId, message, pendingMessage);
    scroll.activateForceScroll();
    scroll.scrollToBottomRAF();

    try {
      await SendMessage(agentId, sessionId, message, backendAttachments, planningMode);
      logDebug('ChatView', 'SEND_COMPLETE', { success: true });
    } catch (err) {
      console.error('Failed to send message:', err);
      logDebug('ChatView', 'SEND_ERROR', { error: String(err) });
      endDebugCycle('send_error');
      // On failure, restore message to input
      // The pending message will be cleaned up when/if the confirmed message arrives
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
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={handleLoadMore}
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
