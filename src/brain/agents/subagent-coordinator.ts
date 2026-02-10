/**
 * Subagent Coordinator - Manages isolated subagent lifecycle
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { SubagentResult, SubagentSession, SubagentTaskDefinition } from '../types.js';
import { spawnSubagent } from './subagent-spawner.js';
import { SubagentHeartbeatMonitor } from './subagent-heartbeat-monitor.js';
import { getSubagentRegistry } from './subagent-registry.js';

export interface SubagentCoordinatorOptions {
  heartbeatTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  resultPollIntervalMs?: number;
}

export class SubagentCoordinator {
  private registry = getSubagentRegistry();
  private monitor: SubagentHeartbeatMonitor;
  private resultPollIntervalMs: number;

  constructor(options: SubagentCoordinatorOptions = {}) {
    this.monitor = new SubagentHeartbeatMonitor({
      timeoutMs: options.heartbeatTimeoutMs,
      intervalMs: options.heartbeatIntervalMs,
      onTimeout: (session) => {
        this.handleTimeout(session).catch((error) => {
          console.error('[SubagentCoordinator] Timeout handler failed:', error);
        });
      },
      onHeartbeat: (session, payload) => {
        this.handleHeartbeat(session, payload).catch((error) => {
          console.error('[SubagentCoordinator] Heartbeat handler failed:', error);
        });
      },
    });
    this.resultPollIntervalMs = options.resultPollIntervalMs ?? 2000;
  }

  async initialize(): Promise<void> {
    await this.registry.initialize();
    this.monitor.start();

    for (const session of this.registry.listSessions()) {
      if (session.status === 'running' || session.status === 'starting') {
        this.monitor.track(session);
      }
    }
  }

  async spawn(task: SubagentTaskDefinition): Promise<SubagentSession> {
    const session = await spawnSubagent(task);
    await this.registry.upsertSession(session);
    this.monitor.track(session);
    return session;
  }

  async waitForResult(session: SubagentSession, timeoutMs: number): Promise<SubagentResult> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (existsSync(session.resultPath)) {
        const content = await readFile(session.resultPath, 'utf-8');
        const result = JSON.parse(content) as SubagentResult;
        await this.registry.updateSession(session.id, {
          status: result.success ? 'completed' : 'failed',
          completedAt: result.completedAt,
        });
        this.monitor.untrack(session.id);
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, this.resultPollIntervalMs));
    }

    await this.registry.updateSession(session.id, { status: 'unresponsive' });
    this.monitor.untrack(session.id);

    return {
      success: false,
      error: 'Subagent timed out waiting for result',
      startedAt: session.startedAt || session.createdAt,
      completedAt: Date.now(),
      attempt: 1,
    };
  }

  async recordHeartbeat(sessionId: string, timestamp: number): Promise<void> {
    const session = this.registry.getSession(sessionId);
    if (!session) return;
    await this.registry.updateSession(sessionId, { lastHeartbeat: timestamp });
  }

  async markRunning(sessionId: string): Promise<void> {
    await this.registry.updateSession(sessionId, { status: 'running', startedAt: Date.now() });
  }

  private async handleHeartbeat(session: SubagentSession, payload: { timestamp: number; status: string }): Promise<void> {
    await this.registry.updateSession(session.id, {
      lastHeartbeat: payload.timestamp,
      status: payload.status === 'failed' ? 'failed' : session.status,
    });
  }

  private async handleTimeout(session: SubagentSession): Promise<void> {
    await this.registry.updateSession(session.id, { status: 'unresponsive' });
    const alertPath = session.resultPath.replace(/\.json$/, '.timeout.json');
    if (!existsSync(alertPath)) {
      await writeFile(alertPath, JSON.stringify({
        sessionId: session.id,
        taskId: session.taskId,
        agentType: session.agentType,
        timestamp: Date.now(),
        error: 'Heartbeat timeout',
      }, null, 2), 'utf-8');
    }
  }
}

let globalSubagentCoordinator: SubagentCoordinator | null = null;

export function getSubagentCoordinator(): SubagentCoordinator {
  if (!globalSubagentCoordinator) {
    globalSubagentCoordinator = new SubagentCoordinator();
  }
  return globalSubagentCoordinator;
}

export function resetSubagentCoordinator(): void {
  globalSubagentCoordinator = null;
}
