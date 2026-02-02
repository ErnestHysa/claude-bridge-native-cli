/**
 * Outcome Tracker - Learn from autonomous actions
 *
 * The Outcome Tracker learns from the results of autonomous actions to improve
 * future decision-making:
 * - Track success/failure rates of actions
 * - Learn which types of actions work well
 * - Identify patterns in successful vs failed actions
 * - Provide feedback to improve the system
 * - Generate learning insights
 *
 * Learning dimensions:
 * - Action type success rates
 * - Risk assessment accuracy
 * - Approval patterns
 * - Time/complexity correlations
 */

import { getMemoryStore } from '../memory/memory-store.js';

// ============================================
// Types
// ============================================

/**
 * Outcome type
 */
export type OutcomeType = 'success' | 'failure' | 'partial' | 'timeout' | 'error';

/**
 * Learning metric
 */
export interface LearningMetric {
  id: string;
  name: string;
  category: 'success_rate' | 'avg_duration' | 'risk_accuracy' | 'approval_rate' | 'user_satisfaction';
  value: number;              // 0-1 for rates, actual value for others
  sampleSize: number;
  trend: 'improving' | 'stable' | 'declining';
  lastUpdated: number;
}

/**
 * Action outcome record
 */
export interface ActionOutcome {
  id: string;
  actionId: string;
  actionType: string;
  actionCategory: string;
  projectPath: string;
  chatId: number;
  outcome: OutcomeType;
  success: boolean;
  duration: number;            // milliseconds
  riskLevel: string;
  requiredApproval: boolean;
  wasApproved: boolean;
  approvedBy: 'user' | 'auto' | 'policy';
  changesCount: number;
  linesChanged: number;

  // Prediction vs reality
  predictedSuccess: number;    // 0-1 confidence
  actualSuccess: number;       // 0-1

  // Learning data
  factors: Record<string, unknown>;
  lessons: string[];

  timestamp: number;
}

/**
 * Learning insight
 */
export interface LearningInsight {
  id: string;
  type: 'pattern' | 'recommendation' | 'warning' | 'correlation';
  title: string;
  description: string;
  confidence: number;        // 0-1
  evidence: string[];
  actionable: boolean;
  suggestedChanges: string[];
  timestamp: number;
}

/**
 * Learning report
 */
export interface LearningReport {
  id: string;
  chatId: number;
  projectPath?: string;
  period: 'daily' | 'weekly' | 'monthly' | 'all';
  startDate: number;
  endDate: number;

  summary: {
    totalActions: number;
    successRate: number;
    avgDuration: number;
    mostSuccessfulCategory: string;
    leastSuccessfulCategory: string;
    topInsights: number;
  };

  metrics: LearningMetric[];
  insights: LearningInsight[];

  recommendations: string[];

  generatedAt: number;
}

// ============================================
// Configuration
// ============================================

const LEARNING_CONFIG = {
  // Minimum samples for reliable metrics
  minSampleSize: 5,

  // Confidence threshold for insights
  insightConfidence: 0.7,

  // Trends
  trendWindow: 10,            // Number of recent samples for trend calculation
  trendThreshold: 0.1,         // 10% change indicates trend

  // Retention (ms) - keep data for 1 year
  retentionPeriod: 365 * 24 * 60 * 60 * 1000,
};

// ============================================
// Outcome Tracker Class
// ============================================

export class OutcomeTracker {
  private memory = getMemoryStore();
  private outcomes = new Map<string, ActionOutcome>();
  private metrics = new Map<string, LearningMetric>();
  private insights = new Map<string, LearningInsight>();
  private active = false;

  /**
   * Start the tracker
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadData();

    console.log('[OutcomeTracker] Started');
  }

  /**
   * Stop the tracker
   */
  stop(): void {
    this.active = false;
    console.log('[OutcomeTracker] Stopped');
  }

