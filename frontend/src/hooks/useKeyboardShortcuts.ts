import { useEffect } from 'react';
import { SaveSettings } from '../../wailsjs/go/main/App';
import { settings as settingsModel } from '../../wailsjs/go/models';
import { workspace } from '../../wailsjs/go/models';
import { debugLogger } from '../utils/debugLogger';

interface KeyboardShortcutConfig {
  onNewWorkspace: () => void;
  onReloadWorkspace: () => void;
  onSelectAgent: (agentId: string) => void;
  onToggleTerminal: () => void;
  onAuthExpired: () => void;
  agents: workspace.Agent[];
  settings: any;
  onSettingsChange: (s: any) => void;
}

export function useKeyboardShortcuts(config: KeyboardShortcutConfig) {
  const { onNewWorkspace, onReloadWorkspace, onSelectAgent, onToggleTerminal,
          onAuthExpired, agents, settings, onSettingsChange } = config;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Note: CMD-S is handled by individual dialogs/panes when open
      // No global CMD-S handler here to avoid conflicts

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        onNewWorkspace();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        onReloadWorkspace();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (index < agents.length) {
          onSelectAgent(agents[index].id);
        }
      }

      // Ctrl+` to toggle terminal
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        onToggleTerminal();
        return;
      }

      // Ctrl+Shift+D to toggle debug logging
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const newEnabled = !debugLogger.isEnabled();
        debugLogger.setEnabled(newEnabled);
        // Save to settings
        const newSettings = settingsModel.Settings.createFrom({
          ...settings,
          debugLogging: newEnabled
        });
        SaveSettings(newSettings).then(() => {
          onSettingsChange(newSettings);
          console.log(`[ClaudeFu] Debug logging ${newEnabled ? 'ENABLED' : 'DISABLED'} (Ctrl+Shift+D to toggle)`);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [agents, settings, onNewWorkspace, onReloadWorkspace, onSelectAgent, onToggleTerminal, onSettingsChange]);

  // Listen for auth:expired events from backend
  useEffect(() => {
    const handleAuthExpired = () => {
      onAuthExpired();
    };
    window.addEventListener('claudefu:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('claudefu:auth-expired', handleAuthExpired);
  }, [onAuthExpired]);
}
