/**
 * Metrics Tracker - Track and persist daily metrics
 *
 * Tracks metrics that survive server restarts:
 * - Tasks completed/failed
 * - Claude queries
 * - Files modified
 * - Lines of code changed
 * - Active projects
 * - Server uptime
 */

import { join } from 'node:path';
import type { DailyMetrics } from '../types.js';

// ============================================
// Configuration
// ============================================

// Use process.cwd() to get the project root, regardless of where the code is running from
const PROJECT_ROOT = process.cwd();
const BRAIN_DIR = join(PROJECT_ROOT, 'brain');
const METRICS_DIR = join(BRAIN_DIR, 'metrics');

// ============================================
// Types
// ============================================

export interface MetricsIncrement {
  tasksCompleted?: number;
  tasksFailed?: number;
  claudeQueries?: number;
  filesModified?: number;
  linesOfCodeChanged?: number;
  activeProject?: string; // Add to active projects if provided
}

// ============================================
// Metrics Tracker Class
// ============================================

export class MetricsTracker {
  private metrics: DailyMetrics;
  private startTime: number;
  private flushInterval: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor() {
    const today = new Date().toISOString().split('T')[0];
    this.metrics = {
      date: today,
      tasksCompleted: 0,
      tasksFailed: 0,
      claudeQueries: 0,
      filesModified: 0,
      linesOfCodeChanged: 0,
      activeProjects: [],
      uptimeMs: 0,
    };
    this.startTime = Date.now();
  }

  /**
   * Start the metrics tracker
   */
  async start(): Promise<void> {
    // Load today's metrics
    await this.load();

    // Update start time for uptime calculation
    this.startTime = Date.now();

    // Flush metrics every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, 30000);

    console.log('[MetricsTracker] Started');
  }

  /**
   * Stop the metrics tracker
   */
  async stop(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
    console.log('[MetricsTracker] Stopped');
  }

