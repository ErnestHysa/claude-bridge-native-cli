/**
 * Morning Briefing - Daily project summaries
 *
 * The Morning Briefing generates comprehensive daily summaries for users:
 * - Test results summary
 * - Code health metrics
 * - Pending tasks and goals progress
 * - Recent commits and activity
 * - Opportunities for improvement
 * - Weather (metaphorical - project health indicators)
 *
 * Briefings are delivered via Telegram and stored for historical reference.
 */

import { getContextTracker, type ProjectContext } from '../context-tracker/context-tracker.js';
import { getGoalSystem } from '../goals/goal-system.js';
import { getTestWatcher } from '../tests/test-watcher.js';
import { getGitAutomation } from '../git/git-automation.js';
import { getIntentionEngine } from '../intention/intention-engine.js';
import { getMemoryStore } from '../memory/memory-store.js';
import { getDependencyManager } from '../dependency/dependency-manager.js';
import { getTestHealer } from '../self-healing/test-healer.js';
import { getRefactoringAgent } from '../refactoring/refactoring-agent.js';
import { getNightWorkQueue } from '../autonomous/night-work-queue.js';
import { getActivityTracker } from '../autonomous/activity-tracker.js';

// ============================================
// Types
// ============================================

/**
 * Briefing section
 */
export type BriefingSection =
  | 'overview'          // Project health overview
  | 'tests'             // Test results
  | 'goals'             // Goal progress
  | 'commits'           // Recent commits
  | 'opportunities'      // Improvement opportunities
  | 'dependencies'      // Dependency status
  | 'intentions'        // Active intentions
  | 'autonomous';       // Autonomous work summary

/**
 * Briefing priority
 */
export type BriefingPriority = 'daily' | 'weekly' | 'on_demand';

/**
 * A briefing report
 */
export interface BriefingReport {
  id: string;
  chatId: number;
  projectPath: string;
  projectName: string;
  priority: BriefingPriority;
  sections: BriefingSection[];
  content: BriefingContent;
  generatedAt: number;
  delivered: boolean;
  deliveredAt?: number;
}

/**
 * Briefing content
 */
export interface BriefingContent {
  overview: {
    healthScore: number;
    healthEmoji: string;
    summary: string;
    trend: 'improving' | 'stable' | 'declining';
  };
  tests?: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
    passRate: number;
    failures: Array<{ test: string; file: string; error: string }>;
    healing: {
      active: number;
      healed: number;
    };
  };
  goals?: {
    total: number;
    active: number;
    completed: number;
    onTrack: number;
    behind: number;
    goals: Array<{
      title: string;
      progress: number;
      status: string;
      target: string;
    }>;
  };
  commits?: {
    total: number;
    recent: Array<{
      hash: string;
      message: string;
      author: string;
      time: string;
    }>;
  };
  opportunities?: {
    total: number;
    items: Array<{
      type: string;
      description: string;
      priority: string;
    }>;
  };
  dependencies?: {
    outdated: number;
    vulnerable: number;
    healthScore: number;
  };
  intentions?: {
    total: number;
    urgent: number;
    items: Array<{
      title: string;
      type: string;
      priority: string;
    }>;
  };
  autonomous?: {
    enabled: boolean;
    inactiveHours: {
      start: string;
      end: string;
    } | null;
    tasksCompleted: number;
    tasksFailed: number;
    totalWorkTime: number; // in minutes
    workLogs: Array<{
      taskType: string;
      title: string;
      status: string;
      duration: number; // in seconds
      timestamp: number;
    }>;
  };
}

/**
 * Briefing schedule
 */
export interface BriefingSchedule {
  chatId: number;
  projectPath?: string;      // Empty = all projects
  time: string;              // HH:MM format
  timezone: string;
  days: number[];            // 0-6 (Sunday-Saturday)
  enabled: boolean;
}

// ============================================
// Configuration
// ============================================

