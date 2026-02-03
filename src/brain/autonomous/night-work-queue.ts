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
import { getIntentionEngine } from '../intention/intention-engine.js';
import { getOpportunityDetector } from '../opportunity/opportunity-detector.js';
import type { TaskPriority } from '../types.js';
import type { Goal } from '../goals/goal-system.js';
import type { Intention, IntentionFilter } from '../intention/intention-engine.js';
import type { ImprovementOpportunity } from '../opportunity/opportunity-detector.js';

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
   * Creates night work tasks for high-confidence pending intentions
   */
  private async syncFromIntentions(chatId?: number): Promise<number> {
    try {
      const intentionEngine = getIntentionEngine();

      // Create filter for active, high-confidence intentions
      const filter: IntentionFilter = {
        minConfidence: 0.6,
        active: true,
      };

      if (chatId) {
        filter.chatId = chatId;
      }

      // Get matching intentions
      const intentions = await intentionEngine.queryIntentions(filter);

      let addedCount = 0;

      for (const intention of intentions) {
        // Filter by chatId if specified
        if (chatId && intention.chatId !== chatId) continue;

        // Skip expired intentions
        if (intention.expiresAt && intention.expiresAt < Date.now()) continue;

        // Only process high-priority or medium-priority intentions
        if (intention.priority === 'low') continue;

        // Check if a task for this intention already exists in queue
        const existingTasks = Array.from(this.state.tasks.values())
          .filter(t => t.source === 'intention' && t.sourceId === intention.id);

        const hasActiveTask = existingTasks.some(t =>
          ['pending', 'scheduled', 'ready', 'running'].includes(t.status)
        );

        if (hasActiveTask) continue;

        // Map intention type to night work task type
        const taskType = this.mapIntentionToTaskType(intention.type);

        // Map intention priority to task priority
        const priority = this.mapIntentionPriority(intention.priority);

        // Determine required permission based on intention type and confidence
        const requiredPermission = this.getIntentionPermissionLevel(intention);

        // Create the task
        const task: Omit<NightWorkTask, 'id' | 'createdAt' | 'retryCount' | 'status'> = {
          type: taskType,
          priority,
          title: intention.title,
          description: `${intention.description}\n\nReasoning: ${intention.reasoning}`,
          source: 'intention',
          sourceId: intention.id,
          chatId: intention.chatId,
          requiredPermission,
          context: {
            projectId: intention.projectPath,
            metadata: {
              intentionType: intention.type,
              intentionSource: intention.source,
              confidence: intention.confidence,
              suggestedAction: intention.suggestedAction,
              evidence: intention.evidence,
            },
          },
          maxRetries: 1,
          scheduledFor: intention.expiresAt,
          estimatedDuration: this.estimateIntentionDuration(intention),
        };

        await this.addTask(task);
        addedCount++;
      }

      return addedCount;
    } catch (error) {
      console.error('Error syncing from intentions:', error);
      return 0;
    }
  }

  /**
   * Map intention type to night work task type
   */
  private mapIntentionToTaskType(intentionType: string): NightWorkTaskType {
    const typeMap: Record<string, NightWorkTaskType> = {
      refactor: 'refactoring',
      fix: 'custom',
      improve: 'custom',
      analyze: 'custom',
      implement: 'custom',
      update: 'dependency_update',
      test: 'test_fix',
      optimize: 'custom',
      document: 'documentation',
    };

    return typeMap[intentionType] || 'custom';
  }

  /**
   * Map intention priority to task priority
   */
  private mapIntentionPriority(priority: string): 'urgent' | 'high' | 'medium' | 'low' {
    if (priority === 'urgent') return 'urgent';
    if (priority === 'high') return 'high';
    if (priority === 'low') return 'low';
    return 'medium';
  }

  /**
   * Determine permission level required for an intention-based task
   */
  private getIntentionPermissionLevel(intention: Intention): NightWorkTask['requiredPermission'] {
    // High-confidence, low-risk intentions can be autonomous
    if (intention.confidence >= 0.9) {
      switch (intention.type) {
        case 'document':
        case 'test':
          return 'autonomous';
        case 'refactor':
        case 'improve':
          return 'supervised';
        default:
          return 'supervised';
      }
    }

    // Lower confidence needs supervision
    if (intention.confidence >= 0.7) {
      return 'supervised';
    }

    // Low confidence needs approval
    return 'advisory';
  }

  /**
   * Estimate duration for an intention-based task
   */
  private estimateIntentionDuration(intention: Intention): number {
    // Base duration by type (in milliseconds)
    const baseDurations: Record<string, number> = {
      refactor: 45 * 60 * 1000,     // 45 minutes
      fix: 30 * 60 * 1000,          // 30 minutes
      improve: 30 * 60 * 1000,      // 30 minutes
      analyze: 20 * 60 * 1000,      // 20 minutes
      implement: 60 * 60 * 1000,    // 60 minutes
      update: 15 * 60 * 1000,       // 15 minutes
      test: 25 * 60 * 1000,         // 25 minutes
      optimize: 40 * 60 * 1000,     // 40 minutes
      document: 20 * 60 * 1000,     // 20 minutes
    };

    const base = baseDurations[intention.type] || 30 * 60 * 1000;

    // Adjust based on confidence (lower confidence = more time needed)
    const confidenceMultiplier = 1 + (1 - intention.confidence) * 0.5;

    return Math.floor(base * confidenceMultiplier);
  }

  /**
   * Sync tasks from opportunities
   * Creates night work tasks for detected improvement opportunities
   */
  private async syncFromOpportunities(_chatId?: number): Promise<number> {
    try {
      const opportunityDetector = getOpportunityDetector();

      // Get opportunities with 'detected' status
      const opportunities = await opportunityDetector.getOpportunities({
        status: 'detected',
      });

      let addedCount = 0;

      for (const opportunity of opportunities) {
        // Skip if opportunity can't be auto-applied with high impact
        if (!opportunity.canAutoApply && opportunity.estimatedImpact > 0.3) continue;

        // Check if a task for this opportunity already exists in queue
        const existingTasks = Array.from(this.state.tasks.values())
          .filter(t => t.source === 'opportunity' && t.sourceId === opportunity.id);

        const hasActiveTask = existingTasks.some(t =>
          ['pending', 'scheduled', 'ready', 'running'].includes(t.status)
        );

        if (hasActiveTask) continue;

        // Map opportunity type to night work task type
        const taskType = this.mapOpportunityToTaskType(opportunity);

        // Map opportunity priority to task priority
        const priority = this.mapOpportunityPriority(opportunity.priority);

        // Determine required permission based on opportunity properties
        const requiredPermission = this.getOpportunityPermissionLevel(opportunity);

        // For opportunities, chatId is inferred from context (system tasks)
        const taskChatId = 0;

        // Create the task
        const task: Omit<NightWorkTask, 'id' | 'createdAt' | 'retryCount' | 'status'> = {
          type: taskType,
          priority,
          title: opportunity.title,
          description: opportunity.description,
          source: 'opportunity',
          sourceId: opportunity.id,
          chatId: taskChatId,
          requiredPermission,
          context: {
            projectId: opportunity.projectPath,
            metadata: {
              opportunityType: opportunity.type,
              estimatedImpact: opportunity.estimatedImpact,
              estimatedEffort: opportunity.estimatedEffort,
              canAutoApply: opportunity.canAutoApply,
              filePath: opportunity.filePath,
            },
          },
          maxRetries: opportunity.priority === 'critical' ? 1 : 2,
          estimatedDuration: Math.floor((opportunity.estimatedEffort || 1) * 30 * 60 * 1000),
        };

        await this.addTask(task);
        addedCount++;
      }

      return addedCount;
    } catch (error) {
      console.error('Error syncing from opportunities:', error);
      return 0;
    }
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
  private mapOpportunityPriority(priority: string): 'urgent' | 'high' | 'medium' | 'low' {
    if (priority === 'critical') return 'urgent';
    if (priority === 'high') return 'high';
    if (priority === 'low') return 'low';
    return 'medium';
  }

  /**
   * Determine permission level required for an opportunity-based task
   */
  private getOpportunityPermissionLevel(opportunity: ImprovementOpportunity): NightWorkTask['requiredPermission'] {
    // Critical opportunities always need supervision
    if (opportunity.priority === 'critical') {
      return 'supervised';
    }

    // High impact needs supervision
    if (opportunity.estimatedImpact > 0.5) {
      return 'supervised';
    }

    // Safe opportunities can be autonomous
    if (opportunity.canAutoApply && opportunity.estimatedImpact <= 0.3) {
      switch (opportunity.type) {
        case 'documentation':
          return 'autonomous';
        case 'test_coverage':
          return 'autonomous';
        case 'refactoring':
        case 'complexity':
        case 'duplication':
          return 'supervised';
        default:
          return 'supervised';
      }
    }

    return 'supervised';
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
