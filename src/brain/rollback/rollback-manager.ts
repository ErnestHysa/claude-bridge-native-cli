/**
 * Rollback Manager - Revert autonomous actions
 *
 * The Rollback Manager provides safety for autonomous actions by allowing
 * them to be rolled back if something goes wrong:
 * - Track changes made by autonomous actions
 * - Create snapshots before actions
 * - Rollback via git or file restoration
 * - Automatic rollback on failures
 * - Manual rollback via commands
 *
 * Safety features:
 * - Every autonomous action creates a rollback point
 * - Tests are run before committing rollback points
 * - Rollback is automatic on test failures
 * - Users can manually trigger rollbacks
 */

import { getMemoryStore } from '../memory/memory-store.js';
import { getTransparencyTracker } from '../transparency/transparency-tracker.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================
// Types
// ============================================

/**
 * Rollback point type
 */
export type RollbackPointType = 'git_commit' | 'file_snapshot' | 'dependency_backup' | 'test_backup';

/**
 * File change record
 */
export interface FileChange {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  originalContent?: string;
  backupPath?: string;
}

/**
 * Rollback point
 */
export interface RollbackPoint {
  id: string;
  actionId: string;
  chatId: number;
  projectPath: string;
  type: RollbackPointType;
  timestamp: number;

  // Git info (if git_commit type)
  gitCommit?: string;
  gitBranch?: string;

  // File snapshots (if file_snapshot type)
  fileChanges: FileChange[];

  // Metadata
  description: string;
  actionCategory: string;
  riskLevel: string;

  // Status
  isRollbackPoint: true;
  canRollback: boolean;
  wasRolledBack: boolean;
  rolledBackAt?: number;
}

/**
 * Rollback result
 */
export interface RollbackResult {
  success: boolean;
  rollbackPointId: string;
  previousActionId: string;
  method: 'git_reset' | 'file_restore' | 'dependency_revert';
  filesRestored: number;
  commitsReverted: number;
  duration: number;
  error?: string;
}

/**
 * Rollback options
 */
export interface RollbackOptions {
  reason?: string;
  force?: boolean;           // Skip confirmation
  keepFiles?: boolean;       // Keep changed files as .backup
  createRollbackCommit?: boolean;  // Create a commit after rollback
}

/**
 * Snapshot before action
 */
export interface ActionSnapshot {
  actionId: string;
  chatId: number;
  projectPath: string;
  description: string;
  filesModified: string[];
  testsPassing: boolean;
  gitStatus: {
    branch: string;
    commit: string;
    clean: boolean;
  };
  timestamp: number;
}

// ============================================
// Configuration
// ============================================

const ROLLBACK_CONFIG = {
  // Maximum rollback points to keep per project
  maxRollbackPoints: 50,

  // Retention period for rollback points (ms) - 30 days
  retentionPeriod: 30 * 24 * 60 * 60 * 1000,

  // Auto-rollback on test failure
  autoRollbackOnTestFailure: true,

  // Always create rollback point before autonomous actions
  alwaysCreateRollbackPoint: true,

  // Backup directory
  backupDir: '.claude-backup',

  // Whether to use git for rollbacks when available
  preferGitRollback: true,
};

// ============================================
// Rollback Manager Class
// ============================================

export class RollbackManager {
  private memory = getMemoryStore();
  private rollbackPoints = new Map<string, RollbackPoint>();
  private active = false;

  /**
   * Start the rollback manager
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadRollbackPoints();

    console.log('[RollbackManager] Started');
  }

  /**
   * Stop the rollback manager
   */
  stop(): void {
    this.active = false;
    console.log('[RollbackManager] Stopped');
  }

  /**
   * Create a rollback point before an action
   */
  async createRollbackPoint(snapshot: ActionSnapshot): Promise<RollbackPoint | null> {
    // Check if git is available
    const hasGit = await this.hasGit(snapshot.projectPath);

    if (hasGit && ROLLBACK_CONFIG.preferGitRollback) {
      return this.createGitRollbackPoint(snapshot);
    }

    return this.createFileRollbackPoint(snapshot);
  }

