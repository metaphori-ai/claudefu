/**
 * QueueWatcher - Backend-Driven Queue Auto-Submit
 *
 * This component handles automatic queue submission triggered by the backend's
 * `response_complete` event. The backend emits this event AFTER cmd.Wait() returns,
 * which is the authoritative signal that the Claude CLI process has exited.
 *
 * Flow:
 * 1. Backend emits `response_complete` event when Claude CLI exits
 * 2. useWailsEvents receives event and dispatches `claudefu:queue-autosubmit` custom event
 * 3. This component receives that event and processes the queue
 *
 * This approach is reliable because:
 * - Backend knows exactly when the process exits (no guessing)
 * - No race conditions from stop_reason signals appearing mid-response
 * - Queue items wait until response is definitively complete
 */

import { useEffect } from 'react';
import { useSession } from '../hooks/useSession';
import { useMessages } from '../hooks/useMessages';
import { SendMessage } from '../../wailsjs/go/main/App';
import { types } from '../../wailsjs/go/models';
import { Message, Attachment } from './chat/types';
import { logDebug } from '../utils/debugLogger';

export function QueueWatcher() {
  const {
    shiftQueue,
    getQueue,
    getLastSessionId,
    setAgentResponding,
  } = useSession();
  const { addPendingMessage } = useMessages();

  // NOTE: No processingRef needed - shiftQueue atomically removes items,
  // providing natural protection against double-processing.
  // The previous processingRef was actually causing a bug: it blocked
  // subsequent queue items because the ref wasn't cleared until AFTER
  // the await SendMessage returned, but the next response_complete event
  // arrives BEFORE that.

  useEffect(() => {
    const handleAutoSubmit = async (event: Event) => {
      const customEvent = event as CustomEvent<{ agentId: string; sessionId: string }>;
      const { agentId, sessionId } = customEvent.detail;

      // Check if queue has items
      const queue = getQueue(agentId);
      if (queue.length === 0) {
        logDebug('QueueWatcher', 'SKIP_EMPTY_QUEUE', { agentId: agentId.substring(0, 8) });
        return;
      }

      // Verify session matches the last known session for this agent
      const lastSessionId = getLastSessionId(agentId);
      if (lastSessionId !== sessionId) {
        logDebug('QueueWatcher', 'SKIP_SESSION_MISMATCH', {
          agentId: agentId.substring(0, 8),
          expectedSession: lastSessionId?.substring(0, 8),
          receivedSession: sessionId.substring(0, 8),
        });
        return;
      }

      // Get the first queued message
      const queuedMessage = queue[0];

      logDebug('QueueWatcher', 'AUTO_SUBMITTING', {
        agentId: agentId.substring(0, 8),
        sessionId: sessionId.substring(0, 8),
        content: queuedMessage.content.substring(0, 50),
        attachmentCount: queuedMessage.attachments.length,
      });

      try {
        // Set responding state BEFORE sending
        setAgentResponding(agentId, true);

        // Add pending message for immediate UI feedback
        const pendingMsg: Message = {
          uuid: `pending-${Date.now()}`,
          type: 'user',
          content: queuedMessage.content,
          timestamp: new Date().toISOString(),
          isPending: true,
          contentBlocks: queuedMessage.attachments.length > 0
            ? buildContentBlocks(queuedMessage.content, queuedMessage.attachments)
            : undefined,
        };
        addPendingMessage(agentId, sessionId, queuedMessage.content, pendingMsg);

        // Remove from queue BEFORE sending (prevents double-send if event fires again)
        shiftQueue(agentId);

        // Convert attachments to backend format
        const backendAttachments: types.Attachment[] = queuedMessage.attachments.map((att: Attachment) => ({
          type: att.type,
          media_type: att.mediaType,
          data: att.data,
          fileName: att.fileName,
          filePath: att.filePath,
          extension: att.extension,
        }));

        // Send the message - this will trigger another response_complete when done
        // which will process the next queue item (if any)
        await SendMessage(agentId, sessionId, queuedMessage.content, backendAttachments, false);

        // Note: Don't clear responding state here - wait for response_complete event
        logDebug('QueueWatcher', 'SEND_SUCCESS', { agentId: agentId.substring(0, 8) });
      } catch (err) {
        console.error('[QueueWatcher] Failed to send queued message:', err);
        // Clear responding state on error
        setAgentResponding(agentId, false);
        // Note: Message was already removed from queue to prevent infinite retry loops
        // User would need to re-queue if they want to retry
      }
    };

    // Listen for the custom event dispatched by useWailsEvents
    window.addEventListener('claudefu:queue-autosubmit', handleAutoSubmit);
    return () => {
      window.removeEventListener('claudefu:queue-autosubmit', handleAutoSubmit);
    };
  }, [shiftQueue, getQueue, getLastSessionId, setAgentResponding, addPendingMessage]);

  // This component renders nothing - it's just an event handler
  return null;
}

/**
 * Build content blocks for a message with attachments.
 * This mirrors the structure expected by the backend.
 */
function buildContentBlocks(content: string, attachments: Attachment[]) {
  const blocks: any[] = [];

  // Add text block if content exists
  if (content) {
    blocks.push({ type: 'text', text: content });
  }

  // Add attachment blocks
  for (const att of attachments) {
    if (att.type === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mediaType,
          data: att.data,
        },
      });
    } else if (att.type === 'file') {
      // File attachments are rendered as text with XML delimiter
      // This matches how the backend formats them
      const displayPath = att.filePath || att.fileName;
      const ext = att.extension || 'txt';
      blocks.push({
        type: 'text',
        text: `\n\n<claudefu-file path="${displayPath}" ext="${ext}">\n${att.data}\n</claudefu-file>`,
      });
    }
  }

  return blocks;
}