  /**
   * Record an action outcome
   */
  async recordOutcome(outcome: Omit<ActionOutcome, 'id' | 'timestamp'>): Promise<ActionOutcome> {
    const record: ActionOutcome = {
      id: this.generateOutcomeId(),
      timestamp: Date.now(),
      ...outcome,
    };

    this.outcomes.set(record.id, record);
    await this.storeOutcome(record);

    // Update metrics based on this outcome
    await this.updateMetrics(record);

    // Generate insights if significant
    await this.generateInsights(record);

    return record;
  }

  /**
   * Update metrics based on an outcome
   */
  private async updateMetrics(outcome: ActionOutcome): Promise<void> {
    const actionKey = `${outcome.actionCategory}:${outcome.actionType}`;

    // Update success rate metric
    await this.updateSuccessMetric(actionKey, outcome);

    // Update average duration metric
    await this.updateDurationMetric(actionKey, outcome);

    // Update risk accuracy metric
    await this.updateRiskAccuracyMetric(actionKey, outcome);

    // Update approval rate metric
    await this.updateApprovalRateMetric(actionKey, outcome);
  }

  /**
   * Update success rate metric
   */
  private async updateSuccessMetric(actionKey: string, outcome: ActionOutcome): Promise<void> {
    const metricKey = `success_rate:${actionKey}`;
    const existing = this.metrics.get(metricKey);

    // Get all outcomes for this action type
    const relatedOutcomes = Array.from(this.outcomes.values())
      .filter(o => `${o.actionCategory}:${o.actionType}` === actionKey);

    const successCount = relatedOutcomes.filter(o => o.success).length + (outcome.success ? 1 : 0);
    const newRate = successCount / (relatedOutcomes.length + 1);

    // Calculate trend
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (existing && relatedOutcomes.length >= LEARNING_CONFIG.trendWindow) {
      if (newRate > existing.value + LEARNING_CONFIG.trendThreshold) {
        trend = 'improving';
      } else if (newRate < existing.value - LEARNING_CONFIG.trendThreshold) {
        trend = 'declining';
      }
    }

    const metric: LearningMetric = {
      id: metricKey,
      name: `${actionKey} Success Rate`,
      category: 'success_rate',
      value: newRate,
      sampleSize: relatedOutcomes.length + 1,
      trend,
      lastUpdated: Date.now(),
    };

    this.metrics.set(metricKey, metric);
    await this.memory.setFact(`metric:${metricKey}`, metric);
  }

  /**
   * Update average duration metric
   */
  private async updateDurationMetric(actionKey: string, outcome: ActionOutcome): Promise<void> {
    const metricKey = `avg_duration:${actionKey}`;
    const existing = this.metrics.get(metricKey);

    const relatedOutcomes = Array.from(this.outcomes.values())
      .filter(o => `${o.actionCategory}:${o.actionType}` === actionKey);

    const totalDuration = relatedOutcomes.reduce((sum, o) => sum + o.duration, 0) + outcome.duration;
    const newAvg = totalDuration / (relatedOutcomes.length + 1);

    const metric: LearningMetric = {
      id: metricKey,
      name: `${actionKey} Average Duration`,
      category: 'avg_duration',
      value: newAvg,
      sampleSize: relatedOutcomes.length + 1,
      trend: existing ? (newAvg < existing.value ? 'improving' : newAvg > existing.value ? 'declining' : 'stable') : 'stable',
      lastUpdated: Date.now(),
    };

    this.metrics.set(metricKey, metric);
    await this.memory.setFact(`metric:${metricKey}`, metric);
  }

