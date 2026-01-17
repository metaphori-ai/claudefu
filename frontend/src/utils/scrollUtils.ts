// Scroll utility functions for ChatView

/**
 * Check if scroll position is near bottom (within threshold)
 */
export function isNearBottom(
  container: HTMLElement | null,
  threshold: number = 300
): boolean {
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/**
 * Scroll container to bottom
 */
export function scrollToBottom(container: HTMLElement | null): void {
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * Scroll to bottom using requestAnimationFrame for smoother behavior
 */
export function scrollToBottomRAF(container: HTMLElement | null): void {
  requestAnimationFrame(() => {
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  });
}

/**
 * Scroll to bottom with double RAF for ensuring DOM has fully updated
 */
export function scrollToBottomDoubleRAF(container: HTMLElement | null): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  });
}

/**
 * Get scroll debug info
 */
export interface ScrollDebugInfo {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceFromBottom: number;
  isNearBottom: boolean;
}

export function getScrollDebugInfo(
  container: HTMLElement | null,
  threshold: number = 300
): ScrollDebugInfo {
  if (!container) {
    return {
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      distanceFromBottom: 0,
      isNearBottom: true
    };
  }
  const { scrollTop, scrollHeight, clientHeight } = container;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return {
    scrollTop: Math.round(scrollTop),
    scrollHeight: Math.round(scrollHeight),
    clientHeight: Math.round(clientHeight),
    distanceFromBottom: Math.round(distanceFromBottom),
    isNearBottom: distanceFromBottom < threshold
  };
}
