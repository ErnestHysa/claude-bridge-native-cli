/**
 * Briefing Worker
 *
 * Runs daily at 12 PM to generate and send comprehensive briefing.
 * Includes: weather, recap, GitHub, Twitter, project ideas, error summary.
 */

import { appendFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fetchWeather, formatWeatherMessage } from './fetch-weather.js';
import { fetchGitHubActivity, formatGitHubMessage } from './fetch-github.js';
import { fetchTwitterDigest, formatTwitterDigest, type TwitterDigest } from './fetch-twitter.js';

const MEMORY_PATH = join(process.cwd(), 'brain', 'memory');
const ERRORS_PATH = join(process.cwd(), 'brain', 'errors');

/**
 * Get current date in DD-MM-YYYY format
 */
function getCurrentDate(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Get yesterday's date in DD-MM-YYYY format
 */
function getYesterdayDate(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Get formatted date with day of week
 */
function getFormattedDate(): string {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

/**
 * Get yesterday's recap from memory file
 */
async function getYesterdaysRecap(): Promise<string> {
  try {
    const yesterday = getYesterdayDate();
    const memoryFile = join(MEMORY_PATH, `${yesterday}.md`);

    if (!existsSync(memoryFile)) {
      return '📅 Yesterday\'s Recap\n\nNo memory file found for yesterday. This may be the first day of logging.';
    }

    const content = await readFile(memoryFile, 'utf-8');

    // Extract key events
    const sections: string[] = [];

    if (content.includes('Claude')) sections.push('• Claude interactions and tasks');
    if (content.includes('decision') || content.includes('Decision')) sections.push('• Architectural decisions made');
    if (content.includes('commit') || content.includes('git')) sections.push('• Git activity');
    if (content.includes('error') || content.includes('Error')) sections.push('• Errors encountered');

    let recap = `📅 Yesterday's Recap (${yesterday})\n`;

    if (sections.length > 0) {
      recap += '\n' + sections.join('\n');
    } else {
      recap += '\nNo specific events recorded.';
    }

    // Check for heartbeat alerts
    if (content.includes('ALERTS DETECTED')) {
      recap += '\n\n⚠️ There were alerts during yesterday\'s heartbeat checks.';
    }

    return recap;
  } catch (error) {
    return `📅 Yesterday's Recap\n\nUnable to load yesterday's memory: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Get error summary from errors directory
 */
async function getErrorSummary(): Promise<string> {
  try {
    if (!existsSync(ERRORS_PATH)) {
      return '⚠️ Error Summary\n\nNo errors logged.';
    }

    const files = await readdir(ERRORS_PATH);
    const logFiles = files.filter((f) => f.endsWith('.log'));

    if (logFiles.length === 0) {
      return '⚠️ Error Summary\n\nNo errors logged.';
    }

    let recentCount = 0;
    let criticalCount = 0;

    for (const file of logFiles) {
      const filePath = join(ERRORS_PATH, file);
      try {
        const stats = await readFile(filePath, 'utf-8');
        if (stats.toLowerCase().includes('critical')) {
          criticalCount++;
        }
        recentCount++;
      } catch {
        // Skip files that can't be read
      }
    }

    let summary = `⚠️ Error Summary (last 24h)\n`;
    summary += `• Total errors: ${recentCount}\n`;
    summary += `• Critical errors: ${criticalCount}\n`;

    if (criticalCount > 0) {
      summary += '\n🔴 Critical errors detected. Review error logs for details.';
    }

    return summary;
  } catch (error) {
    return `⚠️ Error Summary\n\nUnable to load error summary: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Generate project ideas based on context
 */
async function generateProjectIdeas(
  twitterDigest: TwitterDigest,
  githubActivity: { repos: Array<{ primaryLanguage: string | null }> }
): Promise<string> {
  let ideas = '💡 Project Ideas\n\n';
  const ideaList: string[] = [];

  // Analyze Twitter trends
  if (twitterDigest.tweets.length > 0) {
    const topics = twitterDigest.tweets.map((t) => t.content.toLowerCase());

    if (topics.some((t) => t.includes('ai') || t.includes('llm'))) {
      ideaList.push('• Add AI-powered code review using LLM analysis');
    }

    if (topics.some((t) => t.includes('rust') || t.includes('systems'))) {
      ideaList.push('• Consider Rust for performance-critical components');
    }
  }

  // Analyze GitHub activity
  if (githubActivity.repos.length > 0) {
    const languages = githubActivity.repos
      .map((r) => r.primaryLanguage)
      .filter((l): l is string => l !== null);

    const uniqueLangs = [...new Set(languages)];

    if (uniqueLangs.includes('TypeScript')) {
      ideaList.push('• Create shared TypeScript utilities package across projects');
    }

    if (uniqueLangs.length > 2) {
      ideaList.push('• Document polyglot development patterns for the team');
    }
  }

  // Always include a general idea
  ideaList.push('• Set up automated testing pipeline for all projects');

  if (ideaList.length === 0) {
    ideaList.push('• Review technical debt and prioritize refactoring');
  }

  ideas += ideaList.slice(0, 5).join('\n');

  return ideas;
}

/**
 * Generate full briefing message
 */
export async function generateBriefing(location: string = 'Kos,Greece'): Promise<{
  success: boolean;
  message: string;
  sections: Record<string, string>;
}> {
  const sections: Record<string, string> = {};

  // 1. Greeting
  const greeting = `☀️ Good Morning!\n\n${getFormattedDate()}`;
  sections.greeting = greeting;

  let message = greeting + '\n\n';

  // 2. Weather
  try {
    const weather = await fetchWeather(location);
    if (weather) {
      const weatherMsg = formatWeatherMessage(weather);
      sections.weather = weatherMsg;
      message += weatherMsg + '\n\n';
    }
  } catch {
    message += '🌤️ Weather\n\nUnable to fetch weather data.\n\n';
  }

  // 3. Yesterday's Recap
  try {
    const recap = await getYesterdaysRecap();
    sections.recap = recap;
    message += recap + '\n\n';
  } catch {
    // Skip if error
  }

  // 4. GitHub Activity
  let githubResult: Awaited<ReturnType<typeof fetchGitHubActivity>> | null = null;
  try {
    githubResult = await fetchGitHubActivity();
    if (githubResult) {
      const githubMsg = formatGitHubMessage(githubResult);
      sections.github = githubMsg;
      message += githubMsg + '\n\n';
    }
  } catch {
    message += '💻 GitHub Activity\n\nUnable to fetch GitHub activity.\n\n';
  }

  // 5. Twitter/X Digest
  let twitterResult: TwitterDigest | null = null;
  try {
    twitterResult = await fetchTwitterDigest();
    const twitterMsg = formatTwitterDigest(twitterResult);
    sections.twitter = twitterMsg;
    message += twitterMsg + '\n\n';
  } catch {
    message += '🐦 X/Twitter Digest\n\nUnable to fetch Twitter digest.\n\n';
  }

  // 6. Project Ideas
  try {
    const twitter = twitterResult || { tweets: [], count: 0, source: 'Nitter' };
    const github = githubResult || { repos: [], totalCount: 0 };

    const ideas = await generateProjectIdeas(twitter, github);
    sections.ideas = ideas;
    message += ideas + '\n\n';
  } catch {
    message += '💡 Project Ideas\n\nReview current projects for optimization opportunities.\n\n';
  }

  // 7. Error Summary
  try {
    const errors = await getErrorSummary();
    sections.errors = errors;
    message += errors + '\n\n';
  } catch {
    message += '⚠️ Error Summary\n\nNo errors to report.\n\n';
  }

  return {
    success: true,
    message: message.trim(),
    sections,
  };
}

/**
 * Log briefing to daily memory file
 */
export async function logBriefing(message: string, messageId?: string): Promise<void> {
  try {
    const date = getCurrentDate();
    const memoryFile = join(MEMORY_PATH, `${date}.md`);

    const timestamp = new Date().toISOString();
    let log = `\n## Briefing ${timestamp}\n`;

    if (messageId) {
      log += `Message ID: ${messageId}\n`;
    }

    log += `\n${message}\n`;

    await appendFile(memoryFile, log, 'utf-8');
  } catch (error) {
    console.error('Failed to log briefing:', error);
  }
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const location = process.argv[2] || 'Kos,Greece';

  const briefing = await generateBriefing(location);

  console.log(briefing.message);

  // Log to memory
  await logBriefing(briefing.message);
}

// Run if called directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('briefing-worker.ts') ||
  process.argv[1].endsWith('briefing-worker') ||
  process.argv[1].includes('briefing-worker.ts')
);

if (isMain) {
  main().catch(console.error);
}
