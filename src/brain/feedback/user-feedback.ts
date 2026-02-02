/**
 * User Feedback System - Collect and analyze user feedback
 *
 * The User Feedback System collects feedback from users about autonomous actions:
 * - Collect feedback via Telegram commands/reactions
 * - Track satisfaction ratings over time
 * - Analyze feedback patterns
 * - Use feedback to improve autonomous decisions
 * - Generate feedback reports
 *
 * Feedback types:
 * - Rating (1-5 stars)
 * - Thumbs up/down
 * - Text comments
 * - Category-based feedback (speed, quality, accuracy)
 */

import { getMemoryStore } from '../memory/memory-store.js';
import { getTransparencyTracker, type ActionCategory } from '../transparency/transparency-tracker.js';
import { getOutcomeTracker } from '../learning/outcome-tracker.js';

// ============================================
// Types
// ============================================

/**
 * Feedback rating type
 */
export type FeedbackRating = 1 | 2 | 3 | 4 | 5;

/**
 * Feedback type
 */
export type FeedbackType = 'rating' | 'thumbs_up' | 'thumbs_down' | 'comment' | 'category';

/**
 * Feedback category
 */
export type FeedbackCategory = 'accuracy' | 'speed' | 'quality' | 'helpfulness' | 'communication';

/**
 * User feedback
 */
export interface UserFeedback {
  id: string;
  chatId: number;
  userId?: number;

  // Action reference
  actionId: string;
  actionType: string;
  actionCategory: ActionCategory;
  projectPath: string;

  // Feedback
  type: FeedbackType;
  rating?: FeedbackRating;
  isPositive?: boolean;        // For thumbs up/down
  category?: FeedbackCategory;
  comment?: string;

  // Context
  timestamp: number;
  wasActionSuccessful: boolean;
  userPermissionLevel: string;

  // System use
  analyzed: boolean;
  actionTaken?: string;        // What system did based on feedback
}

/**
 * Feedback summary
 */
export interface FeedbackSummary {
  totalFeedback: number;
  averageRating: number;
  positiveRatio: number;       // 0-1
  byCategory: Record<FeedbackCategory, { count: number; avgRating: number }>;
  byActionType: Record<string, { count: number; avgRating: number }>;
  recentComments: string[];
  topIssues: string[];
}

/**
 * Feedback trend
 */
export interface FeedbackTrend {
  period: string;              // 'daily', 'weekly', 'monthly'
  dataPoints: Array<{
    timestamp: number;
    avgRating: number;
    count: number;
  }>;
  trend: 'improving' | 'stable' | 'declining';
  changePercent: number;
}

/**
 * Feedback prompt
 */
export interface FeedbackPrompt {
  actionId: string;
  chatId: number;
  sentAt: number;
  expiresAt: number;
  promptMessage: string;
  respondedAt?: number;
}

// ============================================
// Configuration
// ============================================

const FEEDBACK_CONFIG = {
  // Auto-prompt for feedback after actions
  autoPromptAfterAction: true,

  // Minimum time between prompts (per user per day)
  minPromptInterval: 2 * 60 * 60 * 1000,

  // Retention period for feedback (90 days)
  retentionPeriod: 90 * 24 * 60 * 60 * 1000,

  // Trend calculation period (30 days)
  trendPeriod: 30 * 24 * 60 * 60 * 1000,

  // Minimum feedback count for reliable metrics
  minFeedbackCount: 5,

  // Categories that trigger alerts
  alertThreshold: {
    rating: 2.5,               // Alert if average rating below this
    positiveRatio: 0.5,        // Alert if positive ratio below this
  },
};

// ============================================
// User Feedback Manager Class
// ============================================

export class UserFeedbackManager {
  private memory = getMemoryStore();
  private feedback = new Map<string, UserFeedback>();
  private prompts = new Map<string, FeedbackPrompt>();
  private active = false;

  /**
   * Start the feedback manager
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadFeedback();
    await this.loadPrompts();

    console.log('[UserFeedbackManager] Started');
  }

  /**
   * Stop the feedback manager
   */
  stop(): void {
    this.active = false;
    console.log('[UserFeedbackManager] Stopped');
  }

  /**
   * Submit feedback
   */
  async submitFeedback(feedback: Omit<UserFeedback, 'id' | 'timestamp' | 'analyzed'>): Promise<UserFeedback> {
    const record: UserFeedback = {
      ...feedback,
      id: this.generateFeedbackId(),
      timestamp: Date.now(),
      analyzed: false,
    };

    this.feedback.set(record.id, record);
    await this.storeFeedback(record);

    // Analyze the feedback
    await this.analyzeFeedback(record);

    // Remove prompt if exists
    this.prompts.delete(feedback.actionId);

    console.log(`[UserFeedbackManager] Feedback submitted: ${record.id}`);

    return record;
  }