  /**
   * Increment metrics
   */
  increment(increments: MetricsIncrement): void {
    let changed = false;

    if (increments.tasksCompleted) {
      this.metrics.tasksCompleted += increments.tasksCompleted;
      changed = true;
    }
    if (increments.tasksFailed) {
      this.metrics.tasksFailed += increments.tasksFailed;
      changed = true;
    }
    if (increments.claudeQueries) {
      this.metrics.claudeQueries += increments.claudeQueries;
      changed = true;
    }
    if (increments.filesModified) {
      this.metrics.filesModified += increments.filesModified;
      changed = true;
    }
    if (increments.linesOfCodeChanged) {
      this.metrics.linesOfCodeChanged += increments.linesOfCodeChanged;
      changed = true;
    }
    if (increments.activeProject) {
      if (!this.metrics.activeProjects.includes(increments.activeProject)) {
        this.metrics.activeProjects.push(increments.activeProject);
        changed = true;
      }
    }

    if (changed) {
      this.dirty = true;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): DailyMetrics {
    // Update uptime
    this.metrics.uptimeMs = Date.now() - this.startTime;
    return { ...this.metrics };
  }

  /**
   * Get today's metrics (alias for getMetrics)
   */
  async getTodayMetrics(): Promise<DailyMetrics> {
    return this.getMetrics();
  }

  /**
   * Load metrics from disk
   */
  private async load(): Promise<void> {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    const today = new Date().toISOString().split('T')[0];
    const metricsPath = join(METRICS_DIR, `${today}.json`);

    if (existsSync(metricsPath)) {
      try {
        const content = await readFile(metricsPath, 'utf-8');
        const loaded = JSON.parse(content) as DailyMetrics;

        // Verify it's for today
        if (loaded.date === today) {
          this.metrics = loaded;
          console.log('[MetricsTracker] Loaded existing metrics for today');
        } else {
          // Date rollover - start fresh
          console.log('[MetricsTracker] Date rollover detected, starting fresh');
        }
      } catch (error) {
        console.error('[MetricsTracker] Failed to load metrics:', error);
      }
    }
  }

  /**
   * Flush metrics to disk
   */
  async flush(): Promise<void> {
    if (!this.dirty && this.metrics.uptimeMs < 60000) {
      return; // Don't flush if nothing changed and just started
    }

    const { writeFile } = await import('node:fs/promises');
    const { mkdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    // Ensure directory exists
    if (!existsSync(METRICS_DIR)) {
      try {
        mkdirSync(METRICS_DIR, { recursive: true });
      } catch {
        // Directory creation might fail
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const metricsPath = join(METRICS_DIR, `${today}.json`);

    // Update uptime before saving
    this.metrics.uptimeMs = Date.now() - this.startTime;

    try {
      await writeFile(metricsPath, JSON.stringify(this.metrics, null, 2), 'utf-8');
      this.dirty = false;
    } catch (error) {
      console.error('[MetricsTracker] Failed to save metrics:', error);
    }
  }

  /**
   * Reset metrics (for testing or manual reset)
   */
  reset(): void {
    const today = new Date().toISOString().split('T')[0];
    this.metrics = {
      date: today,
      tasksCompleted: 0,
      tasksFailed: 0,
      claudeQueries: 0,
      filesModified: 0,
      linesOfCodeChanged: 0,
      activeProjects: [],
      uptimeMs: 0,
    };
    this.startTime = Date.now();
    this.dirty = true;
    this.flush().catch(console.error);
  }

  /**
   * Get metrics for a specific date
   */
  async getMetricsForDate(date: string): Promise<DailyMetrics | null> {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    const metricsPath = join(METRICS_DIR, `${date}.json`);

    if (existsSync(metricsPath)) {
      try {
        const content = await readFile(metricsPath, 'utf-8');
        return JSON.parse(content) as DailyMetrics;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Get metrics for a date range
   */
  async getMetricsRange(startDate: string, endDate: string): Promise<DailyMetrics[]> {
    const { readdirSync } = await import('node:fs');
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const results: DailyMetrics[] = [];

    try {
      const files = readdirSync(METRICS_DIR)
        .filter(f => f.endsWith('.json'))
        .filter(f => {
          const date = f.replace('.json', '');
          return date >= startDate && date <= endDate;
        })
        .sort();

      for (const file of files) {
        try {
          const content = await readFile(join(METRICS_DIR, file), 'utf-8');
          results.push(JSON.parse(content) as DailyMetrics);
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory might not exist
    }

    return results;
  }

  /**
   * Get aggregated metrics for a period
   */
  async getAggregatedMetrics(startDate: string, endDate: string): Promise<DailyMetrics> {
    const metricsList = await this.getMetricsRange(startDate, endDate);

    const aggregated: DailyMetrics = {
      date: `${startDate} to ${endDate}`,
      tasksCompleted: 0,
      tasksFailed: 0,
      claudeQueries: 0,
      filesModified: 0,
      linesOfCodeChanged: 0,
      activeProjects: [],
      uptimeMs: 0,
    };

    const allProjects = new Set<string>();

    for (const m of metricsList) {
      aggregated.tasksCompleted += m.tasksCompleted;
      aggregated.tasksFailed += m.tasksFailed;
      aggregated.claudeQueries += m.claudeQueries;
      aggregated.filesModified += m.filesModified;
      aggregated.linesOfCodeChanged += m.linesOfCodeChanged;
      aggregated.uptimeMs += m.uptimeMs;
      m.activeProjects.forEach(p => allProjects.add(p));
    }

    aggregated.activeProjects = Array.from(allProjects);
    return aggregated;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalMetricsTracker: MetricsTracker | null = null;

export function getMetricsTracker(): MetricsTracker {
  if (!globalMetricsTracker) {
    globalMetricsTracker = new MetricsTracker();
  }
  return globalMetricsTracker;
}

export function resetMetricsTracker(): void {
  if (globalMetricsTracker) {
    globalMetricsTracker.stop().catch(console.error);
  }
  globalMetricsTracker = null;
}