  /**
   * Create a git-based rollback point
   */
  private async createGitRollbackPoint(snapshot: ActionSnapshot): Promise<RollbackPoint | null> {
    try {
      // Get current git status
      const status = await this.getGitStatus(snapshot.projectPath);
      if (!status) {
        return this.createFileRollbackPoint(snapshot);
      }

      // Create a commit for the current state
      const commitMessage = `[claude] Rollback point: ${snapshot.description}`;

      // Stage any uncommitted changes
      if (!status.clean) {
        await this.gitStageAll(snapshot.projectPath);
      }

      // Create rollback commit
      const { stdout: commitHash } = await execAsync(
        `cd "${snapshot.projectPath}" && git commit -m "${commitMessage}" --allow-empty`
      );

      const commit = commitHash.trim().split('\n')[0] || await this.getCurrentCommit(snapshot.projectPath);

      const rollbackPoint: RollbackPoint = {
        id: this.generateRollbackId(),
        actionId: snapshot.actionId,
        chatId: snapshot.chatId,
        projectPath: snapshot.projectPath,
        type: 'git_commit',
        timestamp: Date.now(),
        gitCommit: commit,
        gitBranch: status.branch,
        fileChanges: [],
        description: snapshot.description,
        actionCategory: 'autonomous',
        riskLevel: 'low',
        isRollbackPoint: true,
        canRollback: true,
        wasRolledBack: false,
      };

      this.rollbackPoints.set(rollbackPoint.id, rollbackPoint);
      await this.storeRollbackPoint(rollbackPoint);

      console.log(`[RollbackManager] Created git rollback point: ${rollbackPoint.id}`);
      return rollbackPoint;
    } catch (error) {
      console.error('[RollbackManager] Failed to create git rollback point:', error);
      return this.createFileRollbackPoint(snapshot);
    }
  }

  /**
   * Create a file-based rollback point
   */
  private async createFileRollbackPoint(snapshot: ActionSnapshot): Promise<RollbackPoint | null> {
    const fileChanges: FileChange[] = [];

    // Backup all modified files
    for (const filePath of snapshot.filesModified) {
      const fullPath = this.resolvePath(snapshot.projectPath, filePath);
      try {
        const content = await this.readFile(fullPath);
        const backupPath = await this.createBackup(fullPath);

        fileChanges.push({
          path: filePath,
          action: 'modified',
          originalContent: content,
          backupPath,
        });
      } catch (error) {
        // File might not exist or be readable
        console.warn(`[RollbackManager] Could not backup file: ${filePath}`);
      }
    }

    const rollbackPoint: RollbackPoint = {
      id: this.generateRollbackId(),
      actionId: snapshot.actionId,
      chatId: snapshot.chatId,
      projectPath: snapshot.projectPath,
      type: 'file_snapshot',
      timestamp: Date.now(),
      fileChanges,
      description: snapshot.description,
      actionCategory: 'autonomous',
      riskLevel: 'low',
      isRollbackPoint: true,
      canRollback: fileChanges.length > 0,
      wasRolledBack: false,
    };

    this.rollbackPoints.set(rollbackPoint.id, rollbackPoint);
    await this.storeRollbackPoint(rollbackPoint);

    console.log(`[RollbackManager] Created file rollback point: ${rollbackPoint.id}`);
    return rollbackPoint;
  }

