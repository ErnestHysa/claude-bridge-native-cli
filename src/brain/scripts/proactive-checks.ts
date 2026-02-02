/**
 * Proactive Checks System
 *
 * Runs automated checks for:
 * - Unpushed commits (older than 1 hour)
 * - Stuck tasks (running longer than 2 hours)
 * - Code quality alerts (TODO/FIXME/HACK comments)
 * - Skipped briefing sections
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const execAsync = promisify(exec);

export interface CheckResult {
  type: 'unpushed' | 'stuck_task' | 'code_quality' | 'skipped_briefing';
  severity: 'high' | 'medium' | 'low';
  project?: string;
  message: string;
  details?: string;
}

export interface ProactiveCheckResults {
  hasAlerts: boolean;
  checks: CheckResult[];
  timestamp: string;
}

/**
 * Check for unpushed commits in a project
 */
async function checkUnpushedCommits(projectPath: string, projectName: string): Promise<CheckResult | null> {
  try {
    // Check if it's a git repo
    const gitDir = join(projectPath, '.git');
    if (!existsSync(gitDir)) {
      return null;
    }

    // Get unpushed commits
    const { stdout } = await execAsync(
      `cd "${projectPath}" && git log @{u}.. --oneline --pretty=format:"%h %s %cr" 2>/dev/null || echo ""`,
      { timeout: 10000 }
    );

    if (!stdout.trim()) {
      return null;
    }

    const commits = stdout.trim().split('\n');
    const alerts: CheckResult[] = [];

    for (const commit of commits) {
      const match = commit.match(/(\w+) (.+) (\d+ \w+ ago)/);
      if (match) {
        const [, hash, message, timeAgo] = match;

        // Parse time ago to determine severity
        const isHigh = timeAgo.includes('4') || timeAgo.includes('5') ||
          timeAgo.includes('6') || timeAgo.includes('7') ||
          timeAgo.includes('8') || timeAgo.includes('9') ||
          timeAgo.includes('1 day') || timeAgo.includes('2 day');

        alerts.push({
          type: 'unpushed',
          severity: isHigh ? 'high' : 'medium',
          project: projectName,
          message: `Unpushed commit: ${message}`,
          details: `Hash: ${hash}, Age: ${timeAgo}`,
        });
      }
    }

    return alerts.length > 0 ? alerts[0] : null;
  } catch {
    return null;
  }
}

/**
 * Check for stuck tasks
 */
async function checkStuckTasks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    // Read project memory to find task queue info
    // This is a simplified check - in production, integrate with TaskQueue
    const brainPath = join(process.cwd(), 'brain');
    const memoryPath = join(brainPath, 'memory');

    if (!existsSync(memoryPath)) {
      return results;
    }

    const files = await readdir(memoryPath);
    const now = Date.now();
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const fourHoursMs = 4 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const content = await readFile(join(memoryPath, file), 'utf-8');
      const taskMatch = content.match(/task.*?(in_progress|running)/gi);

      if (taskMatch) {
        const stats = await execAsync(`stat -f %m "${join(memoryPath, file)}" 2>/dev/null || stat -c %Y "${join(memoryPath, file)}" 2>/dev/null`, {
          timeout: 5000,
        });

        const modTime = parseInt(stats.stdout.trim()) * 1000;
        const diff = now - modTime;

        if (diff > twoHoursMs) {
          results.push({
            type: 'stuck_task',
            severity: diff > fourHoursMs ? 'high' : 'medium',
            message: `Task possibly stuck (last update: ${Math.floor(diff / (1000 * 60))} minutes ago)`,
            details: `Check memory file: ${file}`,
          });
        }
      }
    }
  } catch {
    // Silent fail
  }

  return results;
}

/**
 * Check for code quality alerts (TODO/FIXME/HACK comments)
 */
async function checkCodeQuality(projectPath: string, projectName: string): Promise<CheckResult | null> {
  try {
    const patterns = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG'];
    const escapedPatterns = patterns.join('\\|');
    const grepCmd = `grep -rn "${escapedPatterns}" --include="*.ts" --include="*.js" --include="*.py" --include="*.go" "${projectPath}" 2>/dev/null | head -20 || echo ""`;

    const { stdout } = await execAsync(grepCmd, { timeout: 15000 });

    if (!stdout.trim()) {
      return null;
    }

    const lines = stdout.trim().split('\n');
    const count = lines.length;

    // Show a few examples
    const examples = lines.slice(0, 3).map((line) => {
      const parts = line.split(':');
      return `• ${parts[0]}:${parts[1]}: ${parts.slice(2).join(':').trim().substring(0, 50)}`;
    }).join('\n');

    return {
      type: 'code_quality',
      severity: 'low',
      project: projectName,
      message: `Found ${count} code quality markers`,
      details: examples,
    };
  } catch {
    return null;
  }
}