  /**
   * Update risk accuracy metric
   */
  private async updateRiskAccuracyMetric(actionKey: string, outcome: ActionOutcome): Promise<void> {
    // Risk accuracy = how well predicted risk matches actual outcome
    // High risk should correlate with failure, low risk with success
    const metricKey = `risk_accuracy:${actionKey}`;

    const relatedOutcomes = Array.from(this.outcomes.values())
      .filter(o => `${o.actionCategory}:${o.actionType}` === actionKey);

    // Calculate correlation between risk level and success
    // Risk levels: none=0, low=1, medium=2, high=3, critical=4
    const riskValues = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    const riskScore = riskValues[outcome.riskLevel as keyof typeof riskValues] || 0;

    // Successful low-risk actions = good prediction
    // Failed high-risk actions = good prediction
    let correctPredictions = 0;
    for (const o of relatedOutcomes) {
      const r = riskValues[o.riskLevel as keyof typeof riskValues] || 0;
      // Low risk + success OR high risk + failure = correct prediction
      if ((r <= 1 && o.success) || (r >= 3 && !o.success)) {
        correctPredictions++;
      }
    }
    if ((riskScore <= 1 && outcome.success) || (riskScore >= 3 && !outcome.success)) {
      correctPredictions++;
    }

    const accuracy = (correctPredictions + 1) / (relatedOutcomes.length + 1);

    const metric: LearningMetric = {
      id: metricKey,
      name: `${actionKey} Risk Accuracy`,
      category: 'risk_accuracy',
      value: accuracy,
      sampleSize: relatedOutcomes.length + 1,
      trend: 'stable',
      lastUpdated: Date.now(),
    };

    this.metrics.set(metricKey, metric);
    await this.memory.setFact(`metric:${metricKey}`, metric);
  }

  /**
   * Update approval rate metric
   */
  private async updateApprovalRateMetric(actionKey: string, outcome: ActionOutcome): Promise<void> {
    const metricKey = `approval_rate:${actionKey}`;

    const relatedOutcomes = Array.from(this.outcomes.values())
      .filter(o => `${o.actionCategory}:${o.actionType}` === actionKey)
      .filter(o => o.requiredApproval);

    if (relatedOutcomes.length === 0 && !outcome.requiredApproval) {
      return; // No approval required for this action type
    }

    const approvedCount = relatedOutcomes.filter(o => o.wasApproved).length + (outcome.wasApproved ? 1 : 0);
    const approvalRate = approvedCount / (relatedOutcomes.filter(o => o.requiredApproval).length + (outcome.requiredApproval ? 1 : 0));

    const metric: LearningMetric = {
      id: metricKey,
      name: `${actionKey} Approval Rate`,
      category: 'approval_rate',
      value: approvalRate,
      sampleSize: relatedOutcomes.filter(o => o.requiredApproval).length + 1,
      trend: 'stable',
      lastUpdated: Date.now(),
    };

    this.metrics.set(metricKey, metric);
    await this.memory.setFact(`metric:${metricKey}`, metric);
  }

