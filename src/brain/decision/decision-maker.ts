/**
 * Decision Maker - Evaluates if action should be taken
 *
 * The Decision Maker receives intentions from the Intention Engine
 * and decides:
 * 1. Should an action be taken?
 * 2. Does it require user approval?
 * 3. What is the action plan?
 * 4. What are the risks?
 *
 * It uses multiple factors to make decisions:
 * - User preferences and permission level
 * - Risk assessment of the action
 * - Current project state
 * - Time of day (quiet hours)
 * - Historical success rate
 * - Goal alignment
 */

import { getMemoryStore } from '../memory/memory-store.js';
import type { Intention, IntentionType } from '../intention/intention-engine.js';

// ===========================================
// Types
// ===========================================

/**
 * Permission levels for autonomous actions
 */
export enum PermissionLevel {
  READ_ONLY = 'read_only',       // Can only observe and suggest
  ADVISORY = 'advisory',         // Can suggest, needs approval for all
  SUPERVISED = 'supervised',     // Safe actions auto-approved
  AUTONOMOUS = 'autonomous',     // Can act independently within goals
  FULL = 'full',                 // Complete autonomy (not recommended)
}

/**
 * Risk level
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Decision output
 */
export interface Decision {
  id: string;
  intentionId: string;
  shouldAct: boolean;
  requiresApproval: boolean;
  canAutoExecute: boolean;
  actionPlan: ActionStep[];
  reasoning: string;
  risks: Risk[];
  expectedOutcome: string;
  confidence: number;
  estimatedDuration: number;     // milliseconds
  timestamp: number;
  expiresAt: number;
}

/**
 * A single step in the action plan
 */
export interface ActionStep {
  id: string;
  description: string;
  agentType: 'scout' | 'builder' | 'reviewer' | 'tester' | 'deployer' | 'custom';
  estimatedDuration: number;     // milliseconds
  reversible: boolean;
  dependencies: string[];        // IDs of steps that must complete first
}

/**
 * A risk associated with an action
 */
export interface Risk {
  level: RiskLevel;
  description: string;
  mitigation: string;
  probability: number;           // 0-1
}

/**
 * User preferences for autonomous actions
 */
export interface UserDecisionPreferences {
  permissionLevel: PermissionLevel;
  quietHours: {
    enabled: boolean;
    start: number;               // Hour (0-23)
    end: number;                 // Hour (0-23)
  };
  autoApproveRisk: RiskLevel[];  // Risk levels that can be auto-approved
  requireApprovalFor: IntentionType[];
  notifyBeforeAction: boolean;
  maxConcurrentActions: number;
}

/**
 * Decision context - information used to make decision
 */
export interface DecisionContext {
  projectHealth: number;         // 0-100
  testsPassing: boolean;
  buildStable: boolean;
  hasUncommittedChanges: boolean;
  isQuietHours: boolean;
  userGoalAlignment?: number;    // 0-1, how well this aligns with goals
  historicalSuccessRate: number; // 0-1, for similar actions
}

// ===========================================
// Configuration
// ===========================================

const DECISION_CONFIG = {
  // Default decision TTL (milliseconds)
  defaultTTL: 60 * 60 * 1000, // 1 hour

  // Risk thresholds for requiring approval
  approvalRequiredForRisk: ['high', 'critical'] as RiskLevel[],

  // Default user preferences
  defaultPreferences: {
    permissionLevel: PermissionLevel.SUPERVISED,
    quietHours: {
      enabled: false,
      start: 22,
      end: 8,
    },
    autoApproveRisk: ['low'] as RiskLevel[],
    requireApprovalFor: ['implement', 'refactor'] as IntentionType[],
    notifyBeforeAction: true,
    maxConcurrentActions: 3,
  } as UserDecisionPreferences,

  // Success rate thresholds
  minSuccessRateForAutonomous: 0.7,
  minSuccessRateForSupervised: 0.5,

  // Health thresholds
  minHealthForAutonomous: 60,

  // Priority weights for scoring
  weights: {
    userPreference: 0.4,
    riskLevel: 0.3,
    projectHealth: 0.15,
    successRate: 0.1,
    goalAlignment: 0.05,
  },
};

// ===========================================
// Risk Assessment
// ===========================================

/**
 * Default risk levels by intention type
 */
const DEFAULT_RISK_BY_TYPE: Record<IntentionType, RiskLevel> = {
  refactor: 'medium',
  fix: 'low',
  improve: 'low',
  analyze: 'low',
  implement: 'medium',
  update: 'medium',
  test: 'low',
  optimize: 'medium',
  document: 'low',
};

