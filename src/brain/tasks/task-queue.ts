/**
 * Task Queue - Background task execution system
 *
 * Manages autonomous background tasks that can run independently
 * of Telegram sessions. Supports priority queues, scheduling,
 * and persistence across restarts.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getBrain } from '../brain-manager.js';
import type { Task, TaskStatus, TaskPriority, TaskSchedule } from '../types.js';

interface TaskQueueState {
  pending: Task[];
  running: Task[];
  completed: Task[];
  failed: Task[];
  schedules: TaskSchedule[];
}

// Task executor function type
type TaskExecutor = (task: Task) => Promise<{ success: boolean; result?: unknown; error?: string }>;

/**
 * Task Queue - manages background tasks
 */
export class TaskQueue {
  private brain = getBrain();
  private tasksDir: string;
  private queueFile: string;
  private state: TaskQueueState;
  private processing = false;
  private intervalId: NodeJS.Timeout | null = null;
  private executors: Map<string, TaskExecutor> = new Map();

  constructor() {
    this.tasksDir = this.brain.getTasksDir();
    this.queueFile = join(this.tasksDir, 'queue.json');
    this.state = this.emptyState();
  }

  /**
   * Initialize the task queue
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.tasksDir)) {
      await mkdir(this.tasksDir, { recursive: true });
    }

    // Load existing state
    await this.loadState();

    // Start processing loop
    this.startProcessing();
  }

  /**
   * Add a new task to the queue
   */
  async addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<string> {
    const newTask: Task = {
      ...task,
      id: task.id ?? this.generateTaskId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.state.pending.push(newTask);
    await this.saveState();

    return newTask.id;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): Task | undefined {
    return [
      ...this.state.pending,
      ...this.state.running,
      ...this.state.completed,
      ...this.state.failed,
    ].find(t => t.id === taskId);
  }

  /**
   * Get all tasks for a chat
   */
  getTasksForChat(chatId: number): Task[] {
    return [
      ...this.state.pending,
      ...this.state.running,
      ...this.state.completed,
      ...this.state.failed,
    ].filter(t => t.chatId === chatId);
  }

  /**
   * Get pending tasks ordered by priority
   */
  getPendingTasks(): Task[] {
    return this.sortByPriority(this.state.pending);
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const pendingIndex = this.state.pending.findIndex(t => t.id === taskId);
    if (pendingIndex !== -1) {
      this.state.pending.splice(pendingIndex, 1);
      await this.saveState();
      return true;
    }

    const runningIndex = this.state.running.findIndex(t => t.id === taskId);
    if (runningIndex !== -1) {
      this.state.running.splice(runningIndex, 1);
      await this.saveState();
      return true;
    }

    return false;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    result?: unknown,
    error?: string,
  ): Promise<boolean> {
    const task = this.getTask(taskId);
    if (!task) return false;

    // Remove from current array
    this.removeFromArrays(taskId);

    // Update task
    task.status = status;
    task.updatedAt = Date.now();
    if (result) task.result = result;
    if (error) task.error = error;
    if (status === 'running' && !task.startedAt) task.startedAt = Date.now();
    if (status === 'completed' || status === 'failed') task.completedAt = Date.now();

    // Add to appropriate array
    if (status === 'completed') {
      this.state.completed.push(task);
    } else if (status === 'failed') {
      this.state.failed.push(task);
    } else if (status === 'running') {
      this.state.running.push(task);
    } else {
      this.state.pending.push(task);
    }

    // Track metrics
    const { getMetricsTracker } = await import('../metrics/index.js');
    if (status === 'completed') {
      getMetricsTracker().increment({ tasksCompleted: 1 });
    } else if (status === 'failed') {
      getMetricsTracker().increment({ tasksFailed: 1 });
    }

    await this.saveState();
    return true;
  }

  // ===========================================
  // Scheduling
  // ===========================================

  /**
   * Add a scheduled task (cron)
   */
  async addSchedule(schedule: Omit<TaskSchedule, 'id' | 'runCount' | 'lastRun' | 'nextRun'>): Promise<string> {
    const newSchedule: TaskSchedule = {
      ...schedule,
      id: this.generateTaskId(),
      runCount: 0,
    };

    this.state.schedules.push(newSchedule);
    await this.saveState();

    return newSchedule.id;
  }

  /**
   * Remove a schedule
   */
  async removeSchedule(scheduleId: string): Promise<boolean> {
    const index = this.state.schedules.findIndex(s => s.id === scheduleId);
    if (index !== -1) {
      this.state.schedules.splice(index, 1);
      await this.saveState();
      return true;
    }
    return false;
  }

  /**
   * Get all schedules
   */
  getSchedules(): TaskSchedule[] {
    return this.state.schedules;
  }

  // ===========================================
  // Processing Loop
  // ===========================================

  /**
   * Start the processing loop
   */
  private startProcessing(): void {
    if (this.processing) return;

    this.processing = true;

    // Process every 5 seconds
    this.intervalId = setInterval(() => {
      this.processPending().catch(console.error);
      this.checkSchedules().catch(console.error);
    }, 5000);
  }

  /**
   * Stop the processing loop
   */
  stopProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.processing = false;
  }

