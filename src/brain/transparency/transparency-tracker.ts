/**
 * Transparency Tracker - Audit trail for autonomous AI actions
 *
 * The Transparency Tracker maintains a complete audit trail of all autonomous
 * AI actions, providing visibility and accountability:
 * - Log all autonomous actions with full context
 * - Track approval status and outcomes
 * - Generate reports for review
 * - Store decisions and their reasoning
 * - Provide transparency into AI behavior
 *
 * Transparency principles:
 * - Every action is logged
 * - Decisions are explainable
 * - Users can review all activity
 * - Audit trail is immutable
 */

import { getMemoryStore } from '../memory/memory-store.js';
import { getTestHealer } from '../self-healing/test-healer.js';
import { getRefactoringAgent } from '../refactoring/refactoring-agent.js';
import { getDependencyManager } from '../dependency/dependency-manager.js';

// ============================================
// Types
// ============================================

/**
 * Action status
 */
export type ActionStatus = 'pending' | 'approved' | 'denied' | 'executing' | 'completed' | 'failed' | 'rolled_back';

/**
 * Action category
 */
export type ActionCategory =
  | 'test_healing'
  | 'dependency_update'
  | 'refactoring'
  | 'feature_implementation'
  | 'documentation'
  | 'deployment'
  | 'other';

/**
 * An autonomous action log entry
 */
export interface ActionLog {
  id: string;
  category: ActionCategory;
  status: ActionStatus;
  projectPath: string;
  chatId: number;
  intentionId?: string;
  decisionId?: string;

  // Action details
  title: string;
  description: string;
  reasoning: string;

  // Approval info
  requiresApproval: boolean;
  approvedBy?: 'user' | 'auto' | 'policy';
  approvedAt?: number;

  // Execution info
  startedAt?: number;
  completedAt?: number;
  duration?: number;         // milliseconds

  // Results
  changes?: Array<{
    file: string;
    action: 'created' | 'modified' | 'deleted';
    linesChanged?: number;
  }>;
  outcome?: 'success' | 'failure' | 'partial';
  error?: string;

  // Risk assessment
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];

  // Metadata
  timestamp: number;
  metadata: Record<string, unknown>;
}

/**
 * Transparency report
 */
export interface TransparencyReport {
  id: string;
  chatId: number;
  projectPath?: string;
  startDate: number;
  endDate: number;
  summary: {
    totalActions: number;
    byCategory: Record<ActionCategory, number>;
    byStatus: Record<ActionStatus, number>;
    autoApproved: number;
    userApproved: number;
    denied: number;
    successRate: number;
  };
  actions: ActionLog[];
  generatedAt: number;
}

/**
 * Approval record
 */
export interface ApprovalRecord {
  actionId: string;
  approvedBy: 'user' | 'auto' | 'policy';
  approvedAt: number;
  reason?: string;
}

// ============================================
// Configuration
// ============================================

const TRANSPARENCY_CONFIG = {
  // Retention period for logs (ms) - 90 days
  retentionPeriod: 90 * 24 * 60 * 60 * 1000,

  // Maximum actions per report
  maxActionsPerReport: 1000,

  // Report intervals
  reportIntervals: ['daily', 'weekly', 'monthly'] as const,
};

// ============================================
// Transparency Tracker Class
// ============================================

export class TransparencyTracker {
  private memory = getMemoryStore();
  private logs = new Map<string, ActionLog>();
  private active = false;

  /**
   * Start the tracker
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadLogs();

    console.log('[TransparencyTracker] Started');
  }

  /**
   * Stop the tracker
   */
  stop(): void {
    this.active = false;
    console.log('[TransparencyTracker] Stopped');
  }

  /**
   * Log an autonomous action
   */
  async logAction(action: Omit<ActionLog, 'id' | 'timestamp'>): Promise<ActionLog> {
    const log: ActionLog = {
      id: this.generateLogId(),
      timestamp: Date.now(),
      ...action,
      riskLevel: action.riskLevel || 'none',
      riskFactors: action.riskFactors || [],
    };

    this.logs.set(log.id, log);
    await this.storeLog(log);

    // Store for query by user/project
    await this.memory.setFact(`action:by_user:${log.chatId}:${log.id}`, log.id);
    await this.memory.setFact(`action:by_project:${log.projectPath}:${log.id}`, log.id);

    return log;
  }

  /**
   * Update action status
   */
  async updateAction(
    actionId: string,
    updates: Partial<Pick<ActionLog, 'status' | 'startedAt' | 'completedAt' | 'duration' | 'changes' | 'outcome' | 'error'>>
  ): Promise<boolean> {
    const log = this.logs.get(actionId);
    if (!log) return false;

    Object.assign(log, updates);

    // Calculate duration if completed
    if (updates.completedAt && log.startedAt) {
      log.duration = updates.completedAt! - log.startedAt;
    }

    await this.storeLog(log);
    return true;
  }

