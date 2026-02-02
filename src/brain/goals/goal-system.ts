/**
 * Goal System - Manages user-defined objectives with progress tracking
 *
 * The Goal System allows users to define high-level objectives that
 * the AI assistant can work toward. Goals can be:
 * - Quality targets (test coverage, complexity reduction)
 * - Feature implementation (add specific features)
 * - Maintenance tasks (reduce tech debt, update dependencies)
 * - Learning goals (understand codebase, document patterns)
 *
 * Each goal has:
 * - Target metrics with current/target values
 * - Strategy (autonomous, supervised, manual)
 * - Permissions (what actions can be taken)
 * - Progress tracking
 * - Associated tasks
 */

import { getMemoryStore } from '../memory/memory-store.js';
import type { IntentionType } from '../intention/intention-engine.js';

// ===========================================
// Types
// ===========================================

/**
 * Goal type
 */
export type GoalType = 'quality' | 'feature' | 'maintenance' | 'learning';

/**
 * Goal status
 */
export type GoalStatus = 'active' | 'paused' | 'completed' | 'blocked';

/**
 * Goal strategy - how should the AI work on this goal
 */
export type GoalStrategy = 'autonomous' | 'supervised' | 'manual';

/**
 * Target metric for a goal
 */
export interface GoalTarget {
  metric: string;             // e.g., 'test_coverage', 'complexity', 'open_issues'
  current: number;            // Current value
  target: number;             // Target value
  unit?: string;              // e.g., '%', 'files', 'issues'
  deadline?: number;          // Timestamp for target completion
}

/**
 * Permissions for autonomous actions on a goal
 */
export interface GoalPermissions {
  canCreateTasks: boolean;    // Can AI create tasks for this goal
  canExecuteWithoutApproval: boolean;  // Can AI execute without asking
  canRefactorCode: boolean;    // Can AI make code changes
  canAddDependencies: boolean; // Can AI add/update dependencies
  canModifyTests: boolean;     // Can AI modify test files
}

/**
 * A goal - a high-level objective
 */
export interface Goal {
  id: string;
  type: GoalType;
  status: GoalStatus;
  title: string;
  description: string;
  projectPath: string;
  chatId: number;              // Which user owns this goal

  // Target
  target: GoalTarget;

  // Strategy
  strategy: GoalStrategy;
  permissions: GoalPermissions;

  // Progress
  progress: number;            // 0-100
  tasks: string[];             // Task IDs created for this goal
  completedTasks: string[];
  blockedBy?: string[];        // Goal IDs that block this goal

  // Metadata
  createdBy: 'user' | 'system';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  notes?: string;
}

/**
 * Task created from a goal
 */
export interface GoalTask {
  id: string;
  goalId: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  intentionType: IntentionType;
  estimatedDuration: number;    // milliseconds
  createdAt: number;
  completedAt?: number;
  result?: string;
}

/**
 * Goal progress summary
 */
export interface GoalProgress {
  goalId: string;
  title: string;
  progress: number;
  status: GoalStatus;
  target: GoalTarget;
  tasksCompleted: number;
  tasksTotal: number;
  timeRemaining: number;        // milliseconds until deadline
  onTrack: boolean;
}

// ===========================================
// Configuration
// ===========================================

const GOAL_CONFIG = {
  // Default permissions by strategy
  defaultPermissions: {
    autonomous: {
      canCreateTasks: true,
      canExecuteWithoutApproval: true,
      canRefactorCode: true,
      canAddDependencies: false,  // Still ask for dependencies
      canModifyTests: true,
    } as GoalPermissions,
    supervised: {
      canCreateTasks: true,
      canExecuteWithoutApproval: false,
      canRefactorCode: true,
      canAddDependencies: false,
      canModifyTests: true,
    } as GoalPermissions,
    manual: {
      canCreateTasks: false,
      canExecuteWithoutApproval: false,
      canRefactorCode: false,
      canAddDependencies: false,
      canModifyTests: false,
    } as GoalPermissions,
  },

  // Progress calculation weights
  progressWeights: {
    metricProgress: 0.6,  // Progress toward target metric
    tasksCompleted: 0.4,  // Percentage of tasks completed
  },
};

// ===========================================
// Goal System Class
// ===========================================

export class GoalSystem {
  private memory = getMemoryStore();
  private goals = new Map<string, Goal>();