// ===========================================
// Decision Maker Class
// ===========================================

export class DecisionMaker {
  private memory = getMemoryStore();
  private decisions = new Map<string, Decision>();
  private userPreferences = new Map<number, UserDecisionPreferences>();

  /**
   * Evaluate an intention and make a decision
   */
  async evaluate(
    intention: Intention,
    context: DecisionContext
  ): Promise<Decision> {
    // Get user preferences
    const preferences = await this.getUserPreferences(intention.chatId);

    // Assess risks
    const risks = this.assessRisks(intention, context);

    // Calculate if action should be taken
    const shouldAct = this.shouldAct(intention, context, preferences, risks);

    // Determine if approval is required
    const requiresApproval = this.requiresApproval(
      intention,
      context,
      preferences,
      risks
    );

    // Generate action plan
    const actionPlan = this.generateActionPlan(intention, risks);

    // Calculate overall confidence
    const confidence = this.calculateConfidence(
      intention,
      context,
      preferences,
      risks
    );

    // Generate expected outcome
    const expectedOutcome = this.generateExpectedOutcome(intention, actionPlan);

    // Calculate estimated duration
    const estimatedDuration = actionPlan.reduce(
      (sum, step) => sum + step.estimatedDuration,
      0
    );

    // Check if auto-execution is possible
    const canAutoExecute = shouldAct && !requiresApproval;

    // Create decision without reasoning first
    const decision: Decision = {
      id: this.generateId(),
      intentionId: intention.id,
      shouldAct,
      requiresApproval,
      canAutoExecute,
      actionPlan,
      reasoning: '', // Will be set below
      risks,
      expectedOutcome,
      confidence,
      estimatedDuration,
      timestamp: Date.now(),
      expiresAt: Date.now() + DECISION_CONFIG.defaultTTL,
    };

    // Generate reasoning (needs decision to be created first)
    decision.reasoning = this.generateReasoning(intention, context, preferences, risks, decision);

    // Store decision
    this.decisions.set(decision.id, decision);
    await this.storeDecision(decision);

    return decision;
  }

  /**
   * Assess risks for an intention
   */
  private assessRisks(
    intention: Intention,
    context: DecisionContext
  ): Risk[] {
    const risks: Risk[] = [];

    // Base risk by type
    const baseRiskLevel = DEFAULT_RISK_BY_TYPE[intention.type];
    risks.push({
      level: baseRiskLevel,
      description: `${intention.type} actions have ${baseRiskLevel} inherent risk`,
      mitigation: 'Review changes before applying',
      probability: 0.1,
    });

    // Project health risk
    if (context.projectHealth < 50) {
      risks.push({
        level: 'high',
        description: 'Project health is poor, actions may have unexpected effects',
        mitigation: 'Address health issues first or proceed with caution',
        probability: 0.3,
      });
    }

    // Uncommitted changes risk
    if (context.hasUncommittedChanges) {
      risks.push({
        level: 'medium',
        description: 'Uncommitted changes may conflict with autonomous actions',
        mitigation: 'Commit or stash changes before proceeding',
        probability: 0.2,
      });
    }

    // Tests failing risk
    if (!context.testsPassing) {
      risks.push({
        level: 'medium',
        description: 'Tests are currently failing',
        mitigation: 'Fix existing test failures first',
        probability: 0.4,
      });
    }

    // Build not stable risk
    if (!context.buildStable) {
      risks.push({
        level: 'high',
        description: 'Build is not stable',
        mitigation: 'Fix build issues before making changes',
        probability: 0.5,
      });
    }

    // High priority actions often mean higher risk
    if (intention.priority === 'urgent') {
      risks.push({
        level: 'medium',
        description: 'Urgent actions may have incomplete analysis',
        mitigation: 'Review carefully before proceeding',
        probability: 0.25,
      });
    }

    // Intention-specific risks
    if (intention.type === 'update' || intention.type === 'implement') {
      risks.push({
        level: 'medium',
        description: 'Dependency updates and new features can introduce breaking changes',
        mitigation: 'Review changelogs and run full test suite',
        probability: 0.3,
      });
    }

    return risks;
  }

