/**
 * Enhanced Scheduler - Proactive monitoring and autonomous actions
 *
 * The Enhanced Scheduler manages multiple heartbeat intervals with
 * different actions at each level. It integrates with the Intention Engine
 * to proactively detect opportunities and create intentions.
 *
 * Intervals:
 * - 30 seconds: Check for immediate events (test failures, build breaks)
 * - 5 minutes: Check test status, build status
 * - 15 minutes: Scan for opportunities (complexity, duplication)
 * - 1 hour: Dependency check, health summary
 * - Daily: Briefing, deep analysis
 * - Weekly: Review, cleanup, report
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getIntentionEngine } from './intention/intention-engine.js';
import { getContextTracker } from './context-tracker/context-tracker.js';
import { getMemoryStore } from './memory/memory-store.js';

// Scripts are in src/brain when running from source
const brainPath = join(process.cwd(), 'src', 'brain');

// ===========================================
// Types
// ===========================================

/**
 * Heartbeat interval definition
 */
interface HeartbeatInterval {
  name: string;
  duration: number;            // milliseconds
  description: string;
  checks: HeartbeatCheck[];
}

/**
 * A check to run at a heartbeat interval
 */
interface HeartbeatCheck {
  name: string;
  check: () => Promise<CheckResult>;
}

/**
 * Result of a heartbeat check
 */
interface CheckResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
}

/**
 * Heartbeat action - what to do when a check finds something
 */
interface HeartbeatAction {
  check: string;               // Which check triggered this
  condition: (data: CheckResult) => boolean;
  action: (data: CheckResult, projectPath: string, chatId: number) => Promise<void>;
}

// ===========================================
// Configuration
// ===========================================

const HEARTBEAT_INTERVALS: HeartbeatInterval[] = [
  {
    name: 'immediate',
    duration: 30 * 1000,       // 30 seconds
    description: 'Check for immediate events (test failures, build breaks)',
    checks: [
      { name: 'test_failures', check: checkTestFailures },
      { name: 'build_status', check: checkBuildStatus },
    ],
  },
  {
    name: 'frequent',
    duration: 5 * 60 * 1000,   // 5 minutes
    description: 'Check test status, build status',
    checks: [
      { name: 'test_status', check: checkTestStatus },
      { name: 'build_status', check: checkBuildStatus },
    ],
  },
  {
    name: 'moderate',
    duration: 15 * 60 * 1000,  // 15 minutes
    description: 'Scan for opportunities (complexity, duplication)',
    checks: [
      { name: 'code_health', check: checkCodeHealth },
      { name: 'opportunities', check: scanOpportunities },
    ],
  },
  {
    name: 'hourly',
    duration: 60 * 60 * 1000,  // 1 hour
    description: 'Dependency check, health summary',
    checks: [
      { name: 'dependencies', check: checkDependencies },
      { name: 'health_summary', check: generateHealthSummary },
    ],
  },
  {
    name: 'daily',
    duration: 24 * 60 * 60 * 1000, // 24 hours
    description: 'Daily briefing, deep analysis',
    checks: [
      { name: 'briefing', check: generateDailyBriefing },
      { name: 'deep_analysis', check: runDeepAnalysis },
    ],
  },
  {
    name: 'weekly',
    duration: 7 * 24 * 60 * 60 * 1000, // 7 days
    description: 'Weekly review, cleanup, report',
    checks: [
      { name: 'weekly_review', check: generateWeeklyReview },
      { name: 'cleanup', check: performCleanup },
    ],
  },
];

// ===========================================
// Heartbeat Checks
// ===========================================

/**
 * Check for test failures
 */
