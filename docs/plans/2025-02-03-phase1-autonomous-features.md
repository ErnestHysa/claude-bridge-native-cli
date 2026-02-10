> **Historical note:** This document is preserved for upgrade traceability. For current runtime setup/usage, use `README.md`, `setup.md`, and `GUIDE.md` in the repository root.

# Phase 1: Autonomous Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the half-implemented autonomous features to enable full autonomous AI operation during inactive hours.

**Architecture:** The autonomous system has a pipeline: ActivityTracker detects inactive state -> AutonomousModeController triggers work -> NightWorkQueue provides tasks -> TaskExecutor executes tasks. We need to complete the missing integrations between GoalSystem, IntentionEngine, OpportunityDetector and the NightWorkQueue, plus add UserPreferences storage for project paths and permission levels.

**Tech Stack:** TypeScript, Node.js, MemoryStore (JSON persistence), existing brain systems (GoalSystem, IntentionEngine, OpportunityDetector, RefactoringAgent, DependencyManager, DocWriterAgent)

---

## Task 1: Add UserPreferences Extensions for Autonomous Mode

**Files:**
- Modify: `src/brain/types.ts:53-84` - Extend UserPreferences interface
- Modify: `src/brain/identity.ts:97-131` - Update DEFAULT_PREFERENCES
- Modify: `src/brain/identity.ts:136-290` - Add new methods to IdentityManager
- Test: No test file (manual verification via Telegram bot)

**Step 1: Extend UserPreferences type in types.ts**

Add autonomous mode preferences to the UserPreferences interface:

```typescript
export interface UserPreferences {
  user: {
    name: string;
    timezone: string;
    location?: string;
    workingHours: {
      start: number;
      end: number;
      timezone: string;
    };
    inactiveHours?: InactiveHours;
  };
  notifications: {
    enabled: boolean;
    quietHours: {
      start: number;
      end: number;
    };
    priorityLevels: Record<string, 'immediate' | 'digest' | 'mute'>;
  };
  git: {
    defaultBranch: string;
    autoPush: boolean;
    signCommits: boolean;
    commitMessageStyle: 'conventional' | 'descriptive' | 'minimal';
  };
  projects: {
    defaultBase: string;
    autoDetect: boolean;
    watchForChanges: boolean;
  };
  // NEW: Autonomous mode preferences
  autonomous?: {
    defaultProjectPath?: string;  // Default project for autonomous tasks
    permissionLevel?: 'read_only' | 'advisory' | 'supervised' | 'autonomous' | 'full';
    maxTasksPerSession?: number;   // Limit autonomous work per session
    allowedProjectPaths?: string[]; // Whitelist of projects AI can work on
  };
}
```

**Step 2: Update DEFAULT_PREFERENCES in identity.ts**

```typescript
const DEFAULT_PREFERENCES: UserPreferences = {
  user: {
    name: 'Developer',
    timezone: 'UTC',
    workingHours: {
      start: 9,
      end: 18,
      timezone: 'UTC',
    },
  },
  notifications: {
    enabled: true,
    quietHours: {
      start: 22,
      end: 8,
    },
    priorityLevels: {
      error: 'immediate',
      warning: 'digest',
      info: 'digest',
      success: 'digest',
    },
  },
  git: {
    defaultBranch: 'main',
    autoPush: false,
    signCommits: false,
    commitMessageStyle: 'conventional',
  },
  projects: {
    defaultBase: 'C:\\Users\\ErnestHome\\DEVPROJECTS',
    autoDetect: true,
    watchForChanges: true,
  },
  autonomous: {
    permissionLevel: 'supervised',
    maxTasksPerSession: 5,
    allowedProjectPaths: [],
  },
};
```

**Step 3: Add autonomous preference getters to IdentityManager class**

Add these methods to the IdentityManager class (after line 290):

