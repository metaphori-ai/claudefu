/**
 * DebugLogger - Aggregated logging for prompt-to-response cycles
 *
 * Instead of scattered console.logs, this accumulates all debug events
 * during a user prompt → assistant response cycle, then outputs them
 * as a single formatted log block for easy copy/paste debugging.
 *
 * Toggle via Settings > Debug Logging
 */

interface LogEntry {
  timestamp: number;
  component: string;
  event: string;
  data?: Record<string, unknown>;
}

class DebugLogger {
  private logs: LogEntry[] = [];
  private cycleActive = false;
  private cycleStartTime = 0;
  private cyclePrompt = '';
  private enabled = false;
  private cycleTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Enable/disable debug logging (controlled by settings)
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled && this.cycleActive) {
      this.reset();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Start a new debug cycle when user sends a message
   */
  startCycle(prompt: string, metadata?: Record<string, unknown>) {
    if (!this.enabled) return;

    // End any existing cycle first
    if (this.cycleActive) {
      this.endCycle('new_cycle_started');
    }

    this.cycleActive = true;
    this.cycleStartTime = Date.now();
    this.cyclePrompt = prompt;
    this.logs = [];

    this.log('DebugLogger', 'CYCLE_START', {
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 100) + (prompt.length > 100 ? '...' : ''),
      ...metadata
    });

    // Safety timeout - end cycle after 60s if not ended naturally
    this.cycleTimeout = setTimeout(() => {
      if (this.cycleActive) {
        this.endCycle('timeout_60s');
      }
    }, 60000);
  }

  /**
   * Log an event during the cycle
   */
  log(component: string, event: string, data?: Record<string, unknown>) {
    if (!this.enabled) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      component,
      event,
      data
    };

    this.logs.push(entry);

    // Also log to console in real-time if cycle isn't active (for non-cycle events)
    if (!this.cycleActive) {
      console.log(`[${component}] ${event}`, data || '');
    }
  }

  /**
   * End the cycle and output aggregated log
   */
  endCycle(reason: string) {
    if (!this.enabled) return;

    if (this.cycleTimeout) {
      clearTimeout(this.cycleTimeout);
      this.cycleTimeout = null;
    }

    if (!this.cycleActive) return;

    const duration = Date.now() - this.cycleStartTime;

    this.log('DebugLogger', 'CYCLE_END', { reason, durationMs: duration });

    // Format and output the aggregated log
    const output = this.formatOutput(duration);
    console.log(output);

    this.reset();
  }

  /**
   * Format all accumulated logs into a single readable block
   */
  private formatOutput(duration: number): string {
    const lines: string[] = [];
    const divider = '═'.repeat(60);

    lines.push('');
    lines.push(divider);
    lines.push(`DEBUG CYCLE - ${new Date(this.cycleStartTime).toISOString()}`);
    lines.push(`Duration: ${duration}ms | Events: ${this.logs.length}`);
    lines.push(`Prompt: "${this.cyclePrompt.slice(0, 80)}${this.cyclePrompt.length > 80 ? '...' : ''}"`);
    lines.push(divider);
    lines.push('');

    for (const entry of this.logs) {
      const relativeTime = entry.timestamp - this.cycleStartTime;
      const timeStr = `+${relativeTime}ms`.padEnd(10);
      const component = entry.component.padEnd(20);

      let line = `${timeStr} [${component}] ${entry.event}`;

      if (entry.data) {
        // Format data compactly but readably
        const dataStr = this.formatData(entry.data);
        if (dataStr) {
          line += ` | ${dataStr}`;
        }
      }

      lines.push(line);
    }

    lines.push('');
    lines.push(divider);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format data object compactly
   */
  private formatData(data: Record<string, unknown>): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;

      let formatted: string;
      if (typeof value === 'string') {
        // Truncate long strings
        formatted = value.length > 50 ? `"${value.slice(0, 50)}..."` : `"${value}"`;
      } else if (typeof value === 'object') {
        // For arrays, show length; for objects, stringify compactly
        if (Array.isArray(value)) {
          formatted = `[${value.length} items]`;
        } else {
          const str = JSON.stringify(value);
          formatted = str.length > 50 ? str.slice(0, 50) + '...' : str;
        }
      } else {
        formatted = String(value);
      }

      parts.push(`${key}=${formatted}`);
    }

    return parts.join(', ');
  }

  /**
   * Reset the logger state
   */
  private reset() {
    this.cycleActive = false;
    this.cycleStartTime = 0;
    this.cyclePrompt = '';
    this.logs = [];
  }

  /**
   * Check if a cycle is currently active
   */
  isCycleActive(): boolean {
    return this.cycleActive;
  }
}

// Singleton instance
export const debugLogger = new DebugLogger();

// Convenience exports for common patterns
export const logDebug = (component: string, event: string, data?: Record<string, unknown>) => {
  debugLogger.log(component, event, data);
};

export const startDebugCycle = (prompt: string, metadata?: Record<string, unknown>) => {
  debugLogger.startCycle(prompt, metadata);
};

export const endDebugCycle = (reason: string) => {
  debugLogger.endCycle(reason);
};
