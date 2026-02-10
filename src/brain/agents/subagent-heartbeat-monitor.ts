/**
 * Subagent Heartbeat Monitor - Detects unresponsive subagents
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { SubagentSession } from '../types.js';

export interface HeartbeatMonitorOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onTimeout?: (session: SubagentSession) => void;
  onHeartbeat?: (session: SubagentSession, payload: HeartbeatPayload) => void;
}

interface HeartbeatPayload {
  timestamp: number;
  status: string;
}

export class SubagentHeartbeatMonitor {
  private timeoutMs: number;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private sessions: Map<string, SubagentSession> = new Map();
  private onTimeout?: (session: SubagentSession) => void;
  private onHeartbeat?: (session: SubagentSession, payload: HeartbeatPayload) => void;

  constructor(options: HeartbeatMonitorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.intervalMs = options.intervalMs ?? 10_000;
    this.onTimeout = options.onTimeout;
    this.onHeartbeat = options.onHeartbeat;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.checkSessions().catch((error) => {
        console.error('[SubagentHeartbeatMonitor] Failed to check sessions:', error);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  track(session: SubagentSession): void {
    this.sessions.set(session.id, session);
  }

  untrack(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private async checkSessions(): Promise<void> {
    const now = Date.now();

    for (const session of this.sessions.values()) {
      if (!existsSync(session.heartbeatPath)) {
        continue;
      }

      try {
        const content = await readFile(session.heartbeatPath, 'utf-8');
        const payload = JSON.parse(content) as HeartbeatPayload;
        const lastHeartbeat = payload.timestamp || 0;

        this.onHeartbeat?.(session, payload);

        if (now - lastHeartbeat > this.timeoutMs) {
          this.onTimeout?.(session);
        }
      } catch (error) {
        console.error('[SubagentHeartbeatMonitor] Failed to read heartbeat:', error);
      }
    }
  }
}