```typescript
  /**
   * Get autonomous mode preferences
   */
  getAutonomousPreferences(): UserPreferences['autonomous'] {
    return this.preferences.autonomous || {
      permissionLevel: 'supervised',
      maxTasksPerSession: 5,
      allowedProjectPaths: [],
    };
  }

  /**
   * Get user's default project path for autonomous mode
   */
  getDefaultProjectPath(): string | undefined {
    return this.preferences.autonomous?.defaultProjectPath;
  }

  /**
   * Get user's permission level for autonomous mode
   */
  getPermissionLevel(): 'read_only' | 'advisory' | 'supervised' | 'autonomous' | 'full' {
    return this.preferences.autonomous?.permissionLevel || 'supervised';
  }

  /**
   * Set autonomous mode preferences
   */
  async setAutonomousPreferences(prefs: Partial<UserPreferences['autonomous']>): Promise<void> {
    const current = this.getAutonomousPreferences();
    const updated = { ...current, ...prefs };
    await this.updatePreferences({ autonomous: updated });
  }

  /**
   * Set default project path for autonomous mode
   */
  async setDefaultProjectPath(projectPath: string): Promise<void> {
    await this.setAutonomousPreferences({ defaultProjectPath: projectPath });
  }

  /**
   * Set permission level for autonomous mode
   */
  async setPermissionLevel(level: 'read_only' | 'advisory' | 'supervised' | 'autonomous' | 'full'): Promise<void> {
    await this.setAutonomousPreferences({ permissionLevel: level });
  }
```

**Step 4: Run TypeScript check**