  /**
   * Rollback to a specific point
   */
  async rollback(rollbackPointId: string, options: RollbackOptions = {}): Promise<RollbackResult | null> {
    const rollbackPoint = this.rollbackPoints.get(rollbackPointId);
    if (!rollbackPoint) {
      console.error(`[RollbackManager] Rollback point not found: ${rollbackPointId}`);
      return null;
    }

    if (!rollbackPoint.canRollback) {
      console.error(`[RollbackManager] Rollback point cannot be rolled back: ${rollbackPointId}`);
      return null;
    }

    if (rollbackPoint.wasRolledBack && !options.force) {
      console.error(`[RollbackManager] Rollback point already rolled back: ${rollbackPointId}`);
      return null;
    }

    const startTime = Date.now();

    try {
      let result: RollbackResult;

      if (rollbackPoint.type === 'git_commit') {
        result = await this.gitReset(rollbackPoint, options);
      } else {
        result = await this.restoreFiles(rollbackPoint, options);
      }

      // Mark rollback point as rolled back
      rollbackPoint.wasRolledBack = true;
      rollbackPoint.rolledBackAt = Date.now();
      await this.storeRollbackPoint(rollbackPoint);

      // Log to transparency tracker
      const tracker = getTransparencyTracker();
      await tracker.logAction({
        category: 'other',
        status: result.success ? 'completed' : 'failed',
        projectPath: rollbackPoint.projectPath,
        chatId: rollbackPoint.chatId,
        title: `Rollback: ${rollbackPoint.description}`,
        description: options.reason || 'Manual rollback',
        reasoning: `Rolling back action ${rollbackPoint.actionId}`,
        requiresApproval: false,
        approvedBy: 'user',
        riskLevel: 'low',
        riskFactors: [],
        metadata: {
          rollbackPointId,
          method: result.method,
          filesRestored: result.filesRestored,
        },
      });

      console.log(`[RollbackManager] Rollback completed: ${rollbackPointId}`);
      return result;
    } catch (error) {
      console.error(`[RollbackManager] Rollback failed:`, error);

      return {
        success: false,
        rollbackPointId,
        previousActionId: rollbackPoint.actionId,
        method: 'file_restore',
        filesRestored: 0,
        commitsReverted: 0,
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  /**
   * Perform a git reset to rollback point
   */
  private async gitReset(rollbackPoint: RollbackPoint, options: RollbackOptions): Promise<RollbackResult> {
    if (!rollbackPoint.gitCommit) {
      throw new Error('No git commit associated with rollback point');
    }

    const startTime = Date.now();

    // Reset to the commit before the rollback point
    // First, get the parent commit (the state before the action)
    const { stdout: parentCommit } = await execAsync(
      `cd "${rollbackPoint.projectPath}" && git rev-parse ${rollbackPoint.gitCommit}^`
    );

    const targetCommit = parentCommit.trim() || rollbackPoint.gitCommit;

    // Hard reset to target commit
    await execAsync(
      `cd "${rollbackPoint.projectPath}" && git reset --hard ${targetCommit}`
    );

    // Clean untracked files unless keepFiles is set
    if (!options.keepFiles) {
      await execAsync(`cd "${rollbackPoint.projectPath}" && git clean -fd`);
    }

    return {
      success: true,
      rollbackPointId: rollbackPoint.id,
      previousActionId: rollbackPoint.actionId,
      method: 'git_reset',
      filesRestored: 0, // Git reset doesn't track individual files
      commitsReverted: 1,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Restore files from backup
   */
  private async restoreFiles(rollbackPoint: RollbackPoint, options: RollbackOptions): Promise<RollbackResult> {
    const startTime = Date.now();
    let filesRestored = 0;

    for (const change of rollbackPoint.fileChanges) {
      try {
        if (change.backupPath && change.originalContent !== undefined) {
          const fullPath = this.resolvePath(rollbackPoint.projectPath, change.path);

          if (change.action === 'deleted') {
            // Delete the file that was created
            await this.deleteFile(fullPath);
          } else {
            // Restore original content
            await this.writeFile(fullPath, change.originalContent);
          }

          filesRestored++;

          // Delete backup unless keepFiles is set
          if (!options.keepFiles && change.backupPath) {
            await this.deleteFile(change.backupPath);
          }
        }
      } catch (error) {
        console.error(`[RollbackManager] Failed to restore file: ${change.path}`, error);
      }
    }

    return {
      success: filesRestored > 0,
      rollbackPointId: rollbackPoint.id,
      previousActionId: rollbackPoint.actionId,
      method: 'file_restore',
      filesRestored,
      commitsReverted: 0,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Auto-rollback on test failure
   */
  async autoRollbackOnFailure(actionId: string, _projectPath: string): Promise<RollbackResult | null> {
    if (!ROLLBACK_CONFIG.autoRollbackOnTestFailure) {
      return null;
    }

    // Find the rollback point for this action
    const rollbackPoint = Array.from(this.rollbackPoints.values())
      .find(rp => rp.actionId === actionId && !rp.wasRolledBack);

    if (!rollbackPoint) {
      console.warn(`[RollbackManager] No rollback point found for action: ${actionId}`);
      return null;
    }

    console.log(`[RollbackManager] Auto-rolling back failed action: ${actionId}`);
    return this.rollback(rollbackPoint.id, {
      reason: 'Automatic rollback due to test failure',
      keepFiles: true,
    });
  }

  /**
   * Get rollback points for a project
   */
  getRollbackPoints(filter: { projectPath?: string; chatId?: number; limit?: number } = {}): RollbackPoint[] {
    let points = Array.from(this.rollbackPoints.values());

    if (filter.projectPath) {
      points = points.filter(p => p.projectPath === filter.projectPath);
    }

    if (filter.chatId !== undefined) {
      points = points.filter(p => p.chatId === filter.chatId);
    }

    // Sort by timestamp (newest first)
    points.sort((a, b) => b.timestamp - a.timestamp);

    if (filter.limit) {
      points = points.slice(0, filter.limit);
    }

    return points;
  }

  /**
   * Get a specific rollback point
   */
  getRollbackPoint(id: string): RollbackPoint | undefined {
    return this.rollbackPoints.get(id);
  }

  /**
   * Get the latest rollback point for a project
   */
  getLatestRollbackPoint(projectPath: string): RollbackPoint | undefined {
    const points = this.getRollbackPoints({ projectPath, limit: 1 });
    return points[0];
  }

  /**
   * Delete old rollback points
   */
  async cleanupOldRollbackPoints(): Promise<number> {
    const now = Date.now();
    const cutoff = now - ROLLBACK_CONFIG.retentionPeriod;
    let cleaned = 0;

    for (const [id, point] of this.rollbackPoints) {
      if (point.timestamp < cutoff || point.wasRolledBack) {
        // Clean up file backups
        if (point.type === 'file_snapshot') {
          for (const change of point.fileChanges) {
            if (change.backupPath) {
              try {
                await this.deleteFile(change.backupPath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        }

        this.rollbackPoints.delete(id);
        await this.memory.setFact(`rollback_point:${id}`, null);
        cleaned++;
      }
    }

    // Also enforce max limit per project
    const projectPoints = new Map<string, RollbackPoint[]>();
    for (const point of this.rollbackPoints.values()) {
      const points = projectPoints.get(point.projectPath) || [];
      points.push(point);
      projectPoints.set(point.projectPath, points);
    }

    for (const [_projectPath, points] of projectPoints) {
      if (points.length > ROLLBACK_CONFIG.maxRollbackPoints) {
        // Remove oldest points beyond limit
        const toRemove = points
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, points.length - ROLLBACK_CONFIG.maxRollbackPoints);

        for (const point of toRemove) {
          this.rollbackPoints.delete(point.id);
          await this.memory.setFact(`rollback_point:${point.id}`, null);
          cleaned++;
        }
      }
    }

    return cleaned;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRollbackPoints: number;
    byType: Record<RollbackPointType, number>;
    byProject: Record<string, number>;
    rolledBack: number;
    pending: number;
  } {
    const points = Array.from(this.rollbackPoints.values());

    const byType: Record<string, number> = {
      git_commit: 0,
      file_snapshot: 0,
      dependency_backup: 0,
      test_backup: 0,
    };

    const byProject: Record<string, number> = {};

    for (const point of points) {
      byType[point.type]++;
      byProject[point.projectPath] = (byProject[point.projectPath] || 0) + 1;
    }

    return {
      totalRollbackPoints: points.length,
      byType: byType as Record<RollbackPointType, number>,
      byProject,
      rolledBack: points.filter(p => p.wasRolledBack).length,
      pending: points.filter(p => !p.wasRolledBack).length,
    };
  }

  /**
   * Check if git is available in the project
   */
  private async hasGit(projectPath: string): Promise<boolean> {
    try {
      await execAsync(`cd "${projectPath}" && git rev-parse --git-dir`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get git status
   */
  private async getGitStatus(projectPath: string): Promise<{
    branch: string;
    commit: string;
    clean: boolean;
  } | null> {
    try {
      const { stdout: branch } = await execAsync(
        `cd "${projectPath}" && git rev-parse --abbrev-ref HEAD`
      );
      const { stdout: commit } = await execAsync(
        `cd "${projectPath}" && git rev-parse HEAD`
      );
      const { stdout: status } = await execAsync(
        `cd "${projectPath}" && git status --porcelain`
      );

      return {
        branch: branch.trim(),
        commit: commit.trim(),
        clean: status.trim() === '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Get current commit hash
   */
  private async getCurrentCommit(projectPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `cd "${projectPath}" && git rev-parse HEAD`
      );
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Stage all changes in git
   */
  private async gitStageAll(projectPath: string): Promise<void> {
    await execAsync(`cd "${projectPath}" && git add -A`);
  }

  /**
   * Create a backup file
   */
  private async createBackup(filePath: string): Promise<string> {
    const backupPath = `${filePath}${ROLLBACK_CONFIG.backupDir}/${Date.now()}.bak`;
    const backupDir = backupPath.substring(0, backupPath.lastIndexOf('/'));

    // Ensure backup directory exists
    await execAsync(`mkdir -p "${backupDir}"`);

    // Copy file
    await execAsync(`cp "${filePath}" "${backupPath}"`);

    return backupPath;
  }

  /**
   * Read file content
   */
  private async readFile(filePath: string): Promise<string> {
    const { stdout } = await execAsync(`cat "${filePath}"`);
    return stdout;
  }

  /**
   * Write file content
   */
  private async writeFile(filePath: string, content: string): Promise<void> {
    await execAsync(`mkdir -p "${filePath.substring(0, filePath.lastIndexOf('/'))}"`);
    await execAsync(`cat > "${filePath}" << 'EOF'\n${content}\nEOF`);
  }

  /**
   * Delete a file
   */
  private async deleteFile(filePath: string): Promise<void> {
    await execAsync(`rm -f "${filePath}"`);
  }

  /**
   * Resolve path relative to project
   */
  private resolvePath(projectPath: string, relativePath: string): string {
    if (relativePath.startsWith('/')) {
      return relativePath;
    }
    return `${projectPath}/${relativePath}`;
  }

  /**
   * Store rollback point in memory
   */
  private async storeRollbackPoint(point: RollbackPoint): Promise<void> {
    await this.memory.setFact(`rollback_point:${point.id}`, point);
  }

  /**
   * Load rollback points from memory
   */
  private async loadRollbackPoints(): Promise<void> {
    // Points are loaded on demand
  }

  /**
   * Generate a unique rollback ID
   */
  private generateRollbackId(): string {
    return `rollback-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalRollbackManager: RollbackManager | null = null;

export function getRollbackManager(): RollbackManager {
  if (!globalRollbackManager) {
    globalRollbackManager = new RollbackManager();
  }
  return globalRollbackManager;
}

export function resetRollbackManager(): void {
  if (globalRollbackManager) {
    globalRollbackManager.stop();
  }
  globalRollbackManager = null;
}
