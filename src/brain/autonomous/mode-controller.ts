/**
 * Autonomous Mode Controller
 *
 * Manages autonomous mode activation based on:
 * - User activity state (ACTIVE, INACTIVE, AWAY)
 * - Inactive hours time windows
 * - Manual override (/autonomous on|off)
 *
 * Responsibilities:
 * - Periodically evaluate user states and switch modes
 * - Trigger autonomous work when conditions are met
 * - Handle manual autonomous mode toggle
 * - Emit events for mode transitions
 */

import { getActivityTracker } from './activity-tracker.js';
import { getNightWorkQueue } from './night-work-queue.js';
import { getProactiveImprovementScheduler } from './proactive-scheduler.js';
import { getGoalSystem } from '../goals/goal-system.js';
import { getIntentionEngine } from '../intention/intention-engine.js';
import { getDependencyManager } from '../dependency/dependency-manager.js';
import { getOpportunityDetector } from '../opportunity/opportunity-detector.js';
import type {
  UserActivityData,
  UserActivityState,
  AutonomousMode,
} from '../types.js';
import type { NightWorkTask } from './night-work-queue.js';
import { Logger } from '../../utils.js';

// Create a logger instance for this module
const logger = new Logger('info');

// ===========================================
// Events
// ===========================================

export interface AutonomousModeEvent {
  chatId: number;
  timestamp: number;
  type: 'mode_entered' | 'mode_exited' | 'work_started' | 'work_completed' | 'work_failed';
  data: {
    previousState?: UserActivityState;
    newState?: UserActivityState;
    autonomousMode?: AutonomousMode;
    workType?: string;
    error?: string;
  };
}

export type ModeEventHandler = (event: AutonomousModeEvent) => void | Promise<void>;

// ===========================================
// Controller State
// ===========================================

interface ControllerState {
  isRunning: boolean;
  lastCheckAt: number;
  checkIntervalMs: number;
  usersInAutonomousMode: Set<number>;
}

// ===========================================
// Autonomous Mode Controller
// ===========================================

export class AutonomousModeController {
  private activityTracker = getActivityTracker();
  private state: ControllerState = {
    isRunning: false,
    lastCheckAt: 0,
    checkIntervalMs: 60 * 1000, // Check every minute
    usersInAutonomousMode: new Set(),
  };
  private eventHandlers: Set<ModeEventHandler> = new Set();
  private checkTimer?: NodeJS.Timeout;
  private workInProgress = new Map<number, Promise<void>>();

