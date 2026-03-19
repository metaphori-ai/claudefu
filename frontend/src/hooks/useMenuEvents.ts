import { useEffect } from 'react';
import { EventsOn, BrowserOpenURL } from '../../wailsjs/runtime/runtime';

interface MenuEventHandlers {
  // Workspace
  onNewWorkspace: () => void;
  onSwitchWorkspace: (id: string) => void;
  onRenameWorkspace: () => void;
  onDeleteWorkspace: () => void;
  onManageWorkspaces: () => void;
  // Agent
  onNewSession: () => void;
  onSelectSession: () => void;
  onRenameAgent: () => void;
  onRemoveAgent: () => void;
  onManageAgents: () => void;
  onSwitchAgent: (agentId: string) => void;
  // App
  onCheckUpdates: () => void;
}

export function useMenuEvents(handlers: MenuEventHandlers) {
  useEffect(() => {
    const subscriptions = [
      EventsOn('menu:about', () => {
        // Handled by macOS native About panel via mac.AboutInfo
      }),
      EventsOn('menu:how-it-works', () => {
        BrowserOpenURL('https://github.com/metaphori-ai/claudefu#readme');
      }),
      EventsOn('menu:settings', () => {
        // TODO: Open settings dialog
        console.log('[Menu] Settings clicked');
      }),
      EventsOn('menu:check-updates', () => {
        handlers.onCheckUpdates();
      }),
      EventsOn('menu:new-session', () => {
        handlers.onNewSession();
      }),
      EventsOn('menu:select-session', () => {
        handlers.onSelectSession();
      }),
      EventsOn('menu:rename-agent', () => {
        handlers.onRenameAgent();
      }),
      EventsOn('menu:remove-agent', () => {
        handlers.onRemoveAgent();
      }),
      EventsOn('menu:manage-agents', () => {
        handlers.onManageAgents();
      }),
      EventsOn('menu:new-workspace', () => {
        handlers.onNewWorkspace();
      }),
      EventsOn('menu:rename-workspace', () => {
        handlers.onRenameWorkspace();
      }),
      EventsOn('menu:delete-workspace', () => {
        handlers.onDeleteWorkspace();
      }),
      EventsOn('menu:manage-workspaces', () => {
        handlers.onManageWorkspaces();
      }),
      EventsOn('menu:switch-workspace', (data: { workspaceId?: string }) => {
        if (data?.workspaceId) {
          handlers.onSwitchWorkspace(data.workspaceId);
        }
      }),
      EventsOn('menu:switch-agent', (data: { agentId?: string }) => {
        if (data?.agentId) {
          handlers.onSwitchAgent(data.agentId);
        }
      }),
    ];

    return () => {
      subscriptions.forEach(unsub => unsub());
    };
  }, [handlers]);
}
