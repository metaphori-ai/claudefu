interface StartupViewProps {
  version: string;
  loadingStatus: string;
}

export function StartupView({ version, loadingStatus }: StartupViewProps) {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 100%)'
    }}>
      <img
        src="/assets/claudefu-logo.png"
        alt="ClaudeFu"
        style={{ width: '400px', marginBottom: '2rem' }}
      />
      {version && (
        <div style={{ color: '#444', fontSize: '0.8rem', marginBottom: '1rem' }}>
          v{version}
        </div>
      )}
      <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: '3rem' }}>
        {loadingStatus}
      </div>

      {/* Acknowledgments & Disclaimer */}
      <div style={{
        maxWidth: '550px',
        textAlign: 'center',
        padding: '0 2rem'
      }}>
        <div style={{ color: '#888', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Built on <a href="https://wails.io/" target="_blank" rel="noopener noreferrer" style={{ color: '#aaa', textDecoration: 'underline' }}>Wails</a> · Powered by <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener noreferrer" style={{ color: '#aaa', textDecoration: 'underline' }}>Claude Code</a> CLI
        </div>
        <div style={{ color: '#666', fontSize: '0.8rem', lineHeight: 1.6, marginBottom: '1rem' }}>
          ClaudeFu is an independent open source project and is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.
        </div>
        <div style={{ color: '#555', fontSize: '0.75rem' }}>
          This application requires a working Claude Code CLI installation. See <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener noreferrer" style={{ color: '#888', textDecoration: 'underline' }}>Claude Code</a> for setup.
        </div>
      </div>
    </div>
  );
}
