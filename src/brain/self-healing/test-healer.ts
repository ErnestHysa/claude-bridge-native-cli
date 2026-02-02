/**
 * Test Healer - Self-healing system for test failures
 *
 * The Test Healer automatically detects test failures and attempts to fix them.
 * It integrates with:
 * - TestWatcher: Monitors test results
 * - IntentionEngine: Creates fix intentions
 * - AgentOrchestrator: Executes autonomous fixes
 * - ContextTracker: Tracks healing outcomes
 *
 * Healing strategies:
 * 1. Syntax errors: Fix syntax issues
 * 2. Import errors: Fix missing/incorrect imports
 * 3. Type errors: Fix type mismatches
 * 4. Logic errors: Analyze and fix logic bugs
 * 5. Environment issues: Fix test setup/config
 */

import { getTestWatcher, type TestResult } from '../tests/test-watcher.js';
import { getIntentionEngine } from '../intention/intention-engine.js';
import { getDecisionMaker } from '../decision/decision-maker.js';
import { getOrchestrator } from '../agents/agent-orchestrator.js';
import { getMemoryStore } from '../memory/memory-store.js';

// ============================================
// Types
// ============================================

/**
 * Healing strategy for a test failure
 */
export type HealingStrategy =
  | 'syntax_fix'        // Fix syntax errors
  | 'import_fix'        // Fix missing/incorrect imports
  | 'type_fix'          // Fix type errors
  | 'logic_fix'         // Fix logic bugs
  | 'environment_fix'   // Fix test setup/config
  | 'test_update';      // Update test itself (if test is wrong)

/**
 * Severity of a test failure
 */
export type FailureSeverity =
  | 'trivial'           // Simple typo, syntax
  | 'minor'             // Import, small type issue
  | 'moderate'          // Logic error, needs analysis
  | 'major'             // Complex logic, multiple issues
  | 'critical';         // Breaks core functionality

/**
 * A test failure that needs healing
 */
export interface TestFailure {
  id: string;
  testFile: string;
  testName: string;
  failureMessage: string;
  stackTrace?: string;
  severity: FailureSeverity;
  suggestedStrategy: HealingStrategy;
  confidence: number;        // 0-1
  projectPath: string;
  chatId: number;
  timestamp: number;
  attempt?: number;          // Healing attempt number
  maxAttempts: number;
  healed: boolean;
  healingAttempts: HealingAttempt[];
}

/**
 * A healing attempt
 */
export interface HealingAttempt {
  attemptNumber: number;
  strategy: HealingStrategy;
  description: string;
  changes: Array<{
    file: string;
    action: 'modified' | 'created' | 'deleted';
    description: string;
  }>;
  success: boolean;
  errorMessage?: string;
  timestamp: number;
  duration: number;          // milliseconds
}

/**
 * Healing outcome
 */
export interface HealingOutcome {
  failureId: string;
  healed: boolean;
  attempts: number;
  finalStrategy?: HealingStrategy;
  changes: string[];
  testPassed: boolean;
  duration: number;
  timestamp: number;
}

// ============================================
// Configuration
// ============================================

const HEALING_CONFIG = {
  // Maximum healing attempts per failure
  maxAttempts: 3,

  // Confidence threshold for auto-healing
  minConfidence: 0.6,

  // Strategies to try in order
  strategyOrder: [
    'syntax_fix',
    'import_fix',
    'type_fix',
    'environment_fix',
    'logic_fix',
    'test_update',
  ] as HealingStrategy[],

  // Time to wait before retrying (ms)
  retryDelay: 1000,

  // Maximum time for healing attempt (ms)
  maxHealTime: 5 * 60 * 1000,

  // Check interval for new failures (ms)
  checkInterval: 30 * 1000,
};

// ============================================
// Test Healer Class
// ============================================

export class TestHealer {
  private memory = getMemoryStore();
  private failures = new Map<string, TestFailure>();
  private active = false;
  private healingInProgress = new Set<string>();
  private checkTimer?: NodeJS.Timeout;
  private lastResults = new Map<string, TestResult>();

  /**
   * Start the test healer
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadFailures();

    // Start periodic check for new failures
    this.checkTimer = setInterval(() => {
      this.checkForNewFailures();
    }, HEALING_CONFIG.checkInterval);

    console.log('[TestHealer] Started');
  }

  /**
   * Stop the test healer
   */
  stop(): void {
    this.active = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    console.log('[TestHealer] Stopped');
  }