  /**
   * Record an action approval
   */
  async recordApproval(actionId: string, approval: ApprovalRecord): Promise<boolean> {
    const log = this.logs.get(actionId);
    if (!log) return false;

    log.approvedBy = approval.approvedBy;
    log.approvedAt = approval.approvedAt;
    log.status = 'approved';

    await this.storeLog(log);
    await this.memory.setFact(`approval:${actionId}`, approval);

    return true;
  }

  /**
   * Get action by ID
   */
  getAction(id: string): ActionLog | undefined {
    return this.logs.get(id);
  }

  /**
   * Get actions by filter
   */
  getActions(filter: {
    chatId?: number;
    projectPath?: string;
    category?: ActionCategory;
    status?: ActionStatus;
    startDate?: number;
    endDate?: number;
    limit?: number;
  } = {}): ActionLog[] {
    let results = Array.from(this.logs.values());

    if (filter.chatId !== undefined) {
      results = results.filter(l => l.chatId === filter.chatId);
    }

    if (filter.projectPath) {
      results = results.filter(l => l.projectPath === filter.projectPath);
    }

    if (filter.category) {
      results = results.filter(l => l.category === filter.category);
    }

    if (filter.status) {
      results = results.filter(l => l.status === filter.status);
    }

    if (filter.startDate !== undefined) {
      results = results.filter(l => l.timestamp >= filter.startDate!);
    }

    if (filter.endDate !== undefined) {
      results = results.filter(l => l.timestamp <= filter.endDate!);
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Generate a transparency report
   */
  async generateReport(options: {
    chatId: number;
    projectPath?: string;
    startDate: number;
    endDate?: number;
  }): Promise<TransparencyReport> {
    const { chatId, projectPath, startDate, endDate = Date.now() } = options;

    const actions = this.getActions({
      chatId,
      projectPath,
      startDate,
      endDate,
      limit: TRANSPARENCY_CONFIG.maxActionsPerReport,
    });

    // Calculate summary
    const summary = {
      totalActions: actions.length,
      byCategory: this.groupBy(actions, 'category') as Record<ActionCategory, number>,
      byStatus: this.groupBy(actions, 'status') as Record<ActionStatus, number>,
      autoApproved: actions.filter(a => a.approvedBy === 'auto' || a.approvedBy === 'policy').length,
      userApproved: actions.filter(a => a.approvedBy === 'user').length,
      denied: actions.filter(a => a.status === 'denied').length,
      successRate: actions.length > 0
        ? Math.round((actions.filter(a => a.outcome === 'success').length / actions.length) * 100)
        : 100,
    };

    const report: TransparencyReport = {
      id: this.generateReportId(),
      chatId,
      projectPath,
      startDate,
      endDate,
      summary,
      actions,
      generatedAt: Date.now(),
    };

    await this.memory.setFact(`report:${report.id}`, report);

    return report;
  }

  /**
   * Format action as a log message
   */
  formatAction(action: ActionLog): string {
    const statusEmoji: Record<ActionStatus, string> = {
      pending: '⏳',
      approved: '✅',
      denied: '❌',
      executing: '🔄',
      completed: '✨',
      failed: '💥',
      rolled_back: '⏪',
    };

    const categoryEmoji: Record<ActionCategory, string> = {
      test_healing: '🔧',
      dependency_update: '📦',
      refactoring: '♻️',
      feature_implementation: '✨',
      documentation: '📝',
      deployment: '🚀',
      other: '🤖',
    };

    const riskEmoji: Record<string, string> = {
      none: '',
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    };

    let message = `${statusEmoji[action.status]} ${categoryEmoji[action.category]} <b>${action.title}</b>\n`;
    message += `   Status: ${action.status}\n`;
    message += `   Risk: ${riskEmoji[action.riskLevel]} ${action.riskLevel}\n`;

    if (action.requiresApproval) {
      message += `   Approved by: ${action.approvedBy || 'pending'}\n`;
    }

    if (action.duration) {
      message += `   Duration: ${Math.round(action.duration / 1000)}s\n`;
    }

    if (action.changes && action.changes.length > 0) {
      message += `   Changes: ${action.changes.length} file(s)\n`;
    }

    if (action.error) {
      message += `   Error: ${action.error.substring(0, 100)}\n`;
    }

    return message;
  }

  /**
   * Format report as a Telegram message
   */
  formatReportMessage(report: TransparencyReport): string {
    const { summary, startDate, endDate } = report;
    const projectName = report.projectPath
      ? report.projectPath.split(/[/\\]/).pop() || 'Project'
      : 'All Projects';

    let message = `📊 <b>Transparency Report: ${projectName}</b>\n\n`;
    message += `Period: ${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}\n\n`;

    message += `<b>Summary:</b>\n`;
    message += `• Total Actions: ${summary.totalActions}\n`;
    message += `• Success Rate: ${summary.successRate}%\n`;
    message += `• Auto-approved: ${summary.autoApproved}\n`;
    message += `• User-approved: ${summary.userApproved}\n`;
    message += `• Denied: ${summary.denied}\n\n`;

    message += `<b>By Category:</b>\n`;
    for (const [category, count] of Object.entries(summary.byCategory)) {
      if (count > 0) {
        message += `• ${category}: ${count}\n`;
      }
    }

    // Recent actions
    const recent = report.actions.slice(0, 5);
    if (recent.length > 0) {
      message += `\n<b>Recent Actions:</b>\n`;
      for (const action of recent) {
        const statusEmoji = action.status === 'completed' ? '✅' :
                          action.status === 'failed' ? '❌' :
                          action.status === 'executing' ? '🔄' : '⏳';
        message += `${statusEmoji} ${action.title}\n`;
      }
    }

    return message;
  }

  /**
   * Sync actions from other brain components
   */
  async syncFromBrain(): Promise<void> {
    // Sync from test healer
    const healer = getTestHealer();
    healer.getStats();

    // Sync from dependency manager
    const depManager = getDependencyManager();
    depManager.getStats();

    // Sync from refactoring agent
    const refactoringAgent = getRefactoringAgent();
    refactoringAgent.getStats();
  }

  /**
   * Get statistics
   */
  getStats(filter?: { chatId?: number; projectPath?: string }): {
    total: number;
    byCategory: Record<ActionCategory, number>;
    byStatus: Record<ActionStatus, number>;
    today: number;
    thisWeek: number;
  } {
    let logs = Array.from(this.logs.values());

    if (filter?.chatId) {
      logs = logs.filter(l => l.chatId === filter.chatId);
    }

    if (filter?.projectPath) {
      logs = logs.filter(l => l.projectPath === filter.projectPath);
    }

    const byCategory: Record<ActionCategory, number> = {
      test_healing: 0,
      dependency_update: 0,
      refactoring: 0,
      feature_implementation: 0,
      documentation: 0,
      deployment: 0,
      other: 0,
    };

    const byStatus: Record<ActionStatus, number> = {
      pending: 0,
      approved: 0,
      denied: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      rolled_back: 0,
    };

    const now = Date.now();
    const today = new Date(now).setHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const log of logs) {
      byCategory[log.category]++;
      byStatus[log.status]++;
    }

    return {
      total: logs.length,
      byCategory,
      byStatus,
      today: logs.filter(l => l.timestamp >= today).length,
      thisWeek: logs.filter(l => l.timestamp >= weekAgo).length,
    };
  }

  /**
   * Clean up old logs
   */
  async cleanupOldLogs(): Promise<number> {
    const cutoff = Date.now() - TRANSPARENCY_CONFIG.retentionPeriod;
    let cleaned = 0;

    for (const [id, log] of this.logs) {
      if (log.timestamp < cutoff) {
        this.logs.delete(id);
        await this.memory.setFact(`action_log:${id}`, null);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Group actions by a field
   */
  private groupBy<T extends keyof ActionLog>(actions: ActionLog[], field: T): Record<string, number> {
    const groups: Record<string, number> = {};

    for (const action of actions) {
      const value = String(action[field]);
      groups[value] = (groups[value] || 0) + 1;
    }

    return groups;
  }

  /**
   * Store log in memory
   */
  private async storeLog(log: ActionLog): Promise<void> {
    await this.memory.setFact(`action_log:${log.id}`, log);
  }

  /**
   * Load logs from memory
   */
  private async loadLogs(): Promise<void> {
    // Logs would be loaded from persistent storage
  }

  /**
   * Generate a unique log ID
   */
  private generateLogId(): string {
    return `action-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate a unique report ID
   */
  private generateReportId(): string {
    return `report-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalTransparencyTracker: TransparencyTracker | null = null;

export function getTransparencyTracker(): TransparencyTracker {
  if (!globalTransparencyTracker) {
    globalTransparencyTracker = new TransparencyTracker();
  }
  return globalTransparencyTracker;
}

export function resetTransparencyTracker(): void {
  if (globalTransparencyTracker) {
    globalTransparencyTracker.stop();
  }
  globalTransparencyTracker = null;
}
