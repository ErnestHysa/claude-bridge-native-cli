/**
 * Context Tracker - Maintains real-time project state understanding
 *
 * The Context Tracker continuously monitors and updates the understanding
 * of each project's state. It maintains:
 * - Health scores (overall, test, code, dependency)
 * - State tracking (commits, tests, changes)
 * - Trends (improving/stable/declining)
 * - Opportunities for improvement
 * - Blockers that need attention
 *
 * This data is used by the Intention Engine and Decision Maker
 * to make informed autonomous decisions.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getMemoryStore } from '../memory/memory-store.js';

const execAsync = promisify(exec);

// ===========================================
// Types
// ===========================================

/**
 * Trend direction
 */
export type Trend = 'improving' | 'stable' | 'declining';

/**
 * Severity level
 */
export type Severity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Project health metrics
 */
export interface ProjectContext {
  projectPath: string;
  projectName: string;

  // Health indicators (0-100)
  healthScore: number;
  testHealth: number;
  codeHealth: number;
  dependencyHealth: number;

  // State tracking
  lastCommit: CommitInfo;
  lastTestRun: TestRunInfo;
  openIssues: number;
  pendingChanges: number;

  // Trends
  testTrend: Trend;
  complexityTrend: Trend;
  coverageTrend: Trend;
  activityLevel: 'active' | 'moderate' | 'inactive';

  // Opportunities
  opportunities: Opportunity[];
  blockers: Blocker[];

  // Timestamps
  lastUpdated: number;
  lastAnalyzed: number;
}

/**
 * Commit information
 */
export interface CommitInfo {
  hash: string;
  author: string;
  message: string;
  timestamp: number;
  filesChanged: number;
}

/**
 * Test run information
 */
export interface TestRunInfo {
  timestamp: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

/**
 * Opportunity for improvement
 */
export interface Opportunity {
  id: string;
  type: 'refactor' | 'feature' | 'fix' | 'improve' | 'test' | 'document';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'high' | 'medium' | 'low';
  file?: string;
  createdAt: number;
}

/**
 * Blocker that needs attention
 */
export interface Blocker {
  id: string;
  type: 'failing_tests' | 'broken_build' | 'dependency' | 'merge_conflict' | 'other';
  description: string;
  severity: Severity;
  createdAt: number;
}

/**
 * Historical data point for trend analysis
 */
interface HistoryPoint {
  timestamp: number;
  healthScore: number;
  testHealth: number;
  codeHealth: number;
  dependencyHealth: number;
  testPassRate: number;
}

// ===========================================
// Configuration
// ===========================================

const CONTEXT_CONFIG = {
  // Health score weights
  healthWeights: {
    testHealth: 0.35,
    codeHealth: 0.35,
    dependencyHealth: 0.30,
  },

  // Trend analysis window (number of data points)
  trendWindow: 5,

  // Context refresh interval (milliseconds)
  refreshInterval: 5 * 60 * 1000, // 5 minutes

  // History retention (milliseconds)
  historyRetention: 7 * 24 * 60 * 60 * 1000, // 7 days

  // Thresholds
  thresholds: {
    excellent: 90,
    good: 75,
    fair: 60,
    poor: 40,
  },
};

// ===========================================
// Context Tracker Class
// ===========================================

export class ContextTracker {
  private memory = getMemoryStore();
  private contexts = new Map<string, ProjectContext>();
  private history = new Map<string, HistoryPoint[]>();
  private refreshTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Get or create context for a project
   */
  async getContext(projectPath: string, projectName?: string): Promise<ProjectContext> {
    // Check cache
    if (this.contexts.has(projectPath)) {
      const context = this.contexts.get(projectPath)!;
      // Refresh if stale
      if (Date.now() - context.lastUpdated > CONTEXT_CONFIG.refreshInterval) {
        await this.refreshContext(projectPath);
      }
      return context;
    }

    // Load from memory or create new
    const stored = await this.memory.getFact(`context:${projectPath}`) as ProjectContext | undefined;
    if (stored) {
      this.contexts.set(projectPath, stored);
      return stored;
    }

    // Create new context
    const context = await this.createContext(projectPath, projectName || projectPath.split(/[/\\]/).pop() || 'unknown');
    this.contexts.set(projectPath, context);
    await this.storeContext(context);

    return context;
  }

