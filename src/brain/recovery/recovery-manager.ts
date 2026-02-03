/**
 * Recovery Manager - Detect and recover from unclean shutdowns
 *
 * Features:
 * - Detects unclean shutdowns (crashes, forced kills)
 * - Records shutdown state for recovery
 * - Provides recovery information on restart
 * - Creates crash reports
 *
 * Uses a "heartbeat" file that is updated periodically. If the file
 * exists on startup with a recent timestamp, it indicates an unclean shutdown.
 */

import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';

// ============================================
// Configuration
// ============================================

const RECOVERY_DIR = join(process.cwd(), 'brain', 'recovery');
const HEARTBEAT_FILE = join(RECOVERY_DIR, 'heartbeat.json');
const HEARTBEAT_INTERVAL = 5000; // Update every 5 seconds
const SHUTDOWN_TIMEOUT = 15000; // Consider unclean if heartbeat older than 15s

// ============================================
// Types
// ============================================

export interface HeartbeatState {
  pid: number;
  startTime: number;
  lastHeartbeat: number;
  uptime: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  activeSessions: number;
  activeTasks: number;
  lastActivity?: string;
}

export interface CrashReport {
  id: string;
  timestamp: number;
  pid: number;
  uptime: number;
  crashReason: 'heartbeat_timeout' | 'missing_heartbeat' | 'unknown';
  lastHeartbeat: number;
  recovery: {
    sessionsCount: number;
    tasksCount: number;
    lastCheckpoint?: string;
  };
}

export interface RecoveryInfo {
  hasUncleanShutdown: boolean;
  lastHeartbeat: HeartbeatState | null;
  timeSinceHeartbeat: number | null;
  crashReports: CrashReport[];
}

// ============================================
// Recovery Manager Class
// ============================================

export class RecoveryManager {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private startTime: number;
  private currentPid: number;
  private status: HeartbeatState['status'] = 'starting';
  private stopping = false;

  constructor() {
    this.startTime = Date.now();
    this.currentPid = process.pid;

    // Ensure directory exists
    this.ensureDirectory();
  }

  /**
   * Start the recovery manager
   */
  async start(): Promise<RecoveryInfo> {
    console.log('[RecoveryManager] Starting...');

    // Check for unclean shutdown
    const recoveryInfo = await this.checkForUncleanShutdown();

    // Start heartbeat
    this.startHeartbeat();

    // Update status
    this.status = 'running';

    return recoveryInfo;
  }

  /**
   * Stop the recovery manager (clean shutdown)
   */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    console.log('[RecoveryManager] Stopping (clean shutdown)...');

    // Update status to stopping
    this.status = 'stopping';
    await this.writeHeartbeat();

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Wait a bit for final heartbeat to be written
    await new Promise(resolve => setTimeout(resolve, 500));

    // Remove heartbeat file (clean shutdown indicator)
    try {
      if (existsSync(HEARTBEAT_FILE)) {
        await unlink(HEARTBEAT_FILE);
      }
    } catch {
      // Ignore errors
    }

    // Write shutdown marker
    await this.writeShutdownMarker();

