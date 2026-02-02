/**
 * Opportunity Detector - Continuous improvement scanning
 *
 * The Opportunity Detector continuously scans for improvement opportunities:
 * - Code refactoring opportunities (complexity, duplication)
 * - Test coverage gaps
 * - Dependency updates available
 * - Documentation gaps
 * - Performance optimization opportunities
 * - Security vulnerabilities
 *
 * Detection runs:
 * - On schedule (e.g., daily)
 * - On demand via command
 * - After code changes
 * - As background task
 */

import { getMemoryStore } from '../memory/memory-store.js';
import { getCodeAnalyzer } from '../analyzer/code-analyzer.js';
import { getDependencyManager } from '../dependency/dependency-manager.js';
import { getRefactoringAgent } from '../refactoring/refactoring-agent.js';

// ============================================
// Types
// ============================================

/**
 * Opportunity type
 */
export type OpportunityType =
  | 'refactoring'
  | 'test_coverage'
  | 'dependency_update'
  | 'documentation'
  | 'performance'
  | 'security'
  | 'complexity'
  | 'duplication';

/**
 * Opportunity priority
 */
export type OpportunityPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Opportunity status
 */
export type OpportunityStatus = 'detected' | 'analyzed' | 'queued' | 'in_progress' | 'completed' | 'dismissed' | 'deferred';

/**
 * An improvement opportunity
 */
export interface ImprovementOpportunity {
  id: string;
  type: OpportunityType;
  priority: OpportunityPriority;
  status: OpportunityStatus;
  projectPath: string;
  chatId: number;

  // Details
  title: string;
  description: string;
  evidence: string[];

  // Location
  filePath?: string;
  functionName?: string;
  lineNumber?: number;

  // Impact assessment
  estimatedEffort: number;        // minutes
  estimatedImpact: number;        // 0-1
  confidence: number;             // 0-1

  // Actionable info
  suggestedAction: string;
  canAutoApply: boolean;

  // Metadata
  detectedAt: number;
  expiresAt?: number;             // Opportunity may no longer be relevant
  dismissedAt?: number;
  completedAt?: number;

  // Tracking
  actionId?: string;              // If action was created
}

/**
 * Detection result
 */
export interface DetectionResult {
  projectPath: string;
  scanDuration: number;
  opportunitiesFound: number;
  byType: Record<OpportunityType, number>;
  byPriority: Record<OpportunityPriority, number>;
  timestamp: number;
}

/**
 * Detection options
 */
export interface DetectionOptions {
  types?: OpportunityType[];
  maxOpportunities?: number;
  minConfidence?: number;
  minPriority?: OpportunityPriority;
  includeDismissed?: boolean;
}

/**
 * Scan schedule
 */
export interface ScanSchedule {
  projectPath: string;
  chatId: number;
  enabled: boolean;
  interval: number;              // milliseconds between scans
  lastScan?: number;
  nextScan?: number;
  types?: OpportunityType[];
}

// ============================================
// Configuration
// ============================================

const DETECTOR_CONFIG = {
  // Default scan interval (daily)
  defaultScanInterval: 24 * 60 * 60 * 1000,

  // Maximum opportunities to keep per project
  maxOpportunitiesPerProject: 100,

  // Minimum confidence for reporting
  minReportConfidence: 0.6,

  // Opportunity expiration (7 days)
  opportunityExpiration: 7 * 24 * 60 * 60 * 1000,

  // Auto-dismiss threshold
  autoDismissAge: 30 * 24 * 60 * 60 * 1000,

  // Thresholds for different types
  thresholds: {
    complexity: { high: 10, veryHigh: 15 },
    duplication: { minLines: 30, minSimilarity: 0.8 },
  },
};

// ============================================
// Opportunity Detector Class
// ============================================

export class OpportunityDetector {
  private memory = getMemoryStore();
  private opportunities = new Map<string, ImprovementOpportunity>();
  private schedules = new Map<string, ScanSchedule>();
  private active = false;
  private scanTimer?: NodeJS.Timeout;