  /**
   * Update context based on an event
   */
  async updateFromEvent(
    projectPath: string,
    event: 'commit' | 'test_run' | 'file_change' | 'dependency_change',
    data: Record<string, unknown>
  ): Promise<void> {
    const context = await this.getContext(projectPath);

    switch (event) {
      case 'commit':
        await this.handleCommitEvent(context, data);
        break;
      case 'test_run':
        await this.handleTestRunEvent(context, data);
        break;
      case 'file_change':
        await this.handleFileChangeEvent(context, data);
        break;
      case 'dependency_change':
        await this.handleDependencyChangeEvent(context, data);
        break;
    }

    context.lastUpdated = Date.now();
    await this.recalculateHealth(context);
    await this.storeContext(context);
  }

  /**
   * Handle commit event
   */
  private async handleCommitEvent(
    context: ProjectContext,
    data: Record<string, unknown>
  ): Promise<void> {
    const { hash, author, message, timestamp, filesChanged } = data as {
      hash?: string;
      author?: string;
      message?: string;
      timestamp?: number;
      filesChanged?: number;
    };

    context.lastCommit = {
      hash: hash || context.lastCommit?.hash || '',
      author: author || context.lastCommit?.author || 'unknown',
      message: message || context.lastCommit?.message || '',
      timestamp: timestamp || Date.now(),
      filesChanged: filesChanged || 0,
    };

    // Update activity level
    const timeSinceCommit = Date.now() - context.lastCommit.timestamp;
    if (timeSinceCommit < 60 * 60 * 1000) { // Less than 1 hour
      context.activityLevel = 'active';
    } else if (timeSinceCommit < 24 * 60 * 60 * 1000) { // Less than 1 day
      context.activityLevel = 'moderate';
    } else {
      context.activityLevel = 'inactive';
    }
  }

  /**
   * Handle test run event
   */
  private async handleTestRunEvent(
    context: ProjectContext,
    data: Record<string, unknown>
  ): Promise<void> {
    const { total, passed, failed, skipped, duration } = data as {
      total?: number;
      passed?: number;
      failed?: number;
      skipped?: number;
      duration?: number;
    };

    context.lastTestRun = {
      timestamp: Date.now(),
      total: total ?? context.lastTestRun?.total ?? 0,
      passed: passed ?? context.lastTestRun?.passed ?? 0,
      failed: failed ?? context.lastTestRun?.failed ?? 0,
      skipped: skipped ?? context.lastTestRun?.skipped ?? 0,
      duration: duration ?? 0,
    };

    // Update test health
    const passRate = context.lastTestRun.total > 0
      ? (context.lastTestRun.passed / context.lastTestRun.total) * 100
      : 100;
    context.testHealth = passRate;

    // Update blockers
    if (context.lastTestRun.failed > 0) {
      const existingBlocker = context.blockers.find(b => b.type === 'failing_tests');
      if (existingBlocker) {
        existingBlocker.description = `${context.lastTestRun.failed} test(s) failing`;
        existingBlocker.severity = context.lastTestRun.failed > 5 ? 'critical' : 'high';
        existingBlocker.createdAt = Date.now();
      } else {
        context.blockers.push({
          id: this.generateId(),
          type: 'failing_tests',
          description: `${context.lastTestRun.failed} test(s) failing`,
          severity: context.lastTestRun.failed > 5 ? 'critical' : 'high',
          createdAt: Date.now(),
        });
      }
    } else {
      // Remove failing_tests blocker if tests are passing
      context.blockers = context.blockers.filter(b => b.type !== 'failing_tests');
    }

    // Add to history
    await this.addHistoryPoint(context);
  }

  /**
   * Handle file change event
   */
  private async handleFileChangeEvent(
    context: ProjectContext,
    _data: Record<string, unknown>
  ): Promise<void> {
    context.pendingChanges = 0;
  }

  /**
   * Handle dependency change event
   */
  private async handleDependencyChangeEvent(
    context: ProjectContext,
    _data: Record<string, unknown>
  ): Promise<void> {
    // Trigger dependency health recalculation
    await this.recalculateDependencyHealth(context);
  }

