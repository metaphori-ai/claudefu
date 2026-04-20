import { useState, useEffect, useCallback } from 'react';
import { DialogBase } from './DialogBase';
import { useSaveShortcut } from '../hooks';
import {
  GetSettings,
  SaveSettings,
  GetGlobalPermissions,
  SaveGlobalPermissions,
  GetOrderedPermissionSets,
  GetGlobalClaudeMD,
  SaveGlobalClaudeMD,
  GetDefaultTemplateMD,
  SaveDefaultTemplateMD,
  GetSifuTemplateMD,
  SaveSifuTemplateMD,
  GetSifuAgentTemplateMD,
  SaveSifuAgentTemplateMD,
  SelectDirectory,
  NormalizeDirPath,
  GetProxyStatus,
  GetHostname,
  GetMachineProxySettings,
  SaveMachineProxySettings,
} from '../../wailsjs/go/main/App';
import { settings } from '../../wailsjs/go/models';
import {
  ToolsTabContent,
  DirectoriesTabContent,
  ClaudeFuPermissions,
  PermissionSet,
} from './permissions';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ENV_OPUS_MODEL_OPTIONS,
  ENV_SONNET_MODEL_OPTIONS,
  ENV_HAIKU_MODEL_OPTIONS,
  ENV_ANY_MODEL_OPTIONS,
  ENV_EFFORT_OPTIONS,
} from './chat/modelCatalog';

// Known Claude CLI environment variables with curated option sets.
// None = omit the var entirely; any other value (including "Custom…") = keep it.
interface KnownEnvVar {
  key: string;
  description: string;
  options: string[];  // values that appear in the dropdown besides None + Custom
}

