import { useState, useRef, useEffect, useCallback } from 'react';
import { isNearBottom as checkNearBottom, getScrollDebugInfo, type ScrollDebugInfo } from '../utils/scrollUtils';

export interface UseScrollManagementReturn {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  showScrollButton: boolean;
  forceScrollActive: boolean;
  forceScrollActiveRef: React.MutableRefObject<boolean>;
  scrollDebug: ScrollDebugInfo;
  isNearBottom: () => boolean;
  scrollToBottom: () => void;
  scrollToBottomRAF: () => void;
  scrollToBottomDoubleRAF: () => void;
  activateForceScroll: () => void;
}

export function useScrollManagement(messages: unknown[]): UseScrollManagementReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const forceScrollActiveRef = useRef<boolean>(false);

  const [showScrollButton, setShowScrollButton] = useState(false);
  const [forceScrollActive, setForceScrollActive] = useState(false);
  const [scrollDebug, setScrollDebug] = useState<ScrollDebugInfo>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    distanceFromBottom: 0,
    isNearBottom: true
  });

  // Check if user is scrolled near bottom
  const isNearBottom = useCallback(() => {
    return checkNearBottom(scrollContainerRef.current, 300);
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      // Reactivate force scroll since user wants to follow
      forceScrollActiveRef.current = true;
      setForceScrollActive(true);
    }
  }, []);

  // Scroll to bottom with requestAnimationFrame
  const scrollToBottomRAF = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    });
  }, []);

  // Scroll to bottom with double RAF (ensures DOM has updated)
  const scrollToBottomDoubleRAF = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      });
    });
  }, []);

  // Activate force scroll (for when user sends a message)
  const activateForceScroll = useCallback(() => {
    forceScrollActiveRef.current = true;
    setForceScrollActive(true);
  }, []);

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
      }

      // Update scroll debug info
      setScrollDebug(getScrollDebugInfo(container, 300));
    };

    container.addEventListener('scroll', handleScroll);
    // Check initial state
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages]); // Re-attach when messages change

  return {
    scrollContainerRef,
    messagesEndRef,
    showScrollButton,
    forceScrollActive,
    forceScrollActiveRef,
    scrollDebug,
    isNearBottom,
    scrollToBottom,
    scrollToBottomRAF,
    scrollToBottomDoubleRAF,
    activateForceScroll
  };
}