  /**
   * Create new context
   */
  private async createContext(projectPath: string, projectName: string): Promise<ProjectContext> {
    const context: ProjectContext = {
      projectPath,
      projectName,
      healthScore: 50,
      testHealth: 50,
      codeHealth: 50,
      dependencyHealth: 50,
      lastCommit: {
        hash: '',
        author: '',
        message: '',
        timestamp: Date.now(),
        filesChanged: 0,
      },
      lastTestRun: {
        timestamp: 0,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
      },
      openIssues: 0,
      pendingChanges: 0,
      testTrend: 'stable',
      complexityTrend: 'stable',
      coverageTrend: 'stable',
      activityLevel: 'inactive',
      opportunities: [],
      blockers: [],
      lastUpdated: Date.now(),
      lastAnalyzed: Date.now(),
    };

    // Perform initial analysis
    await this.refreshContext(projectPath);

    return context;
  }

  /**
   * Refresh context with fresh data
   */
  private async refreshContext(projectPath: string): Promise<void> {
    const context = this.contexts.get(projectPath);
    if (!context) return;

    // Get latest commit
    try {
      const commitInfo = await this.getLatestCommit(projectPath);
      if (commitInfo) {
        context.lastCommit = commitInfo;
      }
    } catch {
      // Not a git repo or git not available
    }

    // Recalculate health scores
    await this.recalculateHealth(context);

    // Update trends
    this.updateTrends(context);

    // Scan for opportunities
    await this.scanOpportunities(context, projectPath);

    // Update blockers
    await this.updateBlockers(context, projectPath);

    context.lastUpdated = Date.now();
    context.lastAnalyzed = Date.now();
  }

  /**
   * Get latest commit info
   */
  private async getLatestCommit(projectPath: string): Promise<CommitInfo | null> {
    try {
      const { stdout } = await execAsync('git log -1 --format="%H|%an|%s|%ct"', {
        cwd: projectPath,
        timeout: 5000,
      });

      const [hash, author, message, timestamp] = stdout.trim().split('|');

      // Get file count
      const { stdout: fileCount } = await execAsync('git diff-tree --no-commit-id --name-only -r HEAD | wc -l', {
        cwd: projectPath,
        timeout: 5000,
      });

      return {
        hash,
        author,
        message,
        timestamp: parseInt(timestamp, 10) * 1000,
        filesChanged: parseInt(fileCount.trim(), 10),
      };
    } catch {
      return null;
    }
  }

  /**
   * Recalculate health scores
   */
  private async recalculateHealth(context: ProjectContext): Promise<void> {
    // Test health is updated by test events
    // If no test data, assume moderate health
    if (context.lastTestRun.timestamp === 0) {
      context.testHealth = 70;
    }

    // Code health - would come from code analyzer
    // For now, use a default value
    if (context.codeHealth === 50) {
      try {
        context.codeHealth = 70; // Default to good if no analysis
      } catch {
        context.codeHealth = 50;
      }
    }

    // Dependency health
    await this.recalculateDependencyHealth(context);

    // Overall health score (weighted average)
    context.healthScore =
      context.testHealth * CONTEXT_CONFIG.healthWeights.testHealth +
      context.codeHealth * CONTEXT_CONFIG.healthWeights.codeHealth +
      context.dependencyHealth * CONTEXT_CONFIG.healthWeights.dependencyHealth;
  }

  /**
   * Recalculate dependency health
   */
  private async recalculateDependencyHealth(context: ProjectContext): Promise<void> {
    try {
      // Check for vulnerabilities using npm audit
      try {
        const { stdout } = await execAsync('npm audit --json', {
          cwd: context.projectPath,
          timeout: 10000,
        });

        const auditResult = JSON.parse(stdout);
        const vulnCount = auditResult.metadata?.vulnerabilities?.total || 0;

        if (vulnCount === 0) {
          context.dependencyHealth = 100;
        } else if (vulnCount <= 2) {
          context.dependencyHealth = 80;
        } else if (vulnCount <= 5) {
          context.dependencyHealth = 60;
        } else if (vulnCount <= 10) {
          context.dependencyHealth = 40;
        } else {
          context.dependencyHealth = 20;
        }

        // Update blocker if vulnerabilities exist
        const highVulns = auditResult.vulnerabilities?.high || 0;
        const criticalVulns = auditResult.vulnerabilities?.critical || 0;

        if (highVulns > 0 || criticalVulns > 0) {
          const existingBlocker = context.blockers.find(b => b.type === 'dependency');
          if (existingBlocker) {
            existingBlocker.description = `${vulnCount} security vulnerabilities (${highVulns} high, ${criticalVulns} critical)`;
            existingBlocker.severity = criticalVulns > 0 ? 'critical' : 'high';
            existingBlocker.createdAt = Date.now();
          } else {
            context.blockers.push({
              id: this.generateId(),
              type: 'dependency',
              description: `${vulnCount} security vulnerabilities (${highVulns} high, ${criticalVulns} critical)`,
              severity: criticalVulns > 0 ? 'critical' : 'high',
              createdAt: Date.now(),
            });
          }
        } else {
          context.blockers = context.blockers.filter(b => b.type !== 'dependency');
        }
      } catch {
        // npm audit failed, assume moderate health
        context.dependencyHealth = 70;
      }
    } catch {
      context.dependencyHealth = 70;
    }
  }