async function checkTestFailures(): Promise<CheckResult> {
  try {
    const memory = getMemoryStore();
    const projects = await memory.getFact('active_projects') as string[] | undefined;

    if (!projects) {
      return { success: true, data: { failures: [] } };
    }

    const failures: Array<{ project: string; testFile: string; testName: string }> = [];

    for (const projectPath of projects) {
      const testFailures = await memory.getFact(`test_failures:${projectPath}`) as unknown[];
      if (testFailures) {
        for (const failure of testFailures) {
          if (typeof failure === 'object' && failure !== null) {
            failures.push({
              project: projectPath,
              testFile: (failure as any).testFile || 'unknown',
              testName: (failure as any).testName || 'unknown',
            });
          }
        }
      }
    }

    return { success: true, data: { failures } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Check build status
 */
async function checkBuildStatus(): Promise<CheckResult> {
  try {
    const memory = getMemoryStore();
    const projects = await memory.getFact('active_projects') as string[] | undefined;

    if (!projects) {
      return { success: true, data: { brokenBuilds: [] } };
    }

    const brokenBuilds: string[] = [];

    for (const projectPath of projects) {
      const buildStatus = await memory.getFact(`build_status:${projectPath}`);
      if (buildStatus === 'broken') {
        brokenBuilds.push(projectPath);
      }
    }

    return { success: true, data: { brokenBuilds } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Check overall test status
 */
async function checkTestStatus(): Promise<CheckResult> {
  try {
    const memory = getMemoryStore();
    const projects = await memory.getFact('active_projects') as string[] | undefined;

    const results: Array<{ project: string; passing: boolean; passRate: number }> = [];

    if (projects) {
      for (const projectPath of projects) {
        const context = await getContextTracker().getContext(projectPath);
        results.push({
          project: projectPath,
          passing: context.lastTestRun.failed === 0,
          passRate: context.testHealth,
        });
      }
    }

    return { success: true, data: { results } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Check code health
 */
async function checkCodeHealth(): Promise<CheckResult> {
  try {
    const memory = getMemoryStore();
    const projects = await memory.getFact('active_projects') as string[] | undefined;

    const results: Array<{
      project: string;
      healthScore: number;
      codeHealth: number;
      complexityTrend: string;
    }> = [];

    if (projects) {
      for (const projectPath of projects) {
        const context = await getContextTracker().getContext(projectPath);
        results.push({
          project: projectPath,
          healthScore: context.healthScore,
          codeHealth: context.codeHealth,
          complexityTrend: context.complexityTrend,
        });
      }
    }

    return { success: true, data: { results } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Scan for opportunities
 */
async function scanOpportunities(): Promise<CheckResult> {
  try {
    const memory = getMemoryStore();
    const projects = await memory.getFact('active_projects') as string[] | undefined;

    const opportunities: Array<{ project: string; count: number }> = [];

    if (projects) {
      for (const projectPath of projects) {
        const context = await getContextTracker().getContext(projectPath);
        opportunities.push({
          project: projectPath,
          count: context.opportunities.length,
        });
      }
    }

    return { success: true, data: { opportunities } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Check dependencies
 */
async function checkDependencies(): Promise<CheckResult> {
  try {
    const memory = getMemoryStore();
    const projects = await memory.getFact('active_projects') as string[] | undefined;

    const results: Array<{
      project: string;
      health: number;
      vulnerabilities?: number;
    }> = [];

    if (projects) {
      for (const projectPath of projects) {
        const context = await getContextTracker().getContext(projectPath);
        results.push({
          project: projectPath,
          health: context.dependencyHealth,
        });
      }
    }

    return { success: true, data: { results } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Generate health summary
 */
async function generateHealthSummary(): Promise<CheckResult> {
  try {
    const tracker = getContextTracker();
    const stats = tracker.getStats();

    return {
      success: true,
      data: {
        totalProjects: stats.totalProjects,
        avgHealth: stats.avgHealth,
        activeProjects: stats.activeProjects,
        totalBlockers: stats.totalBlockers,
        totalOpportunities: stats.totalOpportunities,
      },
    };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Generate daily briefing
 */
async function generateDailyBriefing(): Promise<CheckResult> {
  try {
    const result = await runWorkerScript('briefing-worker');
    return { success: result.success, data: { output: result.output } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Run deep analysis
 */
async function runDeepAnalysis(): Promise<CheckResult> {
  try {
    const memory = getMemoryStore();
    const projects = await memory.getFact('active_projects') as string[] | undefined;

    if (projects) {
      for (const projectPath of projects) {
        // Trigger code analysis
        const { getCodeAnalyzer } = await import('./analyzer/code-analyzer.js');
        const analyzer = getCodeAnalyzer();
        await analyzer.analyzeProject(projectPath);
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Generate weekly review
 */
async function generateWeeklyReview(): Promise<CheckResult> {
  try {
    const memory = getMemoryStore();
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const stats = await memory.getFact(`weekly_stats:${oneWeekAgo}`);
    if (stats) {
      return { success: true, data: { stats } };
    }

    return { success: true, data: { message: 'No stats available for review' } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

/**
 * Perform cleanup
 */
async function performCleanup(): Promise<CheckResult> {
  try {
    const intentionEngine = getIntentionEngine();
    const cleared = intentionEngine.clearExpired();

    const tracker = getContextTracker();
    const contexts = tracker.getAllContexts();

    let totalCleared = cleared;
    for (const context of contexts) {
      // Remove old opportunities and resolved blockers
      context.opportunities = context.opportunities.filter(
        (o: { createdAt: number }) => Date.now() - o.createdAt < 7 * 24 * 60 * 60 * 1000 // 7 days
      );
      context.blockers = context.blockers.filter(
        (b: { severity: string; createdAt: number }) => b.severity === 'critical' || Date.now() - b.createdAt < 24 * 60 * 60 * 1000 // 1 day for non-critical
      );
      totalCleared += context.opportunities.length + context.blockers.length;
    }

    return { success: true, data: { cleared: totalCleared } };
  } catch (error) {
    return { success: false, message: String(error) };
  }
}

// ===========================================
// Heartbeat Actions
// ===========================================

const HEARTBEAT_ACTIONS: HeartbeatAction[] = [
  // Test failure → Create intention
  {
    check: 'test_failures',
    condition: (data: CheckResult) => {
      if (!data.data) return false;
      const failures = (data.data as { failures: unknown[] }).failures;
      return Array.isArray(failures) && failures.length > 0;
    },
    action: async (data: CheckResult, projectPath: string, chatId: number) => {
      const failures = (data.data as { failures: Array<{ testFile: string; testName: string }> }).failures;
      for (const failure of failures.slice(0, 3)) { // Limit to 3 at a time
        const intentionEngine = getIntentionEngine();
        await intentionEngine.processTrigger({
          type: 'test_failure',
          projectPath,
          chatId,
          data: {
            testFile: failure.testFile,
            testName: failure.testName,
            failCount: 1,
          },
          timestamp: Date.now(),
        });
      }
    },
  },

  // Build broken → Create intention
  {
    check: 'build_status',
    condition: (data: CheckResult) => {
      if (!data.data) return false;
      const brokenBuilds = (data.data as { brokenBuilds: string[] }).brokenBuilds;
      return Array.isArray(brokenBuilds) && brokenBuilds.length > 0;
    },
    action: async (data: CheckResult, _projectPath: string, chatId: number) => {
      const brokenBuilds = (data.data as { brokenBuilds: string[] }).brokenBuilds;
      for (const brokenProject of brokenBuilds) {
        const intentionEngine = getIntentionEngine();
        await intentionEngine.processTrigger({
          type: 'build_broken',
          projectPath: brokenProject,
          chatId,
          data: {},
          timestamp: Date.now(),
        });
      }
    },
  },

  // Low coverage → Create intention
  {
    check: 'test_status',
    condition: (data: CheckResult) => {
      if (!data.data) return false;
      const results = (data.data as { results: Array<{ passRate: number }> }).results;
      return results.some(r => r.passRate < 70);
    },
    action: async (data: CheckResult, _projectPath: string, chatId: number) => {
      const results = (data.data as { results: Array<{ project: string; passRate: number }> }).results;
      for (const result of results) {
        if (result.passRate < 70) {
          const intentionEngine = getIntentionEngine();
          await intentionEngine.processTrigger({
            type: 'coverage_low',
            projectPath: result.project,
            chatId,
            data: {
              coverage: result.passRate,
              threshold: 80,
            },
            timestamp: Date.now(),
          });
        }
      }
    },
  },

  // Declining complexity → Create intention
  {
    check: 'code_health',
    condition: (data: CheckResult) => {
      if (!data.data) return false;
      const results = (data.data as { results: Array<{ complexityTrend: string }> }).results;
      return results.some(r => r.complexityTrend === 'declining');
    },
    action: async (data: CheckResult, _projectPath: string, chatId: number) => {
      const results = (data.data as { results: Array<{ project: string; healthScore: number }> }).results;
      for (const result of results) {
        if (result.healthScore < 70) {
          const intentionEngine = getIntentionEngine();
          await intentionEngine.processTrigger({
            type: 'pattern_detected',
            projectPath: result.project,
            chatId,
            data: {
              pattern: 'high_complexity',
              description: 'Code complexity is increasing',
            },
            timestamp: Date.now(),
          });
        }
      }
    },
  },
];

// ===========================================
// Scheduler State
// ===========================================

const schedulerState = {
  timers: new Map<string, NodeJS.Timeout>(),
  activeProjects: new Set<string>(),
  chatId: null as number | null,
};

// ===========================================
// Enhanced Scheduler Functions
// ===========================================

/**
 * Start enhanced heartbeat monitoring
 */
export function startEnhancedHeartbeat(chatId: number, projects: string[]): void {
  // Stop any existing timers
  stopEnhancedHeartbeat();

  schedulerState.chatId = chatId;
  schedulerState.activeProjects = new Set(projects);

  // Start heartbeat for each interval
  for (const interval of HEARTBEAT_INTERVALS) {
    const timer = setInterval(async () => {
      await runHeartbeatInterval(interval);
    }, interval.duration);

    schedulerState.timers.set(interval.name, timer);
  }

  console.log('[EnhancedScheduler] Heartbeat monitoring started:');
  for (const interval of HEARTBEAT_INTERVALS) {
    console.log(`  - ${interval.name}: every ${formatDuration(interval.duration)}`);
  }
}

/**
 * Stop enhanced heartbeat monitoring
 */
export function stopEnhancedHeartbeat(): void {
  for (const [name, timer] of schedulerState.timers.entries()) {
    clearInterval(timer);
    schedulerState.timers.delete(name);
  }

  schedulerState.chatId = null;
  schedulerState.activeProjects.clear();

  console.log('[EnhancedScheduler] Heartbeat monitoring stopped');
}

/**
 * Run a heartbeat interval
 */
async function runHeartbeatInterval(interval: HeartbeatInterval): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Running ${interval.name} heartbeat...`);

  const results: Map<string, CheckResult> = new Map();

  // Run all checks for this interval
  for (const check of interval.checks) {
    try {
      const result = await check.check();
      results.set(check.name, result);

      if (!result.success) {
        console.warn(`  - ${check.name}: FAILED - ${result.message}`);
      }
    } catch (error) {
      console.error(`  - ${check.name}: ERROR - ${error}`);
    }
  }

  // Process heartbeat actions
  await processHeartbeatActions(results);
}

/**
 * Process heartbeat actions based on check results
 */
async function processHeartbeatActions(results: Map<string, CheckResult>): Promise<void> {
  const chatId = schedulerState.chatId;
  if (!chatId) return;

  const projects = Array.from(schedulerState.activeProjects);

  for (const actionDef of HEARTBEAT_ACTIONS) {
    const result = results.get(actionDef.check);
    if (!result) continue;

    try {
      if (actionDef.condition(result)) {
        for (const projectPath of projects) {
          await actionDef.action(result, projectPath, chatId);
        }
      }
    } catch (error) {
      console.error(`[EnhancedScheduler] Action error for ${actionDef.check}:`, error);
    }
  }
}

/**
 * Run a worker script in an isolated process
 */
async function runWorkerScript(scriptName: string, args: string[] = []): Promise<{
  success: boolean;
  output: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const scriptPath = join(brainPath, 'scripts', `${scriptName}.ts`);

    if (!existsSync(scriptPath)) {
      resolve({
        success: false,
        output: '',
        error: `Script not found: ${scriptName}`,
      });
      return;
    }

    const child = spawn('npm', ['exec', '--', 'tsx', scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      detached: false,
      shell: true,
    });

    let output = '';
    let errorOutput = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
    }

    child.on('exit', (code) => {
      resolve({
        success: code === 0,
        output: output.trim(),
        error: errorOutput.trim() || undefined,
      });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

// ===========================================
// Original Functions (kept for compatibility)
// ===========================================

/**
 * Run heartbeat worker (original, for backward compatibility)
 */
export async function runScheduledHeartbeat(): Promise<void> {
  try {
    const result = await runWorkerScript('heartbeat-worker');
    console.log(`[${new Date().toISOString()}] Heartbeat completed:`, result.success ? 'OK' : 'FAILED');
    if (result.error) {
      console.error('Heartbeat error:', result.error);
    }
  } catch (error) {
    console.error('Heartbeat exception:', error);
  }
}

/**
 * Run briefing worker (original, for backward compatibility)
 */
export async function runScheduledBriefing(): Promise<void> {
  try {
    const result = await runWorkerScript('briefing-worker');
    console.log(`[${new Date().toISOString()}] Briefing completed:`, result.success ? 'OK' : 'FAILED');
    if (result.error) {
      console.error('Briefing error:', result.error);
    }
  } catch (error) {
    console.error('Briefing exception:', error);
  }
}

/**
 * Run proactive checks worker (original, for backward compatibility)
 */
export async function runScheduledProactiveChecks(): Promise<void> {
  try {
    const result = await runWorkerScript('proactive-checks');
    console.log(`[${new Date().toISOString()}] Proactive checks completed:`, result.success ? 'OK' : 'FAILED');
    if (result.error) {
      console.error('Proactive checks error:', result.error);
    }
  } catch (error) {
    console.error('Proactive checks exception:', error);
  }
}

/**
 * Start all scheduled jobs (original, for backward compatibility)
 */
export function startScheduledJobs(): void {
  // Heartbeat every hour at minute 0
  setInterval(() => {
    runScheduledHeartbeat().catch(console.error);
  }, 60 * 60 * 1000); // 1 hour

  // Proactive Checks: Every 30 minutes
  setInterval(() => {
    runScheduledProactiveChecks().catch(console.error);
  }, 30 * 60 * 1000); // 30 minutes

  // Briefing: Check every minute if it's 12 PM (noon)
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 12 && now.getMinutes() === 0) {
      runScheduledBriefing().catch(console.error);
    }
  }, 60 * 1000); // Check every minute

  console.log('[CronScheduler] Scheduled jobs started:');
  console.log('  - Heartbeat: Every hour');
  console.log('  - Proactive Checks: Every 30 minutes');
  console.log('  - Briefing: Daily at 12:00 PM');

  // Run initial checks on startup
  setTimeout(() => {
    console.log('[CronScheduler] Running initial checks...');
    runScheduledProactiveChecks().catch(console.error);
  }, 5000); // 5 seconds after startup
}

/**
 * Load self-review for context before responding
 */
export async function loadSelfReviewContext(): Promise<string> {
  try {
    const { readFile } = await import('node:fs/promises');
    const selfReviewPath = join(brainPath, 'self-review.md');

    if (!existsSync(selfReviewPath)) {
      return '';
    }

    const content = await readFile(selfReviewPath, 'utf-8');

    // Extract recent entries (last 10)
    const entries = content.split('\n[').slice(-10).join('\n[');

    if (entries.length === 0) {
      return '';
    }

    // Look for patterns that might be relevant to current context
    const repeatMistakes: string[] = [];
    for (const entry of entries.split('\n[')) {
      if (entry.includes('[repeat]')) {
        repeatMistakes.push(entry);
      }
    }

    if (repeatMistakes.length > 0) {
      return '\n\n⚠️ CONTEXT FROM SELF-REVIEW (recent repeated mistakes):\n' +
        repeatMistakes.slice(0, 3).join('\n\n') +
        '\n\nBe mindful of these patterns in your response.';
    }

    return '';
  } catch {
    return '';
  }
}

/**
 * Get current self-review status
 */
export async function getSelfReviewStatus(): Promise<{
  hasEntries: boolean;
  recentMistakes: number;
  needsAttention: boolean;
}> {
  try {
    const { readFile } = await import('node:fs/promises');
    const selfReviewPath = join(brainPath, 'self-review.md');

    if (!existsSync(selfReviewPath)) {
      return { hasEntries: false, recentMistakes: 0, needsAttention: false };
    }

    const content = await readFile(selfReviewPath, 'utf-8');
    const entries = content.split('\n[').length;

    // Count recent mistakes (last 24 hours)
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let recentMistakes = 0;

    for (const match of content.matchAll(/\[(\d{2}-\d{2}-\d{4})/g)) {
      const dateStr = match[1];
      const [day, month, year] = dateStr.split('-');
      const entryDate = new Date(`${year}-${month}-${day}`).getTime();

      if (now - entryDate < dayMs) {
        recentMistakes++;
      }
    }

    const needsAttention = content.includes('[repeat]') &&
                            content.split('[repeat]').pop()!.includes('MISS');

    return {
      hasEntries: entries > 0,
      recentMistakes,
      needsAttention,
    };
  } catch {
    return { hasEntries: false, recentMistakes: 0, needsAttention: false };
  }
}
