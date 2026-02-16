import { useState, useEffect, useCallback } from 'react';
import { SlideInPane } from './SlideInPane';
import { workspace, mcpserver } from '../../wailsjs/go/models';
import {
  GetMCPToolInstructions, SaveMCPToolInstructions, GetDefaultMCPToolInstructions,
  GetMCPToolAvailability, SaveMCPToolAvailability, GetDefaultMCPToolAvailability,
} from '../../wailsjs/go/main/App';
import { useSaveShortcut } from '../hooks';

// Password required to enable BrowserAgent (experimental tool)
const BROWSER_AGENT_PASSWORD = 'claudefu';

interface MCPSettingsPaneProps {
  isOpen: boolean;
  onClose: () => void;
  agents: workspace.Agent[];
  mcpConfig: workspace.MCPConfig | undefined;
  onSave: (config: workspace.MCPConfig, agents: workspace.Agent[]) => void;
}

// Helper to derive slug from name (must match backend slugify function)
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function MCPSettingsPane({
  isOpen,
  onClose,
  agents,
  mcpConfig,
  onSave,
}: MCPSettingsPaneProps) {
  // Local state for editing
  const [enabled, setEnabled] = useState(mcpConfig?.enabled ?? true);
  const [port, setPort] = useState(mcpConfig?.port || 9315);
  const [agentSettings, setAgentSettings] = useState<Map<string, {
    mcpEnabled: boolean;
    mcpSlug: string;
    mcpDescription: string;
  }>>(new Map());

  // Tool instructions state
  const [toolInstructions, setToolInstructions] = useState<mcpserver.ToolInstructions | null>(null);
  const [instructionsLoading, setInstructionsLoading] = useState(false);

  // Tool availability state
  const [toolAvailability, setToolAvailability] = useState<mcpserver.ToolAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  // Password dialog state for BrowserAgent
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Tab state
  const [activeTab, setActiveTab] = useState<'config' | 'availability' | 'instructions'>('config');

  // Initialize agent settings when pane opens or agents change
  useEffect(() => {
    const settings = new Map<string, { mcpEnabled: boolean; mcpSlug: string; mcpDescription: string }>();
    for (const agent of agents) {
      settings.set(agent.id, {
        mcpEnabled: agent.mcpEnabled !== false, // Default true
        mcpSlug: agent.mcpSlug || '',
        mcpDescription: agent.mcpDescription || '',
      });
    }
    setAgentSettings(settings);
  }, [agents, isOpen]);

  // Reset form when config changes
  useEffect(() => {
    setEnabled(mcpConfig?.enabled ?? true);
    setPort(mcpConfig?.port || 9315);
  }, [mcpConfig, isOpen]);

  // Load tool instructions when pane opens
  useEffect(() => {
    if (isOpen) {
      setInstructionsLoading(true);
      GetMCPToolInstructions()
        .then((instructions) => {
          setToolInstructions(instructions);
        })
        .catch((err) => {
          console.error('Failed to load tool instructions:', err);
        })
        .finally(() => {
          setInstructionsLoading(false);
        });
    }
  }, [isOpen]);

  // Load tool availability when pane opens
  useEffect(() => {
    if (isOpen) {
      setAvailabilityLoading(true);
      GetMCPToolAvailability()
        .then((availability) => {
          setToolAvailability(availability);
        })
        .catch((err) => {
          console.error('Failed to load tool availability:', err);
        })
        .finally(() => {
          setAvailabilityLoading(false);
        });
    }
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    // Save tool instructions if modified
    if (toolInstructions) {
      try {
        await SaveMCPToolInstructions(toolInstructions);
      } catch (err) {
        console.error('Failed to save tool instructions:', err);
      }
    }

    // Save tool availability if modified
    if (toolAvailability) {
      try {
        await SaveMCPToolAvailability(toolAvailability);
      } catch (err) {
        console.error('Failed to save tool availability:', err);
      }
    }

    // Build updated config
    const newConfig = workspace.MCPConfig.createFrom({
      enabled,
      port,
    });

    // Build updated agents with MCP settings
    const updatedAgents = agents.map(agent => {
      const settings = agentSettings.get(agent.id);
      return {
        ...agent,
        mcpEnabled: settings?.mcpEnabled ?? true,
        mcpSlug: settings?.mcpSlug || undefined,
        mcpDescription: settings?.mcpDescription || undefined,
      };
    });

    onSave(newConfig, updatedAgents);
    onClose();
  }, [toolInstructions, toolAvailability, enabled, port, agents, agentSettings, onSave, onClose]);

  // CMD-S to save
  useSaveShortcut(isOpen, handleSave);

  const handleResetInstructions = async () => {
    try {
      const defaults = await GetDefaultMCPToolInstructions();
      setToolInstructions(defaults);
    } catch (err) {
      console.error('Failed to get default instructions:', err);
    }
  };

  const updateInstruction = (field: keyof mcpserver.ToolInstructions, value: string) => {
    if (!toolInstructions) return;
    setToolInstructions({
      ...toolInstructions,
      [field]: value,
    });
  };

  const updateAgentSetting = (
    agentId: string,
    field: 'mcpEnabled' | 'mcpSlug' | 'mcpDescription',
    value: boolean | string
  ) => {
    setAgentSettings(prev => {
      const next = new Map(prev);
      const current = next.get(agentId) || { mcpEnabled: true, mcpSlug: '', mcpDescription: '' };
      next.set(agentId, { ...current, [field]: value });
      return next;
    });
  };

  const getEffectiveSlug = (agent: workspace.Agent): string => {
    const settings = agentSettings.get(agent.id);
    return settings?.mcpSlug || slugify(agent.name);
  };

  // Update tool availability
  const updateAvailability = (field: keyof mcpserver.ToolAvailability, value: boolean) => {
    if (!toolAvailability) return;
    setToolAvailability({
      ...toolAvailability,
      [field]: value,
    });
  };

  // Handle BrowserAgent toggle with password protection
  const handleBrowserAgentToggle = () => {
    if (toolAvailability?.browserAgent) {
      // Disabling doesn't need password
      updateAvailability('browserAgent', false);
    } else {
      // Enabling requires password
      setPasswordInput('');
      setPasswordError('');
      setShowPasswordDialog(true);
    }
  };

  // Verify password and enable BrowserAgent
  const handlePasswordSubmit = () => {
    if (passwordInput === BROWSER_AGENT_PASSWORD) {
      updateAvailability('browserAgent', true);
      setShowPasswordDialog(false);
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('Incorrect password');
    }
  };

  const tabStyle = (tab: 'config' | 'availability' | 'instructions') => ({
    padding: '0.6rem 1.25rem',
    borderRadius: '6px 6px 0 0',
    border: 'none',
    background: activeTab === tab ? '#1a1a1a' : 'transparent',
    color: activeTab === tab ? '#fff' : '#666',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: activeTab === tab ? 500 : 400,
    borderBottom: activeTab === tab ? '2px solid #8b5cf6' : '2px solid transparent',
  });

  return (
    <SlideInPane
      isOpen={isOpen}
      onClose={onClose}
      title="MCP Settings"
      titleColor="#8b5cf6"
      storageKey="mcp-settings"
      defaultWidth={700}
      icon={
        <img
          src="/assets/mcp.png"
          alt="MCP"
          style={{
            width: '20px',
            height: '20px',
            filter: 'invert(1)'
          }}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Tab Bar */}
        <div style={{
          display: 'flex',
          gap: '0.25rem',
          borderBottom: '1px solid #333',
          marginBottom: '1rem',
        }}>
          <button style={tabStyle('config')} onClick={() => setActiveTab('config')}>
            Configuration
          </button>
          <button style={tabStyle('availability')} onClick={() => setActiveTab('availability')}>
            Tool Availability
          </button>
          <button style={tabStyle('instructions')} onClick={() => setActiveTab('instructions')}>
            Tool Instructions
          </button>
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
          {activeTab === 'config' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Global MCP Settings */}
        <section>
          <h3 style={{ color: '#888', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            MCP Server
          </h3>
          <div style={{
            background: '#1a1a1a',
            borderRadius: '8px',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}>
            {/* Enable/Disable Toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
              />
              <span style={{ color: '#fff' }}>Enable MCP Server</span>
            </label>

            {/* Port */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <label style={{ color: '#888', minWidth: '40px' }}>Port:</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 9315)}
                disabled={!enabled}
                style={{
                  width: '100px',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #333',
                  background: enabled ? '#0a0a0a' : '#1a1a1a',
                  color: enabled ? '#fff' : '#666',
                  fontSize: '0.9rem',
                }}
              />
              <span style={{ color: '#666', fontSize: '0.8rem' }}>
                (default: 9315)
              </span>
            </div>

            {/* Connection Info */}
            {enabled && (
              <div style={{
                background: '#0a0a0a',
                borderRadius: '4px',
                padding: '0.75rem',
                fontSize: '0.8rem',
                color: '#666',
              }}>
                <div style={{ marginBottom: '0.5rem', color: '#888' }}>Claude Code MCP config:</div>
                <code style={{ color: '#8b5cf6', wordBreak: 'break-all' }}>
                  {`~/.claude/mcp.json → "claudefu": { "transport": { "type": "sse", "url": "http://localhost:${port}/sse" } }`}
                </code>
              </div>
            )}
          </div>
        </section>

        {/* Agent MCP Settings */}
        <section>
          <h3 style={{ color: '#888', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Agent Configuration
          </h3>

          {agents.length === 0 ? (
            <div style={{ color: '#666', fontSize: '0.9rem', padding: '1rem', textAlign: 'center' }}>
              No agents in workspace. Add agents to configure MCP settings.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {agents.map(agent => {
                const settings = agentSettings.get(agent.id);
                const isEnabled = settings?.mcpEnabled ?? true;
                const effectiveSlug = getEffectiveSlug(agent);

                return (
                  <div
                    key={agent.id}
                    style={{
                      background: '#1a1a1a',
                      borderRadius: '8px',
                      padding: '1rem',
                      opacity: enabled ? 1 : 0.5,
                    }}
                  >
                    {/* Agent Header Row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => updateAgentSetting(agent.id, 'mcpEnabled', e.target.checked)}
                          disabled={!enabled}
                          style={{ width: '16px', height: '16px', accentColor: '#8b5cf6', marginRight: '0.5rem' }}
                        />
                      </label>
                      <span style={{ color: isEnabled ? '#fff' : '#666', fontWeight: 500 }}>
                        {agent.name}
                      </span>
                      <span style={{
                        color: '#8b5cf6',
                        fontSize: '0.8rem',
                        background: '#2d1f5e',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px',
                      }}>
                        {effectiveSlug}
                      </span>
                    </div>

                    {/* Agent Settings (only if enabled) */}
                    {isEnabled && enabled && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingLeft: '1.5rem' }}>
                        {/* Custom Slug */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label style={{ color: '#666', fontSize: '0.8rem', minWidth: '80px' }}>
                            Custom slug:
                          </label>
                          <input
                            type="text"
                            value={settings?.mcpSlug || ''}
                            onChange={(e) => updateAgentSetting(agent.id, 'mcpSlug', e.target.value)}
                            placeholder={slugify(agent.name)}
                            style={{
                              flex: 1,
                              padding: '0.4rem 0.6rem',
                              borderRadius: '4px',
                              border: '1px solid #333',
                              background: '#0a0a0a',
                              color: '#fff',
                              fontSize: '0.85rem',
                            }}
                          />
                        </div>

                        {/* Description */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                          <label style={{ color: '#666', fontSize: '0.8rem', minWidth: '80px', marginTop: '0.4rem' }}>
                            Description:
                          </label>
                          <input
                            type="text"
                            value={settings?.mcpDescription || ''}
                            onChange={(e) => updateAgentSetting(agent.id, 'mcpDescription', e.target.value)}
                            placeholder="What this agent knows about..."
                            style={{
                              flex: 1,
                              padding: '0.4rem 0.6rem',
                              borderRadius: '4px',
                              border: '1px solid #333',
                              background: '#0a0a0a',
                              color: '#fff',
                              fontSize: '0.85rem',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Tool Preview */}
        {enabled && agents.some(a => agentSettings.get(a.id)?.mcpEnabled !== false) && (
          <section>
            <h3 style={{ color: '#888', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
              Tool Description Preview
            </h3>
            <div style={{
              background: '#1a1a1a',
              borderRadius: '8px',
              padding: '1rem',
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              color: '#888',
              whiteSpace: 'pre-wrap',
            }}>
              <div style={{ color: '#666', marginBottom: '0.5rem' }}>Available agents:</div>
              {agents
                .filter(a => agentSettings.get(a.id)?.mcpEnabled !== false)
                .map(agent => {
                  const settings = agentSettings.get(agent.id);
                  const slug = settings?.mcpSlug || slugify(agent.name);
                  const desc = settings?.mcpDescription;
                  return (
                    <div key={agent.id} style={{ color: '#8b5cf6' }}>
                      - {slug}: {desc || `(${agent.name})`}
                    </div>
                  );
                })}
            </div>
          </section>
        )}
            </div>
          )}

          {activeTab === 'availability' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {availabilityLoading ? (
                <div style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
                  Loading tool availability...
                </div>
              ) : toolAvailability ? (
                <>
                  <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>
                    Configure which MCP tools are available to agents.
                  </p>

                  {/* Standard Tools */}
                  <section>
                    <h3 style={{ color: '#888', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                      Standard Tools
                    </h3>
                    <div style={{
                      background: '#1a1a1a',
                      borderRadius: '8px',
                      padding: '1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}>
                      {/* AgentQuery */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.agentQuery}
                          onChange={(e) => updateAvailability('agentQuery', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>AgentQuery</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Query other agents</span>
                        </div>
                      </label>

                      {/* AgentMessage */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.agentMessage}
                          onChange={(e) => updateAvailability('agentMessage', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>AgentMessage</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Send messages to inbox</span>
                        </div>
                      </label>

                      {/* AgentBroadcast */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.agentBroadcast}
                          onChange={(e) => updateAvailability('agentBroadcast', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>AgentBroadcast</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Broadcast to all agents</span>
                        </div>
                      </label>

                      {/* NotifyUser */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.notifyUser}
                          onChange={(e) => updateAvailability('notifyUser', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>NotifyUser</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Show notifications</span>
                        </div>
                      </label>

                      {/* AskUserQuestion - locked, required for ClaudeFu */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'not-allowed', opacity: 0.6 }}>
                        <input
                          type="checkbox"
                          checked={true}
                          disabled
                          style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>AskUserQuestion</span>
                          <span style={{ color: '#888', marginLeft: '0.5rem', fontSize: '0.8rem', fontStyle: 'italic' }}>(required)</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Ask user questions</span>
                        </div>
                      </label>

                      {/* SelfQuery */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.selfQuery}
                          onChange={(e) => updateAvailability('selfQuery', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>SelfQuery</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Query own codebase</span>
                        </div>
                      </label>

                      {/* RequestToolPermission */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.requestToolPermission}
                          onChange={(e) => updateAvailability('requestToolPermission', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>RequestToolPermission</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Request permission for restricted tools</span>
                        </div>
                      </label>

                      {/* ExitPlanMode - locked, required for ClaudeFu */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'not-allowed', opacity: 0.6 }}>
                        <input
                          type="checkbox"
                          checked={true}
                          disabled
                          style={{ width: '18px', height: '18px', accentColor: '#8b5cf6' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>ExitPlanMode</span>
                          <span style={{ color: '#888', marginLeft: '0.5rem', fontSize: '0.8rem', fontStyle: 'italic' }}>(required)</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Plan review approval flow</span>
                        </div>
                      </label>
                    </div>
                  </section>

                  {/* Backlog Tools */}
                  <section>
                    <h3 style={{ color: '#888', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                      Backlog Tools
                    </h3>
                    <div style={{
                      background: '#1a1a1a',
                      borderRadius: '8px',
                      padding: '1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}>
                      {/* BacklogAdd */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.backlogAdd}
                          onChange={(e) => updateAvailability('backlogAdd', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#d97757' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>BacklogAdd</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Add items to per-agent backlog</span>
                        </div>
                      </label>

                      {/* BacklogUpdate */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.backlogUpdate}
                          onChange={(e) => updateAvailability('backlogUpdate', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#d97757' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>BacklogUpdate</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>Update backlog items (title, status, context, tags)</span>
                        </div>
                      </label>

                      {/* BacklogList */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={toolAvailability.backlogList}
                          onChange={(e) => updateAvailability('backlogList', e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#d97757' }}
                        />
                        <div>
                          <span style={{ color: '#fff' }}>BacklogList</span>
                          <span style={{ color: '#666', marginLeft: '0.75rem', fontSize: '0.85rem' }}>List and filter per-agent backlog items</span>
                        </div>
                      </label>
                    </div>
                  </section>

                  {/* Experimental Tools */}
                  <section>
                    <h3 style={{ color: '#888', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                      Experimental Tools
                    </h3>
                    <div style={{
                      background: '#1a1a1a',
                      borderRadius: '8px',
                      padding: '1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}>
                      {/* BrowserAgent - with lock icon and password protection */}
                      <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={toolAvailability.browserAgent}
                            onChange={handleBrowserAgentToggle}
                            style={{ width: '18px', height: '18px', accentColor: '#d97757' }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ color: toolAvailability.browserAgent ? '#d97757' : '#fff' }}>BrowserAgent</span>
                            <span style={{ fontSize: '1rem' }}>
                              {toolAvailability.browserAgent ? '' : '🔒'}
                            </span>
                          </div>
                        </label>
                        <div style={{ marginLeft: '2.25rem', marginTop: '0.5rem' }}>
                          <p style={{ color: '#666', fontSize: '0.85rem', margin: 0 }}>
                            Delegate to Claude in Browser via Chrome extension
                          </p>
                          <p style={{ color: '#d97757', fontSize: '0.8rem', margin: '0.25rem 0 0 0' }}>
                            Requires custom Chrome extension bridge
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>
                </>
              ) : (
                <div style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
                  Failed to load tool availability
                </div>
              )}
            </div>
          )}

          {activeTab === 'instructions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {instructionsLoading ? (
                <div style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
                  Loading instructions...
                </div>
              ) : toolInstructions ? (
                <>
                  <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>
                    Customize the tool descriptions and system prompts sent to Claude Code agents.
                  </p>

                  {/* AgentQuery */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#8b5cf6',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      AgentQuery
                    </label>
                    <textarea
                      value={toolInstructions.agentQuery}
                      onChange={(e) => updateInstruction('agentQuery', e.target.value)}
                      rows={5}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* AgentQuery System Prompt */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#d97757',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      AgentQuery System Prompt
                      <span style={{ color: '#666', fontWeight: 400, marginLeft: '0.5rem' }}>
                        (appended to target agent)
                      </span>
                    </label>
                    <textarea
                      value={toolInstructions.agentQuerySystemPrompt}
                      onChange={(e) => updateInstruction('agentQuerySystemPrompt', e.target.value)}
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* SelfQuery */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#d97757',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      SelfQuery
                      <span style={{ color: '#666', fontWeight: 400, marginLeft: '0.5rem' }}>
                        (query your own codebase with CLAUDE.md context)
                      </span>
                    </label>
                    <textarea
                      value={toolInstructions.selfQuery || ''}
                      onChange={(e) => updateInstruction('selfQuery', e.target.value)}
                      rows={6}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* SelfQuery System Prompt */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#d97757',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      SelfQuery System Prompt
                      <span style={{ color: '#666', fontWeight: 400, marginLeft: '0.5rem' }}>
                        (appended to self-query)
                      </span>
                    </label>
                    <textarea
                      value={toolInstructions.selfQuerySystemPrompt || ''}
                      onChange={(e) => updateInstruction('selfQuerySystemPrompt', e.target.value)}
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* AgentMessage */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#8b5cf6',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      AgentMessage
                    </label>
                    <textarea
                      value={toolInstructions.agentMessage}
                      onChange={(e) => updateInstruction('agentMessage', e.target.value)}
                      rows={6}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* AgentBroadcast */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#8b5cf6',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      AgentBroadcast
                    </label>
                    <textarea
                      value={toolInstructions.agentBroadcast}
                      onChange={(e) => updateInstruction('agentBroadcast', e.target.value)}
                      rows={4}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* NotifyUser */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#8b5cf6',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      NotifyUser
                    </label>
                    <textarea
                      value={toolInstructions.notifyUser}
                      onChange={(e) => updateInstruction('notifyUser', e.target.value)}
                      rows={4}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* AskUserQuestion */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#8b5cf6',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      AskUserQuestion
                    </label>
                    <textarea
                      value={toolInstructions.askUserQuestion}
                      onChange={(e) => updateInstruction('askUserQuestion', e.target.value)}
                      rows={5}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* BrowserAgent */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#d97757',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      BrowserAgent
                      <span style={{ color: '#666', fontWeight: 400, marginLeft: '0.5rem' }}>
                        (experimental - requires Chrome extension bridge)
                      </span>
                    </label>
                    <textarea
                      value={toolInstructions.browserAgent || ''}
                      onChange={(e) => updateInstruction('browserAgent', e.target.value)}
                      rows={6}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* RequestToolPermission */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#8b5cf6',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      RequestToolPermission
                    </label>
                    <textarea
                      value={toolInstructions.requestToolPermission || ''}
                      onChange={(e) => updateInstruction('requestToolPermission', e.target.value)}
                      rows={5}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* ExitPlanMode */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#8b5cf6',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      ExitPlanMode
                    </label>
                    <textarea
                      value={toolInstructions.exitPlanMode || ''}
                      onChange={(e) => updateInstruction('exitPlanMode', e.target.value)}
                      rows={5}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* BacklogAdd */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#d97757',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      BacklogAdd
                      <span style={{ color: '#666', fontWeight: 400, marginLeft: '0.5rem' }}>
                        (per-agent backlog — park ideas with context)
                      </span>
                    </label>
                    <textarea
                      value={toolInstructions.backlogAdd || ''}
                      onChange={(e) => updateInstruction('backlogAdd', e.target.value)}
                      rows={8}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* BacklogUpdate */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#d97757',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      BacklogUpdate
                      <span style={{ color: '#666', fontWeight: 400, marginLeft: '0.5rem' }}>
                        (modify title, status, context, tags)
                      </span>
                    </label>
                    <textarea
                      value={toolInstructions.backlogUpdate || ''}
                      onChange={(e) => updateInstruction('backlogUpdate', e.target.value)}
                      rows={6}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* BacklogList */}
                  <div>
                    <label style={{
                      display: 'block',
                      color: '#d97757',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}>
                      BacklogList
                      <span style={{ color: '#666', fontWeight: 400, marginLeft: '0.5rem' }}>
                        (list and filter per-agent backlog)
                      </span>
                    </label>
                    <textarea
                      value={toolInstructions.backlogList || ''}
                      onChange={(e) => updateInstruction('backlogList', e.target.value)}
                      rows={7}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                        background: '#0a0a0a',
                        color: '#fff',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        lineHeight: '1.4',
                      }}
                    />
                  </div>

                  {/* Reset to Defaults Button */}
                  <button
                    onClick={handleResetInstructions}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '4px',
                      border: '1px solid #333',
                      background: 'transparent',
                      color: '#888',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      alignSelf: 'flex-start',
                    }}
                  >
                    Reset to Defaults
                  </button>
                </>
              ) : (
                <div style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
                  Failed to load instructions
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save Button - Fixed at bottom */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          paddingTop: '1rem',
          borderTop: '1px solid #333',
          marginTop: '1rem',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: '6px',
              border: '1px solid #333',
              background: 'transparent',
              color: '#888',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              background: '#8b5cf6',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.9rem',
            }}
          >
            Save Changes
          </button>
        </div>
      </div>

      {/* Password Dialog for BrowserAgent */}
      {showPasswordDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowPasswordDialog(false)}
        >
          <div
            style={{
              background: '#1a1a1a',
              borderRadius: '12px',
              padding: '1.5rem',
              width: '360px',
              maxWidth: '90vw',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ color: '#d97757', margin: '0 0 1rem 0', fontSize: '1.1rem' }}>
              Enable BrowserAgent
            </h3>

            <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 1rem 0' }}>
              ⚠️ This tool requires a custom Chrome extension bridge that is not publicly available.
            </p>

            <label style={{ display: 'block', color: '#888', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              Enter password to enable:
            </label>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setPasswordError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handlePasswordSubmit();
                } else if (e.key === 'Escape') {
                  setShowPasswordDialog(false);
                }
              }}
              autoFocus
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: '6px',
                border: passwordError ? '1px solid #ef4444' : '1px solid #333',
                background: '#0a0a0a',
                color: '#fff',
                fontSize: '0.9rem',
                marginBottom: '0.5rem',
              }}
            />

            {passwordError && (
              <p style={{ color: '#ef4444', fontSize: '0.8rem', margin: '0 0 0.75rem 0' }}>
                {passwordError}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                onClick={() => setShowPasswordDialog(false)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  border: '1px solid #333',
                  background: 'transparent',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handlePasswordSubmit}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#d97757',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.85rem',
                }}
              >
                Enable
              </button>
            </div>
          </div>
        </div>
      )}
    </SlideInPane>
  );
}