  /**
   * Start the detector
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadOpportunities();
    await this.loadSchedules();

    // Start scheduled scans
    this.startScheduledScans();

    console.log('[OpportunityDetector] Started');
  }

  /**
   * Stop the detector
   */
  stop(): void {
    this.active = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = undefined;
    }
    console.log('[OpportunityDetector] Stopped');
  }

  /**
   * Scan a project for opportunities
   */
  async scanProject(projectPath: string, chatId: number, options: DetectionOptions = {}): Promise<DetectionResult> {
    const startTime = Date.now();

    const typesToScan = options.types || this.getAllOpportunityTypes();
    const minConfidence = options.minConfidence ?? DETECTOR_CONFIG.minReportConfidence;

    let found: ImprovementOpportunity[] = [];

    // Scan by type
    for (const type of typesToScan) {
      const typeOpportunities = await this.scanForType(projectPath, chatId, type, minConfidence);
      found = found.concat(typeOpportunities);
    }

    // Filter by priority if specified
    if (options.minPriority) {
      const priorityOrder = ['low', 'medium', 'high', 'critical'] as const;
      const minIndex = priorityOrder.indexOf(options.minPriority);
      found = found.filter(op => priorityOrder.indexOf(op.priority) >= minIndex);
    }

    // Apply max limit
    if (options.maxOpportunities && found.length > options.maxOpportunities) {
      found.sort((a, b) => b.confidence - a.confidence);
      found = found.slice(0, options.maxOpportunities);
    }

    // Store opportunities
    for (const opportunity of found) {
      const existing = this.findSimilarOpportunity(opportunity);
      if (existing) {
        Object.assign(existing, opportunity, { id: existing.id });
        await this.storeOpportunity(existing);
      } else {
        this.opportunities.set(opportunity.id, opportunity);
        await this.storeOpportunity(opportunity);
      }
    }

    const duration = Date.now() - startTime;

    const result: DetectionResult = {
      projectPath,
      scanDuration: duration,
      opportunitiesFound: found.length,
      byType: this.groupByType(found),
      byPriority: this.groupByPriority(found),
      timestamp: Date.now(),
    };

    console.log(`[OpportunityDetector] Scan complete: ${found.length} opportunities in ${duration}ms`);

    return result;
  }

  /**
   * Scan for a specific type of opportunity
   */
  private async scanForType(
    projectPath: string,
    chatId: number,
    type: OpportunityType,
    minConfidence: number
  ): Promise<ImprovementOpportunity[]> {
    switch (type) {
      case 'complexity':
        return this.scanComplexity(projectPath, chatId, minConfidence);
      case 'duplication':
        return this.scanDuplication(projectPath, chatId, minConfidence);
      case 'dependency_update':
        return this.scanDependencies(projectPath, chatId, minConfidence);
      case 'security':
        return this.scanSecurity(projectPath, chatId, minConfidence);
      case 'refactoring':
        return this.scanRefactoring(projectPath, chatId, minConfidence);
      default:
        return [];
    }
  }

  /**
   * Scan for complexity issues
   */
  private async scanComplexity(projectPath: string, chatId: number, minConfidence: number): Promise<ImprovementOpportunity[]> {
    const opportunities: ImprovementOpportunity[] = [];
    const analyzer = getCodeAnalyzer();

    try {
      const results = await analyzer.analyzeComplexity(projectPath);

      for (const result of results) {
        // Check overall file complexity
        if (result.rating === 'high' || result.rating === 'very-high') {
          const confidence = result.complexity / 20;
          if (confidence >= minConfidence) {
            opportunities.push({
              id: this.generateOpportunityId(),
              type: 'complexity',
              priority: result.rating === 'very-high' ? 'high' : 'medium',
              status: 'detected',
              projectPath,
              chatId,
              title: `High complexity file: ${result.file}`,
              description: `File has overall complexity of ${result.complexity} (${result.rating})`,
              evidence: [
                `Overall complexity: ${result.complexity}`,
                `Rating: ${result.rating}`,
                `Functions: ${result.functions.length}`,
              ],
              filePath: result.file,
              estimatedEffort: Math.max(30, result.complexity * 2),
              estimatedImpact: Math.min(1, result.complexity / 50),
              confidence: Math.min(1, confidence),
              suggestedAction: 'Consider breaking down complex functions into smaller, more manageable pieces',
              canAutoApply: false,
              detectedAt: Date.now(),
            });
          }
        }

        // Check individual functions
        for (const func of result.functions || []) {
          if (func.complexity >= DETECTOR_CONFIG.thresholds.complexity.high) {
            const funcConfidence = func.complexity / 20;
            if (funcConfidence >= minConfidence) {
              opportunities.push({
                id: this.generateOpportunityId(),
                type: 'complexity',
                priority: func.complexity >= DETECTOR_CONFIG.thresholds.complexity.veryHigh ? 'critical' : 'high',
                status: 'detected',
                projectPath,
                chatId,
                title: `Complex function: ${func.name}`,
                description: `Function ${func.name} has complexity of ${func.complexity}`,
                evidence: [
                  `Complexity: ${func.complexity}`,
                  `Line: ${func.line}`,
                ],
                filePath: result.file,
                functionName: func.name,
                lineNumber: func.line,
                estimatedEffort: func.complexity * 3,
                estimatedImpact: Math.min(1, func.complexity / 30),
                confidence: Math.min(1, funcConfidence),
                suggestedAction: 'Refactor this function into smaller functions',
                canAutoApply: false,
                detectedAt: Date.now(),
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('[OpportunityDetector] Error scanning complexity:', error);
    }

    return opportunities;
  }

  /**
   * Scan for code duplication
   */
  private async scanDuplication(projectPath: string, chatId: number, minConfidence: number): Promise<ImprovementOpportunity[]> {
    const opportunities: ImprovementOpportunity[] = [];
    const analyzer = getCodeAnalyzer();

    try {
      const results = await analyzer.analyzeDuplication(projectPath);

      for (const result of results.duplicates || []) {
        if (
          result.lines >= DETECTOR_CONFIG.thresholds.duplication.minLines &&
          result.similarity >= DETECTOR_CONFIG.thresholds.duplication.minSimilarity
        ) {
          const confidence = result.similarity;

          if (confidence >= minConfidence) {
            opportunities.push({
              id: this.generateOpportunityId(),
              type: 'duplication',
              priority: result.lines > 100 ? 'high' : 'medium',
              status: 'detected',
              projectPath,
              chatId,
              title: `Code duplication detected (${result.lines} lines)`,
              description: `Duplicate code found between ${result.fragment1.file} and ${result.fragment2.file}`,
              evidence: [
                `Duplicate lines: ${result.lines}`,
                `Similarity: ${(result.similarity * 100).toFixed(1)}%`,
                `Fragment 1: ${result.fragment1.file}:${result.fragment1.startLine}-${result.fragment1.endLine}`,
                `Fragment 2: ${result.fragment2.file}:${result.fragment2.startLine}-${result.fragment2.endLine}`,
              ],
              filePath: result.fragment1.file,
              lineNumber: result.fragment1.startLine,
              estimatedEffort: Math.ceil(result.lines / 2),
              estimatedImpact: result.lines / 200,
              confidence,
              suggestedAction: 'Extract duplicated code into a shared function or module',
              canAutoApply: false,
              detectedAt: Date.now(),
            });
          }
        }
      }
    } catch (error) {
      console.error('[OpportunityDetector] Error scanning duplication:', error);
    }

    return opportunities;
  }

  /**
   * Scan for dependency updates
   */
  private async scanDependencies(projectPath: string, chatId: number, minConfidence: number): Promise<ImprovementOpportunity[]> {
    const opportunities: ImprovementOpportunity[] = [];
    const depManager = getDependencyManager();

    try {
      const health = await depManager.checkProject(projectPath);

      // Check for vulnerable dependencies
      for (const vuln of health.vulnerabilities || []) {
        const confidence = 1;
        if (confidence >= minConfidence) {
          opportunities.push({
            id: this.generateOpportunityId(),
            type: 'security',
            priority: vuln.severity === 'critical' ? 'critical' : vuln.severity === 'high' ? 'high' : 'medium',
            status: 'detected',
            projectPath,
            chatId,
            title: `Security vulnerability: ${vuln.name}`,
            description: vuln.description || `Security vulnerability detected in ${vuln.name}`,
            evidence: [
              `Severity: ${vuln.severity}`,
              vuln.title ? `Title: ${vuln.title}` : '',
            ].filter(Boolean),
            estimatedEffort: vuln.severity === 'critical' ? 60 : 30,
            estimatedImpact: 1,
            confidence,
            suggestedAction: `Update ${vuln.name} to fix security vulnerability`,
            canAutoApply: false,
            detectedAt: Date.now(),
          });
        }
      }

      // Check for outdated dependencies
      for (const dep of health.updatesAvailable || []) {
        const confidence = dep.updateType === 'major' ? 0.9 : 0.6;
        if (confidence >= minConfidence) {
          opportunities.push({
            id: this.generateOpportunityId(),
            type: 'dependency_update',
            priority: dep.updateType === 'major' ? 'medium' : 'low',
            status: 'detected',
            projectPath,
            chatId,
            title: `Update available: ${dep.name}`,
            description: `Update from ${dep.current} to ${dep.latest || 'latest'}`,
            evidence: [
              `Current: ${dep.current}`,
              `Latest: ${dep.latest || 'available'}`,
              `Update type: ${dep.updateType}`,
            ],
            estimatedEffort: dep.updateType === 'major' ? 60 : 15,
            estimatedImpact: dep.updateType === 'major' ? 0.4 : 0.2,
            confidence,
            suggestedAction: `Update ${dep.name} to ${dep.latest || 'latest version'}`,
            canAutoApply: dep.updateType !== 'major',
            detectedAt: Date.now(),
          });
        }
      }
    } catch (error) {
      console.error('[OpportunityDetector] Error scanning dependencies:', error);
    }

    return opportunities;
  }

  /**
   * Scan for security issues
   */
  private async scanSecurity(projectPath: string, chatId: number, minConfidence: number): Promise<ImprovementOpportunity[]> {
    const opportunities: ImprovementOpportunity[] = [];
    const analyzer = getCodeAnalyzer();

    try {
      const results = await analyzer.analyzeSecurity(projectPath);

      for (const result of results) {
        for (const issue of result.issues || []) {
          const confidence = issue.severity === 'critical' ? 1 :
                           issue.severity === 'high' ? 0.9 :
                           issue.severity === 'medium' ? 0.7 : 0.5;

          if (confidence >= minConfidence) {
            opportunities.push({
              id: this.generateOpportunityId(),
              type: 'security',
              priority: issue.severity === 'critical' ? 'critical' :
                       issue.severity === 'high' ? 'high' :
                       issue.severity === 'medium' ? 'medium' : 'low',
              status: 'detected',
              projectPath,
              chatId,
              title: `Security issue: ${issue.type}`,
              description: issue.message,
              evidence: [
                `Severity: ${issue.severity}`,
                issue.line ? `Line: ${issue.line}` : '',
                issue.rule ? `Rule: ${issue.rule}` : '',
              ].filter(Boolean),
              filePath: result.file,
              lineNumber: issue.line,
              estimatedEffort: issue.severity === 'critical' ? 120 : 60,
              estimatedImpact: issue.severity === 'critical' ? 1 : 0.6,
              confidence,
              suggestedAction: `Review and fix security issue: ${issue.type}`,
              canAutoApply: false,
              detectedAt: Date.now(),
            });
          }
        }
      }
    } catch (error) {
      console.error('[OpportunityDetector] Error scanning security:', error);
    }

    return opportunities;
  }

  /**
   * Scan for general refactoring opportunities
   */
  private async scanRefactoring(projectPath: string, chatId: number, minConfidence: number): Promise<ImprovementOpportunity[]> {
    const opportunities: ImprovementOpportunity[] = [];
    const refactoringAgent = getRefactoringAgent();

    try {
      const agentOpportunities = await refactoringAgent.scanProject(projectPath);

      for (const opp of agentOpportunities || []) {
        if (opp.confidence >= minConfidence) {
          opportunities.push({
            id: this.generateOpportunityId(),
            type: 'refactoring',
            priority: opp.risk === 'high' ? 'high' :
                     opp.risk === 'medium' ? 'medium' : 'low',
            status: 'detected',
            projectPath,
            chatId,
            title: opp.description,
            description: opp.suggestedChange,
            evidence: [
              `Type: ${opp.type}`,
              `Complexity: ${opp.complexity}`,
              `Risk: ${opp.risk}`,
            ],
            filePath: opp.filePath,
            lineNumber: opp.lineNumber,
            estimatedEffort: opp.estimatedEffort,
            estimatedImpact: opp.confidence * 0.5,
            confidence: opp.confidence,
            suggestedAction: opp.suggestedChange,
            canAutoApply: opp.complexity === 'simple',
            detectedAt: Date.now(),
          });
        }
      }
    } catch (error) {
      console.error('[OpportunityDetector] Error scanning refactoring:', error);
    }

    return opportunities;
  }

  /**
   * Get opportunities for a project
   */
  getOpportunities(filter: {
    projectPath?: string;
    chatId?: number;
    type?: OpportunityType;
    status?: OpportunityStatus;
    priority?: OpportunityPriority;
    limit?: number;
  } = {}): ImprovementOpportunity[] {
    let results = Array.from(this.opportunities.values());

    if (filter.projectPath) {
      results = results.filter(o => o.projectPath === filter.projectPath);
    }

    if (filter.chatId !== undefined) {
      results = results.filter(o => o.chatId === filter.chatId);
    }

    if (filter.type) {
      results = results.filter(o => o.type === filter.type);
    }

    if (filter.status) {
      results = results.filter(o => o.status === filter.status);
    }

    if (filter.priority) {
      results = results.filter(o => o.priority === filter.priority);
    }

    // Sort by priority and confidence
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    results.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });

    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get a specific opportunity
   */
  getOpportunity(id: string): ImprovementOpportunity | undefined {
    return this.opportunities.get(id);
  }

  /**
   * Update opportunity status
   */
  async updateOpportunityStatus(
    id: string,
    status: OpportunityStatus,
    actionId?: string
  ): Promise<boolean> {
    const opportunity = this.opportunities.get(id);
    if (!opportunity) return false;

    opportunity.status = status;
    if (actionId) {
      opportunity.actionId = actionId;
    }

    if (status === 'dismissed') {
      opportunity.dismissedAt = Date.now();
    } else if (status === 'completed') {
      opportunity.completedAt = Date.now();
    }

    await this.storeOpportunity(opportunity);
    return true;
  }

  /**
   * Dismiss an opportunity
   */
  async dismissOpportunity(id: string, reason?: string): Promise<boolean> {
    const success = await this.updateOpportunityStatus(id, 'dismissed');
    if (success && reason) {
      await this.memory.setFact(`opportunity_dismissal:${id}`, {
        opportunityId: id,
        reason,
        dismissedAt: Date.now(),
      });
    }
    return success;
  }

  /**
   * Schedule regular scans
   */
  async scheduleScans(projectPath: string, chatId: number, options: {
    interval?: number;
    types?: OpportunityType[];
  } = {}): Promise<void> {
    const scheduleId = `${projectPath}:${chatId}`;
    const existing = this.schedules.get(scheduleId);

    const schedule: ScanSchedule = {
      projectPath,
      chatId,
      enabled: true,
      interval: options.interval || DETECTOR_CONFIG.defaultScanInterval,
      lastScan: existing?.lastScan,
      nextScan: Date.now() + (options.interval || DETECTOR_CONFIG.defaultScanInterval),
      types: options.types,
    };

    this.schedules.set(scheduleId, schedule);
    await this.memory.setFact(`scan_schedule:${scheduleId}`, schedule);

    this.startScheduledScans();
  }

  /**
   * Stop scheduled scans
   */
  async stopScheduledScans(projectPath: string, chatId: number): Promise<void> {
    const scheduleId = `${projectPath}:${chatId}`;
    const schedule = this.schedules.get(scheduleId);
    if (schedule) {
      schedule.enabled = false;
      await this.memory.setFact(`scan_schedule:${scheduleId}`, schedule);
    }
  }

  /**
   * Get statistics
   */
  getStats(filter?: { projectPath?: string; chatId?: number }): {
    total: number;
    byType: Record<OpportunityType, number>;
    byStatus: Record<OpportunityStatus, number>;
    byPriority: Record<OpportunityPriority, number>;
    estimatedTotalEffort: number;
  } {
    let opportunities = Array.from(this.opportunities.values());

    if (filter?.projectPath) {
      opportunities = opportunities.filter(o => o.projectPath === filter.projectPath);
    }

    if (filter?.chatId) {
      opportunities = opportunities.filter(o => o.chatId === filter.chatId);
    }

    const byType: Record<string, number> = {
      refactoring: 0,
      test_coverage: 0,
      dependency_update: 0,
      documentation: 0,
      performance: 0,
      security: 0,
      complexity: 0,
      duplication: 0,
    };

    const byStatus: Record<string, number> = {
      detected: 0,
      analyzed: 0,
      queued: 0,
      in_progress: 0,
      completed: 0,
      dismissed: 0,
      deferred: 0,
    };

    const byPriority: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    let totalEffort = 0;

    for (const opp of opportunities) {
      byType[opp.type]++;
      byStatus[opp.status]++;
      byPriority[opp.priority]++;
      totalEffort += opp.estimatedEffort;
    }

    return {
      total: opportunities.length,
      byType: byType as Record<OpportunityType, number>,
      byStatus: byStatus as Record<OpportunityStatus, number>,
      byPriority: byPriority as Record<OpportunityPriority, number>,
      estimatedTotalEffort: totalEffort,
    };
  }

  /**
   * Start scheduled scans
   */
  private startScheduledScans(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
    }

    const scheduleNext = () => {
      if (!this.active) return;

      const now = Date.now();
      let nextScanTime = Infinity;

      for (const schedule of this.schedules.values()) {
        if (!schedule.enabled) continue;

        if (schedule.nextScan && schedule.nextScan <= now) {
          this.scanProject(schedule.projectPath, schedule.chatId, {
            types: schedule.types,
          }).then(() => {
            schedule.lastScan = now;
            schedule.nextScan = now + schedule.interval;
            this.memory.setFact(`scan_schedule:${schedule.projectPath}:${schedule.chatId}`, schedule);
          }).catch(console.error);
        }

        if (schedule.nextScan && schedule.nextScan < nextScanTime) {
          nextScanTime = schedule.nextScan;
        }
      }

      if (nextScanTime < Infinity) {
        this.scanTimer = setTimeout(scheduleNext, Math.max(0, nextScanTime - now));
      } else {
        this.scanTimer = setTimeout(scheduleNext, 60 * 60 * 1000);
      }
    };

    scheduleNext();
  }

  /**
   * Find similar existing opportunity
   */
  private findSimilarOpportunity(opportunity: ImprovementOpportunity): ImprovementOpportunity | undefined {
    for (const existing of this.opportunities.values()) {
      if (existing.projectPath !== opportunity.projectPath) continue;
      if (existing.type !== opportunity.type) continue;
      if (existing.status === 'dismissed' || existing.status === 'completed') continue;

      if (opportunity.filePath && existing.filePath === opportunity.filePath) {
        if (opportunity.functionName && existing.functionName === opportunity.functionName) {
          return existing;
        }
        if (opportunity.lineNumber && existing.lineNumber === opportunity.lineNumber) {
          return existing;
        }
      }

      if (opportunity.type === 'dependency_update' && existing.type === 'dependency_update') {
        if (opportunity.title === existing.title) {
          return existing;
        }
      }
    }
    return undefined;
  }

  /**
   * Group opportunities by type
   */
  private groupByType(opportunities: ImprovementOpportunity[]): Record<OpportunityType, number> {
    const byType: Record<string, number> = {
      refactoring: 0,
      test_coverage: 0,
      dependency_update: 0,
      documentation: 0,
      performance: 0,
      security: 0,
      complexity: 0,
      duplication: 0,
    };

    for (const opp of opportunities) {
      byType[opp.type]++;
    }

    return byType as Record<OpportunityType, number>;
  }

  /**
   * Group opportunities by priority
   */
  private groupByPriority(opportunities: ImprovementOpportunity[]): Record<OpportunityPriority, number> {
    const byPriority: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const opp of opportunities) {
      byPriority[opp.priority]++;
    }

    return byPriority as Record<OpportunityPriority, number>;
  }

  /**
   * Get all opportunity types
   */
  private getAllOpportunityTypes(): OpportunityType[] {
    return ['refactoring', 'test_coverage', 'dependency_update', 'documentation', 'performance', 'security', 'complexity', 'duplication'];
  }

  /**
   * Store opportunity in memory
   */
  private async storeOpportunity(opportunity: ImprovementOpportunity): Promise<void> {
    await this.memory.setFact(`opportunity:${opportunity.id}`, opportunity);
  }

  /**
   * Load opportunities from memory
   */
  private async loadOpportunities(): Promise<void> {
    // Opportunities are loaded on demand
  }

  /**
   * Load schedules from memory
   */
  private async loadSchedules(): Promise<void> {
    // Schedules are loaded on demand
  }

  /**
   * Generate a unique opportunity ID
   */
  private generateOpportunityId(): string {
    return `opp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalOpportunityDetector: OpportunityDetector | null = null;

export function getOpportunityDetector(): OpportunityDetector {
  if (!globalOpportunityDetector) {
    globalOpportunityDetector = new OpportunityDetector();
  }
  return globalOpportunityDetector;
}

export function resetOpportunityDetector(): void {
  if (globalOpportunityDetector) {
    globalOpportunityDetector.stop();
  }
  globalOpportunityDetector = null;
}
