/**
 * Proactive Improvement Scheduler
 *
 * Integrates the opportunity detector with the autonomous system:
 * - Runs during inactive hours to detect improvement opportunities
 * - Creates tasks in the night work queue for autonomous execution
 * - Applies quality gates to prevent risky autonomous changes
 * - Prioritizes opportunities based on impact and effort
 *
 * Quality Gates:
 * - read_only: Can only detect, cannot apply changes
 * - advisory: Can suggest, requires approval
 * - supervised: Can apply safe changes (refactors, doc updates)
 * - autonomous: Can apply most changes except critical
 * - full: Can apply any change
 */

import { getOpportunityDetector } from '../opportunity/opportunity-detector.js';
import { getNightWorkQueue } from './night-work-queue.js';
import { getActivityTracker } from './activity-tracker.js';
import { getIdentityManager } from '../identity.js';
import type { ImprovementOpportunity } from '../opportunity/opportunity-detector.js';
import type { NightWorkTaskType } from './night-work-queue.js';

// ============================================
// Types
// ============================================

/**
 * Quality gate level
 */
export type QualityGateLevel = 'read_only' | 'advisory' | 'supervised' | 'autonomous' | 'full';

/**
 * Quality gate result
 */
export interface QualityGateResult {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  maxAutonomousImpact: number; // Maximum impact score for autonomous execution
}

/**
 * Quality gate configuration
 */
export interface QualityGateConfig {
  level: QualityGateLevel;
  allowAutoRefactor: boolean;
  allowTestUpdates: boolean;
  allowDependencyUpdates: boolean;
  allowDocUpdates: boolean;
  allowCriticalChanges: boolean;
  maxImpactScore: number;
}

/**
 * Proactive improvement options
 */
export interface ProactiveImprovementOptions {
  projectPath: string;
  chatId: number;
  types?: string[];  // Opportunity types to scan for
  maxTasks?: number; // Maximum tasks to create
  permissionLevel?: QualityGateLevel;
}

/**
 * Scan result
 */
export interface ProactiveScanResult {
  projectPath: string;
  chatId: number;
  opportunitiesScanned: number;
  tasksCreated: number;
  tasksSkipped: {
    qualityGate: number;
    lowPriority: number;
    duplicate: number;
  };
  timestamp: number;
}

// ============================================
// Quality Gate Configurations
// ============================================

const QUALITY_GATES: Record<QualityGateLevel, QualityGateConfig> = {
  read_only: {
    level: 'read_only',
    allowAutoRefactor: false,
    allowTestUpdates: false,
    allowDependencyUpdates: false,
    allowDocUpdates: false,
    allowCriticalChanges: false,
    maxImpactScore: 0,
  },
  advisory: {
    level: 'advisory',
    allowAutoRefactor: false,
    allowTestUpdates: false,
    allowDependencyUpdates: false,
    allowDocUpdates: true,
    allowCriticalChanges: false,
    maxImpactScore: 0.1,
  },
  supervised: {
    level: 'supervised',
    allowAutoRefactor: true,
    allowTestUpdates: true,
    allowDependencyUpdates: false,
    allowDocUpdates: true,
    allowCriticalChanges: false,
    maxImpactScore: 0.3,
  },
  autonomous: {
    level: 'autonomous',
    allowAutoRefactor: true,
    allowTestUpdates: true,
    allowDependencyUpdates: true,
    allowDocUpdates: true,
    allowCriticalChanges: false,
    maxImpactScore: 0.5,
  },
  full: {
    level: 'full',
    allowAutoRefactor: true,
    allowTestUpdates: true,
    allowDependencyUpdates: true,
    allowDocUpdates: true,
    allowCriticalChanges: true,
    maxImpactScore: 1.0,
  },
};

// ============================================
// Proactive Improvement Scheduler
// ============================================

export class ProactiveImprovementScheduler {
  private opportunityDetector = getOpportunityDetector();
  private workQueue = getNightWorkQueue();
  private activityTracker = getActivityTracker();