const KNOWN_ENV_VARS: KnownEnvVar[] = [
  { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL',           description: 'Model that the "opus" (and opusplan plan-mode) alias resolves to', options: ENV_OPUS_MODEL_OPTIONS },
  { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL',         description: 'Model that the "sonnet" (and opusplan execution) alias resolves to', options: ENV_SONNET_MODEL_OPTIONS },
  { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',          description: 'Model that the "haiku" alias resolves to (also used for background tasks)', options: ENV_HAIKU_MODEL_OPTIONS },
  { key: 'CLAUDE_CODE_SUBAGENT_MODEL',             description: 'Model used for Task-tool subagents', options: ENV_ANY_MODEL_OPTIONS },
  { key: 'ANTHROPIC_MODEL',                        description: 'Override the active model at startup (alias or full ID)', options: ENV_ANY_MODEL_OPTIONS },
  { key: 'CLAUDE_CODE_EFFORT_LEVEL',               description: 'Persistent effort level (auto|low|medium|high|xhigh|max)', options: ENV_EFFORT_OPTIONS },
  { key: 'CLAUDE_CODE_DISABLE_1M_CONTEXT',         description: 'Set to 1 to hide 1M-context variants from the picker', options: ['1'] },
  { key: 'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING',  description: 'Set to 1 to revert to fixed thinking budget (4.6 models only)', options: ['1'] },
  { key: 'DISABLE_PROMPT_CACHING',                 description: 'Set to 1 to disable prompt caching globally', options: ['1'] },
  { key: 'DISABLE_PROMPT_CACHING_OPUS',            description: 'Set to 1 to disable prompt caching for Opus models', options: ['1'] },
  { key: 'DISABLE_PROMPT_CACHING_SONNET',          description: 'Set to 1 to disable prompt caching for Sonnet models', options: ['1'] },
  { key: 'DISABLE_PROMPT_CACHING_HAIKU',           description: 'Set to 1 to disable prompt caching for Haiku models', options: ['1'] },
];

const CUSTOM_SENTINEL = '__CUSTOM__';

interface GlobalSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EnvVar {
  key: string;
  value: string;
}

type TabId = 'env' | 'tools' | 'directories' | 'global-claude-md' | 'default-claude-md' | 'sifu' | 'sifu-md' | 'sifu-agent-md' | 'proxy';

export function GlobalSettingsDialog({ isOpen, onClose }: GlobalSettingsDialogProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('env');

  // Environment Variables state
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // Global Permissions state
  const [globalPermissions, setGlobalPermissions] = useState<ClaudeFuPermissions | null>(null);
  const [orderedSets, setOrderedSets] = useState<PermissionSet[]>([]);

  // CLAUDE.md state
  const [globalClaudeMD, setGlobalClaudeMD] = useState('');
  const [defaultTemplateMD, setDefaultTemplateMD] = useState('');
  const [claudeMDViewMode, setClaudeMDViewMode] = useState<'edit' | 'preview'>('edit');
  const [mdSaved, setMdSaved] = useState(false);

  // Claude CLI command state
  const [claudeCodeCommand, setClaudeCodeCommand] = useState('');

  // Sifu state
  const [sifuEnabled, setSifuEnabled] = useState(false);
  const [sifuRootFolder, setSifuRootFolder] = useState('');
  const [sifuTemplateMD, setSifuTemplateMD] = useState('');
  const [sifuAgentTemplateMD, setSifuAgentTemplateMD] = useState('');

  // Proxy state
  const [hostname, setHostname] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyPort, setProxyPort] = useState(9350);
  const [proxyCacheFix, setProxyCacheFix] = useState(true);
  const [proxyCacheTTL, setProxyCacheTTL] = useState('5m');
  const [proxyLogging, setProxyLogging] = useState(false);
  const [proxyLogDir, setProxyLogDir] = useState('');
  const [proxyStatus, setProxyStatus] = useState<{ running: boolean; port: number; stats: any } | null>(null);

  // Shared state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load settings when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadAllSettings();
    }
  }, [isOpen]);

  // Clear saved indicator
  useEffect(() => {
    if (mdSaved) {
      const timer = setTimeout(() => setMdSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [mdSaved]);

  const loadAllSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResult, permSetsResult, globalPermsResult] = await Promise.all([
        GetSettings(),
        GetOrderedPermissionSets(),
        GetGlobalPermissions(),
      ]);

      // Load CLAUDE.md files separately — these are non-critical
      let globalMD = '';
      let defaultMD = '';
      try { globalMD = await GetGlobalClaudeMD(); } catch { /* ok */ }
      try { defaultMD = await GetDefaultTemplateMD(); } catch { /* ok */ }
      let sifuMD = '', sifuAgentMD = '';
      try { sifuMD = await GetSifuTemplateMD(); } catch { /* ok */ }
      try { sifuAgentMD = await GetSifuAgentTemplateMD(); } catch { /* ok */ }

      // Convert settings env vars map to array
      const vars: EnvVar[] = [];
      if (settingsResult.claudeEnvVars) {
        for (const [key, value] of Object.entries(settingsResult.claudeEnvVars)) {
          vars.push({ key, value });
        }
      }
      setEnvVars(vars);

      // Load Claude CLI command
      setClaudeCodeCommand(settingsResult.claudeCodeCommand || '');

      // Load Sifu settings
      setSifuEnabled(settingsResult.sifuEnabled || false);
      setSifuRootFolder(settingsResult.sifuRootFolder || '');

      // Load Proxy settings from machine-specific resolver
      try {
        const [machineProxy, hn] = await Promise.all([
          GetMachineProxySettings(),
          GetHostname(),
        ]);
        setHostname(hn);
        setProxyEnabled(machineProxy.proxyEnabled || false);
        setProxyPort(machineProxy.proxyPort || 9350);
        setProxyCacheFix(machineProxy.proxyCacheFix !== false); // default true
        setProxyCacheTTL(machineProxy.proxyCacheTTL || '5m');
        setProxyLogging(machineProxy.proxyLogging || false);
        setProxyLogDir(machineProxy.proxyLogDir || '');
      } catch { /* ok */ }
      try { setProxyStatus(await GetProxyStatus()); } catch { /* ok */ }

      // Convert permission sets to plain objects
      const plainSets: PermissionSet[] = permSetsResult.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        permissions: {
          common: s.permissions?.common || [],
          permissive: s.permissions?.permissive || [],
          yolo: s.permissions?.yolo || [],
        },
      }));
      setOrderedSets(plainSets);

      // Convert global permissions to plain object (v2 format)
      const plainPerms: ClaudeFuPermissions = {
        version: globalPermsResult.version || 2,
        inheritFromGlobal: globalPermsResult.inheritFromGlobal,
        toolPermissions: globalPermsResult.toolPermissions || {},
        additionalDirectories: globalPermsResult.additionalDirectories || [],
      };
      setGlobalPermissions(plainPerms);

      setGlobalClaudeMD(globalMD);
      setDefaultTemplateMD(defaultMD);
      setSifuTemplateMD(sifuMD);
      setSifuAgentTemplateMD(sifuAgentMD);
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      // CLAUDE.md tabs save independently
      if (activeTab === 'global-claude-md') {
        await SaveGlobalClaudeMD(globalClaudeMD);
        setMdSaved(true);
      } else if (activeTab === 'default-claude-md') {
        await SaveDefaultTemplateMD(defaultTemplateMD);
        setMdSaved(true);
      } else if (activeTab === 'sifu-md') {
        await SaveSifuTemplateMD(sifuTemplateMD);
        setMdSaved(true);
      } else if (activeTab === 'sifu-agent-md') {
        await SaveSifuAgentTemplateMD(sifuAgentTemplateMD);
        setMdSaved(true);
      } else if (activeTab === 'proxy') {
        // Proxy settings saved per-machine (keyed by hostname)
        await SaveMachineProxySettings({
          proxyEnabled,
          proxyPort,
          proxyCacheFix,
          proxyCacheTTL,
          proxyLogging,
          proxyLogDir,
        } as any);
        try { setProxyStatus(await GetProxyStatus()); } catch { /* ok */ }
        onClose();
      } else {
        // Save env + permissions for non-MD, non-proxy tabs
        const currentSettings = await GetSettings();
        const envMap: Record<string, string> = {};
        for (const { key, value } of envVars) {
          if (key.trim()) {
            envMap[key.trim()] = value;
          }
        }
        const updatedSettings = new settings.Settings({
          ...currentSettings,
          claudeEnvVars: envMap,
          claudeCodeCommand,
          sifuEnabled,
          sifuRootFolder,
        });
        await Promise.all([
          SaveSettings(updatedSettings),
          globalPermissions ? SaveGlobalPermissions(globalPermissions as any) : Promise.resolve(),
        ]);
        onClose();
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [activeTab, envVars, globalPermissions, globalClaudeMD, defaultTemplateMD, sifuTemplateMD, sifuAgentTemplateMD, claudeCodeCommand, sifuEnabled, sifuRootFolder, proxyEnabled, proxyPort, proxyCacheFix, proxyCacheTTL, proxyLogging, proxyLogDir, onClose]);

  // CMD-S to save
  useSaveShortcut(isOpen, handleSave);

  const handleAddVar = () => {
    if (newKey.trim()) {
      if (envVars.some(v => v.key === newKey.trim())) {
        setError(`Key "${newKey.trim()}" already exists`);
        return;
      }
      setEnvVars([...envVars, { key: newKey.trim(), value: newValue }]);
      setNewKey('');
      setNewValue('');
      setError(null);
    }
  };

  const handleRemoveVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleUpdateVar = (index: number, field: 'key' | 'value', newVal: string) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: newVal };
    setEnvVars(updated);
  };

  // Upsert/remove a Known Variable by key.
  // value === "" removes the var entirely; any other string upserts it.
  const setKnownEnvVar = (key: string, value: string) => {
    const idx = envVars.findIndex(v => v.key === key);
    if (value === '') {
      if (idx >= 0) setEnvVars(envVars.filter((_, i) => i !== idx));
      return;
    }
    if (idx >= 0) {
      const updated = [...envVars];
      updated[idx] = { ...updated[idx], value };
      setEnvVars(updated);
    } else {
      setEnvVars([...envVars, { key, value }]);
    }
  };

  const getKnownEnvVarValue = (key: string): string => {
    return envVars.find(v => v.key === key)?.value ?? '';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newKey.trim()) {
      e.preventDefault();
      handleAddVar();
    }
  };

  const handlePermissionsChange = (newPerms: ClaudeFuPermissions) => {
    setGlobalPermissions(newPerms);
  };

  const handleDirectoriesChange = (dirs: string[]) => {
    if (!globalPermissions) return;
    setGlobalPermissions({
      ...globalPermissions,
      additionalDirectories: dirs,
    });
  };

  const isMDTab = activeTab === 'global-claude-md' || activeTab === 'default-claude-md' || activeTab === 'sifu-md' || activeTab === 'sifu-agent-md';

  const renderProxyTab = () => (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left', overflow: 'auto', flex: 1 }}>
      {/* Machine identifier */}
      {hostname && (
        <div style={{ fontSize: '0.8rem', color: '#666' }}>
          Configuring proxy for: <strong style={{ color: '#ccc' }}>{hostname}</strong>
        </div>
      )}

      <div style={{ fontSize: '0.8rem', color: '#666', lineHeight: 1.5 }}>
        The cache fix proxy intercepts requests to Anthropic and stabilizes the cache layout,
        preventing expensive cache re-creation caused by Claude Code moving system-reminder blocks.
        This can save 30-40% on API costs.
      </div>

      {/* Status indicator */}
      {proxyStatus && (
        <div style={{
          padding: '0.6rem 0.75rem',
          background: '#151515',
          borderRadius: '8px',
          border: `1px solid ${proxyStatus.running ? '#16a34a33' : '#33333366'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.8rem',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: proxyStatus.running ? '#16a34a' : '#555',
          }} />
          <span style={{ color: proxyStatus.running ? '#16a34a' : '#666' }}>
            {proxyStatus.running ? `Running on :${proxyStatus.port}` : 'Stopped'}
          </span>
          {proxyStatus.running && proxyStatus.stats && (
            <span style={{ color: '#555', marginLeft: 'auto', fontSize: '0.75rem' }}>
              {proxyStatus.stats.totalRequests} requests | {proxyStatus.stats.cacheFixesApplied} fixes
            </span>
          )}
        </div>
      )}

      {/* Enable toggle */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer',
        padding: '0.75rem', background: '#151515', borderRadius: '8px', border: '1px solid #222',
      }}>
        <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)}
          style={{ width: '18px', height: '18px', accentColor: '#d97757', cursor: 'pointer' }} />
        <div>
          <div style={{ color: '#ccc', fontSize: '0.9rem', fontWeight: 500 }}>Enable Cache Fix Proxy</div>
          <div style={{ color: '#666', fontSize: '0.75rem', marginTop: '0.2rem' }}>
            Auto-injects ANTHROPIC_BASE_URL for all Claude CLI processes
          </div>
        </div>
      </label>

      {proxyEnabled && (
        <>
          {/* Port */}
          <div>
            <label style={{ color: '#999', fontSize: '0.8rem', fontWeight: 500 }}>Port</label>
            <input type="number" value={proxyPort} onChange={(e) => setProxyPort(parseInt(e.target.value) || 9350)}
              style={{
                width: '100%', boxSizing: 'border-box', marginTop: '0.3rem',
                padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #333',
                background: '#0d0d0d', color: '#fff', fontSize: '0.85rem', fontFamily: 'monospace',
              }} />
          </div>

          {/* Cache Fix toggle */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer',
            padding: '0.6rem 0.75rem', background: '#151515', borderRadius: '8px', border: '1px solid #222',
          }}>
            <input type="checkbox" checked={proxyCacheFix} onChange={(e) => setProxyCacheFix(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: '#d97757', cursor: 'pointer' }} />
            <div>
              <div style={{ color: '#ccc', fontSize: '0.85rem' }}>Cache Fix Mutations</div>
              <div style={{ color: '#666', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                Stabilizes system-reminder position and adds cache breakpoints
              </div>
            </div>
          </label>

          {/* Cache TTL selector */}
          <div>
            <label style={{ color: '#999', fontSize: '0.8rem', fontWeight: 500 }}>Stable Context TTL</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
              {(['5m', '1h'] as const).map(ttl => (
                <button key={ttl} onClick={() => setProxyCacheTTL(ttl)}
                  style={{
                    flex: 1, padding: '0.5rem 0.75rem', borderRadius: '6px', cursor: 'pointer',
                    border: proxyCacheTTL === ttl ? '1px solid #d97757' : '1px solid #333',
                    background: proxyCacheTTL === ttl ? '#d9775720' : '#0d0d0d',
                    color: proxyCacheTTL === ttl ? '#d97757' : '#888',
                    fontSize: '0.85rem', fontWeight: proxyCacheTTL === ttl ? 600 : 400,
                  }}>
                  {ttl === '5m' ? '5 min (safe default)' : '1 hour (long sessions)'}
                </button>
              ))}
            </div>
            <div style={{ color: '#555', fontSize: '0.72rem', marginTop: '0.3rem', lineHeight: 1.4 }}>
              {proxyCacheTTL === '1h'
                ? 'Upgrades all cache breakpoints to 1h. Best for long coding sessions where CLAUDE.md rarely changes.'
                : 'Matches Claude Code\'s default 5-minute cache. Adds missing breakpoints without changing existing TTLs.'}
            </div>
          </div>

          {/* Logging toggle */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer',
            padding: '0.6rem 0.75rem', background: '#151515', borderRadius: '8px', border: '1px solid #222',
          }}>
            <input type="checkbox" checked={proxyLogging} onChange={(e) => setProxyLogging(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: '#d97757', cursor: 'pointer' }} />
            <div>
              <div style={{ color: '#ccc', fontSize: '0.85rem' }}>Request/Response Logging</div>
              <div style={{ color: '#666', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                Dumps API requests and responses to disk for debugging
              </div>
            </div>
          </label>

          {/* Log directory */}
          {proxyLogging && (
            <div>
              <label style={{ color: '#999', fontSize: '0.8rem', fontWeight: 500 }}>Log Directory</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                <input type="text" value={proxyLogDir}
                  onChange={(e) => setProxyLogDir(e.target.value)}
                  placeholder="~/.claudefu/proxy-logs/"
                  style={{
                    flex: 1, padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '1px solid #333', background: '#0d0d0d', color: '#fff',
                    fontSize: '0.85rem', fontFamily: 'monospace',
                  }} />
                <button onClick={async () => {
                  const dir = await SelectDirectory('Select Proxy Log Directory');
                  if (dir) setProxyLogDir(await NormalizeDirPath(dir));
                }} style={{
                  padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #333',
                  background: '#151515', color: '#999', cursor: 'pointer', fontSize: '0.8rem',
                }}>
                  Browse
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderEnvVarsTab = () => (
    <div style={{ padding: '1rem', overflow: 'auto', flex: 1 }}>

      {/* Claude CLI Command */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#ccc' }}>
          Claude CLI Command
        </h3>
        <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.8rem', color: '#666', lineHeight: 1.5 }}>
          Custom command name or full path to the Claude CLI binary.
          Leave empty to use the default (<code style={{ background: '#0d0d0d', padding: '0.1rem 0.3rem', borderRadius: '3px', fontSize: '0.75rem' }}>claude</code>).
        </p>
        <input
          type="text"
          value={claudeCodeCommand}
          onChange={(e) => setClaudeCodeCommand(e.target.value)}
          placeholder="claude"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid #333',
            background: '#0d0d0d',
            color: '#fff',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
          }}
        />
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '0.75rem'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '0.95rem',
          fontWeight: 600,
          color: '#ccc'
        }}>
          Claude CLI Environment Variables
        </h3>
      </div>

      <p style={{
        margin: '0 0 1rem 0',
        fontSize: '0.8rem',
        color: '#666',
        lineHeight: 1.5
      }}>
        These environment variables are passed to all Claude CLI processes.
        Useful for proxies (e.g., <code style={{
          background: '#0d0d0d',
          padding: '0.1rem 0.3rem',
          borderRadius: '3px',
          fontSize: '0.75rem'
        }}>ANTHROPIC_BASE_URL</code>).
      </p>

      {/* Known Variables — curated list with dropdown + custom fallback.
          None = omit the var from ClaudeEnvVars; anything else = include on CLI. */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h4 style={{
          margin: '0 0 0.5rem 0',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: '#aaa',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Known Variables
        </h4>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', color: '#666', lineHeight: 1.4 }}>
          Curated set of Claude CLI env vars. <strong style={{ color: '#888' }}>None (omit)</strong> removes the var entirely; any other value is injected into every Claude CLI invocation.
        </p>
        {KNOWN_ENV_VARS.map(kev => {
          const currentValue = getKnownEnvVarValue(kev.key);
          const isCustom = currentValue !== '' && !kev.options.includes(currentValue);
          return (
            <div key={kev.key} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center' }}>
              <code
                title={kev.description}
                style={{
                  width: '35%',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '4px',
                  border: '1px solid #222',
                  background: '#0a0a0a',
                  color: '#bbb',
                  fontSize: '0.72rem',
                  fontFamily: 'monospace',
                  cursor: 'help',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {kev.key}
              </code>
              <span style={{ color: '#444' }}>=</span>
              <select
                value={isCustom ? CUSTOM_SENTINEL : currentValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === CUSTOM_SENTINEL) {
                    // Switch to custom mode: seed with a single space so the text input renders and user can edit.
                    setKnownEnvVar(kev.key, currentValue || ' ');
                  } else {
                    setKnownEnvVar(kev.key, v);
                  }
                }}
                style={{
                  flex: isCustom ? 0 : 1,
                  minWidth: '140px',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '4px',
                  border: '1px solid #333',
                  background: '#0d0d0d',
                  color: '#fff',
                  fontSize: '0.8rem',
                  fontFamily: 'monospace',
                }}
              >
                <option value="">— None (omit) —</option>
                {kev.options.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value={CUSTOM_SENTINEL}>Custom…</option>
              </select>
              {isCustom && (
                <input
                  type="text"
                  value={currentValue.trim()}
                  onChange={(e) => setKnownEnvVar(kev.key, e.target.value || ' ')}
                  placeholder="custom value"
                  style={{
                    flex: 1,
                    padding: '0.4rem 0.6rem',
                    borderRadius: '4px',
                    border: '1px solid #444',
                    background: '#0d0d0d',
                    color: '#fff',
                    fontSize: '0.8rem',
                    fontFamily: 'monospace',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <h4 style={{
        margin: '0 0 0.5rem 0',
        fontSize: '0.8rem',
        fontWeight: 600,
        color: '#aaa',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        Custom Variables
      </h4>

      {/* Existing Variables — only those not covered by the Known Variables section */}
      {envVars.filter(v => !KNOWN_ENV_VARS.some(k => k.key === v.key)).length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          {envVars.map((envVar, index) => {
            if (KNOWN_ENV_VARS.some(k => k.key === envVar.key)) return null;
            return (
            <div
              key={index}
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '0.5rem',
                alignItems: 'center',
              }}
            >
              <input
                type="text"
                value={envVar.key}
                onChange={(e) => handleUpdateVar(index, 'key', e.target.value)}
                placeholder="KEY"
                style={{
                  width: '35%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #333',
                  background: '#0d0d0d',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                }}
              />
              <span style={{ color: '#444' }}>=</span>
              <input
                type="text"
                value={envVar.value}
                onChange={(e) => handleUpdateVar(index, 'value', e.target.value)}
                placeholder="value"
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #333',
                  background: '#0d0d0d',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                }}
              />
              <button
                onClick={() => handleRemoveVar(index)}
                style={{
                  padding: '0.5rem',
                  borderRadius: '6px',
                  border: '1px solid #333',
                  background: 'transparent',
                  color: '#666',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#c53030';
                  e.currentTarget.style.color = '#c53030';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#333';
                  e.currentTarget.style.color = '#666';
                }}
                title="Remove"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            );
          })}
        </div>
      )}

      {/* Add New Variable */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          padding: '0.75rem',
          background: '#151515',
          borderRadius: '8px',
          border: '1px solid #222',
        }}
      >
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          placeholder="NEW_KEY"
          style={{
            width: '35%',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid #333',
            background: '#0d0d0d',
            color: '#fff',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
          }}
        />
        <span style={{ color: '#444' }}>=</span>
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="value"
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid #333',
            background: '#0d0d0d',
            color: '#fff',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
          }}
        />
        <button
          onClick={handleAddVar}
          disabled={!newKey.trim()}
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: 'none',
            background: newKey.trim() ? '#d97757' : '#333',
            color: newKey.trim() ? '#fff' : '#666',
            cursor: newKey.trim() ? 'pointer' : 'not-allowed',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );

  const renderClaudeMDTab = (mdContent: string, setMdContent: (v: string) => void, pathLabel: string) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Path + view toggle */}
      <div style={{
        padding: '0.5rem 1rem',
        borderBottom: '1px solid #333',
        background: '#1a1a1a',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: '0.7rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pathLabel}
        </div>
        <div style={{ display: 'flex', gap: '2px', background: '#0d0d0d', borderRadius: '4px', padding: '2px' }}>
          <button
            onClick={() => setClaudeMDViewMode('edit')}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '3px',
              border: 'none',
              background: claudeMDViewMode === 'edit' ? '#333' : 'transparent',
              color: claudeMDViewMode === 'edit' ? '#fff' : '#666',
              fontSize: '0.7rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
          <button
            onClick={() => setClaudeMDViewMode('preview')}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '3px',
              border: 'none',
              background: claudeMDViewMode === 'preview' ? '#333' : 'transparent',
              color: claudeMDViewMode === 'preview' ? '#fff' : '#666',
              fontSize: '0.7rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Preview
          </button>
        </div>
      </div>

      {/* Editor or Preview */}
      <div style={{ flex: 1, padding: '0.5rem', overflow: 'hidden' }}>
        {claudeMDViewMode === 'edit' ? (
          <textarea
            value={mdContent}
            onChange={(e) => setMdContent(e.target.value)}
            placeholder="# Instructions&#10;&#10;Add instructions here..."
            style={{
              width: '100%',
              height: '100%',
              padding: '0.75rem',
              borderRadius: '6px',
              border: '1px solid #333',
              background: '#0d0d0d',
              color: '#ccc',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              lineHeight: 1.5,
              resize: 'none',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => e.target.style.borderColor = '#d97757'}
            onBlur={(e) => e.target.style.borderColor = '#333'}
          />
        ) : (
          <div
            className="markdown-content"
            style={{
              width: '100%',
              height: '100%',
              padding: '0.75rem',
              borderRadius: '6px',
              border: '1px solid #333',
              background: '#0d0d0d',
              color: '#ccc',
              fontSize: '0.85rem',
              lineHeight: 1.6,
              overflow: 'auto',
              boxSizing: 'border-box',
              textAlign: 'left',
            }}
          >
            {mdContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {mdContent}
              </ReactMarkdown>
            ) : (
              <div style={{ color: '#666', fontStyle: 'italic' }}>
                No content to preview
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: 'env', label: 'Environment' },
    { id: 'tools', label: 'Tools' },
    { id: 'directories', label: 'Directories' },
    { id: 'global-claude-md', label: 'Global CLAUDE.md' },
    { id: 'default-claude-md', label: 'Default CLAUDE.md' },
    { id: 'sifu', label: 'Sifu' },
    { id: 'sifu-md', label: 'SIFU.md' },
    { id: 'sifu-agent-md', label: 'SIFU_AGENT.md' },
    { id: 'proxy', label: 'Proxy' },
  ];

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Global Settings
        </div>
      }
      width="900px"
      height="700px"
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #333',
          background: '#0d0d0d',
          flexShrink: 0,
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setMdSaved(false); }}
              style={{
                padding: '0.6rem 1.25rem',
                border: 'none',
                background: 'transparent',
                color: activeTab === tab.id ? '#fff' : '#666',
                borderBottom: activeTab === tab.id ? '2px solid #d97757' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: activeTab === tab.id ? 500 : 400,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ padding: '2rem', color: '#666', textAlign: 'center' }}>
              Loading settings...
            </div>
          ) : (
            <>
              {activeTab === 'env' && renderEnvVarsTab()}
              {activeTab === 'tools' && globalPermissions && (
                <ToolsTabContent
                  permissions={globalPermissions}
                  onChange={handlePermissionsChange}
                  orderedSets={orderedSets}
                />
              )}
              {activeTab === 'directories' && globalPermissions && (
                <DirectoriesTabContent
                  globalDirectories={[]}
                  agentDirectories={globalPermissions.additionalDirectories || []}
                  onChange={handleDirectoriesChange}
                />
              )}
              {activeTab === 'global-claude-md' && renderClaudeMDTab(
                globalClaudeMD, setGlobalClaudeMD, '~/.claude/CLAUDE.md'
              )}
              {activeTab === 'default-claude-md' && renderClaudeMDTab(
                defaultTemplateMD, setDefaultTemplateMD, '~/.claudefu/default-templates/CLAUDE.md'
              )}
              {activeTab === 'sifu-md' && renderClaudeMDTab(
                sifuTemplateMD, setSifuTemplateMD, '~/.claudefu/default-templates/SIFU.md'
              )}
              {activeTab === 'sifu-agent-md' && renderClaudeMDTab(
                sifuAgentTemplateMD, setSifuAgentTemplateMD, '~/.claudefu/default-templates/SIFU_AGENT.md'
              )}
              {activeTab === 'sifu' && (
                <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', textAlign: 'left' }}>
                  <div style={{
                    fontSize: '0.8rem',
                    color: '#666',
                    lineHeight: 1.5,
                  }}>
                    Sifu is a workspace-level agent with access to all agent folders. It can coordinate work across your entire workspace.
                  </div>

                  {/* Enable toggle */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    padding: '0.75rem',
                    background: '#151515',
                    borderRadius: '8px',
                    border: '1px solid #222',
                  }}>
                    <input
                      type="checkbox"
                      checked={sifuEnabled}
                      onChange={(e) => setSifuEnabled(e.target.checked)}
                      style={{
                        width: '18px',
                        height: '18px',
                        accentColor: '#d97757',
                        cursor: 'pointer',
                      }}
                    />
                    <div>
                      <div style={{ color: '#ccc', fontSize: '0.9rem', fontWeight: 500 }}>
                        Enable Sifu Agent
                      </div>
                      <div style={{ color: '#666', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        Adds a Sifu agent to your workspace with cross-agent access
                      </div>
                    </div>
                  </label>

                  {/* Root folder */}
                  <div>
                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: '#ccc',
                      marginBottom: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      Sifu Root Folder
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem' }}>
                      The folder where the Sifu agent runs. Supports <code style={{
                        background: '#1a1a1a',
                        padding: '0.1rem 0.3rem',
                        borderRadius: '3px',
                        fontSize: '0.7rem',
                      }}>~/</code> prefix.
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        value={sifuRootFolder}
                        onChange={(e) => setSifuRootFolder(e.target.value)}
                        placeholder="~/path/to/sifu-workspace"
                        style={{
                          flex: 1,
                          padding: '0.5rem 0.75rem',
                          borderRadius: '6px',
                          border: '1px solid #333',
                          background: '#0d0d0d',
                          color: '#ccc',
                          fontSize: '0.85rem',
                          fontFamily: 'monospace',
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={async () => {
                          try {
                            const selected = await SelectDirectory('Select Sifu Root Folder');
                            if (selected) {
                              const normalized = await NormalizeDirPath(selected);
                              setSifuRootFolder(normalized);
                            }
                          } catch (err) {
                            console.error('Failed to select directory:', err);
                          }
                        }}
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '6px',
                          border: '1px solid #444',
                          background: 'transparent',
                          color: '#888',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#666';
                          e.currentTarget.style.color = '#ccc';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#444';
                          e.currentTarget.style.color = '#888';
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        Browse
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'proxy' && renderProxyTab()}
            </>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            margin: '0.75rem 1rem',
            padding: '0.75rem',
            background: 'rgba(197, 48, 48, 0.1)',
            border: '1px solid #c53030',
            borderRadius: '6px',
            color: '#fc8181',
            fontSize: '0.85rem',
            flexShrink: 0,
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            borderTop: '1px solid #333',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid #444',
              background: 'transparent',
              color: '#888',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              background: mdSaved ? '#16a34a' : '#d97757',
              color: '#fff',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
              opacity: isSaving ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            {mdSaved ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </>
            ) : isSaving ? (
              'Saving...'
            ) : isMDTab ? (
              'Save CLAUDE.md'
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </DialogBase>
  );
}