  /**
   * Register a task executor for a specific task type
   */
  registerExecutor(type: string, executor: TaskExecutor): void {
    this.executors.set(type, executor);
  }

  /**
   * Unregister a task executor
   */
  unregisterExecutor(type: string): void {
    this.executors.delete(type);
  }

  /**
   * Process pending tasks
   */
  private async processPending(): Promise<void> {
    if (this.state.pending.length === 0) return;

    // Limit concurrent tasks
    if (this.state.running.length >= 3) return;

    // Get highest priority task
    const task = this.sortByPriority(this.state.pending).shift();
    if (!task) return;

    // Remove from pending
    this.state.pending = this.state.pending.filter(t => t.id !== task.id);

    // Move to running
    this.state.running.push(task);
    await this.updateTaskStatus(task.id, 'running');

    console.log(`[TaskQueue] Processing task: ${task.id} (${task.type})`);

    // Execute the task
    try {
      const executor = this.executors.get(task.type);
      if (executor) {
        const result = await executor(task);
        if (result.success) {
          await this.updateTaskStatus(task.id, 'completed', result.result);
        } else {
          await this.updateTaskStatus(task.id, 'failed', undefined, result.error);
        }
      } else {
        // No executor registered - mark as failed
        await this.updateTaskStatus(
          task.id,
          'failed',
          undefined,
          `No executor registered for task type: ${task.type}`
        );
      }
    } catch (error) {
      await this.updateTaskStatus(
        task.id,
        'failed',
        undefined,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Check and execute scheduled tasks
   */
  private async checkSchedules(): Promise<void> {
    const now = Date.now();

    for (const schedule of this.state.schedules) {
      if (!schedule.enabled) continue;

      if (schedule.nextRun && schedule.nextRun <= now) {
        // Execute scheduled task
        const task = schedule.task;
        await this.addTask({
          type: task.type,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          projectId: task.projectId,
          chatId: task.chatId,
          metadata: task.metadata,
        });

        // Calculate next run
        schedule.lastRun = now;
        schedule.nextRun = this.calculateNextRun(schedule.cronExpression, now);
        schedule.runCount = (schedule.runCount || 0) + 1;

        await this.saveState();
      }
    }
  }

  /**
   * Calculate next run time from cron expression
   * Simplified implementation - supports basic patterns
   */
  private calculateNextRun(cron: string, from: number): number {
    // Very basic implementation - just support hourly for now
    // TODO: Implement full cron parsing
    const parts = cron.split(' ');
    if (parts[1] === '*') {
      // Every minute - add 1 minute
      return from + 60 * 1000;
    }
    // Default to 1 hour
    return from + 60 * 60 * 1000;
  }

  // ===========================================
  // State Management
  // ===========================================

  /**
   * Load state from disk
   */
  private async loadState(): Promise<void> {
    if (!existsSync(this.queueFile)) {
      this.state = this.emptyState();
      return;
    }

    try {
      const content = await readFile(this.queueFile, 'utf-8');
      this.state = JSON.parse(content);
    } catch {
      this.state = this.emptyState();
    }
  }

  /**
   * Save state to disk
   */
  private async saveState(): Promise<void> {
    await writeFile(this.queueFile, JSON.stringify(this.state, null, 2));
  }

  /**
   * Create empty state
   */
  private emptyState(): TaskQueueState {
    return {
      pending: [],
      running: [],
      completed: [],
      failed: [],
      schedules: [],
    };
  }

  /**
   * Remove task from all arrays
   */
  private removeFromArrays(taskId: string): void {
    this.state.pending = this.state.pending.filter(t => t.id !== taskId);
    this.state.running = this.state.running.filter(t => t.id !== taskId);
    this.state.completed = this.state.completed.filter(t => t.id !== taskId);
    this.state.failed = this.state.failed.filter(t => t.id !== taskId);
  }

  /**
   * Sort tasks by priority
   */
  private sortByPriority(tasks: Task[]): Task[] {
    const priorityOrder: Record<TaskPriority, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return [...tasks].sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt - b.createdAt; // Earlier tasks first
    });
  }

  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Global singleton
let globalTaskQueue: TaskQueue | null = null;

export function getTaskQueue(): TaskQueue {
  if (!globalTaskQueue) {
    globalTaskQueue = new TaskQueue();
  }
  return globalTaskQueue;
}
