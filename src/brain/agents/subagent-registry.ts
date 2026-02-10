/**
 * Subagent Registry - Persistent tracking for isolated subagents
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SubagentSession, SubagentStatus } from '../types.js';

const SUBAGENT_DIR = join(process.cwd(), 'brain', 'agents', 'subagents');
const SUBAGENT_STATE_FILE = join(SUBAGENT_DIR, 'state.json');

interface SubagentRegistryState {
  version: string;
  updatedAt: number;
  sessions: Record<string, SubagentSession>;
}

export class SubagentRegistry {
  private state: SubagentRegistryState = {
    version: '1.0',
    updatedAt: 0,
    sessions: {},
  };

  async initialize(): Promise<void> {
    await this.ensureDirectories();
    await this.loadState();
  }

  getSession(id: string): SubagentSession | undefined {
    return this.state.sessions[id];
  }

  listSessions(): SubagentSession[] {
    return Object.values(this.state.sessions);
  }

  async upsertSession(session: SubagentSession): Promise<void> {
    this.state.sessions[session.id] = session;
    await this.saveState();
  }

  async updateSession(id: string, updates: Partial<SubagentSession>): Promise<void> {
    const existing = this.state.sessions[id];
    if (!existing) return;
    this.state.sessions[id] = { ...existing, ...updates };
    await this.saveState();
  }

  async updateStatus(id: string, status: SubagentStatus): Promise<void> {
    const existing = this.state.sessions[id];
    if (!existing) return;
    this.state.sessions[id] = { ...existing, status };
    await this.saveState();
  }

  async removeSession(id: string): Promise<void> {
    delete this.state.sessions[id];
    await this.saveState();
  }

  private async ensureDirectories(): Promise<void> {
    if (!existsSync(SUBAGENT_DIR)) {
      await mkdir(SUBAGENT_DIR, { recursive: true });
    }
  }

  private async loadState(): Promise<void> {
    if (!existsSync(SUBAGENT_STATE_FILE)) {
      return;
    }

    try {
      const content = await readFile(SUBAGENT_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(content) as SubagentRegistryState;
      this.state = {
        version: parsed.version || '1.0',
        updatedAt: parsed.updatedAt || 0,
        sessions: parsed.sessions || {},
      };
    } catch (error) {
      console.error('[SubagentRegistry] Failed to load state:', error);
      this.state = {
        version: '1.0',
        updatedAt: 0,
        sessions: {},
      };
    }
  }

  private async saveState(): Promise<void> {
    this.state.updatedAt = Date.now();
    await writeFile(SUBAGENT_STATE_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
  }
}

let globalSubagentRegistry: SubagentRegistry | null = null;

export function getSubagentRegistry(): SubagentRegistry {
  if (!globalSubagentRegistry) {
    globalSubagentRegistry = new SubagentRegistry();
  }
  return globalSubagentRegistry;
}

export function resetSubagentRegistry(): void {
  globalSubagentRegistry = null;
}