  /**
   * Create a new goal
   */
  async createGoal(
    chatId: number,
    projectPath: string,
    params: {
      type: GoalType;
      title: string;
      description: string;
      target: GoalTarget;
      strategy?: GoalStrategy;
      permissions?: Partial<GoalPermissions>;
      notes?: string;
    }
  ): Promise<Goal> {
    const strategy = params.strategy || 'supervised';
    const permissions: GoalPermissions = {
      ...GOAL_CONFIG.defaultPermissions[strategy],
      ...params.permissions,
    };

    const goal: Goal = {
      id: this.generateId(),
      type: params.type,
      status: 'active',
      title: params.title,
      description: params.description,
      projectPath,
      chatId,
      target: params.target,
      strategy,
      permissions,
      progress: 0,
      tasks: [],
      completedTasks: [],
      createdBy: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      notes: params.notes,
    };

    // Calculate initial progress
    goal.progress = this.calculateProgress(goal);

    // Store goal
    this.goals.set(goal.id, goal);
    await this.storeGoal(goal);

    return goal;
  }

  /**
   * Get goal by ID
   */
  getGoal(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  /**
   * Get goals by filter
   */
  getGoals(filter: {
    chatId?: number;
    projectPath?: string;
    type?: GoalType;
    status?: GoalStatus;
    strategy?: GoalStrategy;
  } = {}): Goal[] {
    let results = Array.from(this.goals.values());

    if (filter.chatId !== undefined) {
      results = results.filter(g => g.chatId === filter.chatId);
    }

    if (filter.projectPath) {
      results = results.filter(g => g.projectPath === filter.projectPath);
    }

    if (filter.type) {
      results = results.filter(g => g.type === filter.type);
    }

    if (filter.status) {
      results = results.filter(g => g.status === filter.status);
    }

    if (filter.strategy) {
      results = results.filter(g => g.strategy === filter.strategy);
    }

    // Sort by updated time (most recent first)
    results.sort((a, b) => b.updatedAt - a.updatedAt);

    return results;
  }

  /**
   * Update goal
   */
  async updateGoal(
    goalId: string,
    updates: Partial<Omit<Goal, 'id' | 'createdAt' | 'chatId' | 'projectPath' | 'tasks'>>
  ): Promise<Goal | null> {
    const goal = this.goals.get(goalId);
    if (!goal) return null;

    // Apply updates
    const updated: Goal = {
      ...goal,
      ...updates,
      // Don't allow changing certain fields
      id: goal.id,
      createdAt: goal.createdAt,
      chatId: goal.chatId,
      projectPath: goal.projectPath,
      tasks: goal.tasks, // Keep tasks array reference
    };

    updated.updatedAt = Date.now();
    updated.progress = this.calculateProgress(updated);

    // Check if goal should be marked completed
    if (updated.progress >= 100 && updated.status !== 'completed') {
      updated.status = 'completed';
      updated.completedAt = Date.now();
    }

    this.goals.set(goalId, updated);
    await this.storeGoal(updated);

    return updated;
  }

  /**
   * Pause a goal
   */
  async pauseGoal(goalId: string): Promise<boolean> {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status === 'completed') return false;

    goal.status = 'paused';
    goal.updatedAt = Date.now();
    await this.storeGoal(goal);

    return true;
  }

  /**
   * Resume a paused goal
   */
  async resumeGoal(goalId: string): Promise<boolean> {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status !== 'paused') return false;

    goal.status = 'active';
    goal.updatedAt = Date.now();
    await this.storeGoal(goal);