  /**
   * Update trends based on history
   */
  private updateTrends(context: ProjectContext): void {
    const history = this.history.get(context.projectPath);
    if (!history || history.length < 2) {
      context.testTrend = 'stable';
      context.complexityTrend = 'stable';
      context.coverageTrend = 'stable';
      return;
    }

    // Get recent points
    const recent = history.slice(-CONTEXT_CONFIG.trendWindow);

    // Calculate test trend
    const testValues = recent.map(h => h.testHealth);
    context.testTrend = this.calculateTrend(testValues);

    // Calculate complexity trend (inverse of code health for complexity)
    const complexityValues = recent.map(h => 100 - h.codeHealth);
    context.complexityTrend = this.calculateTrend(complexityValues);

    // Calculate coverage trend
    const coverageValues = recent.map(h => h.codeHealth);
    context.coverageTrend = this.calculateTrend(coverageValues);
  }

  /**
   * Calculate trend from values
   */
  private calculateTrend(values: number[]): Trend {
    if (values.length < 2) return 'stable';

    const first = values[0];
    const last = values[values.length - 1];
    const change = last - first;
    const percentChange = (change / first) * 100;

    if (percentChange > 5) return 'improving';
    if (percentChange < -5) return 'declining';
    return 'stable';
  }

  /**
   * Scan for opportunities
   */
  private async scanOpportunities(context: ProjectContext, _projectPath: string): Promise<void> {
    context.opportunities = [];

    // Check for low test coverage
    if (context.testHealth < 80) {
      context.opportunities.push({
        id: this.generateId(),
        type: 'test',
        title: 'Improve test coverage',
        description: `Test health is at ${context.testHealth.toFixed(0)}%. Add more tests to improve coverage.`,
        impact: context.testHealth < 50 ? 'high' : 'medium',
        effort: 'medium',
        createdAt: Date.now(),
      });
    }

    // Check for declining trends
    if (context.testTrend === 'declining') {
      context.opportunities.push({
        id: this.generateId(),
        type: 'fix',
        title: 'Address declining test health',
        description: 'Test health has been declining. Investigate and fix failing tests.',
        impact: 'high',
        effort: 'medium',
        createdAt: Date.now(),
      });
    }

    if (context.complexityTrend === 'declining') {
      context.opportunities.push({
        id: this.generateId(),
        type: 'refactor',
        title: 'Reduce code complexity',
        description: 'Code complexity has been increasing. Consider refactoring complex areas.',
        impact: 'medium',
        effort: 'high',
        createdAt: Date.now(),
      });
    }

    // Check for inactive project with issues
    if (context.activityLevel === 'inactive' && context.healthScore < 70) {
      context.opportunities.push({
        id: this.generateId(),
        type: 'improve',
        title: 'Project maintenance needed',
        description: 'Project health is below optimal and has been inactive. Consider scheduling maintenance.',
        impact: 'medium',
        effort: 'low',
        createdAt: Date.now(),
      });
    }
  }

  /**
   * Update blockers
   */
  private async updateBlockers(context: ProjectContext, projectPath: string): Promise<void> {
    // Remove stale blockers (older than 1 hour)
    const now = Date.now();
    const staleThreshold = 60 * 60 * 1000;

    context.blockers = context.blockers.filter(b => {
      // Keep critical blockers
      if (b.severity === 'critical') return true;
      // Remove stale blockers
      return now - b.createdAt < staleThreshold;
    });

    // Check for broken build
    try {
      await execAsync('npm run build 2>&1', {
        cwd: projectPath,
        timeout: 30000,
      });

      // Build succeeded, remove build blocker
      context.blockers = context.blockers.filter(b => b.type !== 'broken_build');
    } catch {
      // Build failed
      const existingBlocker = context.blockers.find(b => b.type === 'broken_build');
      if (!existingBlocker) {
        context.blockers.push({
          id: this.generateId(),
          type: 'broken_build',
          description: 'Build is failing',
          severity: 'critical',
          createdAt: Date.now(),
        });
      }
    }
  }