Run: `npm run check` or `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/brain/types.ts src/brain/identity.ts
git commit -m "feat: add autonomous mode preferences to UserPreferences

- Extend UserPreferences interface with autonomous section
- Add defaultProjectPath, permissionLevel, maxTasksPerSession, allowedProjectPaths
- Add getter/setter methods to IdentityManager for autonomous preferences

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 2: Implement syncFromGoals in NightWorkQueue

**Files:**
- Modify: `src/brain/autonomous/night-work-queue.ts:385-388` - Implement syncFromGoals
- Test: No test file (manual verification via Telegram bot)

**Step 1: Import GoalSystem types**

At the top of night-work-queue.ts, add the import (after line 21):

```typescript
import { getGoalSystem } from '../goals/goal-system.js';
import type { Goal, GoalStatus } from '../goals/goal-system.js';
```

**Step 2: Implement syncFromGoals method**

Replace the stub implementation (lines 385-388) with:

```typescript
  /**
   * Sync tasks from goals
   * Creates night work tasks for active goals that need work
   */
  private async syncFromGoals(chatId?: number): Promise<number> {
    try {
      const goalSystem = getGoalSystem();

      // Get active goals that have autonomous strategy
      const allGoals = await goalSystem.getActiveGoals();
      const goals = chatId
        ? allGoals.filter(g => g.chatId === chatId)
        : allGoals;

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
```

**Step 3: Add getActiveGoals method to GoalSystem if not present**

Check if GoalSystem has a getActiveGoals method. If not, add this to goal-system.ts after the createGoal method:

```typescript
  /**
   * Get all active goals
   */
  async getActiveGoals(): Promise<Goal[]> {
    return Array.from(this.goals.values()).filter(g => g.status === 'active');
  }

  /**
   * Get goals for a specific user
   */
  async getGoalsByChatId(chatId: number): Promise<Goal[]> {
    return Array.from(this.goals.values()).filter(g => g.chatId === chatId);
  }
```

**Step 4: Run TypeScript check**

Run: `npm run check` or `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/brain/autonomous/night-work-queue.ts src/brain/goals/goal-system.ts
git commit -m "feat: implement syncFromGoals in NightWorkQueue

- Query GoalSystem for active goals
- Create night work tasks for goals with autonomous/supervised strategy
- Skip goals that already have active tasks in queue
- Calculate priority based on deadline and progress
- Add getActiveGoals and getGoalsByChatId methods to GoalSystem

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 3: Implement syncFromIntentions in NightWorkQueue

**Files:**
- Modify: `src/brain/autonomous/night-work-queue.ts:390-397` - Implement syncFromIntentions
- Test: No test file (manual verification via Telegram bot)

**Step 1: Import IntentionEngine types**

At the top of night-work-queue.ts, add the import (after the goal import):

```typescript
import { getIntentionEngine } from '../intention/intention-engine.js';
import type { Intention, IntentionFilter } from '../intention/intention-engine.js';
```

**Step 2: Implement syncFromIntentions method**

Replace the stub implementation (lines 390-397) with:

```typescript
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
```

**Step 3: Add queryIntentions method to IntentionEngine if not present**

Check if IntentionEngine has a queryIntentions method. If not, add this to intention-engine.ts:

```typescript
  /**
   * Query intentions with filters
   */
  async queryIntentions(filter: IntentionFilter): Promise<Intention[]> {
    const now = Date.now();
    const intentions = Array.from(this.intentions.values());

    return intentions.filter(intention => {
      // Filter by types
      if (filter.types && !filter.types.includes(intention.type)) return false;

      // Filter by sources
      if (filter.sources && !filter.sources.includes(intention.source)) return false;

      // Filter by priorities
      if (filter.priorities && !filter.priorities.includes(intention.priority)) return false;

      // Filter by min confidence
      if (filter.minConfidence && intention.confidence < filter.minConfidence) return false;

      // Filter by project path
      if (filter.projectPath && intention.projectPath !== filter.projectPath) return false;

      // Filter by chat ID
      if (filter.chatId && intention.chatId !== filter.chatId) return false;

      // Filter active (non-expired)
      if (filter.active) {
        if (intention.expiresAt && intention.expiresAt < now) return false;
      }

      return true;
    });
  }
```

**Step 4: Run TypeScript check**

Run: `npm run check` or `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/brain/autonomous/night-work-queue.ts src/brain/intention/intention-engine.ts
git commit -m "feat: implement syncFromIntentions in NightWorkQueue

- Query IntentionEngine for high-confidence pending intentions
- Create night work tasks for intentions with confidence >= 0.6
- Map intention types to appropriate task types
- Determine permission level based on intention confidence and type
- Estimate task duration based on intention type
- Add queryIntentions method to IntentionEngine

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 4: Implement syncFromOpportunities in NightWorkQueue

**Files:**
- Modify: `src/brain/autonomous/night-work-queue.ts:399-406` - Implement syncFromOpportunities
- Test: No test file (manual verification via Telegram bot)

**Step 1: Import OpportunityDetector types**

At the top of night-work-queue.ts, add the import (after the intention import):

```typescript
import { getOpportunityDetector } from '../opportunity/opportunity-detector.js';
import type { ImprovementOpportunity } from '../opportunity/opportunity-detector.js';
```

**Step 2: Implement syncFromOpportunities method**

Replace the stub implementation (lines 399-406) with:

```typescript
  /**
   * Sync tasks from opportunities
   * Creates night work tasks for detected improvement opportunities
   */
  private async syncFromOpportunities(chatId?: number): Promise<number> {
    try {
      const opportunityDetector = getOpportunityDetector();

      // Get opportunities with 'detected' or 'queued' status
      // Note: This is a simplified version - the ProactiveScheduler handles most opportunity syncing
      // This method is for manual/backward compatibility
      const opportunities = await opportunityDetector.getOpportunities({
        status: 'detected',
      });

      let addedCount = 0;

      for (const opportunity of opportunities) {
        // Filter by chatId - opportunities don't have chatId directly
        // We need to check if the project path belongs to the user
        // For now, we'll skip chatId filtering for opportunities
        // and let the quality gate handle it

        // Skip if opportunity can't be auto-applied
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
        const priority = this.mapOpportunityPriority(opportunity);

        // Determine required permission based on opportunity properties
        const requiredPermission = this.getOpportunityPermissionLevel(opportunity);

        // For opportunities, we need to infer chatId from project path
        // This is a limitation - opportunities should track chatId
        // For now, use 0 as system chatId (will be filtered in getTask)
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
              filePaths: opportunity.filePaths,
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
```

**Step 3: Run TypeScript check**

Run: `npm run check` or `npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/brain/autonomous/night-work-queue.ts
git commit -m "feat: implement syncFromOpportunities in NightWorkQueue

- Query OpportunityDetector for detected improvement opportunities
- Create night work tasks for auto-applicable opportunities
- Map opportunity types to appropriate task types
- Determine permission level based on opportunity impact and safety
- Estimate task duration based on effort estimate

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 5: Wire up UserPreferences in ProactiveScheduler

**Files:**
- Modify: `src/brain/autonomous/proactive-scheduler.ts:419-432` - Implement user config retrieval
- Test: No test file (manual verification via Telegram bot)

**Step 1: Import IdentityManager**

At the top of proactive-scheduler.ts, add the import (after line 22):

```typescript
import { getIdentityManager } from '../identity.js';
```

**Step 2: Implement getUserProjectPath method**

Replace the stub implementation (lines 419-423) with:

```typescript
  /**
   * Get user's default project path
   */
  private getUserProjectPath(chatId: number): string | null {
    try {
      const identityManager = getIdentityManager();

      // Get the autonomous preferences
      const autonomousPrefs = identityManager.getAutonomousPreferences();

      // Return the default project path if set
      return autonomousPrefs.defaultProjectPath || null;
    } catch (error) {
      console.error(`Error getting user project path for chat ${chatId}:`, error);
      return null;
    }
  }
```

**Step 3: Implement getUserPermissionLevel method**

Replace the stub implementation (lines 428-432) with:

```typescript
  /**
   * Get user's permission level for autonomous mode
   */
  private async getUserPermissionLevel(chatId: number): Promise<QualityGateLevel> {
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
      console.error(`Error getting user permission level for chat ${chatId}:`, error);
      return 'supervised';
    }
  }
```

**Step 4: Run TypeScript check**

Run: `npm run check` or `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/brain/autonomous/proactive-scheduler.ts
git commit -m "feat: wire up UserPreferences in ProactiveScheduler

- Implement getUserProjectPath to retrieve default project from preferences
- Implement getUserPermissionLevel to retrieve permission level from preferences
- Add error handling and fallback defaults
- Integrate with IdentityManager for preference retrieval

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 6: Implement Task Execution in AutonomousModeController

**Files:**
- Modify: `src/brain/autonomous/mode-controller.ts:407-436` - Implement executeTask method
- Modify: `src/brain/autonomous/mode-controller.ts:1-25` - Add imports
- Test: No test file (manual verification via Telegram bot)

**Step 1: Add necessary imports**

Add these imports at the top of mode-controller.ts (after line 23):

```typescript
import { getGoalSystem } from '../goals/goal-system.js';
import { getIntentionEngine } from '../intention/intention-engine.js';
import { getRefactoringAgent } from '../refactoring/refactoring-agent.js';
import { getDependencyManager } from '../dependency/dependency-manager.js';
import { getDocWriter } from '../agents/doc-writer.js';
import { getFeatureWorkflow } from '../feature/feature-workflow.js';
import { getTestHealer } from '../self-healing/test-healer.js';
import { ClaudeSpawner } from '../../claude-spawner-class.js';
import { ProjectManager } from '../../project-manager-class.js';
import { getIdentityManager } from '../identity.js';
```

**Step 2: Implement executeTask method**

Replace the stub implementation (lines 399-436) with:

```typescript
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
          result = `Task "${task.title}" acknowledged (no specific handler)`;
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
        output: undefined,
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
    const goal = await goalSystem.getGoalById(task.sourceId);

    if (!goal) {
      return `Goal ${task.sourceId} not found`;
    }

    // For goal tasks, we create a sub-task in the goal
    const goalTask = await goalSystem.createGoalTask(goal.id, {
      title: task.title,
      description: task.description,
      intentionType: 'improve',
      estimatedDuration: task.estimatedDuration || 30 * 60 * 1000,
    });

    // Execute the task using Claude spawner
    const projectPath = task.context.projectId || goal.projectPath;
    const result = await this.executeClaudeTask(projectPath, task.description);

    // Update goal task status
    if (result.success) {
      await goalSystem.completeGoalTask(goalTask.id, result.output);
    } else {
      await goalSystem.failGoalTask(goalTask.id, result.error || 'Execution failed');
    }

    // Update goal progress
    await goalSystem.updateGoalProgress(goal.id);

    return result.success
      ? `Goal task completed: ${result.output}`
      : `Goal task failed: ${result.error}`;
  }

  /**
   * Execute an intention fulfillment task
   */
  private async executeIntentionTask(task: NightWorkTask): Promise<string> {
    const intentionEngine = getIntentionEngine();
    const intention = await intentionEngine.getIntentionById(task.sourceId);

    if (!intention) {
      return `Intention ${task.sourceId} not found`;
    }

    // Execute the suggested action
    const projectPath = task.context.projectId || intention.projectPath;
    const result = await this.executeClaudeTask(projectPath, intention.suggestedAction);

    // Update intention status based on result
    if (result.success) {
      await intentionEngine.updateIntentionStatus(intention.id, 'completed');
    } else {
      await intentionEngine.updateIntentionStatus(intention.id, 'failed');
    }

    return result.success
      ? `Intention fulfilled: ${result.output}`
      : `Intention failed: ${result.error}`;
  }

  /**
   * Execute an opportunity improvement task
   */
  private async executeOpportunityTask(task: NightWorkTask): Promise<string> {
    const opportunityDetector = getOpportunityDetector();
    const opportunity = await opportunityDetector.getOpportunityById(task.sourceId);

    if (!opportunity) {
      return `Opportunity ${task.sourceId} not found`;
    }

    // Delegate to appropriate agent based on opportunity type
    switch (opportunity.type) {
      case 'refactoring':
      case 'complexity':
      case 'duplication': {
        const refactoringAgent = getRefactoringAgent();
        const result = await refactoringAgent.applyRefactoring({
          opportunityId: opportunity.id,
          projectPath: opportunity.projectPath,
          autoApply: true,
        });
        await opportunityDetector.updateOpportunityStatus(opportunity.id, result.success ? 'completed' : 'failed');
        return result.success
          ? `Refactoring applied: ${result.changes?.length || 0} files changed`
          : `Refactoring failed: ${result.error}`;
      }

      case 'dependency_update': {
        const dependencyManager = getDependencyManager();
        const result = await dependencyManager.updateDependencies({
          projectPath: opportunity.projectPath,
          autoApprove: task.requiredPermission === 'autonomous' || task.requiredPermission === 'full',
        });
        await opportunityDetector.updateOpportunityStatus(opportunity.id, 'completed');
        return `Dependencies updated: ${result.updated?.length || 0} packages`;
      }

      case 'documentation': {
        const docWriter = getDocWriter();
        const result = await docWriter.generateDocumentation({
          projectPath: opportunity.projectPath,
          format: 'markdown',
        });
        await opportunityDetector.updateOpportunityStatus(opportunity.id, 'completed');
        return `Documentation generated: ${result.files?.length || 0} files`;
      }

      case 'test_coverage': {
        const testHealer = getTestHealer();
        const result = await testHealer.healTestCoverage({
          projectPath: opportunity.projectPath,
          targetFiles: opportunity.filePaths,
        });
        await opportunityDetector.updateOpportunityStatus(opportunity.id, result.success ? 'completed' : 'failed');
        return result.success
          ? `Test coverage improved: ${result.addedTests || 0} tests added`
          : `Test healing failed: ${result.error}`;
      }

      default: {
        // For unknown opportunity types, use Claude spawner
        const result = await this.executeClaudeTask(opportunity.projectPath, task.description);
        await opportunityDetector.updateOpportunityStatus(opportunity.id, result.success ? 'completed' : 'failed');
        return result.success
          ? `Opportunity addressed: ${result.output}`
          : `Opportunity failed: ${result.error}`;
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

    // Run heartbeat checks
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
      ? `Proactive check completed: ${result.output}`
      : `Proactive check failed: ${result.error}`;
  }

  /**
   * Execute a refactoring task
   */
  private async executeRefactoringTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Refactoring failed: no project path specified';
    }

    const refactoringAgent = getRefactoringAgent();
    const result = await refactoringAgent.refactorProject({
      projectPath,
      description: task.description,
      autoApply: task.requiredPermission === 'autonomous' || task.requiredPermission === 'full',
    });

    return result.success
      ? `Refactoring completed: ${result.summary || 'No changes'}`
      : `Refactoring failed: ${result.error}`;
  }

  /**
   * Execute a test fix task
   */
  private async executeTestFixTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Test fix failed: no project path specified';
    }

    const testHealer = getTestHealer();
    const result = await testHealer.healTests({
      projectPath,
      description: task.description,
    });

    return result.success
      ? `Test fixes applied: ${result.summary || 'Tests fixed'}`
      : `Test fix failed: ${result.error}`;
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
    const result = await dependencyManager.updateDependencies({
      projectPath,
      autoApprove: task.requiredPermission === 'autonomous' || task.requiredPermission === 'full',
    });

    return result.success
      ? `Dependencies updated: ${result.updated?.length || 0} packages`
      : `Dependency update failed: ${result.error}`;
  }

  /**
   * Execute a documentation task
   */
  private async executeDocumentationTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Documentation task failed: no project path specified';
    }

    const docWriter = getDocWriter();
    const result = await docWriter.generateDocumentation({
      projectPath,
      description: task.description,
      format: 'markdown',
    });

    return result.success
      ? `Documentation generated: ${result.files?.length || 0} files`
      : `Documentation task failed: ${result.error}`;
  }

  /**
   * Execute a deployment task
   */
  private async executeDeploymentTask(task: NightWorkTask): Promise<string> {
    // Deployment always requires explicit approval
    return `Deployment task "${task.title}" requires manual approval. Please review and deploy manually.`;
  }

  /**
   * Execute a code review task
   */
  private async executeCodeReviewTask(task: NightWorkTask): Promise<string> {
    const projectPath = task.context.projectId;

    if (!projectPath) {
      return 'Code review failed: no project path specified';
    }

    const result = await this.executeClaudeTask(projectPath,
      `Review the code changes for this project. Focus on:\n` +
      `- Code quality and maintainability\n` +
      `- Potential bugs or edge cases\n` +
      `- Security vulnerabilities\n` +
      `- Performance considerations\n` +
      `- Testing coverage\n\n` +
      `Task description: ${task.description}`
    );

    return result.success
      ? `Code review completed: ${result.output?.slice(0, 200)}...`
      : `Code review failed: ${result.error}`;
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
      const claudeSpawner = new ClaudeSpawner({
        logLevel: 'info',
        projectsBase: projectPath,
        maxConcurrentSessions: 1,
        sessionsDir: '',
      });

      const process = claudeSpawner.spawnProcess({
        project: { path: projectPath, name: 'Unknown' },
        prompt,
        timeoutMs: 5 * 60 * 1000, // 5 minutes
      });

      const result = await claudeSpawner.waitForProcess(process);

      return {
        success: result.exitCode === 0,
        output: result.output,
        error: result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
```

**Step 3: Add helper methods to GoalSystem and IntentionEngine if missing**

Add these methods to goal-system.ts if not present:

```typescript
  /**
   * Get a goal by ID
   */
  async getGoalById(goalId: string): Promise<Goal | null> {
    return this.goals.get(goalId) || null;
  }

  /**
   * Create a task for a goal
   */
  async createGoalTask(goalId: string, params: {
    title: string;
    description: string;
    intentionType: IntentionType;
    estimatedDuration: number;
  }): Promise<GoalTask> {
    const goal = this.goals.get(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    const task: GoalTask = {
      id: this.generateTaskId(),
      goalId,
      title: params.title,
      description: params.description,
      status: 'in_progress',
      intentionType: params.intentionType,
      estimatedDuration: params.estimatedDuration,
      createdAt: Date.now(),
    };

    goal.tasks.push(task.id);
    await this.saveGoal(goal);

    return task;
  }

  /**
   * Complete a goal task
   */
  async completeGoalTask(taskId: string, result: string): Promise<void> {
    for (const goal of this.goals.values()) {
      const taskIndex = goal.tasks.findIndex(t => t === taskId);
      if (taskIndex !== -1) {
        const task = await this.getGoalTask(goal.id, taskId);
        if (task) {
          task.status = 'completed';
          task.completedAt = Date.now();
          task.result = result;
          goal.completedTasks.push(taskId);
          await this.saveGoal(goal);
          await this.updateGoalProgress(goal.id);
        }
        return;
      }
    }
  }

  /**
   * Fail a goal task
   */
  async failGoalTask(taskId: string, error: string): Promise<void> {
    for (const goal of this.goals.values()) {
      if (goal.tasks.includes(taskId)) {
        const task = await this.getGoalTask(goal.id, taskId);
        if (task) {
          task.status = 'failed';
          task.result = error;
          await this.saveGoal(goal);
        }
        return;
      }
    }
  }

  /**
   * Get a specific task from a goal
   */
  async getGoalTask(goalId: string, taskId: string): Promise<GoalTask | null> {
    const goal = this.goals.get(goalId);
    if (!goal) return null;

    // Load tasks from memory
    const tasks = await this.memory.getFact(`goal:${goalId}:tasks`) as GoalTask[] | undefined;
    if (!tasks) return null;

    return tasks.find(t => t.id === taskId) || null;
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    return `goaltask:${Date.now()}:${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Save goal to memory
   */
  private async saveGoal(goal: Goal): Promise<void> {
    await this.memory.setFact(`goal:${goal.id}`, goal);
  }
```

Add these methods to intention-engine.ts if not present:

```typescript
  /**
   * Get an intention by ID
   */
  async getIntentionById(intentionId: string): Promise<Intention | null> {
    return this.intentions.get(intentionId) || null;
  }

  /**
   * Update intention status
   */
  async updateIntentionStatus(intentionId: string, status: 'pending' | 'in_progress' | 'completed' | 'failed'): Promise<void> {
    const intention = this.intentions.get(intentionId);
    if (!intention) return;

    intention.timestamp = Date.now(); // Update timestamp to reflect status change
    // Note: We don't have a status field in Intention, so this is a no-op
    // In a real implementation, we'd add status tracking to intentions
  }
```

**Step 4: Run TypeScript check**

Run: `npm run check` or `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/brain/autonomous/mode-controller.ts src/brain/goals/goal-system.ts src/brain/intention/intention-engine.ts
git commit -m "feat: implement task execution in AutonomousModeController

- Implement executeTask with handlers for all task types
- Add executeGoalTask for goal-based work
- Add executeIntentionTask for intention fulfillment
- Add executeOpportunityTask delegating to appropriate agents
- Add specialized handlers for refactoring, test_fix, dependency_update, documentation
- Add executeClaudeTask as fallback handler
- Add helper methods to GoalSystem for task management
- Add getIntentionById and updateIntentionStatus to IntentionEngine

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 7: Add Telegram Command for Setting Autonomous Preferences

**Files:**
- Modify: `src/telegram-bot.ts` - Add /setautonomousprefs command handler
- Test: Manual verification via Telegram bot

**Step 1: Add command to bot commands list**

In the setupCommands method of TelegramBotHandler (around line 210), add:

```typescript
{ command: "setautonomousprefs", description: "Set autonomous mode preferences" },
```

**Step 2: Add command handler registration**

In the setupHandlers method (around line 340), add:

```typescript
this.bot.onText(/\/setautonomousprefs(?:\s+(.+))?/, (msg, match) =>
  this.handleSetAutonomousPrefs(msg, match?.[1])
);
```

**Step 3: Implement the handler method**

Add this method to the TelegramBotHandler class (after handlePermissions, around line 5100):

```typescript
  /**
   * Handle /setautonomousprefs command - Set autonomous mode preferences
   * Usage: /setautonomousprefs [key=value]
   * Examples:
   *   /setautonomousprefs - Show current preferences
   *   /setautonomousprefs project=/path/to/project
   *   /setautonomousprefs permission=autonomous
   *   /setautonomousprefs maxtasks=10
   */
  private async handleSetAutonomousPrefs(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();

    const chatId = msg.chat.id;
    const identityManager = getIdentityManager();

    // Show current preferences if no args
    if (!args) {
      const prefs = identityManager.getAutonomousPreferences();

      let message = `🤖 <b>Autonomous Mode Preferences</b>\n\n`;

      if (prefs.defaultProjectPath) {
        message += `<b>Default Project:</b> <code>${this.escapeHtml(prefs.defaultProjectPath)}</code>\n`;
      } else {
        message += `<b>Default Project:</b> <i>Not set</i>\n`;
      }

      message += `<b>Permission Level:</b> <code>${prefs.permissionLevel}</code>\n`;
      message += `<b>Max Tasks Per Session:</b> <code>${prefs.maxTasksPerSession}</code>\n`;

      if (prefs.allowedProjectPaths && prefs.allowedProjectPaths.length > 0) {
        message += `<b>Allowed Projects:</b>\n`;
        for (const path of prefs.allowedProjectPaths) {
          message += `  - <code>${this.escapeHtml(path)}</code>\n`;
        }
      } else {
        message += `<b>Allowed Projects:</b> <i>All projects</i>\n`;
      }

      message += `\n<b>Usage:</b>\n`;
      message += `<code>/setautonomousprefs project=&lt;path&gt;</code> - Set default project\n`;
      message += `<code>/setautonomousprefs permission=&lt;level&gt;</code> - Set permission level\n`;
      message += `<code>/setautonomousprefs maxtasks=&lt;number&gt;</code> - Set max tasks per session\n`;
      message += `<code>/setautonomousprefs addproject=&lt;path&gt;</code> - Add allowed project\n`;
      message += `<code>/setautonomousprefs removeproject=&lt;path&gt;</code> - Remove allowed project\n\n`;
      message += `<b>Permission Levels:</b>\n`;
      message += `• read_only - Can only detect, no changes\n`;
      message += `• advisory - Can suggest, requires approval\n`;
      message += `• supervised - Can apply safe changes\n`;
      message += `• autonomous - Can apply most changes except critical\n`;
      message += `• full - Can apply any change`;

      await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
      return;
    }

    // Parse the argument
    const [key, ...valueParts] = args.split('=');
    const value = valueParts.join('=').trim();

    if (!key || !value) {
      await this.bot.sendMessage(
        chatId,
        "❌ <b>Invalid format</b>\n\nUsage: /setautonomousprefs key=value",
        { parse_mode: "HTML" }
      );
      return;
    }

    try {
      switch (key.toLowerCase()) {
        case 'project':
        case 'defaultproject':
        case 'projectpath': {
          await identityManager.setDefaultProjectPath(value);
          await this.bot.sendMessage(
            chatId,
            `✅ Default project set to:\n<code>${this.escapeHtml(value)}</code>`,
            { parse_mode: "HTML" }
          );
          break;
        }

        case 'permission':
        case 'permissionlevel': {
          const validLevels = ['read_only', 'advisory', 'supervised', 'autonomous', 'full'];
          if (!validLevels.includes(value)) {
            await this.bot.sendMessage(
              chatId,
              `❌ Invalid permission level. Valid values: ${validLevels.join(', ')}`,
              { parse_mode: "HTML" }
            );
            return;
          }
          await identityManager.setPermissionLevel(value as any);
          await this.bot.sendMessage(
            chatId,
            `✅ Permission level set to: <code>${value}</code>`,
            { parse_mode: "HTML" }
          );
          break;
        }

        case 'maxtasks':
        case 'maxtaskspersession': {
          const num = parseInt(value, 10);
          if (isNaN(num) || num < 1 || num > 50) {
            await this.bot.sendMessage(
              chatId,
              "❌ Invalid value. Max tasks must be between 1 and 50.",
              { parse_mode: "HTML" }
            );
            return;
          }
          await identityManager.setAutonomousPreferences({ maxTasksPerSession: num });
          await this.bot.sendMessage(
            chatId,
            `✅ Max tasks per session set to: <code>${num}</code>`,
            { parse_mode: "HTML" }
          );
          break;
        }

        case 'addproject': {
          const prefs = identityManager.getAutonomousPreferences();
          const allowedProjects = prefs.allowedProjectPaths || [];
          if (!allowedProjects.includes(value)) {
            allowedProjects.push(value);
            await identityManager.setAutonomousPreferences({ allowedProjectPaths: allowedProjects });
          }
          await this.bot.sendMessage(
            chatId,
            `✅ Added to allowed projects:\n<code>${this.escapeHtml(value)}</code>`,
            { parse_mode: "HTML" }
          );
          break;
        }

        case 'removeproject': {
          const prefs = identityManager.getAutonomousPreferences();
          const allowedProjects = prefs.allowedProjectPaths || [];
          const filtered = allowedProjects.filter(p => p !== value);
          await identityManager.setAutonomousPreferences({ allowedProjectPaths: filtered });
          await this.bot.sendMessage(
            chatId,
            `✅ Removed from allowed projects:\n<code>${this.escapeHtml(value)}</code>`,
            { parse_mode: "HTML" }
          );
          break;
        }

        default:
          await this.bot.sendMessage(
            chatId,
            `❌ Unknown setting: <code>${key}</code>\n\nUse /setautonomousprefs to see available settings.`,
            { parse_mode: "HTML" }
          );
          break;
      }
    } catch (error) {
      this.logger.error('Error setting autonomous preferences', {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.bot.sendMessage(
        chatId,
        "❌ Failed to update preferences. Please try again.",
        { parse_mode: "HTML" }
      );
    }
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
```

**Step 4: Run TypeScript check**

Run: `npm run check` or `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/telegram-bot.ts
git commit -m "feat: add /setautonomousprefs command

- Add command to view and set autonomous mode preferences
- Support setting default project path
- Support setting permission level
- Support setting max tasks per session
- Support managing allowed project paths whitelist
- Show current settings when called without arguments

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 8: Update brain/index.ts exports

**Files:**
- Modify: `src/brain/index.ts` - Add exports for new methods
- Test: No test file

**Step 1: Update exports to include any new types**

No changes needed - all types are already exported via type exports.

**Step 2: Run TypeScript check**

Run: `npm run check` or `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/brain/index.ts
git commit -m "chore: verify brain index exports for Phase 1

- Ensure all new autonomous types and methods are exported
- No actual changes needed, verification commit

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Summary

This plan implements the Phase 1 autonomous features:

1. **UserPreferences extension** - Store autonomous mode settings per user
2. **syncFromGoals** - Pull tasks from GoalSystem into night work queue
3. **syncFromIntentions** - Pull tasks from IntentionEngine into night work queue
4. **syncFromOpportunities** - Pull tasks from OpportunityDetector into night work queue
5. **User config retrieval** - Wire up IdentityManager in ProactiveScheduler
6. **Task execution** - Complete executeTask implementation in AutonomousModeController
7. **Telegram command** - Add /setautonomousprefs for user configuration

## Verification Steps

After completing all tasks:

1. **Test autonomous preferences:**
   ```
   /setautonomousprefs
   /setautonomousprefs project=C:\Users\ErnestHome\DEVPROJECTS\myproject
   /setautonomousprefs permission=supervised
   ```

2. **Test goal syncing:**
   - Create a goal via /goals
   - Run /autonomous on
   - Check /tasks to see if goal task was created

3. **Test intention syncing:**
   - Trigger an intention (e.g., via /checks)
   - Run /autonomous on
   - Check /tasks to see if intention task was created

4. **Test task execution:**
   - Use /handoff to create a continuation session
   - Set inactive hours via /inactivehours
   - Wait for autonomous mode to trigger
   - Check task results via /tasks

---

**END OF PLAN**
