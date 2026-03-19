import { useState } from 'react';
import { SetAPIKey, StartHyperLogin, CompleteHyperLogin, Logout } from '../../wailsjs/go/main/App';

interface DeviceAuthInfo {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}

interface AuthStatus {
  isAuthenticated: boolean;
  authMethod: string;
  hasApiKey: boolean;
  hasHyper: boolean;
  hasClaudeCode: boolean;
  claudeCodeSubscription: string;
}

interface AuthViewProps {
  authStatus: AuthStatus | null;
  version: string;
  onAuthenticated: () => void;
  onContinue: () => void;
}

export function AuthView({ authStatus, version, onAuthenticated, onContinue }: AuthViewProps) {
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuthInfo | null>(null);

  const handleSetAPIKey = async () => {
    if (!apiKey.trim()) {
      setMessage('Please enter an API key');
      return;
    }
    try {
      await SetAPIKey(apiKey);
      setMessage('API key saved successfully!');
      setApiKey('');
      await onAuthenticated();
    } catch (err) {
      setMessage(`Error saving API key: ${err}`);
    }
  };

  const handleHyperLogin = async () => {
    setIsLoading(true);
    setMessage('');
    try {
      const info = await StartHyperLogin();
      setDeviceAuth(info);
      setMessage(`Enter code "${info.userCode}" in the browser window that opened`);
      await CompleteHyperLogin(info.deviceCode, info.expiresIn);
      setMessage('Successfully authenticated with Claude Pro/Max!');
      setDeviceAuth(null);
      await onAuthenticated();
    } catch (err) {
      setMessage(`Authentication failed: ${err}`);
      setDeviceAuth(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await Logout();
      setMessage('Logged out successfully');
      await onAuthenticated();
    } catch (err) {
      setMessage(`Error logging out: ${err}`);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '3rem 2rem',
      background: 'linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 100%)'
    }}>
      <img
        src="/assets/claude-fu-icon.png"
        alt="ClaudeFu"
        style={{ width: '120px', marginBottom: '1rem' }}
      />
      <h1 style={{ color: '#fff', marginBottom: '0.25rem', fontSize: '1.5rem' }}>ClaudeFu</h1>
      <p style={{ color: '#666', marginBottom: '2rem', fontSize: '0.85rem' }}>Code GUI Orchestrator</p>

      {authStatus?.hasClaudeCode && (
        <div style={{
          background: '#14532d',
          padding: '1.25rem',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          width: '100%',
          maxWidth: '360px',
          textAlign: 'center'
        }}>
          <div style={{ color: '#4ade80', fontWeight: 600, marginBottom: '0.5rem' }}>
            Claude Code Detected
          </div>
          <p style={{ color: '#86efac', fontSize: '0.85rem', margin: 0 }}>
            {authStatus.claudeCodeSubscription && (
              <span>Claude {authStatus.claudeCodeSubscription.charAt(0).toUpperCase() + authStatus.claudeCodeSubscription.slice(1)} subscription</span>
            )}
          </p>
          <button
            onClick={onContinue}
            style={{
              marginTop: '1rem',
              padding: '0.6rem 1.5rem',
              borderRadius: '6px',
              border: 'none',
              background: '#4ade80',
              color: '#000',
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Continue
          </button>
        </div>
      )}

      {!authStatus?.hasClaudeCode && !authStatus?.hasHyper && (
        <div style={{
          background: '#1a1a1a',
          padding: '1.25rem',
          borderRadius: '12px',
          marginBottom: '1rem',
          width: '100%',
          maxWidth: '360px'
        }}>
          <h3 style={{ color: '#fff', marginBottom: '0.5rem', fontSize: '0.95rem' }}>Claude Pro/Max</h3>
          <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '1rem' }}>
            Log in with your Claude subscription
          </p>
          <button
            onClick={handleHyperLogin}
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '0.6rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: isLoading ? '#555' : '#8b5cf6',
              color: '#fff',
              cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
          >
            {isLoading ? 'Waiting for browser...' : 'Login with Claude'}
          </button>
          {deviceAuth && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#2a2a2a', borderRadius: '6px' }}>
              <p style={{ color: '#fff', fontSize: '0.85rem', margin: 0 }}>
                Code: <strong style={{ color: '#fbbf24' }}>{deviceAuth.userCode}</strong>
              </p>
            </div>
          )}
        </div>
      )}

      <div style={{
        background: '#1a1a1a',
        padding: '1.25rem',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '360px'
      }}>
        <h3 style={{ color: '#fff', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
          {authStatus?.hasClaudeCode ? 'Or Use API Key' : 'API Key'}
        </h3>
        <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
          Use an Anthropic API key
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            style={{
              flex: 1,
              padding: '0.5rem',
              borderRadius: '6px',
              border: '1px solid #333',
              background: '#0a0a0a',
              color: '#fff',
              fontSize: '0.85rem'
            }}
          />
          <button
            onClick={handleSetAPIKey}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: '#d97757',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            Save
          </button>
        </div>
      </div>

      {message && (
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          background: message.includes('Error') || message.includes('failed') ? '#7f1d1d' : '#14532d',
          color: '#fff',
          marginTop: '1.5rem',
          width: '100%',
          maxWidth: '360px',
          fontSize: '0.85rem',
          textAlign: 'center'
        }}>
          {message}
        </div>
      )}
    </div>
  );
}