  /**
   * Add history point
   */
  private async addHistoryPoint(context: ProjectContext): Promise<void> {
    const point: HistoryPoint = {
      timestamp: Date.now(),
      healthScore: context.healthScore,
      testHealth: context.testHealth,
      codeHealth: context.codeHealth,
      dependencyHealth: context.dependencyHealth,
      testPassRate: context.lastTestRun.total > 0
        ? context.lastTestRun.passed / context.lastTestRun.total
        : 1,
    };

    let history = this.history.get(context.projectPath) || [];
    history.push(point);

    // Trim old history
    const cutoff = Date.now() - CONTEXT_CONFIG.historyRetention;
    history = history.filter(h => h.timestamp > cutoff);

    this.history.set(context.projectPath, history);
  }

  /**
   * Store context in memory
   */
  private async storeContext(context: ProjectContext): Promise<void> {
    try {
      await this.memory.setFact(`context:${context.projectPath}`, context);
    } catch (error) {
      console.error('[ContextTracker] Failed to store context:', error);
    }
  }

  /**
   * Get health summary for a project
   */
  async getHealthSummary(projectPath: string): Promise<{
    score: number;
    status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    testHealth: number;
    codeHealth: number;
    dependencyHealth: number;
    blockers: Blocker[];
    opportunities: Opportunity[];
  }> {
    const context = await this.getContext(projectPath);

    let status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    const s = context.healthScore;

    if (s >= CONTEXT_CONFIG.thresholds.excellent) status = 'excellent';
    else if (s >= CONTEXT_CONFIG.thresholds.good) status = 'good';
    else if (s >= CONTEXT_CONFIG.thresholds.fair) status = 'fair';
    else if (s >= CONTEXT_CONFIG.thresholds.poor) status = 'poor';
    else status = 'critical';

    return {
      score: context.healthScore,
      status,
      testHealth: context.testHealth,
      codeHealth: context.codeHealth,
      dependencyHealth: context.dependencyHealth,
      blockers: context.blockers,
      opportunities: context.opportunities,
    };
  }

  /**
   * Start auto-refresh for a project
   */
  startAutoRefresh(projectPath: string, interval?: number): void {
    this.stopAutoRefresh(projectPath);

    const refreshInterval = interval || CONTEXT_CONFIG.refreshInterval;

    const timer = setInterval(async () => {
      try {
        await this.refreshContext(projectPath);
      } catch (error) {
        console.error(`[ContextTracker] Auto-refresh failed for ${projectPath}:`, error);
      }
    }, refreshInterval);

    this.refreshTimers.set(projectPath, timer);
  }

  /**
   * Stop auto-refresh for a project
   */
  stopAutoRefresh(projectPath: string): void {
    const timer = this.refreshTimers.get(projectPath);
    if (timer) {
      clearInterval(timer);
      this.refreshTimers.delete(projectPath);
    }
  }

  /**
   * Get all contexts
   */
  getAllContexts(): ProjectContext[] {
    return Array.from(this.contexts.values());
  }

  /**
   * Get context statistics
   */
  getStats(): {
    totalProjects: number;
    avgHealth: number;
    activeProjects: number;
    totalBlockers: number;
    totalOpportunities: number;
  } {
    const contexts = Array.from(this.contexts.values());

    return {
      totalProjects: contexts.length,
      avgHealth: contexts.length > 0
        ? contexts.reduce((sum, c) => sum + c.healthScore, 0) / contexts.length
        : 0,
      activeProjects: contexts.filter(c => c.activityLevel === 'active').length,
      totalBlockers: contexts.reduce((sum, c) => sum + c.blockers.length, 0),
      totalOpportunities: contexts.reduce((sum, c) => sum + c.opportunities.length, 0),
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ===========================================
// Global Singleton
// ===========================================

let globalContextTracker: ContextTracker | null = null;

export function getContextTracker(): ContextTracker {
  if (!globalContextTracker) {
    globalContextTracker = new ContextTracker();
  }
  return globalContextTracker;
}

export function resetContextTracker(): void {
  const tracker = globalContextTracker;
  if (tracker) {
    // Stop all auto-refresh timers
    for (const context of tracker.getAllContexts()) {
      tracker.stopAutoRefresh(context.projectPath);
    }
  }
  globalContextTracker = null;
}