  /**
   * Generate insights from an outcome
   */
  private async generateInsights(outcome: ActionOutcome): Promise<void> {
    // Only generate insights if we have enough data
    const relatedOutcomes = Array.from(this.outcomes.values())
      .filter(o => `${o.actionCategory}:${o.actionType}` === `${outcome.actionCategory}:${outcome.actionType}`);

    if (relatedOutcomes.length < LEARNING_CONFIG.minSampleSize) {
      return;
    }

    const successRate = relatedOutcomes.filter(o => o.success).length / relatedOutcomes.length;

    // Insight: Low success rate action
    if (successRate < 0.5 && relatedOutcomes.length >= LEARNING_CONFIG.minSampleSize) {
      const insight: LearningInsight = {
        id: this.generateInsightId(),
        type: 'warning',
        title: `Low success rate for ${outcome.actionType}`,
        description: `${outcome.actionType} actions have a ${(successRate * 100).toFixed(0)}% success rate over ${relatedOutcomes.length} attempts.`,
        confidence: 1 - successRate,  // Higher confidence when rate is very low
        evidence: [
          `${relatedOutcomes.filter(o => o.success).length} successful out of ${relatedOutcomes.length} attempts`,
          `Average duration: ${Math.round(relatedOutcomes.reduce((s, o) => s + o.duration, 0) / relatedOutcomes.length / 1000)}s`,
        ],
        actionable: true,
        suggestedChanges: [
          `Review ${outcome.actionType} implementation approach`,
          `Consider requiring approval for ${outcome.actionType} actions`,
          `Increase testing before applying ${outcome.actionType} changes`,
        ],
        timestamp: Date.now(),
      };

      this.insights.set(insight.id, insight);
      await this.memory.setFact(`insight:${insight.id}`, insight);
    }

    // Insight: High risk actions often fail
    const highRiskOutcomes = relatedOutcomes.filter(o => o.riskLevel === 'high' || o.riskLevel === 'critical');
    if (highRiskOutcomes.length >= LEARNING_CONFIG.minSampleSize) {
      const highRiskFailureRate = highRiskOutcomes.filter(o => !o.success).length / highRiskOutcomes.length;

      if (highRiskFailureRate > 0.7) {
        const insight: LearningInsight = {
          id: this.generateInsightId(),
          type: 'pattern',
          title: `High risk actions frequently fail`,
          description: `Actions marked as high or critical risk have a ${(highRiskFailureRate * 100).toFixed(0)}% failure rate.`,
          confidence: highRiskFailureRate,
          evidence: [
            `${highRiskOutcomes.filter(o => !o.success).length} failures out of ${highRiskOutcomes.length} high-risk actions`,
          ],
          actionable: true,
          suggestedChanges: [
            `Increase scrutiny of high-risk actions`,
            `Break down high-risk actions into smaller steps`,
            `Require user approval for high-risk actions`,
          ],
          timestamp: Date.now(),
        };

        this.insights.set(insight.id, insight);
        await this.memory.setFact(`insight:${insight.id}`, insight);
      }
    }
  }

  /**
   * Get a learning report
   */
  async getReport(options: {
    chatId: number;
    projectPath?: string;
    period: 'daily' | 'weekly' | 'monthly' | 'all';
  }): Promise<LearningReport> {
    const { chatId, projectPath, period } = options;

    // Calculate date range
    const endDate = Date.now();
    const startDate = period === 'daily' ? endDate - 24 * 60 * 60 * 1000 :
                    period === 'weekly' ? endDate - 7 * 24 * 60 * 60 * 1000 :
                    period === 'monthly' ? endDate - 30 * 24 * 60 * 60 * 1000 :
                    0; // all time

    // Get outcomes in range
    let outcomes = Array.from(this.outcomes.values())
      .filter(o => o.chatId === chatId && o.timestamp >= startDate && o.timestamp <= endDate);

    if (projectPath) {
      outcomes = outcomes.filter(o => o.projectPath === projectPath);
    }

    // Calculate summary
    const totalActions = outcomes.length;
    const successCount = outcomes.filter(o => o.success).length;
    const successRate = totalActions > 0 ? successCount / totalActions : 1;
    const avgDuration = totalActions > 0
      ? outcomes.reduce((sum, o) => sum + o.duration, 0) / totalActions
      : 0;

    // Find most/least successful categories
    const categoryStats = new Map<string, { success: number; total: number }>();
    for (const o of outcomes) {
      const key = `${o.actionCategory}:${o.actionType}`;
      const stats = categoryStats.get(key) || { success: 0, total: 0 };
      stats.success += o.success ? 1 : 0;
      stats.total += 1;
      categoryStats.set(key, stats);
    }

    let mostSuccessfulCategory = '';
    let leastSuccessfulCategory = '';
    let bestRate = -1;
    let worstRate = 2;

    for (const [key, stats] of categoryStats) {
      const rate = stats.success / stats.total;
      if (stats.total >= LEARNING_CONFIG.minSampleSize) {
        if (rate > bestRate) {
          bestRate = rate;
          mostSuccessfulCategory = key;
        }
        if (rate < worstRate) {
          worstRate = rate;
          leastSuccessfulCategory = key;
        }
      }
    }

    // Get insights
    const insights = Array.from(this.insights.values())
      .filter(i => i.timestamp >= startDate && i.timestamp <= endDate && i.confidence >= (LEARNING_CONFIG.insightConfidence))
      .slice(0, 10);

    // Generate recommendations
    const recommendations = this.generateRecommendations(outcomes, insights);

    // Get metrics
    const metrics = Array.from(this.metrics.values())
      .filter(m => m.lastUpdated >= startDate);

    const report: LearningReport = {
      id: this.generateReportId(),
      chatId,
      projectPath,
      period,
      startDate,
      endDate,
      summary: {
        totalActions,
        successRate,
        avgDuration,
        mostSuccessfulCategory,
        leastSuccessfulCategory,
        topInsights: insights.length,
      },
      metrics,
      insights,
      recommendations,
      generatedAt: Date.now(),
    };

    await this.memory.setFact(`report:${report.id}`, report);

    return report;
  }

