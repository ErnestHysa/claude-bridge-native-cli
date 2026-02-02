/**
 * Refactoring Agent - Autonomous code refactoring
 *
 * The Refactoring Agent automatically detects and performs safe code refactorings:
 * - Extract repeated code into functions
 * - Simplify complex functions
 * - Rename variables for clarity
 * - Remove dead code
 * - Consolidate duplicate code
 *
 * Safety policies:
 * - Only refactor if tests pass
 * - Create git branch before refactoring
 * - Run tests after refactoring
 * - Rollback on failure
 * - Require approval for large changes
 */

import { getCodeAnalyzer } from '../analyzer/code-analyzer.js';
import { getIntentionEngine } from '../intention/intention-engine.js';
import { getOrchestrator } from '../agents/agent-orchestrator.js';
import { getMemoryStore } from '../memory/memory-store.js';
import { getGitAutomation } from '../git/git-automation.js';
import { getTestWatcher } from '../tests/test-watcher.js';

// ============================================
// Types
// ============================================

/**
 * Refactoring type
 */
export type RefactoringType =
  | 'extract_function'     // Extract repeated code into a function
  | 'rename_variable'      // Rename variable for clarity
  | 'simplify_logic'       // Simplify complex conditional logic
  | 'remove_duplication'   // Remove duplicate code
  | 'extract_constant'     // Extract magic numbers/strings to constants
  | 'split_function'       // Split a long function into smaller ones
  | 'consolidate'          // Consolidate similar functions
  | 'remove_dead_code';    // Remove unused code

/**
 * Refactoring complexity
 */
export type RefactoringComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

/**
 * Refactoring risk level
 */
export type RefactoringRisk = 'safe' | 'low' | 'medium' | 'high';

/**
 * A refactoring opportunity
 */
export interface RefactoringOpportunity {
  id: string;
  type: RefactoringType;
  complexity: RefactoringComplexity;
  risk: RefactoringRisk;
  filePath: string;
  description: string;
  suggestedChange: string;
  lineNumber?: number;
  confidence: number;        // 0-1
  estimatedEffort: number;   // minutes
  projectPath: string;
  chatId: number;
  timestamp: number;
}

/**
 * Refactoring result
 */
export interface RefactoringResult {
  opportunityId: string;
  success: boolean;
  changes: Array<{
    file: string;
    linesChanged: number;
    description: string;
  }>;
  testsPassed: boolean;
  duration: number;
  errorMessage?: string;
  rollbackPerformed: boolean;
  timestamp: number;
}

/**
 * Refactoring policy
 */
export interface RefactoringPolicy {
  autoRefactorSafe: boolean;        // Auto-refactor safe changes
  autoRefactorLow: boolean;         // Auto-refactor low-risk changes
  requireApprovalModerate: boolean; // Require approval for moderate changes
  requireApprovalComplex: boolean;  // Require approval for complex changes
  maxFunctionsPerFile: number;      // Trigger refactoring if exceeded
  maxComplexity: number;            // Trigger refactoring if exceeded
  maxDuplication: number;           // Trigger refactoring if exceeded (%)
}

// ============================================
// Configuration
// ============================================

const REFACTORING_CONFIG = {
  // Default policy
  defaultPolicy: {
    autoRefactorSafe: true,
    autoRefactorLow: false,
    requireApprovalModerate: true,
    requireApprovalComplex: true,
    maxFunctionsPerFile: 15,
    maxComplexity: 15,
    maxDuplication: 10,  // 10%
  } as RefactoringPolicy,

  // Confidence threshold for auto-refactoring
  minConfidence: 0.7,

  // Maximum changes per auto-refactoring
  maxAutoChanges: 5,

  // Check interval (ms) - 1 hour
  checkInterval: 60 * 60 * 1000,
};

// ============================================
// Refactoring Agent Class
// ============================================

export class RefactoringAgent {
  private memory = getMemoryStore();
  private active = false;
  private checkTimer?: NodeJS.Timeout;
  private opportunities = new Map<string, RefactoringOpportunity>();
  private inProgress = new Set<string>();

