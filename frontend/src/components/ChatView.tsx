import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GetConversationPaged, SetActiveSession, ClearActiveSession, SendMessage, MarkSessionViewed, NewSession, ReadPlanFile, TouchPlanFile, AnswerQuestion, CancelSession, AcceptPlanReview, RejectPlanReview, RunSlashCommand, DeleteFromMessage, GetAgentMeta, UpdateAgentMeta } from '../../wailsjs/go/main/App';
import { types } from '../../wailsjs/go/models';

// Extracted components
import { MessageList } from './chat/MessageList';
import { DebugStatsOverlay } from './chat/DebugStatsOverlay';
import { InputArea, InputAreaHandle } from './chat/InputArea';
import { ControlButtonsRow } from './chat/ControlButtonsRow';
import type { Message, ContentBlock, PendingQuestion, ChatViewProps, Attachment } from './chat/types';
// Model/effort state is per-agent via AGENT_MODEL / AGENT_EFFORT meta, not per-ChatView.
// Empty strings fall through to CLI defaults (no --model / --effort flags).

// Existing components
import { ReferencesPane } from './ReferencesPane';
import { CompactionPane } from './CompactionPane';
import { ToolDetailPane } from './ToolDetailPane';
import { SlideInPane } from './SlideInPane';
import { ClaudeSettingsDialog } from './ClaudeSettingsDialog';
import { PermissionsDialog } from './PermissionsDialog';
import { AddPermissionWizard } from './AddPermissionWizard';
import { ConfirmDialog } from './ConfirmDialog';

// Hooks
import { useScrollManagement } from '../hooks/useScrollManagement';
import { useMessages } from '../hooks/useMessages';
import { useSession } from '../hooks/useSession';
import { QueuedMessage } from '../context/SessionContext';

// Utilities
import { buildToolResultMap, buildPendingQuestionMap, computeDebugStats, filterMessagesToRender, computeTokenMetrics, type SessionTokenMetrics } from '../utils/messageUtils';
import { debugLogger, startDebugCycle, logDebug, endDebugCycle } from '../utils/debugLogger';

