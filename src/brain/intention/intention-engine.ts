/**
 * Intention Engine - Converts events into actionable intentions
 *
 * The Intention Engine is the first step in the autonomous AI pipeline.
 * It processes various triggers (time-based, event-based, pattern-based,
 * context-based, heartbeat) and converts them into structured intentions
 * that can be evaluated by the Decision Maker.
 *
 * Flow:
 * 1. Event/Trigger occurs
 * 2. Intention Engine processes trigger
 * 3. Creates Intention with metadata
 * 4. Scores confidence
 * 5. Queues for Decision Maker evaluation
 */

import { getMemoryStore } from '../memory/memory-store.js';

// ===========================================
// Types
// ===========================================

/**
 * Intention Type - What kind of action is being suggested
 */
export type IntentionType =
  | 'refactor'      // Code restructuring/improvement
  | 'fix'           // Bug fixing
  | 'improve'       // General improvement
  | 'analyze'       // Deep analysis
  | 'implement'     // Feature implementation
  | 'update'        // Dependency update
  | 'test'          // Test related
  | 'optimize'      // Performance optimization
  | 'document';     // Documentation

/**
 * Intention Source - What triggered this intention
 */
export type IntentionSource =
  | 'time'          // Scheduled/cron trigger
  | 'event'         // Git push, test failure, file change
  | 'pattern'       // Detected anti-pattern, code smell
  | 'context'       // Project state analysis
  | 'heartbeat'     // Periodic monitoring
  | 'user';         // User-initiated

/**
 * Intention Priority - How urgent is this
 */
export type IntentionPriority =
  | 'urgent'        // Immediate attention needed
  | 'high'          // Should be addressed soon
  | 'medium'        // Normal priority
  | 'low';          // Nice to have

/**
 * Main Intention interface
 */
export interface Intention {
  id: string;
  type: IntentionType;
  source: IntentionSource;
  priority: IntentionPriority;
  title: string;
  description: string;
  reasoning: string;           // Why this intention was created
  evidence: Evidence[];        // Data supporting the intention
  suggestedAction: string;     // What to do about it
  confidence: number;          // 0-1, how sure are we
  projectPath: string;
  chatId: number;              // Which user/session this is for
  timestamp: number;
  expiresAt?: number;          // When this intention is no longer relevant
  metadata: Record<string, unknown>;
}

/**
 * Evidence supporting an intention
 */
export interface Evidence {
  type: 'metric' | 'file' | 'test' | 'dependency' | 'pattern' | 'commit';
  description: string;
  value: string | number;
  location?: string;           // File path, test name, etc.
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Trigger types that can create intentions
 */
export interface Trigger {
  type: 'test_failure' | 'build_broken' | 'complexity_high' | 'duplication_found'
       | 'dependency_outdated' | 'dependency_vulnerable' | 'pattern_detected'
       | 'coverage_low' | 'scheduled' | 'heartbeat' | 'user_request';
  projectPath: string;
  chatId: number;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Intention filter criteria
 */
export interface IntentionFilter {
  types?: IntentionType[];
  sources?: IntentionSource[];
  priorities?: IntentionPriority[];
  minConfidence?: number;
  projectPath?: string;
  chatId?: number;
  active?: boolean;            // Only non-expired intentions
}

// ===========================================
// Configuration
// ===========================================

const INTENTION_CONFIG = {
  // Minimum confidence to create an intention
  minConfidence: 0.3,

  // Default intention TTL (milliseconds)
  defaultTTL: 24 * 60 * 60 * 1000, // 24 hours

  // Maximum intentions in queue per project
  maxQueueSize: 50,

  // Confidence thresholds by priority
  priorityThresholds: {
    urgent: 0.9,
    high: 0.7,
    medium: 0.5,
    low: 0.3,
  } as Record<IntentionPriority, number>,
};

// ===========================================
// Intention Engine Class
// ===========================================

export class IntentionEngine {
  private memory = getMemoryStore();
  private intentions = new Map<string, Intention>();