  /**
   * Submit a simple rating
   */
  async submitRating(
    actionId: string,
    chatId: number,
    rating: FeedbackRating,
    userId?: number
  ): Promise<UserFeedback | null> {
    // Find the associated action from transparency tracker
    const tracker = getTransparencyTracker();
    const action = tracker.getAction(actionId);

    if (!action) {
      console.warn(`[UserFeedbackManager] Action not found: ${actionId}`);
      return null;
    }

    return this.submitFeedback({
      chatId,
      userId,
      actionId,
      actionType: 'unknown',
      actionCategory: action.category,
      projectPath: action.projectPath,
      type: 'rating',
      rating,
      wasActionSuccessful: action.status === 'completed' || action.outcome === 'success',
      userPermissionLevel: 'unknown',
    });
  }

  /**
   * Submit thumbs up/down
   */
  async submitThumbs(
    actionId: string,
    chatId: number,
    isPositive: boolean,
    userId?: number
  ): Promise<UserFeedback | null> {
    const tracker = getTransparencyTracker();
    const action = tracker.getAction(actionId);

    if (!action) {
      return null;
    }

    return this.submitFeedback({
      chatId,
      userId,
      actionId,
      actionType: 'unknown',
      actionCategory: action.category,
      projectPath: action.projectPath,
      type: 'thumbs_up',
      isPositive,
      wasActionSuccessful: action.status === 'completed' || action.outcome === 'success',
      userPermissionLevel: 'unknown',
    });
  }

  /**
   * Submit a comment
   */
  async submitComment(
    actionId: string,
    chatId: number,
    comment: string,
    userId?: number
  ): Promise<UserFeedback | null> {
    const tracker = getTransparencyTracker();
    const action = tracker.getAction(actionId);

    if (!action) {
      return null;
    }

    return this.submitFeedback({
      chatId,
      userId,
      actionId,
      actionType: 'unknown',
      actionCategory: action.category,
      projectPath: action.projectPath,
      type: 'comment',
      comment,
      wasActionSuccessful: action.status === 'completed' || action.outcome === 'success',
      userPermissionLevel: 'unknown',
    });
  }

  /**
   * Create a feedback prompt
   */
  async createPrompt(actionId: string, chatId: number, promptMessage?: string): Promise<FeedbackPrompt> {
    const prompt: FeedbackPrompt = {
      actionId,
      chatId,
      sentAt: Date.now(),
      expiresAt: Date.now() + FEEDBACK_CONFIG.minPromptInterval,
      promptMessage: promptMessage || 'How was this action? Please rate 1-5 stars.',
    };

    this.prompts.set(actionId, prompt);
    await this.memory.setFact(`feedback_prompt:${actionId}`, prompt);

    return prompt;
  }

  /**
   * Check if prompt exists and is valid
   */
  getPrompt(actionId: string): FeedbackPrompt | undefined {
    const prompt = this.prompts.get(actionId);
    if (!prompt) return undefined;

    if (Date.now() > prompt.expiresAt) {
      this.prompts.delete(actionId);
      return undefined;
    }

    return prompt;
  }

  /**
   * Get feedback summary
   */
  getSummary(filter?: {
    chatId?: number;
    projectPath?: string;
    actionCategory?: ActionCategory;
    period?: number;           // milliseconds back from now
  }): FeedbackSummary {
    let feedback = Array.from(this.feedback.values());

    // Apply filters
    if (filter?.chatId !== undefined) {
      feedback = feedback.filter(f => f.chatId === filter.chatId);
    }

    if (filter?.projectPath) {
      feedback = feedback.filter(f => f.projectPath === filter.projectPath);
    }

    if (filter?.actionCategory) {
      feedback = feedback.filter(f => f.actionCategory === filter.actionCategory);
    }

    if (filter?.period) {
      const cutoff = Date.now() - filter.period;
      feedback = feedback.filter(f => f.timestamp >= cutoff);
    }

    // Calculate summary
    const ratings = feedback.filter(f => f.rating !== undefined);
    const averageRating = ratings.length > 0
      ? ratings.reduce((sum, f) => sum + (f.rating || 0), 0) / ratings.length
      : 0;

    const thumbs = feedback.filter(f => f.isPositive !== undefined);
    const positiveRatio = thumbs.length > 0
      ? thumbs.filter(f => f.isPositive).length / thumbs.length
      : 0;

    // By category
    const byCategory: Record<string, { count: number; avgRating: number }> = {};
    for (const f of feedback) {
      if (!f.category) continue;
      if (!byCategory[f.category]) {
        byCategory[f.category] = { count: 0, avgRating: 0 };
      }
      byCategory[f.category].count++;
      if (f.rating) {
        byCategory[f.category].avgRating =
          (byCategory[f.category].avgRating * (byCategory[f.category].count - 1) + f.rating) /
          byCategory[f.category].count;
      }
    }

    // By action type
    const byActionType: Record<string, { count: number; avgRating: number }> = {};
    for (const f of feedback) {
      if (!byActionType[f.actionType]) {
        byActionType[f.actionType] = { count: 0, avgRating: 0 };
      }
      byActionType[f.actionType].count++;
      if (f.rating) {
        byActionType[f.actionType].avgRating =
          (byActionType[f.actionType].avgRating * (byActionType[f.actionType].count - 1) + f.rating) /
          byActionType[f.actionType].count;
      }
    }

    // Recent comments
    const recentComments = feedback
      .filter(f => f.comment && f.comment.length > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10)
      .map(f => f.comment!);

    // Top issues (negative comments)
    const negativeComments = feedback.filter(f => {
      if (!f.comment) return false;
      if (f.rating && f.rating >= 3) return false;
      if (f.isPositive === true) return false;
      return true;
    });
    const topIssues = this.extractCommonIssues(negativeComments.map(f => f.comment!));

    return {
      totalFeedback: feedback.length,
      averageRating,
      positiveRatio,
      byCategory: byCategory as Record<FeedbackCategory, { count: number; avgRating: number }>,
      byActionType,
      recentComments,
      topIssues,
    };
  }