const BRIEFING_CONFIG = {
  // Default sections to include
  defaultSections: [
    'overview',
    'autonomous',
    'tests',
    'goals',
    'commits',
    'opportunities',
  ] as BriefingSection[],

  // Maximum items per section
  maxItemsPerSection: 5,

  // Emoji mappings for health scores
  healthEmojis: [
    { min: 80, emoji: '🟢' },
    { min: 60, emoji: '🟡' },
    { min: 40, emoji: '🟠' },
    { min: 0, emoji: '🔴' },
  ],

  // Default briefing time (9:00 AM)
  defaultTime: '09:00',

  // Default timezone
  defaultTimezone: 'UTC',
};

// ============================================
// Morning Briefing Class
// ============================================

export class MorningBriefing {
  private memory = getMemoryStore();
  private schedules = new Map<string, BriefingSchedule>();
  private active = false;
  private checkTimer?: NodeJS.Timeout;

  /**
   * Start the briefing service
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadSchedules();

    // Check every minute for scheduled briefings
    this.checkTimer = setInterval(() => {
      this.checkScheduledBriefings();
    }, 60 * 1000);

    console.log('[MorningBriefing] Started');
  }

  /**
   * Stop the briefing service
   */
  stop(): void {
    this.active = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    console.log('[MorningBriefing] Stopped');
  }

  /**
   * Generate a briefing for a user
   */
  async generateBriefing(
    chatId: number,
    options: {
      projectPath?: string;
      sections?: BriefingSection[];
      priority?: BriefingPriority;
    } = {}
  ): Promise<BriefingReport[]> {
    const sections = options.sections || BRIEFING_CONFIG.defaultSections;
    const priority = options.priority || 'daily';

    // Get projects to include
    let projectPaths: string[];
    if (options.projectPath) {
      projectPaths = [options.projectPath];
    } else {
      projectPaths = await this.getUserProjects(chatId);
    }

    const reports: BriefingReport[] = [];

    for (const projectPath of projectPaths) {
      const content = await this.generateBriefingContent(projectPath, sections, chatId);

      const report: BriefingReport = {
        id: this.generateBriefingId(),
        chatId,
        projectPath,
        projectName: this.getProjectName(projectPath),
        priority,
        sections,
        content,
        generatedAt: Date.now(),
        delivered: false,
      };

      reports.push(report);
      await this.storeBriefing(report);
    }

    return reports;
  }

  /**
   * Generate briefing content for a project
   */
  private async generateBriefingContent(
    projectPath: string,
    sections: BriefingSection[],
    chatId = 0
  ): Promise<BriefingContent> {
    const content: Partial<BriefingContent> = {};

    // Always generate overview
    content.overview = await this.generateOverview(projectPath);

    // Generate requested sections
    for (const section of sections) {
      switch (section) {
        case 'tests':
          content.tests = await this.generateTestsSection(projectPath);
          break;
        case 'goals':
          content.goals = await this.generateGoalsSection(projectPath, chatId);
          break;
        case 'commits':
          content.commits = await this.generateCommitsSection(projectPath);
          break;
        case 'opportunities':
          content.opportunities = await this.generateOpportunitiesSection(projectPath);
          break;
        case 'dependencies':
          content.dependencies = await this.generateDependenciesSection(projectPath);
          break;
        case 'intentions':
          content.intentions = await this.generateIntentionsSection(projectPath);
          break;
        case 'autonomous':
          content.autonomous = await this.generateAutonomousSection(chatId);
          break;
      }
    }

    return content as BriefingContent;
  }

  /**
   * Generate overview section
   */
  private async generateOverview(projectPath: string): Promise<BriefingContent['overview']> {
    const contextTracker = getContextTracker();
    const context = await contextTracker.getContext(projectPath);

    const healthScore = context.healthScore;
    const healthEmoji = this.getHealthEmoji(healthScore);

    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (context.testTrend === 'improving' || context.complexityTrend === 'improving') {
      trend = 'improving';
    } else if (context.testTrend === 'declining' || context.complexityTrend === 'declining') {
      trend = 'declining';
    }

    const summary = this.generateOverviewSummary(context, trend);

    return {
      healthScore,
      healthEmoji,
      summary,
      trend,
    };
  }