// CSS keyframes for spinner animation
const spinnerStyles = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
`;

export function ChatView({ agentId, agentName, folder, sessionId, onSessionCreated, initialMessage, isExternallyCreatingSession, draftsRef }: ChatViewProps) {
  // Model & effort selection:
  //   agentDefault* = value from AGENT_MODEL / AGENT_EFFORT meta (persisted per agent).
  //   selected*     = current per-message choice; initialized to agent default, may diverge.
  //   "" means "use CLI default" (omit --model / --effort flags).
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedEffort, setSelectedEffort] = useState('');
  const [agentDefaultModel, setAgentDefaultModel] = useState('');
  const [agentDefaultEffort, setAgentDefaultEffort] = useState('');

  // Load the agent's persisted model/effort defaults when the folder changes.
  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await GetAgentMeta(folder);
        if (cancelled) return;
        const meta = info?.meta ?? {};
        const m = (meta['AGENT_MODEL'] as string) ?? '';
        const e = (meta['AGENT_EFFORT'] as string) ?? '';
        setAgentDefaultModel(m);
        setAgentDefaultEffort(e);
        // Initialize current selections to the agent default (per-message override starts unset).
        setSelectedModel(m);
        setSelectedEffort(e);
      } catch (err) {
        console.warn('[ChatView] Failed to load AGENT_MODEL/AGENT_EFFORT meta:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [folder]);

  // Persist a model or effort choice to the agent's registry meta.
  const saveAgentMetaField = async (key: 'AGENT_MODEL' | 'AGENT_EFFORT', value: string) => {
    if (!folder) return;
    try {
      const info = await GetAgentMeta(folder);
      const meta = { ...(info?.meta ?? {}) } as Record<string, string>;
      // Empty string = explicitly "CLI default"; persist it so intent is preserved.
      meta[key] = value;
      await UpdateAgentMeta(folder, meta);
      if (key === 'AGENT_MODEL') setAgentDefaultModel(value);
      else setAgentDefaultEffort(value);
    } catch (err) {
      console.error(`[ChatView] Failed to save ${key}:`, err);
    }
  };

  const handleSaveModelAsAgentDefault = async (modelId: string) => {
    await saveAgentMetaField('AGENT_MODEL', modelId);
  };
  const handleSaveEffortAsAgentDefault = async (level: string) => {
    await saveAgentMetaField('AGENT_EFFORT', level);
  };
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
    clearAllPendingInSession,
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

  // Per-agent "responding" state from context (survives agent switching)
  const { setAgentResponding, isAgentResponding, addToQueue, removeFromQueue, shiftQueue, getQueue, setLastSessionId, mcpPendingPlanReview, setMCPPendingPlanReview } = useSession();
  const isSending = isAgentResponding(agentId);
  const queue = getQueue(agentId);

  // UI state
  const [showDebugStats, setShowDebugStats] = useState(false);
  const [compactionContent, setCompactionContent] = useState<string | null>(null);
  const [selectedToolCall, setSelectedToolCall] = useState<ContentBlock | null>(null);
  const [selectedToolResult, setSelectedToolResult] = useState<ContentBlock | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [deleteMessageUUID, setDeleteMessageUUID] = useState<string | null>(null);

  // Ref for InputArea imperative control (setValue, focus)
  const inputAreaRef = useRef<InputAreaHandle>(null);

  // Ref to track current input value for draft save on unmount
  const currentDraftRef = useRef<{ text: string; attachments: Attachment[] }>({ text: '', attachments: [] });

  // Toggle states for prompt controls
  const [newSessionMode, setNewSessionMode] = useState(false);
  const [planningMode, setPlanningMode] = useState(false);
  const [planPaneOpen, setPlanPaneOpen] = useState(false);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [planFilePath, setPlanFilePath] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [claudeSettingsOpen, setClaudeSettingsOpen] = useState(false);
  const [referencesPaneOpen, setReferencesPaneOpen] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [planReviewFeedback, setPlanReviewFeedback] = useState('');
  const [planReviewSubmitting, setPlanReviewSubmitting] = useState(false);

  // Derive session slug from messages (any message with a slug field)
  const sessionSlug = useMemo(() => {
    for (const msg of messages) {
      if (msg.slug) return msg.slug;
    }
    return null;
  }, [messages]);

  // Auto-open plan pane when MCP plan review arrives
  useEffect(() => {
    if (mcpPendingPlanReview && sessionSlug) {
      const openPlanForReview = async () => {
        setPlanError(null);
        try {
          const planPath = await TouchPlanFile(agentId, sessionId);
          setPlanFilePath(planPath);
          const content = await ReadPlanFile(planPath);
          setPlanContent(content || null); // empty string → null (shows "empty" state)
          setPlanPaneOpen(true);
          setPlanReviewFeedback('');
        } catch (err: any) {
          console.error('Failed to open plan for review:', err);
          setPlanError(err?.message || String(err));
          setPlanPaneOpen(true); // Still open pane so user sees the error
        }
      };
      openPlanForReview();
    }
  }, [mcpPendingPlanReview, sessionSlug, agentId, sessionId]);

  // Handle accepting a plan review
  const handleAcceptPlanReview = async () => {
    if (!mcpPendingPlanReview || planReviewSubmitting) return;
    setPlanReviewSubmitting(true);
    try {
      await AcceptPlanReview(mcpPendingPlanReview.id, planReviewFeedback);
      setMCPPendingPlanReview(null);
      setPlanPaneOpen(false);
      setPlanContent(null);
      setPlanReviewFeedback('');
    } catch (err) {
      console.error('Failed to accept plan review:', err);
    } finally {
      setPlanReviewSubmitting(false);
    }
  };

  // Handle rejecting a plan review with feedback
  const handleRejectPlanReview = async () => {
    if (!mcpPendingPlanReview || planReviewSubmitting) return;
    setPlanReviewSubmitting(true);
    try {
      await RejectPlanReview(mcpPendingPlanReview.id, planReviewFeedback);
      setMCPPendingPlanReview(null);
      setPlanPaneOpen(false);
      setPlanContent(null);
      setPlanReviewFeedback('');
    } catch (err) {
      console.error('Failed to reject plan review:', err);
    } finally {
      setPlanReviewSubmitting(false);
    }
  };

  // Permission wizard state (triggered from failed tool calls)
  const [permissionWizardOpen, setPermissionWizardOpen] = useState(false);
  const [permissionWizardTool, setPermissionWizardTool] = useState<string>('');
  const [permissionWizardCommand, setPermissionWizardCommand] = useState<string | undefined>(undefined);

  // Attachment state (lifted from InputArea, displayed in ControlButtonsRow)
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Restore draft on mount (from parent's draftsRef or localStorage fallback)
  useEffect(() => {
    const saved = draftsRef?.current.get(agentId);
    if (saved) {
      inputAreaRef.current?.setValue(saved.text);
      setAttachments(saved.attachments);
      draftsRef?.current.delete(agentId); // consumed
    } else {
      // localStorage fallback (survives app restart)
      try {
        const stored = localStorage.getItem(`draft:${agentId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          inputAreaRef.current?.setValue(parsed.text || '');
          setAttachments(parsed.attachments || []);
          localStorage.removeItem(`draft:${agentId}`); // consumed
        }
      } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save draft on unmount (to parent's draftsRef + localStorage)
  useEffect(() => {
    return () => {
      const text = currentDraftRef.current.text;
      const atts = currentDraftRef.current.attachments;
      if (text || atts.length > 0) {
        draftsRef?.current.set(agentId, { text, attachments: atts });
        // Persist text + file attachments to localStorage (skip image base64 to avoid quota issues)
        const textOnly = { text, attachments: atts.filter(a => a.type !== 'image') };
        try { localStorage.setItem(`draft:${agentId}`, JSON.stringify(textOnly)); } catch {}
      } else {
        draftsRef?.current.delete(agentId);
        try { localStorage.removeItem(`draft:${agentId}`); } catch {}
      }
    };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep currentDraftRef in sync with attachments state
  useEffect(() => {
    currentDraftRef.current.attachments = attachments;
  }, [attachments]);

  // Listen for inbox inject events (Sidebar dispatches when user clicks "Inject into Prompt")
  useEffect(() => {
    const handleInject = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text && inputAreaRef.current) {
        const currentText = inputAreaRef.current.getValue() || '';
        const newText = currentText ? detail.text + currentText : detail.text;
        inputAreaRef.current.setValue(newText);
        inputAreaRef.current.focus();
      }
    };
    window.addEventListener('claudefu:inject-into-prompt', handleInject);
    return () => window.removeEventListener('claudefu:inject-into-prompt', handleInject);
  }, []);

  // CMD-R: refresh session messages from disk
  useEffect(() => {
    const handleRefresh = () => {
      console.log('[ChatView] CMD-R: refreshing session messages from disk');
      clearContextSession(agentId, sessionId);
      loadConversation(true);
    };
    window.addEventListener('claudefu:refresh-session', handleRefresh);
    return () => window.removeEventListener('claudefu:refresh-session', handleRefresh);
  }, [agentId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check for pending inbox inject (stored by Sidebar when injecting into a different agent)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('claudefu:pendingInject');
      if (raw) {
        const { agentId: targetId, text } = JSON.parse(raw);
        if (targetId === agentId && text) {
          localStorage.removeItem('claudefu:pendingInject');
          // Use rAF to ensure InputArea ref is ready after mount
          requestAnimationFrame(() => {
            if (inputAreaRef.current) {
              const currentText = inputAreaRef.current.getValue() || '';
              const newText = currentText ? text + currentText : text;
              inputAreaRef.current.setValue(newText);
              inputAreaRef.current.focus();
            }
          });
        }
      }
    } catch {}
  }, [agentId]);

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
  const tokenMetrics = useMemo(() => computeTokenMetrics(messages), [messages]);
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
      const displayCount = result?.displayCount || messageList.length;
      setContextMessages(agentId, sessionId, messageList, totalCount, hasMoreMessages, displayCount);

      // Scroll to bottom after initial load
      scroll.scrollToBottomRAF();
    } catch (err) {
      setError(`Failed to load conversation: ${err}`);
    } finally {
      setLocalLoading(false);
      setContextLoading(agentId, sessionId, false);
    }
  };

  // Load a specific number of recent messages (replaces offset-based Load More)
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const handleLoadCount = async (count: number) => {
    if (isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      // count=0 means "all messages"
      const result = await GetConversationPaged(agentId, sessionId, count, 0);
      const messageList = result?.messages || [];
      const totalCount = result?.totalCount || messageList.length;
      const hasMoreMessages = result?.hasMore || false;
      const displayCount = result?.displayCount || messageList.length;
      setContextMessages(agentId, sessionId, messageList, totalCount, hasMoreMessages, displayCount);

      // Scroll to bottom after reload
      scroll.scrollToBottomRAF();
    } catch (err) {
      console.error('Failed to load messages:', err);
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

      // Track this session as the last viewed for this agent (for global queue auto-submit)
      setLastSessionId(agentId, sessionId);

      try {
        await MarkSessionViewed(agentId, sessionId);
      } catch (err) {
        console.error('Failed to mark session as viewed:', err);
      }

      await loadConversation();
    };

    initSession();

    // Cleanup: Clear active session when unmounting (user switches agents)
    // This ensures the backend doesn't think we're still viewing this session
    return () => {
      ClearActiveSession().catch(err => {
        console.error('Failed to clear active session:', err);
      });
    };
  }, [agentId, sessionId]);

  // Clear chat when creating new session externally (from SessionsDialog + button)
  // This matches the behavior of the InputArea + button (newSessionMode)
  useEffect(() => {
    if (isExternallyCreatingSession) {
      clearContextSession(agentId, sessionId);
    }
  }, [isExternallyCreatingSession, agentId, sessionId, clearContextSession]);

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
          // Clear waiting state - Claude has responded
          setIsWaitingForResponse(false);
          setIsCancelling(false);
        }
      }
      lastMessageCountRef.current = messages.length;
    }
  }, [messages.length, agentId, sessionId]);

  // Auto-send initialMessage when provided
  const initialMessageSentRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !initialMessageSentRef.current && !isLoading && initialLoadDone) {
      initialMessageSentRef.current = true;
      const sendInitialMessage = async () => {
        setAgentResponding(agentId, true);
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
          await SendMessage(agentId, sessionId, initialMessage, [], planningMode, selectedModel, selectedEffort);
        } catch (err) {
          // On failure, the message stays in pending state
          // Context will handle cleanup when confirmed message arrives
          console.error('Failed to send initial message:', err);
        } finally {
          setAgentResponding(agentId, false);
        }
      };
      sendInitialMessage();
    }
  }, [initialMessage, isLoading, initialLoadDone, agentId, sessionId, planningMode, addPendingMessage, setAgentResponding]);

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
      await SendMessage(agentId, sessionId, "I'm skipping this question. Please continue.", [], planningMode, selectedModel, selectedEffort);
      // Clear and reload from context
      clearContextSession(agentId, sessionId);
      await loadConversation(true); // Force reload
    } catch (err) {
      console.error('Failed to skip question:', err);
    }
  };

  // Handle cancelling a running Claude response
  const handleCancel = async () => {
    if (!isSending || isCancelling) return;

    setIsCancelling(true);
    console.log('[ChatView] Cancelling Claude response for session:', sessionId);

    try {
      await CancelSession(agentId, sessionId);
      console.log('[ChatView] Cancel request sent');

      // Clear pending spinner immediately on cancel
      clearAllPendingInSession(agentId, sessionId);

      // NOTE: We do NOT append a cancellation marker to the JSONL.
      // Writing to Claude Code's JSONL breaks the parentUuid chain and causes
      // Claude to lose conversation context. Just kill the process and let
      // Claude Code handle its own state.

      // Don't clear isWaitingForResponse here - let it clear when the assistant message arrives
      // or after a short timeout if no response comes
      setTimeout(() => {
        setIsWaitingForResponse(false);
        setIsCancelling(false);
      }, 2000); // Safety timeout - clear state if no response within 2s
    } catch (err) {
      console.error('Failed to cancel session:', err);
      setIsCancelling(false);
    }
  };

  // Known slash commands that get passed through to Claude CLI
  const SLASH_COMMANDS = ['/context', '/compact'];

  // Handle sending a message (receives message from InputArea)
  const handleSend = async (message: string, attachments: Attachment[] = []) => {
    console.log('=== USER PROMPT START ===', {
      timestamp: new Date().toISOString(),
      messageLength: message.length,
      attachmentCount: attachments.length,
      sessionId: sessionId.substring(0, 8),
    });
    if ((!message && attachments.length === 0) || isSending) return;

    // Detect slash commands — intercept before normal send flow
    const trimmedMsg = message.trim();
    if (SLASH_COMMANDS.includes(trimmedMsg)) {
      setAgentResponding(agentId, true);
      try {
        const output = await RunSlashCommand(agentId, sessionId, trimmedMsg);

        // For /compact, reload messages from context since JSONL was rewritten
        if (trimmedMsg === '/compact') {
          clearContextSession(agentId, sessionId);
          await loadConversation(true);
        }

        // Add the command output as a local system message
        if (output.trim()) {
          const systemMessage: Message = {
            type: 'assistant',
            content: output,
            timestamp: new Date().toISOString(),
            uuid: `slash-${Date.now()}`,
            isSlashCommand: true,
            slashCommand: trimmedMsg,
          };
          addPendingMessage(agentId, sessionId, '', systemMessage);
          scroll.scrollToBottomRAF();
        }
      } catch (err) {
        console.error(`Slash command ${trimmedMsg} failed:`, err);
        const errorMessage: Message = {
          type: 'assistant',
          content: `Error running ${trimmedMsg}: ${err}`,
          timestamp: new Date().toISOString(),
          uuid: `slash-err-${Date.now()}`,
          isSlashCommand: true,
          slashCommand: trimmedMsg,
        };
        addPendingMessage(agentId, sessionId, '', errorMessage);
      } finally {
        setAgentResponding(agentId, false);
      }
      return;
    }

    // Track this session as the last used for this agent (for global queue auto-submit)
    setLastSessionId(agentId, sessionId);

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
      data: att.data,
      // File-specific fields
      fileName: att.fileName,
      filePath: att.filePath,
      extension: att.extension
    }));
    logDebug('ChatView', 'SEND_START', {
      messageLength: message.length,
      attachments: attachments.length,
      backendAttachments: backendAttachments.length,
    });

    setAgentResponding(agentId, true);

    if (newSessionMode) {
      try {
        setIsCreatingSession(true);
        clearContextSession(agentId, sessionId);
        const newSessionId = await NewSession(agentId);
        setNewSessionMode(false);
        setIsCreatingSession(false);
        setAttachments([]);  // Clear attachments on new session
        draftsRef?.current.delete(agentId);
        try { localStorage.removeItem(`draft:${agentId}`); } catch {}
        if (onSessionCreated) {
          onSessionCreated(newSessionId, message);
        }
        setAgentResponding(agentId, false);
        return;
      } catch (err) {
        console.error('Failed to create new session:', err);
        setIsCreatingSession(false);
        setAgentResponding(agentId, false);
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

    // Start waiting for Claude's response
    setIsWaitingForResponse(true);

    try {
      await SendMessage(agentId, sessionId, message, backendAttachments, planningMode, selectedModel, selectedEffort);
      logDebug('ChatView', 'SEND_COMPLETE', { success: true });
      // Clear attachments, planning mode, and persisted draft on successful send
      setAttachments([]);
      setPlanningMode(false);
      draftsRef?.current.delete(agentId);
      try { localStorage.removeItem(`draft:${agentId}`); } catch {}
      // Note: isWaitingForResponse stays true - it gets cleared when assistant message arrives
    } catch (err) {
      console.error('Failed to send message:', err);
      logDebug('ChatView', 'SEND_ERROR', { error: String(err) });
      endDebugCycle('send_error');
      // On failure, restore message to input and clear waiting state
      // The pending message will be cleaned up when/if the confirmed message arrives
      inputAreaRef.current?.setValue(message);
      setIsWaitingForResponse(false);
    } finally {
      // NOTE: Don't clear respondingAgents here - use event-driven approach instead
      // The useWailsEvents hook clears respondingAgents when assistant message arrives
      // This ensures correct state even when user switches agents during a response
    }
  };

  // Handle opening plan pane - touch file if it doesn't exist yet
  const handleViewPlan = async () => {
    if (!sessionSlug) return;
    setPlanError(null);
    setPlanContent(null);
    setPlanPaneOpen(true); // Open immediately so user sees loading state
    try {
      // TouchPlanFile creates the file if needed and returns its path
      const planPath = await TouchPlanFile(agentId, sessionId);
      setPlanFilePath(planPath);
      const content = await ReadPlanFile(planPath);
      setPlanContent(content || null); // empty string → null (shows "empty" state)
    } catch (err: any) {
      console.error('Failed to open plan file:', err);
      setPlanError(err?.message || String(err));
    }
  };

  // Handle opening permission wizard from tool failure
  const handleAddPermission = (toolName: string, command?: string) => {
    setPermissionWizardTool(toolName);
    setPermissionWizardCommand(command);
    setPermissionWizardOpen(true);
  };

  // ===== DELETE LAST TURN =====

  const handleDeleteFromMessage = async () => {
    if (!deleteMessageUUID) return;
    const uuid = deleteMessageUUID;
    setDeleteMessageUUID(null);
    try {
      await DeleteFromMessage(agentId, sessionId, uuid);
      // Clear cached messages then force reload from disk
      clearContextSession(agentId, sessionId);
      await loadConversation(true);
    } catch (err) {
      console.error('Failed to delete from message:', err);
    }
  };

  // ===== MESSAGE QUEUE HANDLERS =====

  // Add message to queue (called when user presses Enter/Queue while Claude is responding)
  const handleQueue = (content: string, queueAttachments: Attachment[]) => {
    addToQueue(agentId, {
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content,
      attachments: queueAttachments,
      createdAt: Date.now()
    });
  };

  // Remove message from queue
  const handleRemoveFromQueue = (messageId: string) => {
    removeFromQueue(agentId, messageId);
  };

  // Edit queued message (removes from queue - content is loaded into InputArea by InputArea itself)
  const handleEditQueueMessage = (message: QueuedMessage) => {
    removeFromQueue(agentId, message.id);
  };

  // NOTE: Auto-submit from queue is DISABLED in ChatView
  // Frontend cannot reliably detect when Claude's response is complete:
  // - stop_reason signals are unreliable (can appear mid-response during tool use)
  // - Race conditions when switching agents
  // - Frontend doesn't know true process state
  //
  // Queue is now DISPLAY ONLY. Users can:
  // 1. See queued messages in QueueDisplay
  // 2. Edit or remove queued messages
  // 3. Manually send when ready
  //
  // Future: Backend should emit "response_complete" event for reliable auto-submit

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
        isCreatingSession={isCreatingSession || !!isExternallyCreatingSession}
        scrollContainerRef={scroll.scrollContainerRef}
        messagesEndRef={scroll.messagesEndRef}
        showScrollButton={scroll.showScrollButton}
        hasMore={hasMore}
        totalCount={sessionData?.totalCount || 0}
        isLoadingMore={isLoadingMore}
        onLoadCount={handleLoadCount}
        onScrollToBottom={scroll.scrollToBottom}
        onCompactionClick={setCompactionContent}
        onViewToolDetails={handleViewToolDetails}
        onQuestionAnswer={handleQuestionAnswer}
        onQuestionSkip={handleQuestionSkip}
        onAddPermission={handleAddPermission}
        onDeleteFromMessage={(uuid) => setDeleteMessageUUID(uuid)}
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
          latestPlanFile={sessionSlug}
          onViewPlan={handleViewPlan}
          onOpenReferences={() => setReferencesPaneOpen(true)}
          onOpenPermissions={() => setPermissionsDialogOpen(true)}
          onOpenClaudeSettings={() => setClaudeSettingsOpen(true)}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          selectedEffort={selectedEffort}
          onEffortChange={setSelectedEffort}
          agentDefaultModel={agentDefaultModel}
          agentDefaultEffort={agentDefaultEffort}
          onSaveModelAsAgentDefault={handleSaveModelAsAgentDefault}
          onSaveEffortAsAgentDefault={handleSaveEffortAsAgentDefault}
          attachments={attachments}
          onAttachmentRemove={(id) => setAttachments(prev => prev.filter(att => att.id !== id))}
          isSending={isSending}
        />
        <InputArea
          ref={inputAreaRef}
          agentId={agentId}
          folder={folder}
          onSend={handleSend}
          onCancel={handleCancel}
          isSending={isSending}
          isWaitingForResponse={isWaitingForResponse}
          isCancelling={isCancelling}
          hasPendingQuestion={hasPendingQuestion}
          newSessionMode={newSessionMode}
          planningMode={planningMode}
          tokenMetrics={tokenMetrics}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          queue={queue}
          onQueue={handleQueue}
          onRemoveFromQueue={handleRemoveFromQueue}
          onEditQueueMessage={handleEditQueueMessage}
          onInputChange={(value) => { currentDraftRef.current.text = value; }}
        />
      </div>

      {/* @ References Pane */}
      <ReferencesPane
        isOpen={referencesPaneOpen}
        onClose={() => setReferencesPaneOpen(false)}
        folder={folder}
      />

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
          setPlanFilePath(null);
          setPlanError(null);
        }}
        title={mcpPendingPlanReview ? `Plan Review (from ${mcpPendingPlanReview.agentSlug})` : "Plan"}
        storageKey="planPaneWidth"
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Plan file path */}
          {planFilePath && (
            <div style={{
              padding: '4px 16px',
              borderBottom: '1px solid #222',
              fontSize: '0.7rem',
              color: '#555',
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
            title={planFilePath}
            >
              {planFilePath}
            </div>
          )}

          {/* Waiting indicator when review is pending */}
          {mcpPendingPlanReview && (
            <div style={{
              padding: '8px 16px',
              background: 'rgba(217, 119, 87, 0.1)',
              borderBottom: '1px solid rgba(217, 119, 87, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.8rem',
              color: '#d97757'
            }}>
              <span style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#d97757',
                animation: 'pulse 2s ease-in-out infinite'
              }} />
              Claude is waiting for your approval
            </div>
          )}

          {/* Plan content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '1rem', color: '#ccc' }}>
            {planError ? (
              <div style={{ color: '#e88' }}>
                <div style={{ marginBottom: '8px', fontWeight: 500 }}>Failed to load plan</div>
                <div style={{ fontSize: '0.85rem', color: '#a66', fontFamily: 'monospace' }}>{planError}</div>
              </div>
            ) : planContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {planContent}
              </ReactMarkdown>
            ) : (
              <div style={{ color: '#666' }}>
                {planFilePath ? 'Plan file is empty' : 'Loading...'}
              </div>
            )}
          </div>

          {/* Accept/Reject footer when review is pending */}
          {mcpPendingPlanReview && (
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid #333',
              background: '#1a1a1a',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <textarea
                value={planReviewFeedback}
                onChange={(e) => setPlanReviewFeedback(e.target.value)}
                placeholder="Optional: alignment notes (accept) or revision feedback (reject)..."
                style={{
                  width: '100%',
                  minHeight: '48px',
                  padding: '8px',
                  background: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: '#ccc',
                  fontSize: '0.8rem',
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  onClick={handleRejectPlanReview}
                  disabled={planReviewSubmitting}
                  style={{
                    padding: '6px 16px',
                    background: '#333',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    color: '#ccc',
                    cursor: planReviewSubmitting ? 'not-allowed' : 'pointer',
                    fontSize: '0.8rem',
                    opacity: planReviewSubmitting ? 0.5 : 1
                  }}
                >
                  {planReviewFeedback ? 'Reject with Feedback' : 'Reject'}
                </button>
                <button
                  onClick={handleAcceptPlanReview}
                  disabled={planReviewSubmitting}
                  style={{
                    padding: '6px 16px',
                    background: '#d97757',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    cursor: planReviewSubmitting ? 'not-allowed' : 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    opacity: planReviewSubmitting ? 0.5 : 1
                  }}
                >
                  {planReviewFeedback ? 'Accept with Feedback' : 'Accept Plan'}
                </button>
              </div>
            </div>
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

      {/* Add Permission Wizard (from tool failure) */}
      <AddPermissionWizard
        isOpen={permissionWizardOpen}
        onClose={() => {
          setPermissionWizardOpen(false);
          setPermissionWizardTool('');
          setPermissionWizardCommand(undefined);
        }}
        folder={folder}
        toolName={permissionWizardTool}
        command={permissionWizardCommand}
      />
      <ConfirmDialog
        isOpen={!!deleteMessageUUID}
        onClose={() => setDeleteMessageUUID(null)}
        onConfirm={handleDeleteFromMessage}
        title="Delete From Here"
        message="This will remove this message and everything after it from the session file. This cannot be undone."
        confirmText="Delete"
        danger
      />
    </div>
  );
}