  /**
   * Process a trigger and create intentions
   */
  async processTrigger(trigger: Trigger): Promise<Intention[]> {
    const createdIntentionIds: string[] = [];

    try {
      switch (trigger.type) {
        case 'test_failure':
          createdIntentionIds.push(...await this.handleTestFailure(trigger));
          break;

        case 'build_broken':
          createdIntentionIds.push(...await this.handleBuildBroken(trigger));
          break;

        case 'complexity_high':
          createdIntentionIds.push(...await this.handleHighComplexity(trigger));
          break;

        case 'duplication_found':
          createdIntentionIds.push(...await this.handleDuplication(trigger));
          break;

        case 'dependency_outdated':
          createdIntentionIds.push(...await this.handleOutdatedDependency(trigger));
          break;

        case 'dependency_vulnerable':
          createdIntentionIds.push(...await this.handleVulnerableDependency(trigger));
          break;

        case 'pattern_detected':
          createdIntentionIds.push(...await this.handlePatternDetected(trigger));
          break;

        case 'coverage_low':
          createdIntentionIds.push(...await this.handleLowCoverage(trigger));
          break;

        case 'scheduled':
          createdIntentionIds.push(...await this.handleScheduled(trigger));
          break;

        case 'heartbeat':
          createdIntentionIds.push(...await this.handleHeartbeat(trigger));
          break;

        case 'user_request':
          createdIntentionIds.push(...await this.handleUserRequest(trigger));
          break;

        default:
          // Unknown trigger type, ignore
          break;
      }

      // Store intentions
      const intentions: Intention[] = [];
      for (const id of createdIntentionIds) {
        const intention = this.intentions.get(id);
        if (intention) {
          intentions.push(intention);
          await this.storeIntention(intention);
        }
      }

      return intentions;

    } catch (error) {
      console.error('[IntentionEngine] Error processing trigger:', error);
      return [];
    }
  }

