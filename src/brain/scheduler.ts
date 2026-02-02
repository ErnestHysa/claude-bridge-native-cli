/**
 * Cron Scheduler
 *
 * Manages scheduled tasks for the self-improvement system.
 * Uses node-cron to trigger workers at specified intervals.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Scripts are in src/brain/scripts when running from source
const brainPath = join(process.cwd(), 'src', 'brain');

/**
 * Run a worker script in an isolated process
 */
async function runWorkerScript(scriptName: string, args: string[] = []): Promise<{
  success: boolean;
  output: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    // Use tsx to run TypeScript files directly
    const scriptPath = join(brainPath, 'scripts', `${scriptName}.ts`);

    // Check if script exists
    if (!existsSync(scriptPath)) {
      resolve({
        success: false,
        output: '',
        error: `Script not found: ${scriptName}`,
      });
      return;
    }

    // Use npm exec to run tsx - more reliable on Windows than npx
    const child = spawn('npm', ['exec', '--', 'tsx', scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      detached: false,
      shell: true, // Required for npm on Windows
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
 * Run heartbeat worker
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
 * Run briefing worker
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
 * Run proactive checks worker
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
 * Start all scheduled jobs
 */
export function startScheduledJobs(): void {
  // Heartbeat every hour at minute 0
  // Format: CRON expression = second minute hour day month weekday
  // Note: node-cron uses 6 fields (second minute hour day month weekday)
  // We use simple intervals instead for reliability

  // Heartbeat: Every hour
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
    // Focus on [repeat] tags which indicate repeated mistakes
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

    // Check if needs attention (recent repeat mistakes)
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