  /**
   * Determine if action should be taken
   */
  private shouldAct(
    intention: Intention,
    context: DecisionContext,
    preferences: UserDecisionPreferences,
    risks: Risk[]
  ): boolean {
    // Check permission level
    if (preferences.permissionLevel === PermissionLevel.READ_ONLY) {
      return false; // Can't act, only suggest
    }

    // Check quiet hours
    if (context.isQuietHours && intention.priority !== 'urgent') {
      return false;
    }

    // Check if user explicitly blocked this type
    if (preferences.requireApprovalFor.includes(intention.type)) {
      return true; // Still act, but requires approval
    }

    // Check max concurrent actions
    const currentActions = this.countActiveActions(intention.chatId);
    if (currentActions >= preferences.maxConcurrentActions) {
      return false;
    }

    // Check confidence threshold
    if (intention.confidence < 0.5) {
      return false;
    }

    // Check if high/critical risks make it too dangerous
    const hasCriticalRisk = risks.some(r => r.level === 'critical' && r.probability > 0.3);
    if (hasCriticalRisk && preferences.permissionLevel < PermissionLevel.FULL) {
      return false; // Too risky
    }

    return true;
  }

  /**
   * Determine if approval is required
   */
  private requiresApproval(
    intention: Intention,
    context: DecisionContext,
    preferences: UserDecisionPreferences,
    risks: Risk[]
  ): boolean {
    // Read only always needs approval (for suggestions)
    if (preferences.permissionLevel === PermissionLevel.READ_ONLY) {
      return true;
    }

    // Advisory always needs approval
    if (preferences.permissionLevel === PermissionLevel.ADVISORY) {
      return true;
    }

    // Check if intention type requires approval
    if (preferences.requireApprovalFor.includes(intention.type)) {
      return true;
    }

    // Check if risk level requires approval
    const maxRisk = this.getMaxRiskLevel(risks);
    if (!preferences.autoApproveRisk.includes(maxRisk)) {
      return true;
    }

    // High and critical always need approval unless FULL autonomy
    if ((maxRisk === 'high' || maxRisk === 'critical') &&
        preferences.permissionLevel < PermissionLevel.FULL) {
      return true;
    }

    // During quiet hours, always ask for approval
    if (context.isQuietHours) {
      return true;
    }

    // Implement and refactor always need approval for supervised and below
    if ((intention.type === 'implement' || intention.type === 'refactor') &&
        preferences.permissionLevel < PermissionLevel.AUTONOMOUS) {
      return true;
    }

    // Notify before action preference
    if (preferences.notifyBeforeAction && !preferences.autoApproveRisk.includes(maxRisk)) {
      return true;
    }

    return false;
  }