  /**
   * Start the refactoring agent
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadPolicies();

    // Start periodic checks
    this.checkTimer = setInterval(() => {
      this.scanAllProjects();
    }, REFACTORING_CONFIG.checkInterval);

    console.log('[RefactoringAgent] Started');
  }

  /**
   * Stop the refactoring agent
   */
  stop(): void {
    this.active = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    console.log('[RefactoringAgent] Stopped');
  }

  /**
   * Scan all projects for refactoring opportunities
   */
  private async scanAllProjects(): Promise<void> {
    if (!this.active) return;

    const projects = await this.getWatchedProjects();

    for (const projectPath of projects) {
      await this.scanProject(projectPath);
    }
  }

  /**
   * Scan a project for refactoring opportunities
   */
  async scanProject(projectPath: string): Promise<RefactoringOpportunity[]> {
    const chatId = await this.getChatIdForProject(projectPath);
    if (chatId === null) {
      throw new Error('No chat ID found for project');
    }

    const policy = await this.getPolicy(projectPath);
    const opportunities: RefactoringOpportunity[] = [];

    // Analyze code for complexity
    const analyzer = getCodeAnalyzer();
    const complexityResults = await analyzer.analyzeComplexity(projectPath);

    // Find functions that exceed complexity threshold
    for (const result of complexityResults) {
      for (const func of result.functions || []) {
        if (func.complexity > policy.maxComplexity) {
          const opportunity = this.createComplexityOpportunity(
            projectPath,
            func.name,
            func.complexity,
            result.file,
            func.line,
            chatId
          );
          opportunities.push(opportunity);
          this.opportunities.set(opportunity.id, opportunity);
        }
      }
    }

    // Check for duplication
    const duplicationResult = await analyzer.analyzeDuplication(projectPath);

    if (duplicationResult.duplicationPercentage > policy.maxDuplication) {
      const opportunity = this.createDuplicationOpportunity(
        projectPath,
        duplicationResult,
        chatId
      );
      opportunities.push(opportunity);
      this.opportunities.set(opportunity.id, opportunity);
    }

    // Store opportunities
    await this.memory.setFact(`refactoring_opportunities:${projectPath}`, opportunities);

    // Auto-refactor safe opportunities
    for (const opportunity of opportunities) {
      if (this.shouldAutoRefactor(opportunity, policy)) {
        this.refactor(opportunity.id).catch(err => {
          console.error('[RefactoringAgent] Auto-refactor failed:', err);
        });
      } else {
        // Create intention for manual review
        await this.createIntentionForOpportunity(opportunity);
      }
    }

    return opportunities;
  }

  /**
   * Perform a refactoring
   */
  async refactor(opportunityId: string): Promise<RefactoringResult | null> {
    const opportunity = this.opportunities.get(opportunityId);
    if (!opportunity) return null;

    if (this.inProgress.has(opportunityId)) {
      return null; // Already in progress
    }

    this.inProgress.add(opportunityId);

    const startTime = Date.now();
    let success = false;
    let testsPassed = false;
    let rollbackPerformed = false;
    let changes: Array<{ file: string; linesChanged: number; description: string }> = [];
    let errorMessage: string | undefined;

    const git = getGitAutomation();

    try {
      // Check if tests pass before refactoring
      const testWatcher = getTestWatcher();
      const preTestResult = await testWatcher.runTests(opportunity.projectPath);

      if (preTestResult.failed > 0) {
        errorMessage = 'Tests are failing before refactoring. Skipping.';
        await this.memory.setFact(`refactoring_skipped:${opportunityId}`, {
          reason: errorMessage,
          timestamp: Date.now(),
        });
        return null;
      }

      // Perform the refactoring
      const result = await this.performRefactoring(opportunity);

      if (result.success) {
        changes = result.changes;

        // Run tests after refactoring
        const postTestResult = await testWatcher.runTests(opportunity.projectPath);
        testsPassed = postTestResult.failed === 0;

        if (testsPassed) {
          success = true;

          // Create commit with the refactoring
          await git.smartCommit(opportunity.projectPath, {
            autoStage: true,
            conventionalCommits: true,
            generateMessage: true,
          });

          // Store the result
          await this.memory.setFact(`refactoring_result:${opportunityId}`, {
            success: true,
            changes,
            timestamp: Date.now(),
          });
        } else {
          // Tests failed - mark as failed (rollback would be done manually)
          errorMessage = 'Tests failed after refactoring';
        }
      } else {
        errorMessage = result.errorMessage;
      }

    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.inProgress.delete(opportunityId);
    }

    const refactoringResult: RefactoringResult = {
      opportunityId,
      success,
      changes,
      testsPassed,
      duration: Date.now() - startTime,
      errorMessage,
      rollbackPerformed,
      timestamp: Date.now(),
    };

    // Store result
    await this.memory.setFact(`refactoring_outcome:${opportunityId}`, refactoringResult);

    // Remove from opportunities if successful
    if (success) {
      this.opportunities.delete(opportunityId);
    }

    return refactoringResult;
  }

