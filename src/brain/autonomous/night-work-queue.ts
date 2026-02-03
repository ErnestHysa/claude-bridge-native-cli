/**
 * Night Work Queue
 *
 * Sources, prioritizes, and queues tasks for autonomous execution during inactive hours.
 *
 * Task Sources:
 * - Goals: Active goals from the goal system
 * - Intentions: Pending intentions from the intention engine
 * - Opportunities: Detected improvement opportunities
 * - Pending Work: Unfinished tasks from previous sessions
 * - Proactive Checks: Scheduled self-improvement checks
 *
 * Priority Levels:
 * - urgent: Critical bugs, security issues, deployment failures
 * - high: Important goals, approaching deadlines
 * - medium: Regular work, improvements
 * - low: Nice-to-have features, exploration
 */

import { getMemoryStore } from '../memory/memory-store.js';
import { getGoalSystem } from '../goals/goal-system.js';
import type { TaskPriority } from '../types.js';
import type { Goal } from '../goals/goal-system.js';

// ===========================================
// Night Work Task
// ===========================================

export interface NightWorkTask {
  id: string;
  type: NightWorkTaskType;
  priority: TaskPriority;
  title: string;
  description: string;
  source: NightWorkTaskSource;
  sourceId: string; // ID of the source entity (goal, intention, etc.)
  chatId: number;
  createdAt: number;
  scheduledFor?: number; // When to execute the task
  deadlineAt?: number; // Hard deadline for completion
  estimatedDuration?: number; // Estimated duration in milliseconds
  requiredPermission: 'read_only' | 'advisory' | 'supervised' | 'autonomous' | 'full';
  context: {
    projectId?: string;
    metadata?: Record<string, unknown>;
  };
  status: NightWorkTaskStatus;
  result?: NightWorkTaskResult;
  retryCount: number;
  maxRetries: number;
  dependencies?: string[]; // IDs of tasks that must complete first
}

export type NightWorkTaskType =
  | 'goal_task'
  | 'intention_fulfillment'
  | 'opportunity_improvement'
  | 'proactive_check'
  | 'documentation'
  | 'test_fix'
  | 'dependency_update'
  | 'refactoring'
  | 'code_review'
  | 'deployment'
  | 'custom';

export type NightWorkTaskSource =
  | 'goal'
  | 'intention'
  | 'opportunity'
  | 'pending_session'
  | 'heartbeat'
  | 'manual'
  | 'scheduler';

export type NightWorkTaskStatus =
  | 'pending'
  | 'scheduled'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface NightWorkTaskResult {
  success: boolean;
  output?: string;
  error?: string;
  completedAt: number;
  duration: number;
}

// ===========================================
// Queue State
// ===========================================

interface NightWorkQueueState {
  tasks: Map<string, NightWorkTask>;
  isProcessing: boolean;
  lastSyncAt: number;
  lastExecutionAt: number;
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalExecutionTime: number;
  };
}

// ===========================================
// Night Work Queue
// ===========================================

export class NightWorkQueue {
  private memory = getMemoryStore();
  private state: NightWorkQueueState = {
    tasks: new Map(),
    isProcessing: false,
    lastSyncAt: 0,
    lastExecutionAt: 0,
    stats: {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalExecutionTime: 0,
    },
  };
  private syncIntervalMs = 5 * 60 * 1000; // Sync every 5 minutes
  private syncTimer?: NodeJS.Timeout;

  /**
   * Initialize the queue
   */
  async initialize(): Promise<void> {
    // Load persisted state
    await this.loadState();

    // Start periodic sync
    this.scheduleSync();
  }