  /**
   * Generate action plan
   */
  private generateActionPlan(
    intention: Intention,
    _risks: Risk[]
  ): ActionStep[] {
    const steps: ActionStep[] = [];

    switch (intention.type) {
      case 'fix':
        steps.push({
          id: this.generateStepId(),
          description: 'Analyze the issue and identify root cause',
          agentType: 'scout',
          estimatedDuration: 5 * 60 * 1000, // 5 minutes
          reversible: false,
          dependencies: [],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Implement fix',
          agentType: 'builder',
          estimatedDuration: 10 * 60 * 1000, // 10 minutes
          reversible: true,
          dependencies: [steps[0].id],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Run tests to verify fix',
          agentType: 'tester',
          estimatedDuration: 3 * 60 * 1000, // 3 minutes
          reversible: false,
          dependencies: [steps[1].id],
        });
        break;

      case 'refactor':
        steps.push({
          id: this.generateStepId(),
          description: 'Analyze code structure and identify refactoring opportunities',
          agentType: 'scout',
          estimatedDuration: 5 * 60 * 1000,
          reversible: false,
          dependencies: [],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Apply refactoring changes',
          agentType: 'builder',
          estimatedDuration: 15 * 60 * 1000,
          reversible: true,
          dependencies: [steps[0].id],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Review changes for correctness',
          agentType: 'reviewer',
          estimatedDuration: 5 * 60 * 1000,
          reversible: false,
          dependencies: [steps[1].id],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Run tests to ensure no regressions',
          agentType: 'tester',
          estimatedDuration: 3 * 60 * 1000,
          reversible: false,
          dependencies: [steps[2].id],
        });
        break;

      case 'implement':
        steps.push({
          id: this.generateStepId(),
          description: 'Analyze requirements and design approach',
          agentType: 'scout',
          estimatedDuration: 10 * 60 * 1000,
          reversible: false,
          dependencies: [],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Implement the feature',
          agentType: 'builder',
          estimatedDuration: 30 * 60 * 1000,
          reversible: true,
          dependencies: [steps[0].id],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Write tests for the feature',
          agentType: 'tester',
          estimatedDuration: 15 * 60 * 1000,
          reversible: false,
          dependencies: [steps[1].id],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Code review',
          agentType: 'reviewer',
          estimatedDuration: 5 * 60 * 1000,
          reversible: false,
          dependencies: [steps[2].id],
        });
        break;

      case 'update':
        steps.push({
          id: this.generateStepId(),
          description: 'Check for package updates and vulnerabilities',
          agentType: 'scout',
          estimatedDuration: 2 * 60 * 1000,
          reversible: false,
          dependencies: [],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Update dependencies',
          agentType: 'builder',
          estimatedDuration: 5 * 60 * 1000,
          reversible: true,
          dependencies: [steps[0].id],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Run tests to verify compatibility',
          agentType: 'tester',
          estimatedDuration: 5 * 60 * 1000,
          reversible: false,
          dependencies: [steps[1].id],
        });
        break;

      case 'analyze':
        steps.push({
          id: this.generateStepId(),
          description: 'Perform analysis',
          agentType: 'scout',
          estimatedDuration: 5 * 60 * 1000,
          reversible: false,
          dependencies: [],
        });
        steps.push({
          id: this.generateStepId(),
          description: 'Generate report',
          agentType: 'scout',
          estimatedDuration: 2 * 60 * 1000,
          reversible: false,
          dependencies: [steps[0].id],
        });
        break;

      default:
        // Generic action plan
        steps.push({
          id: this.generateStepId(),
          description: intention.suggestedAction || 'Execute action',
          agentType: 'builder',
          estimatedDuration: 10 * 60 * 1000,
          reversible: true,
          dependencies: [],
        });
    }

    return steps;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    intention: Intention,
    context: DecisionContext,
    preferences: UserDecisionPreferences,
    risks: Risk[]
  ): number {
    let confidence = intention.confidence;

    // Adjust based on project health
    if (context.projectHealth > 80) {
      confidence *= 1.1;
    } else if (context.projectHealth < 50) {
      confidence *= 0.7;
    }

    // Adjust based on success rate
    if (context.historicalSuccessRate > 0.8) {
      confidence *= 1.05;
    } else if (context.historicalSuccessRate < 0.5) {
      confidence *= 0.8;
    }

    // Adjust based on risks
    const maxRisk = this.getMaxRiskLevel(risks);
    if (maxRisk === 'critical') {
      confidence *= 0.6;
    } else if (maxRisk === 'high') {
      confidence *= 0.8;
    }

    // Adjust based on permission level
    if (preferences.permissionLevel >= PermissionLevel.AUTONOMOUS) {
      confidence *= 1.05;
    }

    // Clamp to 0-1
    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * Get max risk level from risks array
   */
  private getMaxRiskLevel(risks: Risk[]): RiskLevel {
    const levels: RiskLevel[] = ['critical', 'high', 'medium', 'low'];
    for (const level of levels) {
      if (risks.some(r => r.level === level)) {
        return level;
      }
    }
    return 'low';
  }

  /**
   * Generate reasoning explanation
   */
  private generateReasoning(
    intention: Intention,
    context: DecisionContext,
    preferences: UserDecisionPreferences,
    risks: Risk[],
    decision: Decision
  ): string {
    const parts: string[] = [];

    // Intention source
    parts.push(`This ${intention.source}-triggered intention`);

    // Priority consideration
    parts.push(`has ${intention.priority} priority`);

    // Confidence
    parts.push(`with ${(intention.confidence * 100).toFixed(0)}% confidence`);

    // Risk assessment
    const maxRisk = this.getMaxRiskLevel(risks);
    parts.push(`and ${maxRisk} risk level`);

    // Project state
    if (context.projectHealth < 60) {
      parts.push(`(note: project health is at ${context.projectHealth}%)`);
    }

    // Approval requirement
    if (decision.requiresApproval) {
      if (preferences.permissionLevel === PermissionLevel.ADVISORY) {
        parts.push(`- approval required due to advisory permission level`);
      } else if (maxRisk === 'high' || maxRisk === 'critical') {
        parts.push(`- approval required due to ${maxRisk} risk`);
      } else if (preferences.requireApprovalFor.includes(intention.type)) {
        parts.push(`- approval required for ${intention.type} actions`);
      } else {
        parts.push(`- approval required`);
      }
    } else {
      parts.push(`- can execute autonomously`);
    }

    return parts.join(' ') + '.';
  }

  /**
   * Generate expected outcome description
   */
  private generateExpectedOutcome(
    intention: Intention,
    actionPlan: ActionStep[]
  ): string {
    const duration = actionPlan.reduce((sum, s) => sum + s.estimatedDuration, 0);
    const minutes = Math.round(duration / 60000);

    const outcomes: string[] = [];

    switch (intention.type) {
      case 'fix':
        outcomes.push('Bug will be resolved');
        outcomes.push('Tests will pass');
        break;
      case 'refactor':
        outcomes.push('Code will be more maintainable');
        outcomes.push('Complexity will be reduced');
        break;
      case 'implement':
        outcomes.push('Feature will be added');
        outcomes.push('Tests will be created');
        break;
      case 'update':
        outcomes.push('Dependencies will be updated');
        outcomes.push('Security will be improved');
        break;
      default:
        outcomes.push('Action will be completed');
    }

    return `${outcomes.join('. ')} (estimated ${minutes} minutes)`;
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(chatId: number): Promise<UserDecisionPreferences> {
    // Check cache
    if (this.userPreferences.has(chatId)) {
      return this.userPreferences.get(chatId)!;
    }

    // Try to load from memory
    const stored = await this.memory.getFact(`user:${chatId}:decisionPreferences`) as UserDecisionPreferences | undefined;
    if (stored) {
      this.userPreferences.set(chatId, stored);
      return stored;
    }

    // Return defaults
    const defaults = { ...DECISION_CONFIG.defaultPreferences };
    this.userPreferences.set(chatId, defaults);
    return defaults;
  }

  /**
   * Set user preferences
   */
  async setUserPreferences(chatId: number, preferences: Partial<UserDecisionPreferences>): Promise<UserDecisionPreferences> {
    const current = await this.getUserPreferences(chatId);
    const updated: UserDecisionPreferences = {
      ...current,
      ...preferences,
      quietHours: { ...current.quietHours, ...preferences.quietHours },
    };

    this.userPreferences.set(chatId, updated);
    await this.memory.setFact(`user:${chatId}:decisionPreferences`, updated);

    return updated;
  }

  /**
   * Count active actions for a user
   */
  private countActiveActions(_chatId: number): number {
    return Array.from(this.decisions.values()).filter(
      d => d.requiresApproval === false && d.canAutoExecute === true
    ).length;
  }

  /**
   * Store decision in memory
   */
  private async storeDecision(decision: Decision): Promise<void> {
    try {
      await this.memory.setFact(`decision:${decision.id}`, decision);
    } catch (error) {
      console.error('[DecisionMaker] Failed to store decision:', error);
    }
  }

  /**
   * Get decision by ID
   */
  getDecision(id: string): Decision | undefined {
    return this.decisions.get(id);
  }

  /**
   * Get decisions by filter
   */
  getDecisions(filter: {
    intentionId?: string;
    requiresApproval?: boolean;
    active?: boolean;
  } = {}): Decision[] {
    let results = Array.from(this.decisions.values());

    if (filter.intentionId) {
      results = results.filter(d => d.intentionId === filter.intentionId);
    }

    // Note: we don't have chatId directly in Decision, would need to look up via Intention
    // This is a simplified version

    if (filter.requiresApproval !== undefined) {
      results = results.filter(d => d.requiresApproval === filter.requiresApproval);
    }

    if (filter.active !== undefined) {
      const now = Date.now();
      results = results.filter(d => filter.active ? d.expiresAt > now : d.expiresAt <= now);
    }

    return results;
  }

  /**
   * Clear expired decisions
   */
  clearExpired(): number {
    const now = Date.now();
    let cleared = 0;

    for (const [id, decision] of this.decisions.entries()) {
      if (decision.expiresAt < now) {
        this.decisions.delete(id);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Override a decision (user manual override)
   */
  overrideDecision(decisionId: string, shouldAct: boolean): boolean {
    const decision = this.decisions.get(decisionId);
    if (!decision) return false;

    decision.shouldAct = shouldAct;
    decision.requiresApproval = false; // User override = approval
    decision.canAutoExecute = shouldAct;

    return true;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `decision-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate step ID
   */
  private generateStepId(): string {
    return `step-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    requiresApproval: number;
    canAutoExecute: number;
    avgConfidence: number;
  } {
    const decisions = Array.from(this.decisions.values());

    return {
      total: decisions.length,
      requiresApproval: decisions.filter(d => d.requiresApproval).length,
      canAutoExecute: decisions.filter(d => d.canAutoExecute).length,
      avgConfidence: decisions.length > 0
        ? decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length
        : 0,
    };
  }
}

// ===========================================
// Global Singleton
// ===========================================

let globalDecisionMaker: DecisionMaker | null = null;

export function getDecisionMaker(): DecisionMaker {
  if (!globalDecisionMaker) {
    globalDecisionMaker = new DecisionMaker();
  }
  return globalDecisionMaker;
}

export function resetDecisionMaker(): void {
  globalDecisionMaker = null;
}