  /**
   * Handle test failure trigger
   */
  private async handleTestFailure(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { testFile, testName, failCount } = trigger.data as {
      testFile?: string;
      testName?: string;
      failCount?: number;
    };

    if (!testFile && !testName) return ids;

    const intention = this.createIntention({
      type: 'fix',
      source: 'event',
      priority: failCount && failCount > 1 ? 'high' : 'medium',
      title: `Fix failing test${testName ? `: ${testName}` : ''}`,
      description: `A test is failing${testFile ? ` in ${testFile}` : ''}${failCount && failCount > 1 ? ` (failed ${failCount} times)` : ''}`,
      reasoning: 'Failing tests indicate a bug or regression that should be fixed',
      suggestedAction: 'Analyze the test failure, identify the root cause, and fix the issue',
      confidence: 0.85,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'test',
          description: 'Test failed',
          value: testName || testFile || 'unknown',
          location: testFile,
          severity: failCount && failCount > 1 ? 'high' : 'medium',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle build broken trigger
   */
  private async handleBuildBroken(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { error } = trigger.data as { error?: string };

    const intention = this.createIntention({
      type: 'fix',
      source: 'event',
      priority: 'urgent',
      title: 'Fix broken build',
      description: `The build is failing${error ? ` with error: ${error}` : ''}`,
      reasoning: 'A broken build blocks all development and must be fixed immediately',
      suggestedAction: 'Investigate the build error and fix the underlying issue',
      confidence: 0.95,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'metric',
          description: 'Build status',
          value: 'failed',
          severity: 'critical',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle high complexity trigger
   */
  private async handleHighComplexity(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { file, complexity } = trigger.data as {
      file?: string;
      complexity?: number;
    };

    if (!file) return ids;

    const intention = this.createIntention({
      type: 'refactor',
      source: 'pattern',
      priority: complexity && complexity > 50 ? 'high' : 'medium',
      title: `Refactor complex file: ${file}`,
      description: `File has high cyclomatic complexity${complexity ? ` (${complexity})` : ''}`,
      reasoning: 'High complexity makes code hard to understand, test, and maintain',
      suggestedAction: 'Break down complex functions into smaller, more focused units',
      confidence: 0.75,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'metric',
          description: 'Cyclomatic complexity',
          value: complexity || 0,
          location: file,
          severity: complexity && complexity > 50 ? 'high' : 'medium',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle duplication found trigger
   */
  private async handleDuplication(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { duplicateLines, percentage } = trigger.data as {
      duplicateLines?: number;
      percentage?: number;
    };

    const intention = this.createIntention({
      type: 'refactor',
      source: 'pattern',
      priority: percentage && percentage > 10 ? 'high' : 'medium',
      title: 'Reduce code duplication',
      description: `Found ${duplicateLines || 0} duplicate lines (${percentage || 0}% of codebase)`,
      reasoning: 'Code duplication leads to maintenance issues and bugs',
      suggestedAction: 'Extract duplicated code into reusable functions or modules',
      confidence: 0.8,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'metric',
          description: 'Duplication rate',
          value: percentage || 0,
          severity: percentage && percentage > 10 ? 'high' : 'medium',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle outdated dependency trigger
   */
  private async handleOutdatedDependency(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { package: pkg, current, latest, type } = trigger.data as {
      package?: string;
      current?: string;
      latest?: string;
      type?: 'dev' | 'prod';
    };

    if (!pkg) return ids;

    const intention = this.createIntention({
      type: 'update',
      source: 'event',
      priority: type === 'prod' ? 'medium' : 'low',
      title: `Update dependency: ${pkg}`,
      description: `Update ${pkg} from ${current || 'unknown'} to ${latest || 'latest'}`,
      reasoning: 'Keeping dependencies updated ensures security and performance improvements',
      suggestedAction: `Update ${pkg} to version ${latest || 'latest'} and run tests`,
      confidence: 0.6,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'dependency',
          description: 'Outdated package',
          value: pkg,
          severity: 'low',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle vulnerable dependency trigger
   */
  private async handleVulnerableDependency(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { package: pkg, vulnerability, severity } = trigger.data as {
      package?: string;
      vulnerability?: string;
      severity?: 'low' | 'moderate' | 'high' | 'critical';
    };

    if (!pkg) return ids;

    const intention = this.createIntention({
      type: 'fix',
      source: 'event',
      priority: severity === 'critical' || severity === 'high' ? 'urgent' : 'high',
      title: `Fix security vulnerability in ${pkg}`,
      description: `Vulnerability detected${vulnerability ? `: ${vulnerability}` : ''}`,
      reasoning: 'Security vulnerabilities should be addressed immediately',
      suggestedAction: `Update ${pkg} to a secure version`,
      confidence: 0.9,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'dependency',
          description: 'Security vulnerability',
          value: pkg,
          severity: severity === 'critical' || severity === 'high' ? 'critical' : 'high',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle pattern detected trigger
   */
  private async handlePatternDetected(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { pattern, description } = trigger.data as {
      pattern?: string;
      description?: string;
    };

    if (!pattern) return ids;

    const intention = this.createIntention({
      type: 'refactor',
      source: 'pattern',
      priority: 'medium',
      title: `Address anti-pattern: ${pattern}`,
      description: description || `Detected anti-pattern in codebase`,
      reasoning: 'Anti-patterns lead to maintainability and reliability issues',
      suggestedAction: `Refactor code to avoid the ${pattern} pattern`,
      confidence: 0.7,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'pattern',
          description: pattern,
          value: 0,
          severity: 'medium',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle low coverage trigger
   */
  private async handleLowCoverage(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { coverage, threshold } = trigger.data as {
      coverage?: number;
      threshold?: number;
    };

    const intention = this.createIntention({
      type: 'improve',
      source: 'context',
      priority: 'medium',
      title: 'Improve test coverage',
      description: `Test coverage is ${coverage || 0}%, below target of ${threshold || 80}%`,
      reasoning: 'Low test coverage means untested code and potential bugs',
      suggestedAction: 'Add tests for uncovered code paths',
      confidence: 0.8,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'metric',
          description: 'Test coverage',
          value: coverage || 0,
          severity: 'medium',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle scheduled trigger
   */
  private async handleScheduled(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { task, schedule } = trigger.data as {
      task?: string;
      schedule?: string;
    };

    const intention = this.createIntention({
      type: 'analyze',
      source: 'time',
      priority: 'low',
      title: `Scheduled: ${task || 'analysis'}`,
      description: `Scheduled task: ${task || 'Periodic analysis'}`,
      reasoning: `Scheduled to run at ${schedule || 'regular intervals'}`,
      suggestedAction: task || 'Run periodic analysis',
      confidence: 0.5,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Handle heartbeat trigger - scan for opportunities
   */
  private async handleHeartbeat(_trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];

    // Heartbeat does various scans
    // This is where we'd check for various opportunities

    return ids;
  }

  /**
   * Handle user request trigger
   */
  private async handleUserRequest(trigger: Trigger): Promise<string[]> {
    const ids: string[] = [];
    const { request, description } = trigger.data as {
      request?: string;
      description?: string;
    };

    if (!request) return ids;

    const intention = this.createIntention({
      type: 'implement',
      source: 'user',
      priority: 'high',
      title: `User request: ${request}`,
      description: description || request,
      reasoning: 'User explicitly requested this action',
      suggestedAction: request,
      confidence: 0.95,
      projectPath: trigger.projectPath,
      chatId: trigger.chatId,
      evidence: [
        {
          type: 'pattern',
          description: 'User request',
          value: request,
          severity: 'low',
        },
      ],
    });

    ids.push(intention.id);
    this.intentions.set(intention.id, intention);

    return ids;
  }

  /**
   * Create an intention from parameters
   */
  private createIntention(params: {
    type: IntentionType;
    source: IntentionSource;
    priority: IntentionPriority;
    title: string;
    description: string;
    reasoning: string;
    suggestedAction: string;
    confidence: number;
    projectPath: string;
    chatId: number;
    evidence: Evidence[];
  }): Intention {
    const id = this.generateId();

    // Check minimum confidence
    if (params.confidence < INTENTION_CONFIG.minConfidence) {
      params.confidence = INTENTION_CONFIG.minConfidence;
    }

    // Adjust confidence based on priority threshold
    const minConfidenceForPriority = INTENTION_CONFIG.priorityThresholds[params.priority];
    if (params.confidence < minConfidenceForPriority) {
      params.confidence = minConfidenceForPriority;
    }

    return {
      id,
      type: params.type,
      source: params.source,
      priority: params.priority,
      title: params.title,
      description: params.description,
      reasoning: params.reasoning,
      evidence: params.evidence,
      suggestedAction: params.suggestedAction,
      confidence: Math.min(params.confidence, 1),
      projectPath: params.projectPath,
      chatId: params.chatId,
      timestamp: Date.now(),
      expiresAt: Date.now() + INTENTION_CONFIG.defaultTTL,
      metadata: {},
    };
  }

  /**
   * Store intention in memory
   */
  private async storeIntention(intention: Intention): Promise<void> {
    try {
      await this.memory.setFact(
        `intention:${intention.id}`,
        intention
      );
    } catch (error) {
      console.error('[IntentionEngine] Failed to store intention:', error);
    }
  }

  /**
   * Get intentions by filter
   */
  getIntentions(filter: IntentionFilter = {}): Intention[] {
    let results = Array.from(this.intentions.values());

    // Filter by type
    if (filter.types && filter.types.length > 0) {
      results = results.filter(i => filter.types!.includes(i.type));
    }

    // Filter by source
    if (filter.sources && filter.sources.length > 0) {
      results = results.filter(i => filter.sources!.includes(i.source));
    }

    // Filter by priority
    if (filter.priorities && filter.priorities.length > 0) {
      results = results.filter(i => filter.priorities!.includes(i.priority));
    }

    // Filter by minimum confidence
    if (filter.minConfidence !== undefined) {
      results = results.filter(i => i.confidence >= filter.minConfidence!);
    }

    // Filter by project
    if (filter.projectPath) {
      results = results.filter(i => i.projectPath === filter.projectPath);
    }

    // Filter by chat
    if (filter.chatId) {
      results = results.filter(i => i.chatId === filter.chatId);
    }

    // Filter active (non-expired)
    if (filter.active !== undefined && filter.active) {
      const now = Date.now();
      results = results.filter(i => !i.expiresAt || i.expiresAt > now);
    }

    // Sort by priority and confidence
    results.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });

    return results;
  }

  /**
   * Get intention by ID
   */
  getIntention(id: string): Intention | undefined {
    return this.intentions.get(id);
  }

  /**
   * Remove intention
   */
  removeIntention(id: string): boolean {
    return this.intentions.delete(id);
  }

  /**
   * Clear expired intentions
   */
  clearExpired(): number {
    const now = Date.now();
    let cleared = 0;

    for (const [id, intention] of this.intentions.entries()) {
      if (intention.expiresAt && intention.expiresAt < now) {
        this.intentions.delete(id);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Get intention statistics
   */
  getStats(projectPath?: string): {
    total: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    bySource: Record<string, number>;
    avgConfidence: number;
  } {
    let intentions = Array.from(this.intentions.values());

    if (projectPath) {
      intentions = intentions.filter(i => i.projectPath === projectPath);
    }

    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let totalConfidence = 0;

    for (const intention of intentions) {
      byType[intention.type] = (byType[intention.type] || 0) + 1;
      byPriority[intention.priority] = (byPriority[intention.priority] || 0) + 1;
      bySource[intention.source] = (bySource[intention.source] || 0) + 1;
      totalConfidence += intention.confidence;
    }

    return {
      total: intentions.length,
      byType,
      byPriority,
      bySource,
      avgConfidence: intentions.length > 0 ? totalConfidence / intentions.length : 0,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `intention-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ===========================================
// Global Singleton
// ===========================================

let globalIntentionEngine: IntentionEngine | null = null;

export function getIntentionEngine(): IntentionEngine {
  if (!globalIntentionEngine) {
    globalIntentionEngine = new IntentionEngine();
  }
  return globalIntentionEngine;
}

export function resetIntentionEngine(): void {
  globalIntentionEngine = null;
}