    console.log('[RecoveryManager] Stopped (clean shutdown)');
  }

  /**
   * Check for unclean shutdown from previous run
   */
  private async checkForUncleanShutdown(): Promise<RecoveryInfo> {
    const info: RecoveryInfo = {
      hasUncleanShutdown: false,
      lastHeartbeat: null,
      timeSinceHeartbeat: null,
      crashReports: [],
    };

    // Check for heartbeat file
    if (existsSync(HEARTBEAT_FILE)) {
      try {
        const content = await readFile(HEARTBEAT_FILE, 'utf-8');
        const heartbeat = JSON.parse(content) as HeartbeatState;

        info.lastHeartbeat = heartbeat;
        info.timeSinceHeartbeat = Date.now() - heartbeat.lastHeartbeat;

        // If heartbeat is recent but we're starting up, it's an unclean shutdown
        if (info.timeSinceHeartbeat < SHUTDOWN_TIMEOUT && heartbeat.status !== 'stopped') {
          info.hasUncleanShutdown = true;

          // Create crash report
          const crashReport = await this.createCrashReport(heartbeat);
          info.crashReports.push(crashReport);

          console.error(`[RecoveryManager] Detected unclean shutdown! PID: ${heartbeat.pid}, Uptime: ${Math.floor(heartbeat.uptime / 1000)}s`);
        } else {
          // Old heartbeat file, clean it up
          await unlink(HEARTBEAT_FILE);
        }
      } catch (error) {
        console.error('[RecoveryManager] Failed to read heartbeat:', error);
      }
    }

    // Load existing crash reports
    await this.loadCrashReports(info);

    return info;
  }

  /**
   * Create a crash report
   */
  private async createCrashReport(heartbeat: HeartbeatState): Promise<CrashReport> {
    const report: CrashReport = {
      id: this.generateReportId(),
      timestamp: Date.now(),
      pid: heartbeat.pid,
      uptime: heartbeat.uptime,
      crashReason: 'heartbeat_timeout',
      lastHeartbeat: heartbeat.lastHeartbeat,
      recovery: {
        sessionsCount: heartbeat.activeSessions,
        tasksCount: heartbeat.activeTasks,
      },
    };

    // Try to get last checkpoint info
    try {
      const { getCheckpointManager } = await import('../checkpoint/index.js');
      const checkpointMgr = getCheckpointManager();
      const checkpoints = await checkpointMgr.listCheckpoints();
      if (checkpoints.length > 0) {
        report.recovery.lastCheckpoint = checkpoints[0];
      }
    } catch {
      // Skip
    }

    // Save crash report
    const reportFile = join(RECOVERY_DIR, `crash-${report.id}.json`);
    await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');

    console.log(`[RecoveryManager] Crash report created: ${report.id}`);

    return report;
  }

  /**
   * Load existing crash reports
   */
  private async loadCrashReports(info: RecoveryInfo): Promise<void> {
    try {
      const files = readdirSync(RECOVERY_DIR)
        .filter((f: string) => f.startsWith('crash-') && f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 10); // Last 10 crashes

      for (const file of files) {
        try {
          const reportPath = join(RECOVERY_DIR, file);
          const content = await readFile(reportPath, 'utf-8');
          const report = JSON.parse(content) as CrashReport;
          info.crashReports.push(report);
        } catch {
          // Skip invalid reports
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  /**
   * Start the heartbeat
   */
  private startHeartbeat(): void {
    // Write initial heartbeat
    this.writeHeartbeat().catch(console.error);

    // Update heartbeat periodically
    this.heartbeatInterval = setInterval(() => {
      this.writeHeartbeat().catch(console.error);
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Write heartbeat file
   */
  private async writeHeartbeat(): Promise<void> {
    const heartbeat: HeartbeatState = {
      pid: this.currentPid,
      startTime: this.startTime,
      lastHeartbeat: Date.now(),
      uptime: Date.now() - this.startTime,
      status: this.status,
      activeSessions: this.getActiveSessionCount(),
      activeTasks: this.getActiveTaskCount(),
    };

    try {
      await writeFile(HEARTBEAT_FILE, JSON.stringify(heartbeat, null, 2), 'utf-8');
    } catch (error) {
      console.error('[RecoveryManager] Failed to write heartbeat:', error);
    }
  }

  /**
   * Write shutdown marker file
   */
  private async writeShutdownMarker(): Promise<void> {
    const marker = {
      timestamp: Date.now(),
      pid: this.currentPid,
      uptime: Date.now() - this.startTime,
      shutdown: 'clean',
    };

    const markerFile = join(RECOVERY_DIR, `shutdown-${Date.now()}.json`);
    try {
      await writeFile(markerFile, JSON.stringify(marker, null, 2), 'utf-8');
    } catch (error) {
      console.error('[RecoveryManager] Failed to write shutdown marker:', error);
    }
  }

  /**
   * Get active session count
   */
  private getActiveSessionCount(): number {
    try {
      const { getSessionManager } = require('../../session-manager.js');
      const sessionManager = getSessionManager();
      return sessionManager.getAllSessions().length;
    } catch {
      return 0;
    }
  }

  /**
   * Get active task count
   */
  private getActiveTaskCount(): number {
    try {
      const { getTaskQueue } = require('../tasks/task-queue.js');
      const taskQueue = getTaskQueue();
      return taskQueue.getState().running.length + taskQueue.getState().pending.length;
    } catch {
      return 0;
    }
  }

  /**
   * Get recovery info
   */
  async getRecoveryInfo(): Promise<RecoveryInfo> {
    const info: RecoveryInfo = {
      hasUncleanShutdown: false,
      lastHeartbeat: null,
      timeSinceHeartbeat: null,
      crashReports: [],
    };

    // Read current heartbeat
    if (existsSync(HEARTBEAT_FILE)) {
      try {
        const content = await readFile(HEARTBEAT_FILE, 'utf-8');
        const heartbeat = JSON.parse(content) as HeartbeatState;
        info.lastHeartbeat = heartbeat;
        info.timeSinceHeartbeat = Date.now() - heartbeat.lastHeartbeat;
      } catch {
        // Skip
      }
    }

    // Load crash reports
    await this.loadCrashReports(info);

    return info;
  }

  /**
   * Clear old crash reports
   */
  async clearOldCrashReports(keepCount = 10): Promise<number> {
    try {
      const files = readdirSync(RECOVERY_DIR)
        .filter((f: string) => f.startsWith('crash-') && f.endsWith('.json'))
        .sort()
        .reverse();

      const toDelete = files.slice(keepCount);
      let deleted = 0;

      for (const file of toDelete) {
        try {
          unlinkSync(join(RECOVERY_DIR, file));
          deleted++;
        } catch {
          // Skip
        }
      }

      return deleted;
    } catch {
      return 0;
    }
  }

  /**
   * Ensure recovery directory exists
   */
  private ensureDirectory(): void {
    if (!existsSync(RECOVERY_DIR)) {
      mkdirSync(RECOVERY_DIR, { recursive: true });
    }
  }

  /**
   * Generate report ID
   */
  private generateReportId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    return `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalRecoveryManager: RecoveryManager | null = null;

export function getRecoveryManager(): RecoveryManager {
  if (!globalRecoveryManager) {
    globalRecoveryManager = new RecoveryManager();
  }
  return globalRecoveryManager;
}

export function resetRecoveryManager(): void {
  if (globalRecoveryManager) {
    globalRecoveryManager.stop().catch(console.error);
  }
  globalRecoveryManager = null;
}