  /**
   * Run proactive improvement scan for a user
   */
  async runProactiveScan(options: ProactiveImprovementOptions): Promise<ProactiveScanResult> {
    const {
      projectPath,
      chatId,
      maxTasks = 5,
      permissionLevel = 'autonomous',
    } = options;

    // Get quality gate config
    const gateConfig = QUALITY_GATES[permissionLevel];

    // Get opportunities that haven't been addressed
    const opportunities = await this.opportunityDetector.getOpportunities({
      projectPath,
      status: 'detected',
    });

    const result: ProactiveScanResult = {
      projectPath,
      chatId,
      opportunitiesScanned: opportunities.length,
      tasksCreated: 0,
      tasksSkipped: {
        qualityGate: 0,
        lowPriority: 0,
        duplicate: 0,
      },
      timestamp: Date.now(),
    };

    // Filter and prioritize opportunities
    const prioritized = this.prioritizeOpportunities(opportunities, gateConfig);

    // Create tasks for top opportunities
    let createdCount = 0;
    for (const opportunity of prioritized) {
      if (createdCount >= maxTasks) break;

      // Check quality gate
      const gateResult = this.checkQualityGate(opportunity, gateConfig);
      if (!gateResult.allowed) {
        result.tasksSkipped.qualityGate++;
        continue;
      }

      // Check if task already exists in queue
      const existingTasks = this.workQueue.getUserTasks(chatId);
      const alreadyQueued = existingTasks.some(t =>
        t.sourceId === opportunity.id && t.status !== 'completed' && t.status !== 'failed'
      );

      if (alreadyQueued) {
        result.tasksSkipped.duplicate++;
        continue;
      }

      // Map opportunity to task type
      const taskType = this.mapOpportunityToTaskType(opportunity);

      // Create the task
      await this.workQueue.addTask({
        type: taskType,
        priority: this.mapPriority(opportunity.priority),
        title: opportunity.title,
        description: opportunity.description,
        source: 'opportunity',
        sourceId: opportunity.id,
        chatId: chatId,
        requiredPermission: gateResult.requiresApproval ? 'supervised' : 'autonomous',
        context: {
          projectId: projectPath,
          metadata: {
            opportunityId: opportunity.id,
            opportunityType: opportunity.type,
            estimatedImpact: opportunity.estimatedImpact,
          },
        },
        maxRetries: opportunity.priority === 'critical' ? 1 : 2,
      });

      // Update opportunity status
      await this.opportunityDetector.updateOpportunityStatus(opportunity.id, 'queued');

      result.tasksCreated++;
      createdCount++;
    }

    return result;
  }

  /**
   * Run proactive scans for all users in autonomous mode
   * Called by the autonomous mode controller
   */
  async runScansForAutonomousUsers(): Promise<ProactiveScanResult[]> {
    const results: ProactiveScanResult[] = [];

    // Get all users in autonomous mode
    const autonomousUsers = await this.activityTracker.getAutonomousUsers();

    for (const userData of autonomousUsers) {
      // Only scan if user has projects configured
      const projectPath = this.getUserProjectPath(userData.chatId);
      if (!projectPath) continue;

      // Get user's permission level (from preferences)
      const permissionLevel = await this.getUserPermissionLevel(userData.chatId);

      try {
        const result = await this.runProactiveScan({
          projectPath,
          chatId: userData.chatId,
          permissionLevel,
        });
        results.push(result);
      } catch (error) {
        console.error(`Proactive scan failed for user ${userData.chatId}:`, error);
      }
    }

    return results;
  }

