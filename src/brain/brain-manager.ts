/**
 * Brain Manager - Main entry point for the brain system
 *
 * Manages all brain subsystems: identity, memory, tasks, agents
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentIdentity,
  AgentPersonality,
  UserPreferences,
  DailyMetrics,
  HeartbeatEntry
} from './types.js';
import { getIdentityManager } from './identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);
const BRAIN_DIR = join(PROJECT_ROOT, 'brain');

// Subdirectories
const MEMORY_DIR = join(BRAIN_DIR, 'memory');
const PROJECTS_DIR = join(BRAIN_DIR, 'projects');
const TASKS_DIR = join(BRAIN_DIR, 'tasks');
const HEARTBEATS_DIR = join(BRAIN_DIR, 'heartbeats');
const LOGS_DIR = join(BRAIN_DIR, 'logs');

/**
 * Brain Manager class - coordinates all brain subsystems
 */
export class BrainManager {
  private identityManager = getIdentityManager();
  private initialized = false;

  /**
   * Initialize the brain system - create directories and load identity
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure all directories exist
    this.ensureDirectories();

    // Load identity from files
    await this.identityManager.load();

    // Initialize memory store
    const { getMemoryStore } = await import('./memory/memory-store.js');
    await getMemoryStore().initialize();

    // Initialize task queue
    const { getTaskQueue } = await import('./tasks/task-queue.js');
    await getTaskQueue().initialize();

    this.initialized = true;
    this.logHeartbeat('startup', { version: this.identityManager.getIdentity().version });
  }

  /**
   * Check if setup is needed
   */
  isSetupNeeded(): boolean {
    return !this.identityManager.isSetupComplete();
  }

  /**
   * Ensure all brain directories exist
   */
  private ensureDirectories(): void {
    const dirs = [
      MEMORY_DIR,
      PROJECTS_DIR,
      TASKS_DIR,
      HEARTBEATS_DIR,
      LOGS_DIR,
      join(MEMORY_DIR, 'conversations'),
      join(MEMORY_DIR, 'embeddings'),
      join(MEMORY_DIR, 'knowledge'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  // ===========================================
  // Identity Getters (delegated to IdentityManager)
  // ===========================================

  getIdentity(): AgentIdentity {
    return this.identityManager.getIdentity();
  }

  getPersonality(): AgentPersonality {
    return this.identityManager.getPersonality();
  }

  getPreferences(): UserPreferences {
    return this.identityManager.getPreferences();
  }

  getName(): string {
    return this.identityManager.getName();
  }

  getEmoji(): string {
    return this.identityManager.getEmoji();
  }

  getUserName(): string {
    return this.identityManager.getUserName();
  }

  getTimezone(): string {
    return this.identityManager.getTimezone();
  }

  async updateIdentity(updates: Partial<AgentIdentity>): Promise<void> {
    await this.identityManager.updateIdentity(updates);
  }

  async updatePersonality(updates: Partial<AgentPersonality>): Promise<void> {
    await this.identityManager.updatePersonality(updates);
  }

  async updatePreferences(updates: Partial<UserPreferences>): Promise<void> {
    await this.identityManager.updatePreferences(updates);
  }

  /**
   * Mark setup as complete
   */
  async markSetupComplete(): Promise<void> {
    await this.identityManager.markSetupComplete();
  }

  // ===========================================
  // Memory Operations (simplified, uses MemoryStore for actual persistence)
  // ===========================================

  /**
   * Store a fact in memory
   */
  async remember(key: string, value: unknown): Promise<void> {
    // This will be handled by MemoryStore
    const { getMemoryStore } = await import('./memory/memory-store.js');
    const store = getMemoryStore();
    await store.setFact(key, value);
  }

  /**
   * Recall facts from memory
   */
  async recall(key: string): Promise<unknown> {
    const { getMemoryStore } = await import('./memory/memory-store.js');
    const store = getMemoryStore();
    return store.getFact(key);
  }

  /**
   * Search facts by pattern
   */
  async searchFacts(pattern: string): Promise<Array<{ key: string; value: unknown }>> {
    const { getMemoryStore } = await import('./memory/memory-store.js');
    const store = getMemoryStore();
    return store.searchFacts(pattern);
  }

  // ===========================================
  // Heartbeat & Metrics
  // ===========================================

  /**
   * Log a heartbeat event
   */
  async logHeartbeat(
    _type: HeartbeatEntry['type'],
    _details?: Record<string, unknown>,
  ): Promise<void> {
    // TODO: Write to heartbeat file
    const heartbeatPath = join(HEARTBEATS_DIR, `${Date.now()}.json`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(heartbeatPath, JSON.stringify({
      timestamp: Date.now(),
      type: _type,
      details: _details,
    }, null, 2));
  }

  /**
   * Get today's metrics
   */
  async getTodayMetrics(): Promise<DailyMetrics> {
    // TODO: Load today's metrics from file
    const metricsPath = join(HEARTBEATS_DIR, `${new Date().toISOString().split('T')[0]}.json`);

    const { readFile } = await import('node:fs/promises');
    const { existsSync: existsSyncSync } = await import('node:fs');

    if (existsSyncSync(metricsPath)) {
      try {
        const content = await readFile(metricsPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        // Fall through to defaults
      }
    }

    return {
      date: new Date().toISOString().split('T')[0],
      tasksCompleted: 0,
      tasksFailed: 0,
      claudeQueries: 0,
      linesOfCodeChanged: 0,
      filesModified: 0,
      activeProjects: [],
      uptimeMs: 0,
    };
  }

  // ===========================================
  // Utilities
  // ===========================================

  getBrainDir(): string {
    return BRAIN_DIR;
  }

  getMemoryDir(): string {
    return MEMORY_DIR;
  }

  getProjectsDir(): string {
    return PROJECTS_DIR;
  }

  getTasksDir(): string {
    return TASKS_DIR;
  }
}

// Global singleton instance
let globalBrain: BrainManager | null = null;

/**
 * Get the global brain manager instance
 */
export function getBrain(): BrainManager {
  if (!globalBrain) {
    globalBrain = new BrainManager();
  }
  return globalBrain;
}

/**
 * Reset the global brain instance (for testing)
 */
export function resetBrain(): void {
  globalBrain = null;
}