  /**
   * Check for new test failures
   */
  private async checkForNewFailures(): Promise<void> {
    if (!this.active) return;

    const testWatcher = getTestWatcher();
    const projects = await this.getWatchedProjects();

    for (const projectPath of projects) {
      try {
        // Get latest test results for the project
        const results = await testWatcher.getTestResults(projectPath, 5);

        for (const result of results) {
          const resultKey = `${projectPath}:${result.timestamp}`;

          // Skip if we've already processed this result
          if (this.lastResults.has(resultKey)) continue;
          this.lastResults.set(resultKey, result);

          // Process failures
          if (result.failures && result.failures.length > 0) {
            for (const failure of result.failures) {
              await this.handleTestFailure(projectPath, result, failure);
            }
          }
        }
      } catch (error) {
        console.error('[TestHealer] Error checking for failures:', error);
      }
    }
  }

  /**
   * Handle a test failure
   */
  private async handleTestFailure(
    projectPath: string,
    result: TestResult,
    failure: { file: string; test: string; error: string }
  ): Promise<void> {
    // Get chatId from project context
    const chatId = await this.getChatIdForProject(projectPath);
    if (chatId === null) return;

    // Generate failure ID
    const failureId = this.generateFailureId(projectPath, failure.file, failure.test);

    // Check if this failure is already being healed
    if (this.healingInProgress.has(failureId)) return;
    if (this.failures.has(failureId)) {
      const existing = this.failures.get(failureId);
      if (existing?.healed) return;
    }

    // Analyze the failure
    const analysis = this.analyzeFailure(failure.error);

    // Create a failure record
    const testFailure: TestFailure = {
      id: failureId,
      testFile: failure.file,
      testName: failure.test,
      failureMessage: failure.error,
      stackTrace: result.output.substring(0, 500),
      severity: analysis.severity,
      suggestedStrategy: analysis.strategy,
      confidence: analysis.confidence,
      projectPath,
      chatId,
      timestamp: Date.now(),
      maxAttempts: HEALING_CONFIG.maxAttempts,
      healed: false,
      healingAttempts: [],
    };

    this.failures.set(failureId, testFailure);
    await this.storeFailure(testFailure);

    // Attempt to heal if confidence is high enough
    if (analysis.confidence >= HEALING_CONFIG.minConfidence) {
      this.attemptHeal(failureId).catch(err => {
        console.error('[TestHealer] Healing attempt failed:', err);
      });
    } else {
      // Create an intention for manual review
      await this.createIntentionForFailure(testFailure);
    }
  }

  /**
   * Analyze a test failure to determine strategy and confidence
   */
  private analyzeFailure(error: string): {
    severity: FailureSeverity;
    strategy: HealingStrategy;
    confidence: number;
  } {
    const errorLower = error.toLowerCase();

    // Syntax errors
    if (errorLower.includes('syntax') || errorLower.includes('unexpected token')) {
      return {
        severity: 'trivial',
        strategy: 'syntax_fix',
        confidence: 0.95,
      };
    }

    // Import errors
    if (errorLower.includes('cannot find module') || errorLower.includes('import')) {
      return {
        severity: 'minor',
        strategy: 'import_fix',
        confidence: 0.85,
      };
    }

    // Type errors
    if (errorLower.includes('type') && (errorLower.includes('not assignable') || errorLower.includes('is not assignable'))) {
      return {
        severity: 'minor',
        strategy: 'type_fix',
        confidence: 0.75,
      };
    }

    // Environment/setup errors
    if (errorLower.includes('timeout') || errorLower.includes('before each') || errorLower.includes('after each')) {
      return {
        severity: 'moderate',
        strategy: 'environment_fix',
        confidence: 0.65,
      };
    }

    // Assertion errors (logic issues)
    if (errorLower.includes('expected') || errorLower.includes('assert') || errorLower.includes('equal')) {
      return {
        severity: 'moderate',
        strategy: 'logic_fix',
        confidence: 0.55,
      };
    }

    // Unknown errors - low confidence
    return {
      severity: 'major',
      strategy: 'logic_fix',
      confidence: 0.4,
    };
  }