  /**
   * Check if an opportunity passes quality gates
   */
  checkQualityGate(opportunity: ImprovementOpportunity, config: QualityGateConfig): QualityGateResult {
    const result: QualityGateResult = {
      allowed: false,
      reason: '',
      requiresApproval: false,
      maxAutonomousImpact: config.maxImpactScore,
    };

    // Critical changes always require approval
    if (opportunity.priority === 'critical' && !config.allowCriticalChanges) {
      result.reason = 'Critical changes require manual approval';
      result.requiresApproval = true;
      return result;
    }

    // Check impact score
    if (opportunity.estimatedImpact > config.maxImpactScore) {
      result.reason = `Impact score ${opportunity.estimatedImpact} exceeds threshold ${config.maxImpactScore}`;
      result.requiresApproval = true;
      return result;
    }

    // Check specific type permissions
    switch (opportunity.type) {
      case 'refactoring':
      case 'complexity':
      case 'duplication':
        if (!config.allowAutoRefactor) {
          result.reason = 'Auto-refactoring not allowed at this permission level';
          result.requiresApproval = true;
          return result;
        }
        break;

      case 'test_coverage':
        if (!config.allowTestUpdates) {
          result.reason = 'Test updates not allowed at this permission level';
          result.requiresApproval = true;
          return result;
        }
        break;

      case 'dependency_update':
        if (!config.allowDependencyUpdates) {
          result.reason = 'Dependency updates not allowed at this permission level';
          result.requiresApproval = true;
          return result;
        }
        break;

      case 'documentation':
        if (!config.allowDocUpdates) {
          result.reason = 'Documentation updates not allowed at this permission level';
          return result;
        }
        break;

      case 'security':
      case 'performance':
        result.requiresApproval = true;
        if (opportunity.estimatedImpact > 0.3) {
          result.reason = `${opportunity.type} changes require approval`;
          return result;
        }
        break;
    }

    // Check if opportunity can be auto-applied
    if (!opportunity.canAutoApply && opportunity.estimatedImpact > 0.2) {
      result.reason = 'Opportunity cannot be auto-applied and exceeds safe threshold';
      result.requiresApproval = true;
      return result;
    }

    result.allowed = true;
    return result;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Prioritize opportunities for autonomous processing
   */
  private prioritizeOpportunities(
    opportunities: ImprovementOpportunity[],
    config: QualityGateConfig
  ): ImprovementOpportunity[] {
    // Filter out opportunities that are too high impact for the permission level
    const filtered = opportunities.filter(o => o.estimatedImpact <= config.maxImpactScore);

    // Sort by: (impact / effort) ratio, then priority, then detection date
    return filtered.sort((a, b) => {
      const aScore = a.estimatedImpact / (a.estimatedEffort || 1);
      const bScore = b.estimatedImpact / (b.estimatedEffort || 1);

      if (Math.abs(aScore - bScore) > 0.01) {
        return bScore - aScore; // Higher score first
      }

      // Then by priority
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const aPriority = priorityOrder[a.priority] ?? 2;
      const bPriority = priorityOrder[b.priority] ?? 2;

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Finally by detection date (older first)
      return a.detectedAt - b.detectedAt;
    });
  }

  /**
   * Map opportunity type to night work task type
   */
  private mapOpportunityToTaskType(opportunity: ImprovementOpportunity): NightWorkTaskType {
    const typeMap: Record<string, NightWorkTaskType> = {
      refactoring: 'refactoring',
      complexity: 'refactoring',
      duplication: 'refactoring',
      test_coverage: 'test_fix',
      dependency_update: 'dependency_update',
      documentation: 'documentation',
      performance: 'custom',
      security: 'custom',
    };

    return typeMap[opportunity.type] || 'custom';
  }

  /**
   * Map opportunity priority to task priority
   */
  private mapPriority(priority: string): 'urgent' | 'high' | 'medium' | 'low' {
    if (priority === 'critical') return 'urgent';
    if (priority === 'high') return 'high';
    if (priority === 'low') return 'low';
    return 'medium';
  }

  /**
   * Get user's default project path
   */
  private getUserProjectPath(_chatId: number): string | null {
    try {
      const identityManager = getIdentityManager();

      // Get the autonomous preferences
      const autonomousPrefs = identityManager.getAutonomousPreferences();

      // Return the default project path if set
      return autonomousPrefs?.defaultProjectPath || null;
    } catch (error) {
      console.error(`Error getting user project path for chat ${_chatId}:`, error);
      return null;
    }
  }

  /**
   * Get user's permission level for autonomous mode
   */
  private async getUserPermissionLevel(_chatId: number): Promise<QualityGateLevel> {
    try {
      const identityManager = getIdentityManager();

      // Get the permission level from preferences
      const permissionLevel = identityManager.getPermissionLevel();

      // Ensure it's a valid quality gate level
      const validLevels: QualityGateLevel[] = ['read_only', 'advisory', 'supervised', 'autonomous', 'full'];
      if (validLevels.includes(permissionLevel as QualityGateLevel)) {
        return permissionLevel as QualityGateLevel;
      }

      // Default to supervised if invalid
      return 'supervised';
    } catch (error) {
      console.error(`Error getting user permission level for chat ${_chatId}:`, error);
      return 'supervised';
    }
  }
}

// ============================================
// Singleton
// ============================================

let schedulerInstance: ProactiveImprovementScheduler | null = null;

/**
 * Get the proactive improvement scheduler singleton
 */
export function getProactiveImprovementScheduler(): ProactiveImprovementScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new ProactiveImprovementScheduler();
  }
  return schedulerInstance;
}

/**
 * Reset the scheduler (mainly for testing)
 */
export function resetProactiveImprovementScheduler(): void {
  schedulerInstance = null;
}