  /**
   * Generate overview summary text
   */
  private generateOverviewSummary(context: ProjectContext, trend: 'improving' | 'stable' | 'declining'): string {
    const trendEmoji = trend === 'improving' ? '📈' : trend === 'declining' ? '📉' : '➡️';

    if (context.healthScore >= 80) {
      return `${trendEmoji} Project is in great shape! Health score: ${context.healthScore}%`;
    } else if (context.healthScore >= 60) {
      return `${trendEmoji} Project is healthy with room for improvement. Score: ${context.healthScore}%`;
    } else if (context.healthScore >= 40) {
      return `${trendEmoji} Project needs attention. Score: ${context.healthScore}%. ${context.blockers.length} blocker(s)`;
    } else {
      return `${trendEmoji} Project requires immediate attention. Score: ${context.healthScore}%. ${context.blockers.length} blocker(s)`;
    }
  }

  /**
   * Generate tests section
   */
  private async generateTestsSection(projectPath: string): Promise<BriefingContent['tests']> {
    const testWatcher = getTestWatcher();
    const results = await testWatcher.getTestResults(projectPath, 10);

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const allFailures: Array<{ test: string; file: string; error: string }> = [];

    for (const result of results) {
      passed += result.passed;
      failed += result.failed;
      skipped += result.skipped;

      if (result.failures) {
        for (const f of result.failures) {
          allFailures.push({
            test: f.test,
            file: f.file,
            error: f.error.substring(0, 100),
          });
        }
      }
    }

    const total = passed + failed + skipped;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 100;

    // Get healing stats
    const healer = getTestHealer();
    const healerStats = healer.getStats();
    const opportunities = healer.getFailuresByProject(projectPath);

    return {
      passed,
      failed,
      skipped,
      total,
      passRate,
      failures: allFailures.slice(0, BRIEFING_CONFIG.maxItemsPerSection),
      healing: {
        active: opportunities.length,
        healed: healerStats.healed,
      },
    };
  }

  /**
   * Generate goals section
   */
  private async generateGoalsSection(projectPath: string, chatId = 0): Promise<BriefingContent['goals']> {
    const goalSystem = getGoalSystem();
    const goals = goalSystem.getGoals({ projectPath });
    const allProgress = goalSystem.getAllProgress(chatId);

    // Filter goals for this project
    const projectGoals = goals.filter(g => g.projectPath === projectPath);

    return {
      total: projectGoals.length,
      active: projectGoals.filter(g => g.status === 'active').length,
      completed: projectGoals.filter(g => g.status === 'completed').length,
      onTrack: projectGoals.filter(g => {
        const p = allProgress.find(p => p.goalId === g.id);
        return p?.onTrack;
      }).length,
      behind: projectGoals.filter(g => {
        const needs = goalSystem.getGoalsNeedingAttention(chatId);
        return needs.some(n => n.goal.id === g.id);
      }).length,
      goals: projectGoals.slice(0, BRIEFING_CONFIG.maxItemsPerSection).map(g => ({
        title: g.title,
        progress: g.progress,
        status: g.status,
        target: `${g.target.current}/${g.target.target} ${g.target.unit || ''}`,
      })),
    };
  }

  /**
   * Generate commits section
   */
  private async generateCommitsSection(projectPath: string): Promise<BriefingContent['commits']> {
    const git = getGitAutomation();
    const history = await git.getCommitHistory(projectPath, 10);

    return {
      total: history.length,
      recent: history.slice(0, BRIEFING_CONFIG.maxItemsPerSection).map(commit => ({
        hash: commit.hash.substring(0, 8),
        message: commit.message.split('\n')[0],
        author: commit.author,
        time: this.formatRelativeTime(commit.date),
      })),
    };
  }