  /**
   * Stop the queue
   */
  async stop(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  /**
   * Sync tasks from all sources
   */
  async syncTasks(chatId?: number): Promise<number> {
    this.state.lastSyncAt = Date.now();
    let addedCount = 0;

    // Sync from goals
    addedCount += await this.syncFromGoals(chatId);

    // Sync from intentions
    addedCount += await this.syncFromIntentions(chatId);

    // Sync from opportunities
    addedCount += await this.syncFromOpportunities(chatId);

    // Sync from pending sessions
    addedCount += await this.syncFromPendingSessions(chatId);

    await this.saveState();
    return addedCount;
  }

  /**
   * Get next task to execute for a user
   */
  async getNextTask(chatId: number, permissionLevel: string): Promise<NightWorkTask | null> {
    const now = Date.now();
    const userTasks = Array.from(this.state.tasks.values())
      .filter(t => t.chatId === chatId);

    // Filter tasks that are ready to run
    const readyTasks = userTasks.filter(t => {
      // Check status
      if (t.status !== 'ready' && t.status !== 'pending') return false;

      // Check if scheduled time has passed
      if (t.scheduledFor && t.scheduledFor > now) return false;

      // Check dependencies
      if (t.dependencies && t.dependencies.length > 0) {
        for (const depId of t.dependencies) {
          const dep = this.state.tasks.get(depId);
          if (!dep || dep.status !== 'completed') return false;
        }
      }

      // Check permission requirements
      const requiredLevel = this.getPermissionLevelOrder(t.requiredPermission);
      const currentLevel = this.getPermissionLevelOrder(permissionLevel as any);
      if (requiredLevel > currentLevel) return false;

      return true;
    });

    if (readyTasks.length === 0) return null;

    // Sort by priority and deadline
    readyTasks.sort((a, b) => {
      // First sort by priority
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Then by deadline (earlier deadline first)
      if (a.deadlineAt && b.deadlineAt) {
        return a.deadlineAt - b.deadlineAt;
      }
      if (a.deadlineAt) return -1;
      if (b.deadlineAt) return 1;

      // Finally by creation time (older first)
      return a.createdAt - b.createdAt;
    });

    return readyTasks[0] || null;
  }

  /**
   * Get all tasks for a user
   */
  getUserTasks(chatId: number): NightWorkTask[] {
    return Array.from(this.state.tasks.values())
      .filter(t => t.chatId === chatId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: NightWorkTaskStatus): NightWorkTask[] {
    return Array.from(this.state.tasks.values())
      .filter(t => t.status === status);
  }

  /**
   * Add a task manually
   */
  async addTask(task: Omit<NightWorkTask, 'id' | 'createdAt' | 'retryCount' | 'status'>): Promise<NightWorkTask> {
    const newTask: NightWorkTask = {
      ...task,
      id: this.generateTaskId(),
      createdAt: Date.now(),
      retryCount: 0,
      status: 'pending',
    };

    this.state.tasks.set(newTask.id, newTask);
    this.state.stats.totalTasks++;
    await this.saveState();

    return newTask;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    taskId: string,
    status: NightWorkTaskStatus,
    result?: NightWorkTaskResult
  ): Promise<void> {
    const task = this.state.tasks.get(taskId);
    if (!task) return;

    task.status = status;
    if (result) {
      task.result = result;
    }

    // Update stats
    if (status === 'completed') {
      this.state.stats.completedTasks++;
      if (result) {
        this.state.stats.totalExecutionTime += result.duration;
      }
    } else if (status === 'failed') {
      this.state.stats.failedTasks++;
    }

    // Update dependent tasks
    if (status === 'completed' || status === 'failed') {
      await this.updateDependentTasks(taskId);
    }

    await this.saveState();
  }

  /**
   * Mark a task as running
   */
  async markTaskRunning(taskId: string): Promise<void> {
    const task = this.state.tasks.get(taskId);
    if (!task) return;

    task.status = 'running';
    await this.saveState();
  }

  /**
   * Retry a failed task
   */
  async retryTask(taskId: string): Promise<boolean> {
    const task = this.state.tasks.get(taskId);
    if (!task || task.status !== 'failed') return false;

    if (task.retryCount >= task.maxRetries) return false;

    task.status = 'pending';
    task.retryCount++;
    await this.saveState();

    return true;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.state.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'running' || task.status === 'completed') return false;

    task.status = 'cancelled';
    await this.saveState();

    return true;
  }

  /**
   * Get queue statistics
   */
  getStats(): NightWorkQueueState['stats'] {
    return { ...this.state.stats };
  }

  /**
   * Get a summary of tasks for a user
   */
  getUserTaskSummary(chatId: number): {
    pending: number;
    scheduled: number;
    ready: number;
    running: number;
    completed: number;
    failed: number;
    total: number;
  } {
    const tasks = this.getUserTasks(chatId);

    return {
      pending: tasks.filter(t => t.status === 'pending').length,
      scheduled: tasks.filter(t => t.status === 'scheduled').length,
      ready: tasks.filter(t => t.status === 'ready').length,
      running: tasks.filter(t => t.status === 'running').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      total: tasks.length,
    };
  }

  // ===========================================
  // Task Source Sync Methods
  // ===========================================

  /**
   * Sync tasks from goals
   * Creates night work tasks for active goals that need work
   */
  private async syncFromGoals(chatId?: number): Promise<number> {
    try {
      const goalSystem = getGoalSystem();

      // Get active goals that have autonomous strategy
      const allGoals = await goalSystem.getActiveGoals();

      let addedCount = 0;

      for (const goal of allGoals) {
        // Filter by chatId if specified
        if (chatId && goal.chatId !== chatId) continue;

        // Skip if goal is not in active status
        if (goal.status !== 'active') continue;

        // Skip if goal doesn't allow autonomous task creation
        if (!goal.permissions.canCreateTasks) continue;

        // Skip if goal is manual strategy
        if (goal.strategy === 'manual') continue;

        // Check if a task for this goal already exists in queue
        const existingTasks = Array.from(this.state.tasks.values())
          .filter(t => t.source === 'goal' && t.sourceId === goal.id);

        // Find tasks that are pending, scheduled, ready, or running
        const hasActiveTask = existingTasks.some(t =>
          ['pending', 'scheduled', 'ready', 'running'].includes(t.status)
        );

        if (hasActiveTask) continue;

        // Create a new night work task for this goal
        // Determine priority based on goal target deadline
        const priority = this.calculateGoalPriority(goal);

        // Create the task
        const task: Omit<NightWorkTask, 'id' | 'createdAt' | 'retryCount' | 'status'> = {
          type: 'goal_task',
          priority,
          title: `Work on goal: ${goal.title}`,
          description: goal.description,
          source: 'goal',
          sourceId: goal.id,
          chatId: goal.chatId,
          requiredPermission: goal.strategy === 'autonomous'
            ? 'autonomous'
            : 'supervised',
          context: {
            projectId: goal.projectPath,
            metadata: {
              goalType: goal.type,
              goalProgress: goal.progress,
              targetMetric: goal.target.metric,
              currentTarget: goal.target.current,
              targetValue: goal.target.target,
            },
          },
          maxRetries: 2,
          deadlineAt: goal.target.deadline,
          estimatedDuration: 30 * 60 * 1000, // 30 minutes default
        };

        await this.addTask(task);
        addedCount++;
      }

      return addedCount;
    } catch (error) {
      console.error('Error syncing from goals:', error);
      return 0;
    }
  }

  /**
   * Calculate task priority based on goal properties
   */
  private calculateGoalPriority(goal: Goal): 'urgent' | 'high' | 'medium' | 'low' {
    // Check if deadline is approaching (within 24 hours)
    if (goal.target.deadline) {
      const hoursUntilDeadline = (goal.target.deadline - Date.now()) / (60 * 60 * 1000);
      if (hoursUntilDeadline < 24) return 'urgent';
      if (hoursUntilDeadline < 72) return 'high';
    }

    // Check progress - goals with low progress might need attention
    if (goal.progress < 25) return 'high';

    // Default to medium
    return 'medium';
  }

  /**
   * Sync tasks from intentions
   * TODO: Implement full integration with intention engine
   */
  private async syncFromIntentions(_chatId?: number): Promise<number> {
    // Stub - will be implemented when intention engine integration is ready
    return 0;
  }

  /**
   * Sync tasks from opportunities
   * TODO: Implement full integration with opportunity detector
   */
  private async syncFromOpportunities(_chatId?: number): Promise<number> {
    // Stub - will be implemented when opportunity detector integration is ready
    return 0;
  }

  /**
   * Sync tasks from pending sessions (continuation tasks)
   */
  private async syncFromPendingSessions(chatId?: number): Promise<number> {
    try {
      // Get pending tasks from memory
      const pendingTasks = await this.memory.getFact('pending_session_tasks') as Array<{
        id: string;
        chatId: number;
        title: string;
        description: string;
        projectId?: string;
      }> | undefined;

      if (!pendingTasks || pendingTasks.length === 0) return 0;

      let addedCount = 0;

      for (const pending of pendingTasks) {
        // Filter by chatId if specified
        if (chatId && pending.chatId !== chatId) continue;

        // Check if task already exists in queue
        if (this.state.tasks.has(pending.id)) continue;

        // Create night work task
        const task: NightWorkTask = {
          id: pending.id,
          type: 'custom',
          priority: 'medium',
          title: pending.title,
          description: pending.description,
          source: 'pending_session',
          sourceId: pending.id,
          chatId: pending.chatId,
          createdAt: Date.now(),
          requiredPermission: 'autonomous',
          context: {
            projectId: pending.projectId,
          },
          status: 'ready',
          retryCount: 0,
          maxRetries: 2,
        };

        this.state.tasks.set(task.id, task);
        addedCount++;
      }

      return addedCount;
    } catch {
      return 0;
    }
  }

  // ===========================================
  // Internal Methods
  // ===========================================

  /**
   * Schedule the next sync
   */
  private scheduleSync(): void {
    this.syncTimer = setTimeout(async () => {
      await this.syncTasks();
      this.scheduleSync();
    }, this.syncIntervalMs);
  }

  /**
   * Update tasks that depend on a completed task
   */
  private async updateDependentTasks(completedTaskId: string): Promise<void> {
    for (const task of this.state.tasks.values()) {
      if (task.dependencies && task.dependencies.includes(completedTaskId)) {
        // Check if all dependencies are now met
        const allDepsComplete = task.dependencies.every(depId => {
          const dep = this.state.tasks.get(depId);
          return dep && dep.status === 'completed';
        });

        if (allDepsComplete && task.status === 'blocked') {
          task.status = 'ready';
        }
      }
    }
  }

  /**
   * Get permission level as numeric order for comparison
   */
  private getPermissionLevelOrder(level: string): number {
    const levels = ['read_only', 'advisory', 'supervised', 'autonomous', 'full'];
    return levels.indexOf(level);
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    return `nightwork:${Date.now()}:${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Save state to memory
   */
  private async saveState(): Promise<void> {
    await this.memory.setFact('nightworkqueue:state', {
      tasks: Array.from(this.state.tasks.entries()),
      isProcessing: this.state.isProcessing,
      lastSyncAt: this.state.lastSyncAt,
      lastExecutionAt: this.state.lastExecutionAt,
      stats: this.state.stats,
    });
  }

  /**
   * Load state from memory
   */
  private async loadState(): Promise<void> {
    try {
      const stored = await this.memory.getFact('nightworkqueue:state') as {
        tasks: Array<[string, NightWorkTask]>;
        isProcessing: boolean;
        lastSyncAt: number;
        lastExecutionAt: number;
        stats: NightWorkQueueState['stats'];
      } | undefined;

      if (stored) {
        this.state.tasks = new Map(stored.tasks);
        this.state.isProcessing = stored.isProcessing;
        this.state.lastSyncAt = stored.lastSyncAt;
        this.state.lastExecutionAt = stored.lastExecutionAt;
        this.state.stats = stored.stats;
      }
    } catch {
      // Start fresh if load fails
    }
  }
}

// ===========================================
// Singleton
// ===========================================

let queueInstance: NightWorkQueue | null = null;

/**
 * Get the night work queue singleton
 */
export function getNightWorkQueue(): NightWorkQueue {
  if (!queueInstance) {
    queueInstance = new NightWorkQueue();
  }
  return queueInstance;
}

/**
 * Reset the queue (mainly for testing)
 */
export function resetNightWorkQueue(): void {
  if (queueInstance) {
    void queueInstance.stop();
  }
  queueInstance = null;
}