  /**
   * Attempt to heal a test failure
   */
  async attemptHeal(failureId: string): Promise<HealingOutcome | null> {
    const testFailure = this.failures.get(failureId);
    if (!testFailure) return null;

    if (this.healingInProgress.has(failureId)) {
      return null; // Already healing
    }

    this.healingInProgress.add(failureId);

    const startTime = Date.now();
    let healed = false;
    let finalStrategy: HealingStrategy | undefined;

    try {
      // Get permission level for this user
      const decisionMaker = getDecisionMaker();
      const preferences = await decisionMaker.getUserPreferences(testFailure.chatId);
      const canAutoHeal = preferences.permissionLevel === 'autonomous' ||
                         preferences.permissionLevel === 'full';

      if (!canAutoHeal) {
        // Create intention instead
        await this.createIntentionForFailure(testFailure);
        return null;
      }

      // Try each strategy in order
      const strategiesToTry = HEALING_CONFIG.strategyOrder;
      const attemptNumber = (testFailure.attempt || 0) + 1;

      for (const strategy of strategiesToTry) {
        if (attemptNumber > testFailure.maxAttempts) break;

        const attempt = await this.executeHealingStrategy(testFailure, strategy, attemptNumber);
        testFailure.healingAttempts.push(attempt);

        if (attempt.success) {
          // Re-run the test
          const testPassed = await this.rerunTest(testFailure);

          if (testPassed) {
            healed = true;
            finalStrategy = strategy;
            testFailure.healed = true;
            break;
          }
        }

        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, HEALING_CONFIG.retryDelay));
      }

      await this.storeFailure(testFailure);

      const outcome: HealingOutcome = {
        failureId,
        healed,
        attempts: testFailure.healingAttempts.length,
        finalStrategy,
        changes: testFailure.healingAttempts.flatMap(a => a.changes.map(c => `${c.action}: ${c.file}`)),
        testPassed: healed,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };

      // Track outcome in memory
      await this.trackHealingOutcome(testFailure, outcome);

      // Clean up if healed
      if (healed) {
        this.failures.delete(failureId);
        await this.memory.setFact(`test_failure:${failureId}`, null);
      }