  /**
   * Get feedback trend
   */
  getTrend(options: {
    chatId?: number;
    projectPath?: string;
    period?: 'daily' | 'weekly' | 'monthly';
    days?: number;
  }): FeedbackTrend {
    const { period = 'daily', days = 30 } = options;
    let feedback = Array.from(this.feedback.values());

    if (options?.chatId !== undefined) {
      feedback = feedback.filter(f => f.chatId === options.chatId);
    }

    if (options?.projectPath) {
      feedback = feedback.filter(f => f.projectPath === options.projectPath);
    }

    // Group by time period
    const now = Date.now();
    const interval = period === 'daily' ? 24 * 60 * 60 * 1000 :
                    period === 'weekly' ? 7 * 24 * 60 * 60 * 1000 :
                    30 * 24 * 60 * 60 * 1000;

    const points = new Map<number, { ratings: number[]; count: number }>();

    for (const f of feedback) {
      if (f.timestamp < now - days * 24 * 60 * 60 * 1000) continue;

      const pointTime = Math.floor(f.timestamp / interval) * interval;
      const point = points.get(pointTime) || { ratings: [], count: 0 };
      if (f.rating) {
        point.ratings.push(f.rating);
      }
      point.count++;
      points.set(pointTime, point);
    }

    // Convert to data points
    const dataPoints = Array.from(points.entries())
      .map(([timestamp, data]) => ({
        timestamp,
        avgRating: data.ratings.length > 0
          ? data.ratings.reduce((sum, r) => sum + r, 0) / data.ratings.length
          : 0,
        count: data.count,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Calculate trend
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    let changePercent = 0;

    if (dataPoints.length >= 2) {
      const recent = dataPoints.slice(-3);
      const recentAvg = recent.reduce((sum, p) => sum + p.avgRating, 0) / recent.length;
      const older = dataPoints.slice(0, -3);
      const olderAvg = older.length > 0
        ? older.reduce((sum, p) => sum + p.avgRating, 0) / older.length
        : recentAvg;

      changePercent = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

      if (changePercent > 5) {
        trend = 'improving';
      } else if (changePercent < -5) {
        trend = 'declining';
      }
    }

    return {
      period,
      dataPoints,
      trend,
      changePercent,
    };
  }

  /**
   * Check if alert should be triggered based on feedback
   */
  checkAlerts(summary?: FeedbackSummary): string[] {
    const s = summary || this.getSummary();
    const alerts: string[] = [];

    if (s.totalFeedback >= FEEDBACK_CONFIG.minFeedbackCount) {
      if (s.averageRating < FEEDBACK_CONFIG.alertThreshold.rating) {
        alerts.push(`Average rating (${s.averageRating.toFixed(1)}) is below threshold (${FEEDBACK_CONFIG.alertThreshold.rating})`);
      }

      if (s.positiveRatio < FEEDBACK_CONFIG.alertThreshold.positiveRatio) {
        alerts.push(`Positive ratio (${(s.positiveRatio * 100).toFixed(0)}%) is below threshold (${FEEDBACK_CONFIG.alertThreshold.positiveRatio * 100}%)`);
      }
    }

    // Check for specific category issues
    for (const [category, data] of Object.entries(s.byCategory)) {
      if (data.count >= FEEDBACK_CONFIG.minFeedbackCount && data.avgRating < 3) {
        alerts.push(`${category} category has low satisfaction (${data.avgRating.toFixed(1)} / 5)`);
      }
    }

    return alerts;
  }

  /**
   * Get feedback for a specific action
   */
  getActionFeedback(actionId: string): UserFeedback[] {
    return Array.from(this.feedback.values()).filter(f => f.actionId === actionId);
  }

  /**
   * Clean up old feedback
   */
  async cleanupOldFeedback(): Promise<number> {
    const cutoff = Date.now() - FEEDBACK_CONFIG.retentionPeriod;
    let cleaned = 0;

    for (const [id, feedback] of this.feedback) {
      if (feedback.timestamp < cutoff) {
        this.feedback.delete(id);
        await this.memory.setFact(`feedback:${id}`, null);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Analyze feedback and take action
   */
  private async analyzeFeedback(feedback: UserFeedback): Promise<void> {
    // Mark as analyzed
    feedback.analyzed = true;

    // Low rating or negative feedback - log for review
    const isNegative = (feedback.rating && feedback.rating <= 2) ||
                      (feedback.isPositive === false) ||
                      (feedback.comment && this.isNegativeComment(feedback.comment));

    if (isNegative) {
      feedback.actionTaken = 'flagged_for_review';
      await this.storeFeedback(feedback);

      // Could trigger notifications to admins
      console.log(`[UserFeedbackManager] Negative feedback flagged: ${feedback.id}`);
      return;
    }

    // High rating - learn from success
    if (feedback.rating && feedback.rating >= 4) {
      feedback.actionTaken = 'logged_as_positive';
      await this.storeFeedback(feedback);

      // Update outcome tracker with positive signal
      const outcomeTracker = getOutcomeTracker();
      await outcomeTracker.recordOutcome({
        actionId: feedback.actionId,
        actionType: feedback.actionType,
        actionCategory: feedback.actionCategory,
        projectPath: feedback.projectPath,
        chatId: feedback.chatId,
        outcome: 'success',
        success: true,
        duration: 0,
        riskLevel: 'low',
        requiredApproval: false,
        wasApproved: true,
        approvedBy: 'user',
        changesCount: 0,
        linesChanged: 0,
        predictedSuccess: feedback.rating / 5,
        actualSuccess: 1,
        factors: {
          userRating: feedback.rating,
          feedbackType: feedback.type,
        },
        lessons: [`User rated this action ${feedback.rating}/5`],
      });
    }
  }

  /**
   * Check if a comment is negative
   */
  private isNegativeComment(comment: string): boolean {
    const negativeWords = [
      'bad', 'poor', 'terrible', 'worst', 'hate', 'dislike',
      'wrong', 'error', 'fail', 'broken', 'slow', 'bug',
      'not working', "doesn't work", 'useless', 'waste',
    ];

    const lowerComment = comment.toLowerCase();
    return negativeWords.some(word => lowerComment.includes(word));
  }

  /**
   * Extract common issues from comments
   */
  private extractCommonIssues(comments: string[]): string[] {
    if (comments.length === 0) return [];

    const issues: Record<string, number> = {};

    // Simple keyword extraction
    const keywords = [
      'slow', 'error', 'crash', 'wrong', 'bug', 'confusing',
      'hard to use', 'complicated', 'missing', 'incorrect',
      'quality', 'accuracy', 'speed',
    ];

    for (const comment of comments) {
      const lower = comment.toLowerCase();
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          issues[keyword] = (issues[keyword] || 0) + 1;
        }
      }
    }

    // Return top issues
    return Object.entries(issues)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue, count]) => `${issue} (${count}x)`);
  }

  /**
   * Store feedback in memory
   */
  private async storeFeedback(feedback: UserFeedback): Promise<void> {
    await this.memory.setFact(`feedback:${feedback.id}`, feedback);
  }

  /**
   * Load feedback from memory
   */
  private async loadFeedback(): Promise<void> {
    // Feedback is loaded on demand
  }

  /**
   * Load prompts from memory
   */
  private async loadPrompts(): Promise<void> {
    // Prompts are loaded on demand
  }

  /**
   * Generate a unique feedback ID
   */
  private generateFeedbackId(): string {
    return `feedback-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalUserFeedbackManager: UserFeedbackManager | null = null;

export function getUserFeedbackManager(): UserFeedbackManager {
  if (!globalUserFeedbackManager) {
    globalUserFeedbackManager = new UserFeedbackManager();
  }
  return globalUserFeedbackManager;
}

export function resetUserFeedbackManager(): void {
  if (globalUserFeedbackManager) {
    globalUserFeedbackManager.stop();
  }
  globalUserFeedbackManager = null;
}