  /**
   * Generate opportunities section
   */
  private async generateOpportunitiesSection(projectPath: string): Promise<BriefingContent['opportunities']> {
    const contextTracker = getContextTracker();
    const context = await contextTracker.getContext(projectPath);

    const refactoringAgent = getRefactoringAgent();
    const refactoringOpps = refactoringAgent.getOpportunities(projectPath);

    const items: Array<{ type: string; description: string; priority: string }> = [];

    // Add blockers
    for (const blocker of context.blockers.slice(0, 3)) {
      items.push({
        type: 'blocker',
        description: blocker.description,
        priority: blocker.severity,
      });
    }

    // Add opportunities
    for (const opp of context.opportunities.slice(0, 3)) {
      items.push({
        type: 'opportunity',
        description: opp.description,
        priority: opp.impact,
      });
    }

    // Add refactoring opportunities
    for (const opp of refactoringOpps.slice(0, 3)) {
      items.push({
        type: 'refactoring',
        description: opp.description,
        priority: opp.risk,
      });
    }

    return {
      total: context.blockers.length + context.opportunities.length + refactoringOpps.length,
      items: items.slice(0, BRIEFING_CONFIG.maxItemsPerSection),
    };
  }

  /**
   * Generate dependencies section
   */
  private async generateDependenciesSection(projectPath: string): Promise<BriefingContent['dependencies']> {
    const depManager = getDependencyManager();
    const health = depManager.getHealth(projectPath);

    if (health) {
      return {
        outdated: health.outdated,
        vulnerable: health.vulnerable,
        healthScore: health.healthScore,
      };
    }

    return {
      outdated: 0,
      vulnerable: 0,
      healthScore: 100,
    };
  }

  /**
   * Generate intentions section
   */
  private async generateIntentionsSection(projectPath: string): Promise<BriefingContent['intentions']> {
    const intentionEngine = getIntentionEngine();
    const intentions = intentionEngine.getIntentions({
      projectPath,
      active: true,
    });

    const urgent = intentions.filter(i => i.priority === 'urgent').length;

    return {
      total: intentions.length,
      urgent,
      items: intentions.slice(0, BRIEFING_CONFIG.maxItemsPerSection).map(i => ({
        title: i.title,
        type: i.type,
        priority: i.priority,
      })),
    };
  }

  /**
   * Generate autonomous work section
   */
  private async generateAutonomousSection(chatId: number): Promise<BriefingContent['autonomous']> {
    const activityTracker = getActivityTracker();
    const workQueue = getNightWorkQueue();

    // Get user activity data
    const activityData = await activityTracker.getUserActivityData(chatId);
    const inactiveHours = activityData.inactiveHours;

    // Get work queue statistics
    const userTasks = workQueue.getUserTasks(chatId);
    const completedTasks = userTasks.filter(t => t.status === 'completed');
    const failedTasks = userTasks.filter(t => t.status === 'failed');

    // Calculate total work time (in minutes)
    const totalWorkTimeMs = completedTasks.reduce((sum, t) => {
      return sum + (t.result?.duration || 0);
    }, 0);
    const totalWorkTime = Math.floor(totalWorkTimeMs / 60000);

    // Generate work logs
    const workLogs = userTasks
      .filter(t => t.status === 'completed' || t.status === 'failed')
      .slice(-BRIEFING_CONFIG.maxItemsPerSection)
      .map(t => ({
        taskType: t.type,
        title: t.title,
        status: t.status,
        duration: t.result?.duration || 0,
        timestamp: t.result?.completedAt || t.createdAt,
      }));

    return {
      enabled: inactiveHours.enabled || activityData.autonomousEnabled,
      inactiveHours: inactiveHours.enabled ? {
        start: inactiveHours.start,
        end: inactiveHours.end,
      } : null,
      tasksCompleted: completedTasks.length,
      tasksFailed: failedTasks.length,
      totalWorkTime,
      workLogs,
    };
  }