/**
 * Check for skipped briefing sections
 */
async function checkSkippedBriefings(): Promise<CheckResult | null> {
  try {
    const memoryPath = join(process.cwd(), 'brain', 'memory');
    if (!existsSync(memoryPath)) {
      return null;
    }

    const files = await readdir(memoryPath);
    const mdFiles = files.filter((f) => f.endsWith('.md')).sort().reverse();

    if (mdFiles.length < 3) {
      return null;
    }

    // Check for consistent skips (same section missing 3+ days)
    const sections = ['Weather', 'GitHub', 'Twitter', 'Project Ideas', 'Error Summary'];
    const skipCounts: Record<string, number> = {};

    for (const section of sections) {
      skipCounts[section] = 0;
    }

    for (const file of mdFiles.slice(0, 7)) {
      const content = await readFile(join(memoryPath, file), 'utf-8');

      for (const section of sections) {
        if (!content.toLowerCase().includes(section.toLowerCase())) {
          skipCounts[section]++;
        }
      }
    }

    const skipped = Object.entries(skipCounts)
      .filter(([_, count]) => count >= 3)
      .map(([section, count]) => `${section} (${count} days)`);

    if (skipped.length > 0) {
      return {
        type: 'skipped_briefing',
        severity: 'low',
        message: 'Briefing sections consistently skipped',
        details: skipped.join(', '),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Run all proactive checks
 */
export async function runProactiveChecks(projectsPath?: string): Promise<ProactiveCheckResults> {
  const checks: CheckResult[] = [];

  // 1. Check for unpushed commits and code quality in projects
  if (projectsPath) {
    try {
      const projectDirs = await readdir(projectsPath);

      for (const projectDir of projectDirs) {
        const fullPath = join(projectsPath, projectDir);

        // Skip if not a directory
        const stats = await execAsync(`test -d "${fullPath}" && echo "dir" || echo "not"`, {
          timeout: 5000,
        });

        if (stats.stdout.trim() !== 'dir') continue;

        // Check unpushed commits
        const unpushed = await checkUnpushedCommits(fullPath, projectDir);
        if (unpushed) checks.push(unpushed);

        // Check code quality (limit to first 3 projects)
        if (checks.filter((c) => c.type === 'code_quality').length < 3) {
          const quality = await checkCodeQuality(fullPath, projectDir);
          if (quality) checks.push(quality);
        }
      }
    } catch {
      // Silent fail if projects path doesn't exist
    }
  }

  // 2. Check for stuck tasks
  const stuckTasks = await checkStuckTasks();
  checks.push(...stuckTasks);

  // 3. Check for skipped briefings
  const skipped = await checkSkippedBriefings();
  if (skipped) checks.push(skipped);

  return {
    hasAlerts: checks.length > 0,
    checks,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format results for Telegram message
 */
export function formatProactiveChecksMessage(results: ProactiveCheckResults): string {
  if (!results.hasAlerts) {
    return '✅ PROACTIVE_CHECKS_OK - All systems nominal';
  }

  const bySeverity = {
    high: results.checks.filter((c) => c.severity === 'high'),
    medium: results.checks.filter((c) => c.severity === 'medium'),
    low: results.checks.filter((c) => c.severity === 'low'),
  };

  let message = '';

  if (bySeverity.high.length > 0) {
    message += '🔴 High Priority Alerts:\n';
    for (const check of bySeverity.high) {
      message += `• ${check.project ? `[${check.project}] ` : ''}${check.message}\n`;
      if (check.details) message += `  ${check.details}\n`;
    }
    message += '\n';
  }

  if (bySeverity.medium.length > 0) {
    message += '🟡 Medium Priority Alerts:\n';
    for (const check of bySeverity.medium) {
      message += `• ${check.project ? `[${check.project}] ` : ''}${check.message}\n`;
      if (check.details) message += `  ${check.details}\n`;
    }
    message += '\n';
  }

  if (bySeverity.low.length > 0) {
    message += '🟠 Low Priority Alerts:\n';
    for (const check of bySeverity.low) {
      message += `• ${check.project ? `[${check.project}] ` : ''}${check.message}\n`;
      if (check.details) message += `  ${check.details}\n`;
    }
  }

  return message.trim();
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const projectsPath = process.argv[2];
  const results = await runProactiveChecks(projectsPath);

  console.log(formatProactiveChecksMessage(results));

  // Exit with error code if high severity alerts found
  if (results.checks.some((c) => c.severity === 'high')) {
    process.exit(1);
  }
}

// Run if called directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('proactive-checks.ts') ||
  process.argv[1].endsWith('proactive-checks') ||
  process.argv[1].includes('proactive-checks.ts')
);

if (isMain) {
  main().catch(console.error);
}
