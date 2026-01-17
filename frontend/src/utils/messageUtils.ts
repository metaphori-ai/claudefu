import type { ContentBlock, ImageSource, Message, PendingQuestion } from '../components/chat/types';

/**
 * Format timestamp for display
 */
export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Convert ImageSource to displayable URL
 */
export function getImageUrl(source?: ImageSource): string | null {
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
}

/**
 * Build a global map of tool results by tool_use_id from all messages
 */
export function buildToolResultMap(messages: Message[]): Map<string, ContentBlock> {
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
}

/**
 * Build a global map of pending questions by tool_use_id
 */
export function buildPendingQuestionMap(messages: Message[]): Map<string, PendingQuestion> {
  const map = new Map<string, PendingQuestion>();
  for (const msg of messages) {
    if (msg.pendingQuestion) {
      map.set(msg.pendingQuestion.toolUseId, msg.pendingQuestion);
    }
  }
  return map;
}

/**
 * Compute debug stats from messages
 */
export interface DebugStats {
  total: number;
  typeCounts: Record<string, number>;
  userMsgCount: number;
  assistantMsgCount: number;
  toolResultCarrierCount: number;
  displayable: number;
}

export function computeDebugStats(messages: Message[]): DebugStats {
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
}

/**
 * Filter messages to render based on pending questions and synthetic messages
 */
export function filterMessagesToRender(
  messages: Message[],
  pendingQuestionMap: Map<string, PendingQuestion>,
  globalToolResultMap: Map<string, ContentBlock>
): Message[] {
  // Find the index of the message containing a pending question
  let pendingQuestionMsgIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.pendingQuestion && pendingQuestionMap.has(msg.pendingQuestion.toolUseId)) {
      pendingQuestionMsgIdx = i;
      break;
    }
  }

  // Check if any AskUserQuestion was answered successfully (is_error=false)
  let hasSuccessfulAskUserQuestion = false;
  for (const msg of messages) {
    const blocks = msg.contentBlocks || [];
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.name === 'AskUserQuestion' && block.id) {
        const result = globalToolResultMap.get(block.id);
        if (result && result.is_error === false) {
          hasSuccessfulAskUserQuestion = true;
          break;
        }
      }
    }
    if (hasSuccessfulAskUserQuestion) break;
  }

  // Filter messages: hide all messages AFTER the one with pending question
  let filtered = pendingQuestionMsgIdx >= 0
    ? messages.slice(0, pendingQuestionMsgIdx + 1)
    : messages;

  // Filter out synthetic messages if AskUserQuestion was answered successfully
  if (hasSuccessfulAskUserQuestion) {
    filtered = filtered.filter(msg => !msg.isSynthetic);
  }

  return filtered;
}