  /**
   * Format briefing as Telegram message
   */
  formatBriefingMessage(report: BriefingReport): string {
    const { content, projectName } = report;
    let message = `📊 <b>${projectName}</b> - Briefing\n\n`;

    // Overview
    message += `${content.overview.healthEmoji} <b>Health: ${content.overview.healthScore}%</b>\n`;
    message += `   ${content.overview.summary}\n`;

    // Tests
    if (content.tests) {
      const { tests } = content;
      const emoji = tests.passed === tests.total ? '✅' : tests.failed > 0 ? '❌' : '⚠️';
      message += `\n${emoji} <b>Tests:</b> ${tests.passed}/${tests.total} passed (${tests.passRate}%)\n`;
      if (tests.failed > 0) {
        message += `   ${tests.failed} test(s) failing\n`;
      }
      if (tests.healing.active > 0) {
        message += `   🔧 ${tests.healing.active} auto-heal(s) in progress\n`;
      }
    }

    // Goals
    if (content.goals && content.goals.total > 0) {
      const { goals } = content;
      message += `\n🎯 <b>Goals:</b> ${goals.active} active, ${goals.completed} completed\n`;
      for (const goal of content.goals.goals.slice(0, 3)) {
        const progressBar = '█'.repeat(Math.floor(goal.progress / 10)) + '░'.repeat(10 - Math.floor(goal.progress / 10));
        message += `   [${progressBar}] ${goal.title}\n`;
      }
    }

    // Commits
    if (content.commits && content.commits.recent.length > 0) {
      message += `\n📝 <b>Recent Activity:</b>\n`;
      for (const commit of content.commits.recent.slice(0, 3)) {
        message += `   ${commit.hash} ${commit.message}\n`;
      }
    }

    // Opportunities
    if (content.opportunities && content.opportunities.items.length > 0) {
      message += `\n💡 <b>Opportunities:</b>\n`;
      for (const opp of content.opportunities.items.slice(0, 3)) {
        message += `   • ${opp.description}\n`;
      }
    }

    // Dependencies
    if (content.dependencies && (content.dependencies.outdated > 0 || content.dependencies.vulnerable > 0)) {
      const { dependencies } = content;
      message += `\n📦 <b>Dependencies:</b>\n`;
      if (dependencies.outdated > 0) {
        message += `   ${dependencies.outdated} outdated\n`;
      }
      if (dependencies.vulnerable > 0) {
        message += `   ⚠️ ${dependencies.vulnerable} vulnerable\n`;
      }
    }

    // Autonomous Work
    if (content.autonomous) {
      const { autonomous } = content;
      if (autonomous.enabled || autonomous.tasksCompleted > 0) {
        const emoji = autonomous.enabled ? '🤖' : '🌙';
        message += `\n${emoji} <b>Autonomous Work:</b>\n`;

        if (autonomous.inactiveHours) {
          message += `   Hours: ${autonomous.inactiveHours.start} - ${autonomous.inactiveHours.end}\n`;
        }

        if (autonomous.tasksCompleted > 0 || autonomous.tasksFailed > 0) {
          message += `   Tasks: ${autonomous.tasksCompleted} completed`;
          if (autonomous.tasksFailed > 0) {
            message += `, ${autonomous.tasksFailed} failed`;
          }
          message += '\n';
        }

        if (autonomous.totalWorkTime > 0) {
          message += `   Work time: ${autonomous.totalWorkTime} min\n`;
        }

        if (autonomous.workLogs.length > 0) {
          message += `   Recent work:\n`;
          for (const log of autonomous.workLogs.slice(0, 3)) {
            const statusEmoji = log.status === 'completed' ? '✅' : '❌';
            const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            message += `      ${statusEmoji} ${log.title} (${time})\n`;
          }
        }
      }
    }

    return message;
  }

