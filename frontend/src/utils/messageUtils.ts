import type { ContentBlock, ImageSource, Message, PendingQuestion, TokenUsage } from '../components/chat/types';

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

/**
 * Extract text content from a single message's content blocks.
 * Only includes text blocks, excludes tool_use, tool_result, thinking, etc.
 */
export function getMessageText(message: Message): string {
  const textParts: string[] = [];
  for (const block of message.contentBlocks || []) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    }
  }
  return textParts.join('\n\n') || message.content;
}

/**
 * Get aggregated text from all assistant messages in a response group.
 * A response group is all consecutive assistant messages between user messages.
 * Excludes tool_use, tool_result, and thinking blocks.
 */
export function getFullResponseText(
  messages: Message[],
  startIndex: number
): string {
  const textParts: string[] = [];

  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];

    // Stop at next user message
    if (msg.type === 'user') break;

    // Skip non-assistant messages
    if (msg.type !== 'assistant') continue;

    // Extract text blocks only
    for (const block of msg.contentBlocks || []) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      }
    }
  }

  return textParts.join('\n\n');
}

/**
 * Check if this message is the last assistant message before a user message (or end of array).
 * Used to determine where to show the "copy full response" button.
 */
export function isLastAssistantInResponse(
  messages: Message[],
  index: number
): boolean {
  const msg = messages[index];
  if (msg.type !== 'assistant') return false;

  // Look ahead for next message
  for (let i = index + 1; i < messages.length; i++) {
    const nextMsg = messages[i];
    if (nextMsg.type === 'user') return true;  // User next = we're last assistant
    if (nextMsg.type === 'assistant') return false;  // Another assistant = not last
    // Skip tool_result_carrier and other types
  }

  return true;  // End of array = we're last
}

/**
 * Find the start index of a response group (first assistant message after the previous user message).
 */
export function findResponseGroupStart(
  messages: Message[],
  lastAssistantIndex: number
): number {
  let startIdx = lastAssistantIndex;

  // Walk backwards to find the first assistant message in this group
  while (startIdx > 0) {
    const prevMsg = messages[startIdx - 1];
    if (prevMsg.type === 'user') break;  // Found previous user message
    if (prevMsg.type === 'assistant') {
      startIdx--;  // Include this assistant message in the group
    } else {
      // Skip tool_result_carrier and other types, keep looking
      startIdx--;
    }
  }

  // Now find the first actual assistant message from startIdx
  while (startIdx <= lastAssistantIndex && messages[startIdx].type !== 'assistant') {
    startIdx++;
  }

  return startIdx;
}

/**
 * Session token metrics - all values for display.
 *
 * Latest values (from most recent API response):
 * - inputTokens (in): Non-cached input tokens
 * - cacheRead (cr): Tokens read from cache
 * - cacheWrite (cw): Tokens written to cache
 * - contextSize (ctx): Total context = in + cr + cw
 *
 * Cumulative values:
 * - totalOutput (out): Sum of all output tokens generated
 */
export interface SessionTokenMetrics {
  inputTokens: number;      // in - latest input_tokens (non-cached)
  cacheRead: number;        // cr - latest cache_read_input_tokens
  cacheWrite: number;       // cw - latest cache_creation_input_tokens
  contextSize: number;      // ctx - total context = in + cr + cw
  totalOutput: number;      // out - sum of all output_tokens
}

/**
 * Compute token metrics from messages.
 * Latest values from most recent message, cumulative for output.
 */
export function computeTokenMetrics(messages: Message[]): SessionTokenMetrics {
  let inputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalOutput = 0;

  for (const msg of messages) {
    if (msg.usage) {
      // Always update latest values - we want the most recent
      const inTokens = msg.usage.input_tokens || 0;
      const cr = msg.usage.cache_read_input_tokens || 0;
      const cw = msg.usage.cache_creation_input_tokens || 0;

      if (inTokens > 0 || cr > 0 || cw > 0) {
        inputTokens = inTokens;
        cacheRead = cr;
        cacheWrite = cw;
      }
      // Sum output tokens
      totalOutput += msg.usage.output_tokens || 0;
    }
  }

  // Context size is total tokens in the context window
  const contextSize = inputTokens + cacheRead + cacheWrite;

  return {
    inputTokens,
    cacheRead,
    cacheWrite,
    contextSize,
    totalOutput
  };
}

/**
 * Format token count for display (e.g., "12.5k" for 12500).
 */
export function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}