  /**
   * Generate learning recommendations
   */
  private generateRecommendations(outcomes: ActionOutcome[], insights: LearningInsight[]): string[] {
    const recommendations: string[] = [];

    // From insights
    for (const insight of insights) {
      if (insight.actionable && insight.suggestedChanges) {
        recommendations.push(...insight.suggestedChanges);
      }
    }

    // From patterns
    const failedOutcomes = outcomes.filter(o => !o.success);
    if (failedOutcomes.length > 5) {
      recommendations.push('Review recent failures to identify common patterns');
    }

    const longOutcomes = outcomes.filter(o => o.duration > 300000); // 5 minutes
    if (longOutcomes.length > 3) {
      recommendations.push('Some actions are taking longer than expected - consider optimization');
    }

    // Remove duplicates
    return [...new Set(recommendations)];
  }

  /**
   * Get metrics
   */
  getMetrics(filter?: { category?: LearningMetric['category'] }): LearningMetric[] {
    let metrics = Array.from(this.metrics.values());

    if (filter?.category) {
      metrics = metrics.filter(m => m.category === filter.category);
    }

    return metrics.sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  /**
   * Get insights
   */
  getInsights(filter?: { minConfidence?: number; type?: LearningInsight['type'] }): LearningInsight[] {
    let insights = Array.from(this.insights.values());

    if (filter?.minConfidence !== undefined) {
      insights = insights.filter(i => i.confidence >= filter.minConfidence!);
    }

    if (filter?.type) {
      insights = insights.filter(i => i.type === filter.type);
    }

    return insights.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Clean up old data
   */
  async cleanupOldData(): Promise<number> {
    const cutoff = Date.now() - LEARNING_CONFIG.retentionPeriod;
    let cleaned = 0;

    // Clean outcomes
    for (const [id, outcome] of this.outcomes) {
      if (outcome.timestamp < cutoff) {
        this.outcomes.delete(id);
        await this.memory.setFact(`outcome:${id}`, null);
        cleaned++;
      }
    }

    // Clean insights
    for (const [id, insight] of this.insights) {
      if (insight.timestamp < cutoff) {
        this.insights.delete(id);
        await this.memory.setFact(`insight:${id}`, null);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Store outcome in memory
   */
  private async storeOutcome(outcome: ActionOutcome): Promise<void> {
    await this.memory.setFact(`outcome:${outcome.id}`, outcome);
  }

  /**
   * Load data from memory
   */
  private async loadData(): Promise<void> {
    // Load would happen from persistent storage
  }

  /**
   * Generate unique IDs
   */
  private generateOutcomeId(): string {
    return `outcome-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateInsightId(): string {
    return `insight-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateReportId(): string {
    return `learning-report-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalOutcomeTracker: OutcomeTracker | null = null;

export function getOutcomeTracker(): OutcomeTracker {
  if (!globalOutcomeTracker) {
    globalOutcomeTracker = new OutcomeTracker();
  }
  return globalOutcomeTracker;
}

export function resetOutcomeTracker(): void {
  if (globalOutcomeTracker) {
    globalOutcomeTracker.stop();
  }
  globalOutcomeTracker = null;
}