  /**
   * Mark briefing as delivered
   */
  async markDelivered(briefingId: string): Promise<void> {
    const key = `briefing:${briefingId}`;
    const briefing = await this.memory.getFact(key) as BriefingReport | undefined;
    if (briefing) {
      briefing.delivered = true;
      briefing.deliveredAt = Date.now();
      await this.memory.setFact(key, briefing);
    }
  }

  /**
   * Schedule a daily briefing
   */
  async scheduleBriefing(schedule: BriefingSchedule): Promise<void> {
    const key = `briefing_schedule:${schedule.chatId}:${schedule.projectPath || 'all'}`;
    await this.memory.setFact(key, schedule);
    this.schedules.set(key, schedule);
  }

  /**
   * Check for scheduled briefings
   */
  private async checkScheduledBriefings(): Promise<void> {
    if (!this.active) return;

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDay = now.getDay();

    for (const [_key, schedule] of this.schedules) {
      if (!schedule.enabled) continue;

      // Check if time matches
      if (schedule.time !== currentTime) continue;

      // Check if day matches
      if (!schedule.days.includes(currentDay)) continue;

      // Check if already delivered today
      const lastDeliveredKey = `briefing_last:${schedule.chatId}:${schedule.projectPath || 'all'}`;
      const lastDelivered = await this.memory.getFact(lastDeliveredKey) as number | undefined;
      const today = new Date().setHours(0, 0, 0, 0);
      if (lastDelivered && lastDelivered >= today) continue;

      // Generate and deliver briefing
      const reports = await this.generateBriefing(schedule.chatId, {
        projectPath: schedule.projectPath,
        priority: 'daily',
      });

      for (const report of reports) {
        // Store for delivery by Telegram bot
        await this.memory.setFact(`briefing_pending:${schedule.chatId}:${report.id}`, report);
        await this.markDelivered(report.id);
      }

      await this.memory.setFact(lastDeliveredKey, Date.now());
    }
  }

  /**
   * Get health emoji for score
   */
  private getHealthEmoji(score: number): string {
    for (const range of BRIEFING_CONFIG.healthEmojis) {
      if (score >= range.min) return range.emoji;
    }
    return '⚪';
  }

  /**
   * Get project name from path
   */
  private getProjectName(projectPath: string): string {
    return projectPath.split(/[/\\]/).filter(Boolean).pop() || projectPath;
  }

  /**
   * Get projects for a user
   */
  private async getUserProjects(_chatId: number): Promise<string[]> {
    try {
      const projects = await this.memory.getFact('watched_projects') as string[] | undefined;
      return projects ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Format relative time
   */
  private formatRelativeTime(timestamp: number | string): string {
    let ts: number;
    if (typeof timestamp === 'string') {
      // Parse git short date format (YYYY-MM-DD)
      const parts = timestamp.split('-');
      if (parts.length === 3) {
        ts = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();
      } else {
        ts = Date.now();
      }
    } else {
      ts = timestamp;
    }

    const diff = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  /**
   * Store briefing in memory
   */
  private async storeBriefing(briefing: BriefingReport): Promise<void> {
    await this.memory.setFact(`briefing:${briefing.id}`, briefing);
  }

  /**
   * Load schedules from memory
   */
  private async loadSchedules(): Promise<void> {
    // Schedules are loaded on demand
  }

  /**
   * Generate a unique briefing ID
   */
  private generateBriefingId(): string {
    return `briefing-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalBriefings: number;
    activeSchedules: number;
  } {
    return {
      totalBriefings: 0,  // Would need to count from memory
      activeSchedules: Array.from(this.schedules.values()).filter(s => s.enabled).length,
    };
  }
}

// ============================================
// Global Singleton
// ============================================

let globalMorningBriefing: MorningBriefing | null = null;

export function getMorningBriefing(): MorningBriefing {
  if (!globalMorningBriefing) {
    globalMorningBriefing = new MorningBriefing();
  }
  return globalMorningBriefing;
}

export function resetMorningBriefing(): void {
  if (globalMorningBriefing) {
    globalMorningBriefing.stop();
  }
  globalMorningBriefing = null;
}
