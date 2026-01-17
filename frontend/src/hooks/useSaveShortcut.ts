import { useEffect, useCallback } from 'react';

/**
 * Hook to capture CMD-S (or Ctrl-S) keyboard shortcut for save actions.
 * Only active when isActive is true (e.g., dialog is open).
 *
 * @param isActive - Whether the shortcut should be active (typically dialog isOpen state)
 * @param onSave - Callback to execute when CMD-S is pressed
 */
export function useSaveShortcut(isActive: boolean, onSave: () => void) {
  // Memoize the handler to avoid unnecessary re-subscriptions
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      e.stopPropagation();
      onSave();
    }
  }, [onSave]);

  useEffect(() => {
    if (!isActive) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleKeyDown]);
}
