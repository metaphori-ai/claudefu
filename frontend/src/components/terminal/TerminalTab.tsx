import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { WriteTerminal, ResizeTerminal } from '../../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime';

interface TerminalTabProps {
  id: string;
  isActive: boolean;
}

export function TerminalTab({ id, isActive }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#cccccc',
        cursor: '#d97757',
        selectionBackground: 'rgba(217, 119, 87, 0.3)',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 11,
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
      ResizeTerminal(id, term.cols, term.rows).catch(() => {});
    }, 50);

    // Keystrokes → Go backend
    const dataDisposable = term.onData((data) => {
      WriteTerminal(id, btoa(data)).catch(() => {});
    });

    // Output from Go backend → xterm
    const cancelOutput = EventsOn('terminal:output', (payload: any) => {
      if (payload?.id === id && payload?.data) {
        term.write(Uint8Array.from(atob(payload.data), c => c.charCodeAt(0)));
      }
    });

    // Terminal exited
    const cancelExit = EventsOn('terminal:exit', (payload: any) => {
      if (payload?.id === id) {
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
      }
    });

    // ResizeObserver to auto-fit
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        if (termRef.current) {
          ResizeTerminal(id, termRef.current.cols, termRef.current.rows).catch(() => {});
        }
      }
    });
    observer.observe(containerRef.current);
    observerRef.current = observer;

    return () => {
      dataDisposable.dispose();
      cancelOutput();
      cancelExit();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [id]);

  // Re-fit when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current && termRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (termRef.current) {
          ResizeTerminal(id, termRef.current.cols, termRef.current.rows).catch(() => {});
        }
      }, 50);
      termRef.current.focus();
    }
  }, [isActive, id]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: isActive ? 'block' : 'none',
      }}
    />
  );
}
