import { useState, useEffect } from 'react';
import { SlideInPane } from './SlideInPane';
import { workspace } from '../../wailsjs/go/models';

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

  const handleSave = () => {
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

  return (
    <SlideInPane
      isOpen={isOpen}
      onClose={onClose}
      title="MCP Settings"
      titleColor="#8b5cf6"
      storageKey="mcp-settings"
      defaultWidth={600}
      icon={
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
        </svg>
      }
    >
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

        {/* Save Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
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
    </SlideInPane>
  );
}