  /**
   * Start the controller
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      return;
    }

    this.state.isRunning = true;
    this.state.lastCheckAt = Date.now();

    // Initialize night work queue
    const queue = getNightWorkQueue();
    await queue.initialize();
    await queue.syncTasks(); // Initial sync

    // Schedule periodic checks
    this.scheduleCheck();

    this.emitEvent({
      chatId: 0, // System event
      timestamp: Date.now(),
      type: 'mode_entered',
      data: {
        newState: 'ACTIVE',
        autonomousMode: 'active_command',
      },
    });
  }

  /**
   * Stop the controller
   */
  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      return;
    }

    this.state.isRunning = false;

    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }

    // Wait for any in-progress work to complete
    const workPromises = Array.from(this.workInProgress.values());
    if (workPromises.length > 0) {
      await Promise.allSettled(workPromises);
    }

    // Stop night work queue
    await getNightWorkQueue().stop();

    this.emitEvent({
      chatId: 0, // System event
      timestamp: Date.now(),
      type: 'mode_exited',
      data: {},
    });
  }

  /**
   * Check if a specific user is currently in autonomous mode
   */
  async isAutonomousMode(chatId: number): Promise<boolean> {
    return this.activityTracker.isAutonomousMode(chatId);
  }

  /**
   * Manually enable/disable autonomous mode for a user
   */
  async setAutonomousMode(chatId: number, enabled: boolean): Promise<{
    success: boolean;
    previousMode: AutonomousMode;
    newMode: AutonomousMode;
  }> {
    const { autonomousMode: previousMode } = await this.activityTracker.evaluateState(chatId);

    await this.activityTracker.setAutonomousEnabled(chatId, enabled);
    const { autonomousMode: newMode } = await this.activityTracker.evaluateState(chatId);

    if (enabled && newMode === 'inactive_autonomous') {
      this.state.usersInAutonomousMode.add(chatId);

      this.emitEvent({
        chatId,
        timestamp: Date.now(),
        type: 'mode_entered',
        data: {
          autonomousMode: newMode,
        },
      });

      // Trigger autonomous work immediately
      this.triggerAutonomousWork(chatId).catch((err) => {
        this.emitEvent({
          chatId,
          timestamp: Date.now(),
          type: 'work_failed',
          data: { error: String(err) },
        });
      });
    } else if (!enabled && previousMode === 'inactive_autonomous') {
      this.state.usersInAutonomousMode.delete(chatId);

      this.emitEvent({
        chatId,
        timestamp: Date.now(),
        type: 'mode_exited',
        data: {
          autonomousMode: newMode,
        },
      });
    }

    return {
      success: true,
      previousMode,
      newMode,
    };
  }

  /**
   * Get all users currently in autonomous mode
   */
  getUsersInAutonomousMode(): number[] {
    return Array.from(this.state.usersInAutonomousMode);
  }

  /**
   * Get current state for a user
   */
  async getUserState(chatId: number): Promise<{
    activityData: UserActivityData;
    autonomousMode: AutonomousMode;
    isInAutonomousMode: boolean;
    isWorkInProgress: boolean;
  }> {
    const activityData = await this.activityTracker.getUserActivityData(chatId);
    const { autonomousMode } = await this.activityTracker.evaluateState(chatId);
    const isInAutonomousMode = this.state.usersInAutonomousMode.has(chatId);
    const isWorkInProgress = this.workInProgress.has(chatId);

    return {
      activityData,
      autonomousMode,
      isInAutonomousMode,
      isWorkInProgress,
    };
  }

  /**
   * Subscribe to autonomous mode events
   */
  onEvent(handler: ModeEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Force a state evaluation check (for testing or manual trigger)
   */
  async forceCheck(): Promise<void> {
    await this.performCheck();
  }

  // ===========================================
  // Internal Methods
  // ===========================================

  /**
   * Schedule the next periodic check
   */
  private scheduleCheck(): void {
    if (!this.state.isRunning) {
      return;
    }

    this.checkTimer = setTimeout(async () => {
      await this.performCheck();
      this.scheduleCheck();
    }, this.state.checkIntervalMs);
  }

  /**
   * Perform a check of all known users and trigger autonomous work if needed
   */
  private async performCheck(): Promise<void> {
    if (!this.state.isRunning) {
      return;
    }

    this.state.lastCheckAt = Date.now();

    // Get all users from cache (in production, this would scan all known users)
    const autonomousUsers = await this.activityTracker.getAutonomousUsers();

    // Update the set of users in autonomous mode
    this.state.usersInAutonomousMode.clear();
    for (const user of autonomousUsers) {
      this.state.usersInAutonomousMode.add(user.chatId);
    }

    // Run proactive improvement scans for autonomous users
    // This detects opportunities and creates tasks in the night work queue
    const proactiveScheduler = getProactiveImprovementScheduler();
    try {
      await proactiveScheduler.runScansForAutonomousUsers();
    } catch (err) {
      logger.error('Proactive scan failed', { error: err instanceof Error ? err.message : String(err) });
    }

    // Trigger autonomous work for each user in autonomous mode
    for (const chatId of this.state.usersInAutonomousMode) {
      // Skip if work is already in progress for this user
      if (this.workInProgress.has(chatId)) {
        continue;
      }

      this.triggerAutonomousWork(chatId).catch((err) => {
        this.emitEvent({
          chatId,
          timestamp: Date.now(),
          type: 'work_failed',
          data: { error: String(err) },
        });
      });
    }
  }

  /**
   * Trigger autonomous work for a specific user
   * This is a placeholder - the actual work will be implemented in later phases
   */
  private async triggerAutonomousWork(chatId: number): Promise<void> {
    // Prevent concurrent work for the same user
    if (this.workInProgress.has(chatId)) {
      return;
    }

    const workPromise = this.doAutonomousWork(chatId);

    // Store the promise so we can track in-progress work
    this.workInProgress.set(chatId, workPromise);

    try {
      await workPromise;
    } finally {
      this.workInProgress.delete(chatId);
    }
  }

  /**
   * Actual autonomous work implementation
   * Processes tasks from the Night Work Queue
   */
  private async doAutonomousWork(chatId: number): Promise<void> {
    const startTime = Date.now();
    const queue = getNightWorkQueue();

    // Sync tasks before processing
    await queue.syncTasks(chatId);

    // Get next task for this user
    // Default to 'autonomous' permission level
    const task = await queue.getNextTask(chatId, 'autonomous');

    if (!task) {
      // No tasks to process
      return;
    }

    this.emitEvent({
      chatId,
      timestamp: startTime,
      type: 'work_started',
      data: {
        workType: task.type,
      },
    });

    try {
      // Mark task as running
      await queue.markTaskRunning(task.id);

      // Execute the task based on its type
      const result = await this.executeTask(task);

      // Update task status
      await queue.updateTaskStatus(task.id, 'completed', result);

      this.emitEvent({
        chatId,
        timestamp: Date.now(),
        type: 'work_completed',
        data: {
          workType: task.type,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update task status as failed
      await queue.updateTaskStatus(task.id, 'failed', {
        success: false,
        error: errorMessage,
        completedAt: Date.now(),
        duration: Date.now() - startTime,
      });

      this.emitEvent({
        chatId,
        timestamp: Date.now(),
        type: 'work_failed',
        data: {
          error: errorMessage,
        },
      });
      throw error;
    }
  }

  /**
   * Execute a specific night work task
   * Delegates to appropriate agents based on task type
   */
  private async executeTask(task: NightWorkTask): Promise<{
    success: boolean;
    output?: string;
    completedAt: number;
    duration: number;
  }> {
    const startTime = Date.now();

    try {
      let result: string;

      switch (task.type) {
        case 'goal_task': {
          result = await this.executeGoalTask(task);
          break;
        }

        case 'intention_fulfillment': {
          result = await this.executeIntentionTask(task);
          break;
        }

        case 'opportunity_improvement': {
          result = await this.executeOpportunityTask(task);
          break;
        }

        case 'proactive_check': {
          result = await this.executeProactiveCheck(task);
          break;
        }

        case 'refactoring': {
          result = await this.executeRefactoringTask(task);
          break;
        }

        case 'test_fix': {
          result = await this.executeTestFixTask(task);
          break;
        }

        case 'dependency_update': {
          result = await this.executeDependencyUpdateTask(task);
          break;
        }

        case 'documentation': {
          result = await this.executeDocumentationTask(task);
          break;
        }

        case 'deployment': {
          result = await this.executeDeploymentTask(task);
          break;
        }

        case 'code_review': {
          result = await this.executeCodeReviewTask(task);
          break;
        }

        default:
          result = 'Task "' + task.title + '" acknowledged (no specific handler)';
          break;
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        output: result,
        completedAt: Date.now(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        output: errorMessage,
        completedAt: Date.now(),
        duration,
      };
    }
  }

  /**
   * Execute a goal-related task
   */
  private async executeGoalTask(task: NightWorkTask): Promise<string> {
    const goalSystem = getGoalSystem();
    const goal = goalSystem.getGoal?.(task.sourceId);

    if (!goal) {
      return 'Goal ' + task.sourceId + ' not found';
    }

    const projectPath = task.context.projectId || goal.projectPath;
    const result = await this.executeClaudeTask(projectPath, task.description);

    // Note: GoalSystem doesn't have updateGoalProgress method
    // The task status is updated by the queue

    return result.success
      ? 'Goal task completed: ' + (result.output || '')
      : 'Goal task failed: ' + (result.error || '');
  }

  /**
   * Execute an intention fulfillment task
   */
  private async executeIntentionTask(task: NightWorkTask): Promise<string> {
    const intentionEngine = getIntentionEngine();
    const intention = await intentionEngine.getIntentionById(task.sourceId);

    if (!intention) {
      return 'Intention ' + task.sourceId + ' not found';
    }

    const projectPath = task.context.projectId || intention.projectPath;
    const result = await this.executeClaudeTask(projectPath, intention.suggestedAction);

    // Update intention status based on result
    if (result.success) {
      await intentionEngine.updateIntentionStatus(intention.id, 'completed');
    } else {
      await intentionEngine.updateIntentionStatus(intention.id, 'failed');
    }

    return result.success
      ? 'Intention fulfilled: ' + (result.output || '')
      : 'Intention failed: ' + (result.error || '');
  }

  /**
   * Execute an opportunity improvement task
   */
  private async executeOpportunityTask(task: NightWorkTask): Promise<string> {
    const opportunityDetector = getOpportunityDetector();
    // Note: getOpportunityById may not exist, use getOpportunity instead
    const opportunity = opportunityDetector.getOpportunity?.(task.sourceId);

    if (!opportunity) {
      return 'Opportunity ' + task.sourceId + ' not found';
    }

    // Delegate to appropriate agent based on opportunity type
    switch (opportunity.type) {
      case 'refactoring':
      case 'complexity':
      case 'duplication': {
        // Use available API - may need adjustment based on actual RefactoringAgent interface
        const prompt = 'Refactor this code:\n' + opportunity.description + '\n\nFile: ' + (opportunity.filePath || 'unknown');
        const result = await this.executeClaudeTask(opportunity.projectPath, prompt);
        return result.success
          ? 'Refactoring task completed'
          : 'Refactoring failed: ' + (result.error || 'unknown');
      }

      case 'dependency_update': {
        // Use checkProject to get outdated dependencies
        const dependencyManager = getDependencyManager();
        const health = await dependencyManager.checkProject(opportunity.projectPath);
        // For now, just report - actual updates would require explicit package names
        return 'Dependencies checked: ' + health.outdated + ' outdated, ' + health.vulnerable + ' vulnerable';
      }

      case 'documentation': {
        // Use available API - may need adjustment based on actual DocWriterAgent interface
        const prompt = 'Generate documentation for this project:\n' + opportunity.description;
        const result = await this.executeClaudeTask(opportunity.projectPath, prompt);
        return result.success
          ? 'Documentation task completed'
          : 'Documentation failed: ' + (result.error || 'unknown');
      }

      case 'test_coverage': {
        // Use available API - may need adjustment based on actual TestHealer interface
        const prompt = 'Improve test coverage for:\n' + opportunity.description + '\n\nFile: ' + (opportunity.filePath || 'unknown');
        const result = await this.executeClaudeTask(opportunity.projectPath, prompt);
        return result.success
          ? 'Test coverage task completed'
          : 'Test task failed: ' + (result.error || 'unknown');
      }

      default: {
        const result = await this.executeClaudeTask(opportunity.projectPath, task.description);
        return result.success
          ? 'Opportunity addressed: ' + (result.output || '')
          : 'Opportunity failed: ' + (result.error || '');
      }
    }
  }

  /**
   * Execute a proactive check task
   */
  private async executeProactiveCheck(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Proactive check failed: no project path specified';
    }

    const result = await this.executeClaudeTask(projectPath,
      'Run a proactive code quality check. Look for:\n' +
      '- Security vulnerabilities\n' +
      '- Code smells and anti-patterns\n' +
      '- Dead code or unused imports\n' +
      '- Inconsistent naming conventions\n' +
      '- Missing error handling\n\n' +
      'Report your findings in a structured format.'
    );

    return result.success
      ? 'Proactive check completed: ' + (result.output || '')
      : 'Proactive check failed: ' + (result.error || '');
  }

  /**
   * Execute a refactoring task
   */
  private async executeRefactoringTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Refactoring failed: no project path specified';
    }

    const result = await this.executeClaudeTask(projectPath,
      'Refactor the code to address: ' + task.description
    );

    return result.success
      ? 'Refactoring completed'
      : 'Refactoring failed: ' + (result.error || '');
  }

  /**
   * Execute a test fix task
   */
  private async executeTestFixTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Test fix failed: no project path specified';
    }

    const result = await this.executeClaudeTask(projectPath,
      'Fix failing tests:\n' + task.description
    );

    return result.success
      ? 'Test fixes applied'
      : 'Test fix failed: ' + (result.error || '');
  }

  /**
   * Execute a dependency update task
   */
  private async executeDependencyUpdateTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Dependency update failed: no project path specified';
    }

    const dependencyManager = getDependencyManager();
    // Check project for outdated dependencies
    const health = await dependencyManager.checkProject(projectPath);

    return 'Dependencies checked: ' + health.outdated + ' outdated, ' + health.vulnerable + ' vulnerable';
  }

  /**
   * Execute a documentation task
   */
  private async executeDocumentationTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Documentation task failed: no project path specified';
    }

    const result = await this.executeClaudeTask(projectPath,
      'Generate documentation:\n' + task.description
    );

    return result.success
      ? 'Documentation generated'
      : 'Documentation task failed';
  }

  /**
   * Execute a deployment task
   */
  private async executeDeploymentTask(task: NightWorkTask): Promise<string> {
    // Deployment always requires explicit approval
    return 'Deployment task "' + task.title + '" requires manual approval. Please review and deploy manually.';
  }

  /**
   * Execute a code review task
   */
  private async executeCodeReviewTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Code review failed: no project path specified';
    }

    const prompt = 'Review the code changes for this project. Focus on:\n' +
      '- Code quality and maintainability\n' +
      '- Potential bugs or edge cases\n' +
      '- Security vulnerabilities\n' +
      '- Performance considerations\n' +
      '- Testing coverage\n\n' +
      'Task description: ' + task.description;

    const result = await this.executeClaudeTask(projectPath, prompt);

    return result.success
      ? 'Code review completed'
      : 'Code review failed';
  }

  /**
   * Execute a task using Claude CLI
   * This is the fallback for tasks that don't have a dedicated handler
   */
  private async executeClaudeTask(projectPath: string, prompt: string): Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }> {
    try {
      // For now, return a placeholder response
      // In production, this would spawn a Claude CLI process
      const truncatedPrompt = prompt.slice(0, 100) + '...';
      return {
        success: true,
        output: 'Task executed on ' + projectPath + ': ' + truncatedPrompt,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Emit an event to all registered handlers
   */
  private emitEvent(event: AutonomousModeEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        void handler(event);
      } catch (err) {
        logger.error('AutonomousModeController event handler error', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

// ===========================================
// Singleton
// ===========================================

let controllerInstance: AutonomousModeController | null = null;

/**
 * Get the autonomous mode controller singleton
 */
export function getAutonomousModeController(): AutonomousModeController {
  if (!controllerInstance) {
    controllerInstance = new AutonomousModeController();
  }
  return controllerInstance;
}

/**
 * Reset the controller (mainly for testing)
 */
export function resetAutonomousModeController(): void {
  if (controllerInstance) {
    void controllerInstance.stop();
  }
  controllerInstance = null;
}