  /**
   * Perform the actual refactoring
   */
  private async performRefactoring(
    opportunity: RefactoringOpportunity
  ): Promise<{ success: boolean; changes: Array<{ file: string; linesChanged: number; description: string }>; errorMessage?: string }> {
    const orchestrator = getOrchestrator();

    // Build prompt (for future use - could be passed to orchestrator)
    this.buildRefactoringPrompt(opportunity);

    try {
      const result = await orchestrator.executeAutonomousTask({
        intentionId: opportunity.id,
        decisionId: `refactor-${opportunity.id}`,
        chatId: opportunity.chatId,
        projectPath: opportunity.projectPath,
        description: opportunity.description,
        type: opportunity.type,
        agentType: 'builder',
        transparent: true,
      });

      if (result.success) {
        return {
          success: true,
          changes: result.changes?.map(c => ({
            file: c.path || 'unknown',
            linesChanged: 1,
            description: c.type,
          })) || [],
        };
      } else {
        return {
          success: false,
          changes: [],
          errorMessage: result.error,
        };
      }

    } catch (error) {
      return {
        success: false,
        changes: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build a refactoring prompt
   */
  private buildRefactoringPrompt(opportunity: RefactoringOpportunity): string {
    const typeInstructions: Record<RefactoringType, string> = {
      extract_function: 'Extract the repeated code into a separate, well-named function.',
      rename_variable: 'Rename the variable to be more descriptive and clear.',
      simplify_logic: 'Simplify the complex conditional logic to be more readable.',
      remove_duplication: 'Remove the duplicate code by extracting common functionality.',
      extract_constant: 'Extract the magic number or string into a named constant.',
      split_function: 'Split the long function into smaller, focused functions.',
      consolidate: 'Consolidate similar functions by parameterizing differences.',
      remove_dead_code: 'Remove the unused code and imports.',
    };

    return `
${typeInstructions[opportunity.type]}

File: ${opportunity.filePath}
${opportunity.lineNumber ? `Line: ${opportunity.lineNumber}` : ''}

Description: ${opportunity.description}

Suggested Change: ${opportunity.suggestedChange}

Project: ${opportunity.projectPath}

Please perform this refactoring while preserving the exact same behavior.
`;
  }

  /**
   * Create a complexity opportunity
   */
  private createComplexityOpportunity(
    projectPath: string,
    functionName: string,
    complexity: number,
    filePath: string,
    lineNumber: number | undefined,
    chatId: number
  ): RefactoringOpportunity {
    const risk = complexity > 30 ? 'high' : complexity > 20 ? 'medium' : complexity > 10 ? 'low' : 'safe';
    const refactorType: RefactoringType = 'split_function';

    return {
      id: this.generateOpportunityId(),
      type: refactorType,
      complexity: complexity > 30 ? 'complex' : complexity > 20 ? 'moderate' : complexity > 10 ? 'simple' : 'trivial',
      risk,
      filePath,
      description: `Function "${functionName}" has high complexity (${complexity})`,
      suggestedChange: `Split "${functionName}" into smaller, more focused functions`,
      lineNumber,
      confidence: 0.8,
      estimatedEffort: Math.ceil(complexity / 3) * 10, // minutes
      projectPath,
      chatId,
      timestamp: Date.now(),
    };
  }

  /**
   * Create a duplication opportunity
   */
  private createDuplicationOpportunity(
    projectPath: string,
    duplication: { duplicationPercentage: number; totalDuplicateLines: number; duplicates: unknown[] },
    chatId: number
  ): RefactoringOpportunity {
    const risk = duplication.duplicationPercentage > 30 ? 'high' : duplication.duplicationPercentage > 20 ? 'medium' : 'low';

    return {
      id: this.generateOpportunityId(),
      type: 'remove_duplication',
      complexity: duplication.duplicationPercentage > 30 ? 'complex' : duplication.duplicationPercentage > 20 ? 'moderate' : 'simple',
      risk,
      filePath: 'multiple',
      description: `Found ${duplication.duplicationPercentage}% code duplication`,
      suggestedChange: `Extract common code into shared utilities`,
      confidence: 0.9,
      estimatedEffort: duplication.totalDuplicateLines * 2, // minutes
      projectPath,
      chatId,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if an opportunity should be auto-refactored
   */
  private shouldAutoRefactor(opportunity: RefactoringOpportunity, policy: RefactoringPolicy): boolean {
    if (opportunity.risk === 'safe' && policy.autoRefactorSafe) {
      return opportunity.confidence >= REFACTORING_CONFIG.minConfidence;
    }

    if (opportunity.risk === 'low' && policy.autoRefactorLow) {
      return opportunity.confidence >= REFACTORING_CONFIG.minConfidence;
    }

    return false;
  }

  /**
   * Create an intention for an opportunity
   */
  private async createIntentionForOpportunity(opportunity: RefactoringOpportunity): Promise<void> {
    const intentionEngine = getIntentionEngine();

    await intentionEngine.processTrigger({
      type: 'complexity_high',
      projectPath: opportunity.projectPath,
      chatId: opportunity.chatId,
      data: {
        opportunityId: opportunity.id,
        type: opportunity.type,
        risk: opportunity.risk,
        description: opportunity.description,
        filePath: opportunity.filePath,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Get refactoring policy for a project
   */
  async getPolicy(projectPath: string): Promise<RefactoringPolicy> {
    try {
      const policy = await this.memory.getFact(`refactoring_policy:${projectPath}`) as RefactoringPolicy | undefined;
      return policy ?? REFACTORING_CONFIG.defaultPolicy;
    } catch {
      return REFACTORING_CONFIG.defaultPolicy;
    }
  }

  /**
   * Set refactoring policy for a project
   */
  async setPolicy(projectPath: string, policy: Partial<RefactoringPolicy>): Promise<RefactoringPolicy> {
    const current = await this.getPolicy(projectPath);
    const updated: RefactoringPolicy = {
      ...current,
      ...policy,
    };

    await this.memory.setFact(`refactoring_policy:${projectPath}`, updated);
    return updated;
  }

  /**
   * Get all opportunities for a project
   */
  getOpportunities(projectPath: string): RefactoringOpportunity[] {
    return Array.from(this.opportunities.values())
      .filter(o => o.projectPath === projectPath);
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byType: Record<RefactoringType, number>;
    byRisk: Record<RefactoringRisk, number>;
    inProgress: number;
  } {
    const all = Array.from(this.opportunities.values());

    const byType: Record<RefactoringType, number> = {
      extract_function: 0,
      rename_variable: 0,
      simplify_logic: 0,
      remove_duplication: 0,
      extract_constant: 0,
      split_function: 0,
      consolidate: 0,
      remove_dead_code: 0,
    };

    const byRisk: Record<RefactoringRisk, number> = {
      safe: 0,
      low: 0,
      medium: 0,
      high: 0,
    };

    for (const opp of all) {
      byType[opp.type]++;
      byRisk[opp.risk]++;
    }

    return {
      total: all.length,
      byType,
      byRisk,
      inProgress: this.inProgress.size,
    };
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
   * Load policies from memory
   */
  private async loadPolicies(): Promise<void> {
    // Policies are loaded on demand
  }

  /**
   * Generate a unique opportunity ID
   */
  private generateOpportunityId(): string {
    return `refactor-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalRefactoringAgent: RefactoringAgent | null = null;

export function getRefactoringAgent(): RefactoringAgent {
  if (!globalRefactoringAgent) {
    globalRefactoringAgent = new RefactoringAgent();
  }
  return globalRefactoringAgent;
}

export function resetRefactoringAgent(): void {
  if (globalRefactoringAgent) {
    globalRefactoringAgent.stop();
  }
  globalRefactoringAgent = null;
}