    return true;
  }

  /**
   * Complete a goal
   */
  async completeGoal(goalId: string): Promise<boolean> {
    const goal = this.goals.get(goalId);
    if (!goal) return false;

    goal.status = 'completed';
    goal.progress = 100;
    goal.completedAt = Date.now();
    goal.updatedAt = Date.now();
    await this.storeGoal(goal);

    return true;
  }

  /**
   * Delete a goal
   */
  async deleteGoal(goalId: string): Promise<boolean> {
    const goal = this.goals.get(goalId);
    if (!goal) return false;

    this.goals.delete(goalId);
    await this.memory.setFact(`goal:${goalId}`, null);

    return true;
  }

  /**
   * Calculate progress for a goal
   */
  private calculateProgress(goal: Goal): number {
    // Metric progress (0-100)
    const metricProgress = this.calculateMetricProgress(goal.target);

    // Task completion progress (0-100)
    let taskProgress = 0;
    if (goal.tasks.length > 0) {
      taskProgress = (goal.completedTasks.length / goal.tasks.length) * 100;
    }

    // Weighted average
    const totalProgress =
      metricProgress * GOAL_CONFIG.progressWeights.metricProgress +
      taskProgress * GOAL_CONFIG.progressWeights.tasksCompleted;

    return Math.min(Math.round(totalProgress), 100);
  }

  /**
   * Calculate metric progress
   */
  private calculateMetricProgress(target: GoalTarget): number {
    // If already at or past target
    if (target.current >= target.target) {
      return 100;
    }

    // Calculate percentage of progress made from a baseline
    // We assume baseline is 0 or the opposite of target
    const baseline = target.target > 0 ? 0 : target.target * 2;
    const currentProgress = ((target.current - baseline) / (target.target - baseline)) * 100;

    return Math.max(0, Math.min(100, currentProgress));
  }

  /**
   * Update target metric value
   */
  async updateTarget(
    goalId: string,
    currentValue: number
  ): Promise<Goal | null> {
    const goal = this.goals.get(goalId);
    if (!goal) return null;

    goal.target.current = currentValue;
    goal.progress = this.calculateProgress(goal);
    goal.updatedAt = Date.now();

    // Check if goal should be completed
    if (goal.progress >= 100 && goal.status === 'active') {
      goal.status = 'completed';
      goal.completedAt = Date.now();
    }

    await this.storeGoal(goal);

    return goal;
  }

  /**
   * Add a task to a goal
   */
  async addTask(
    goalId: string,
    taskId: string
  ): Promise<boolean> {
    const goal = this.goals.get(goalId);
    if (!goal) return false;

    if (!goal.tasks.includes(taskId)) {
      goal.tasks.push(taskId);
      goal.progress = this.calculateProgress(goal);
      goal.updatedAt = Date.now();
      await this.storeGoal(goal);
    }

    return true;
  }

  /**
   * Mark a task as completed for a goal
   */
  async completeTask(
    goalId: string,
    taskId: string
  ): Promise<boolean> {
    const goal = this.goals.get(goalId);
    if (!goal) return false;

    if (!goal.completedTasks.includes(taskId)) {
      goal.completedTasks.push(taskId);
      goal.progress = this.calculateProgress(goal);
      goal.updatedAt = Date.now();

      // Check if goal should be completed
      if (goal.completedTasks.length === goal.tasks.length && goal.tasks.length > 0) {
        goal.status = 'completed';
        goal.completedAt = Date.now();
      }

      await this.storeGoal(goal);
    }

    return true;
  }

  /**
   * Get progress summary for a goal
   */
  getProgress(goalId: string): GoalProgress | null {
    const goal = this.goals.get(goalId);
    if (!goal) return null;

    const timeRemaining = goal.target.deadline
      ? Math.max(0, goal.target.deadline - Date.now())
      : 0;

    const onTrack = goal.status === 'completed' ||
      (goal.status === 'active' && goal.progress > 0);

    return {
      goalId: goal.id,
      title: goal.title,
      progress: goal.progress,
      status: goal.status,
      target: goal.target,
      tasksCompleted: goal.completedTasks.length,
      tasksTotal: goal.tasks.length,
      timeRemaining,
      onTrack,
    };
  }

  /**
   * Get all progress summaries for a user
   */
  getAllProgress(chatId: number): GoalProgress[] {
    const goals = this.getGoals({ chatId });
    return goals
      .map(g => this.getProgress(g.id))
      .filter((p): p is GoalProgress => p !== null);
  }

  /**
   * Find goals that need attention
   */
  getGoalsNeedingAttention(chatId: number): Array<{
    goal: Goal;
    reason: string;
  }> {
    const goals = this.getGoals({ chatId, status: 'active' });
    const needing: Array<{ goal: Goal; reason: string }> = [];

    for (const goal of goals) {
      // Check if deadline approaching
      if (goal.target.deadline) {
        const timeUntilDeadline = goal.target.deadline - Date.now();
        const daysUntilDeadline = timeUntilDeadline / (24 * 60 * 60 * 1000);

        if (daysUntilDeadline < 0) {
          needing.push({
            goal,
            reason: `Deadline exceeded by ${Math.abs(Math.round(daysUntilDeadline))} days`,
          });
        } else if (daysUntilDeadline < 3 && goal.progress < 80) {
          needing.push({
            goal,
            reason: `Deadline approaching in ${Math.round(daysUntilDeadline)} days, only ${goal.progress}% complete`,
          });
        }
      }

      // Check if no progress
      if (goal.progress === 0 && goal.tasks.length === 0) {
        const timeSinceCreation = Date.now() - goal.createdAt;
        const daysSinceCreation = timeSinceCreation / (24 * 60 * 60 * 1000);

        if (daysSinceCreation > 7) {
          needing.push({
            goal,
            reason: 'No progress after 1 week',
          });
        }
      }

      // Check if blocked
      if (goal.blockedBy && goal.blockedBy.length > 0) {
        needing.push({
          goal,
          reason: `Blocked by ${goal.blockedBy.length} other goal(s)`,
        });
      }
    }

    return needing;
  }

  /**
   * Generate intentions from active goals
   */
  async generateIntentions(projectPath: string, chatId: number): Promise<Array<{
    goal: Goal;
    intentionType: IntentionType;
    description: string;
    priority: number;
  }>> {
    const goals = this.getGoals({
      chatId,
      projectPath,
      status: 'active',
      strategy: 'autonomous',
    });

    const intentions: Array<{
      goal: Goal;
      intentionType: IntentionType;
      description: string;
      priority: number;
    }> = [];

    for (const goal of goals) {
      // Skip if permission is denied
      if (!goal.permissions.canCreateTasks) continue;

      // Generate intention based on goal type and target
      const intention = this.goalToIntention(goal);
      if (intention) {
        intentions.push(intention);
      }
    }

    // Sort by priority
    intentions.sort((a, b) => b.priority - a.priority);

    return intentions;
  }

  /**
   * Convert a goal to an intention
   */
  private goalToIntention(goal: Goal): {
    goal: Goal;
    intentionType: IntentionType;
    description: string;
    priority: number;
  } | null {
    const { target, type } = goal;
    const progress = this.calculateMetricProgress(target);

    // If close to target, lower priority
    const priority = 100 - progress;

    switch (type) {
      case 'quality':
        if (target.metric === 'test_coverage') {
          return {
            goal,
            intentionType: 'test' as IntentionType,
            description: `Add tests to increase coverage from ${target.current}% to ${target.target}%`,
            priority,
          };
        } else if (target.metric === 'complexity') {
          return {
            goal,
            intentionType: 'refactor' as IntentionType,
            description: `Reduce complexity from ${target.current} to ${target.target}`,
            priority,
          };
        }
        break;

      case 'feature':
        return {
          goal,
          intentionType: 'implement' as IntentionType,
          description: goal.description,
          priority: priority + 20, // Feature goals get higher priority
        };

      case 'maintenance':
        if (target.metric === 'open_issues') {
          return {
            goal,
            intentionType: 'fix' as IntentionType,
            description: `Address open issues (reduce from ${target.current} to ${target.target})`,
            priority,
          };
        } else if (target.metric === 'outdated_dependencies') {
          return {
            goal,
            intentionType: 'update' as IntentionType,
            description: `Update outdated dependencies`,
            priority: priority + 10,
          };
        }
        break;

      case 'learning':
        return {
          goal,
          intentionType: 'analyze' as IntentionType,
          description: `Analyze codebase: ${goal.title}`,
          priority: priority - 10, // Lower priority for learning
        };
    }

    return null;
  }

  /**
   * Store goal in memory
   */
  private async storeGoal(goal: Goal): Promise<void> {
    try {
      await this.memory.setFact(`goal:${goal.id}`, goal);
      await this.memory.setFact(`goal:user:${goal.chatId}:active`, goal.id);
    } catch (error) {
      console.error('[GoalSystem] Failed to store goal:', error);
    }
  }

  /**
   * Load goals for a user
   */
  async loadGoals(chatId: number): Promise<number> {
    try {
      const fact = await this.memory.getFact(`goal:user:${chatId}:active`) as string | undefined;
      if (fact) {
        const goal = await this.memory.getFact(`goal:${fact}`) as Goal | undefined;
        if (goal) {
          this.goals.set(goal.id, goal);
          return 1;
        }
      }
    } catch {
      // Error loading
    }
    return 0;
  }

  /**
   * Get statistics
   */
  getStats(chatId?: number): {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    avgProgress: number;
    completedThisWeek: number;
  } {
    let goals = Array.from(this.goals.values());

    if (chatId !== undefined) {
      goals = goals.filter(g => g.chatId === chatId);
    }

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalProgress = 0;
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let completedThisWeek = 0;

    for (const goal of goals) {
      byStatus[goal.status] = (byStatus[goal.status] || 0) + 1;
      byType[goal.type] = (byType[goal.type] || 0) + 1;
      totalProgress += goal.progress;

      if (goal.completedAt && goal.completedAt > oneWeekAgo) {
        completedThisWeek++;
      }
    }

    return {
      total: goals.length,
      byStatus,
      byType,
      avgProgress: goals.length > 0 ? totalProgress / goals.length : 0,
      completedThisWeek,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `goal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ===========================================
// Global Singleton
// ===========================================

let globalGoalSystem: GoalSystem | null = null;

export function getGoalSystem(): GoalSystem {
  if (!globalGoalSystem) {
    globalGoalSystem = new GoalSystem();
  }
  return globalGoalSystem;
}

export function resetGoalSystem(): void {
  globalGoalSystem = null;
}