      return outcome;

    } catch (error) {
      console.error('[TestHealer] Error healing failure:', error);
      return null;
    } finally {
      this.healingInProgress.delete(failureId);
    }
  }

  /**
   * Execute a healing strategy
   */
  private async executeHealingStrategy(
    testFailure: TestFailure,
    strategy: HealingStrategy,
    attemptNumber: number
  ): Promise<HealingAttempt> {
    const startTime = Date.now();
    const orchestrator = getOrchestrator();

    const prompt = this.buildHealingPrompt(testFailure, strategy);

    try {
      // Use the builder agent to fix the code
      const result = await orchestrator.executeAutonomousTask({
        intentionId: testFailure.id,
        decisionId: `heal-${testFailure.id}`,
        chatId: testFailure.chatId,
        projectPath: testFailure.projectPath,
        description: `Fix test failure: ${testFailure.testName}`,
        type: strategy,
        agentType: 'builder',
        transparent: true,
      });

      const duration = Date.now() - startTime;

      if (result.success) {
        return {
          attemptNumber,
          strategy,
          description: prompt,
          changes: result.changes?.map(c => ({
            file: c.path || 'unknown',
            action: c.action as 'modified' | 'created' | 'deleted',
            description: c.type,
          })) || [],
          success: true,
          timestamp: Date.now(),
          duration,
        };
      } else {
        return {
          attemptNumber,
          strategy,
          description: prompt,
          changes: [],
          success: false,
          errorMessage: result.error,
          timestamp: Date.now(),
          duration,
        };
      }

    } catch (error) {
      return {
        attemptNumber,
        strategy,
        description: prompt,
        changes: [],
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Build a prompt for healing
   */
  private buildHealingPrompt(testFailure: TestFailure, strategy: HealingStrategy): string {
    const strategyDescriptions: Record<HealingStrategy, string> = {
      syntax_fix: 'Fix the syntax error in the code',
      import_fix: 'Fix the missing or incorrect import',
      type_fix: 'Fix the type error',
      logic_fix: 'Analyze and fix the logic bug causing the test to fail',
      environment_fix: 'Fix the test environment or setup',
      test_update: 'Update the test to match the expected behavior (if the test is incorrect)',
    };

    return `
${strategyDescriptions[strategy]}

Test File: ${testFailure.testFile}
Test Name: ${testFailure.testName}
Error: ${testFailure.failureMessage}
${testFailure.stackTrace ? `Output:\n${testFailure.stackTrace.substring(0, 500)}` : ''}

Project: ${testFailure.projectPath}

Please fix the issue and run the test again to verify.
`;
  }

  /**
   * Re-run a test to verify the fix
   */
  private async rerunTest(testFailure: TestFailure): Promise<boolean> {
    const testWatcher = getTestWatcher();

    try {
      // Run tests for the project
      const result = await testWatcher.runTests(testFailure.projectPath);

      // Check if this specific test now passes
      if (result.failures) {
        const stillFailing = result.failures.find(
          f => f.file === testFailure.testFile && f.test === testFailure.testName
        );
        return !stillFailing;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create an intention for a failure that couldn't be auto-healed
   */
  private async createIntentionForFailure(testFailure: TestFailure): Promise<void> {
    const intentionEngine = getIntentionEngine();

    await intentionEngine.processTrigger({
      type: 'test_failure',
      projectPath: testFailure.projectPath,
      chatId: testFailure.chatId,
      data: {
        testFile: testFailure.testFile,
        testName: testFailure.testName,
        error: testFailure.failureMessage,
        strategy: testFailure.suggestedStrategy,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Track healing outcome in memory
   */
  private async trackHealingOutcome(testFailure: TestFailure, outcome: HealingOutcome): Promise<void> {
    const outcomeKey = `healing_outcome:${testFailure.id}`;
    await this.memory.setFact(outcomeKey, outcome);
  }

  /**
   * Get chat ID for a project
   */
  private async getChatIdForProject(projectPath: string): Promise<number | null> {
    try {
      const key = `project:${projectPath}:chatId`;
      const chatId = await this.memory.getFact(key) as number | undefined;
      return chatId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get watched projects
   */
  private async getWatchedProjects(): Promise<string[]> {
    try {
      const projects = await this.memory.getFact('watched_projects') as string[] | undefined;
      return projects ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Store a failure in memory
   */
  private async storeFailure(testFailure: TestFailure): Promise<void> {
    await this.memory.setFact(`test_failure:${testFailure.id}`, testFailure);
  }

  /**
   * Load failures from memory
   */
  private async loadFailures(): Promise<void> {
    try {
      // This would load persisted failures
      // For now, we start fresh
    } catch (error) {
      console.error('[TestHealer] Failed to load failures:', error);
    }
  }

  /**
   * Get all active failures
   */
  getActiveFailures(): TestFailure[] {
    return Array.from(this.failures.values()).filter(f => !f.healed);
  }

  /**
   * Get failures by project
   */
  getFailuresByProject(projectPath: string): TestFailure[] {
    return Array.from(this.failures.values())
      .filter(f => f.projectPath === projectPath && !f.healed);
  }

  /**
   * Get failures by chat ID
   */
  getFailuresByChatId(chatId: number): TestFailure[] {
    return Array.from(this.failures.values())
      .filter(f => f.chatId === chatId && !f.healed);
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    active: number;
    healed: number;
    healing: number;
    byStrategy: Record<HealingStrategy, number>;
    bySeverity: Record<FailureSeverity, number>;
  } {
    const all = Array.from(this.failures.values());
    const active = all.filter(f => !f.healed && f.healingAttempts.length < f.maxAttempts);
    const healed = all.filter(f => f.healed);
    const healing = this.healingInProgress.size;

    const byStrategy: Record<HealingStrategy, number> = {
      syntax_fix: 0,
      import_fix: 0,
      type_fix: 0,
      logic_fix: 0,
      environment_fix: 0,
      test_update: 0,
    };

    const bySeverity: Record<FailureSeverity, number> = {
      trivial: 0,
      minor: 0,
      moderate: 0,
      major: 0,
      critical: 0,
    };

    for (const testFailure of all) {
      for (const attempt of testFailure.healingAttempts) {
        byStrategy[attempt.strategy]++;
      }
      bySeverity[testFailure.severity]++;
    }

    return {
      total: all.length,
      active: active.length,
      healed: healed.length,
      healing,
      byStrategy,
      bySeverity,
    };
  }

  /**
   * Manually trigger healing for a failure
   */
  async healFailure(failureId: string): Promise<HealingOutcome | null> {
    return this.attemptHeal(failureId);
  }

  /**
   * Generate a unique failure ID
   */
  private generateFailureId(projectPath: string, testFile: string, testName: string): string {
    const key = `${projectPath}:${testFile}:${testName}`;
    return `tf-${Buffer.from(key).toString('base64').substring(0, 16)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalTestHealer: TestHealer | null = null;

export function getTestHealer(): TestHealer {
  if (!globalTestHealer) {
    globalTestHealer = new TestHealer();
  }
  return globalTestHealer;
}

export function resetTestHealer(): void {
  if (globalTestHealer) {
    globalTestHealer.stop();
  }
  globalTestHealer = null;
}
