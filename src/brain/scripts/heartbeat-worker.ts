/**
 * Heartbeat Worker
 *
 * Runs hourly self-reflection questions and logs to self-review.md.
 * Also triggers proactive checks before self-reflection.
 */

import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { runProactiveChecks, formatProactiveChecksMessage } from './proactive-checks.js';

const SELF_REVIEW_PATH = join(process.cwd(), 'brain', 'self-review.md');
const MEMORY_PATH = join(process.cwd(), 'brain', 'memory');

/**
 * Heartbeat questions from HEARTBEAT.md
 */
const HEARTBEAT_QUESTIONS = [
  {
    id: 'ideas_nowhere',
    question: 'What sounded right but went nowhere?',
    tag: 'confidence',
  },
  {
    id: 'defaulted_consensus',
    question: 'Where did I default to consensus?',
    tag: 'confidence',
  },
  {
    id: 'unverified_assumption',
    question: 'What assumption didn\'t I pressure test?',
    tag: 'confidence',
  },
  {
    id: 'repeated_mistake',
    question: 'What mistakes did I repeat after user correction?',
    tag: 'repeat',
  },
  {
    id: 'speed_depth',
    question: 'Was I too fast or too shallow?',
    tag: 'depth',
  },
];

/**
 * Get current date in DD-MM-YYYY format
 */
export function getCurrentDate(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Get current time in HH:MM format
 */
function getCurrentTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Format heartbeat entry for self-review.md
 */
function formatHeartbeatEntry(
  questionId: string,
  miss: string,
  fix: string,
  context?: string
): string {
  const date = getCurrentDate();
  const time = getCurrentTime();
  const question = HEARTBEAT_QUESTIONS.find((q) => q.id === questionId);
  const tag = question?.tag || 'confidence';

  let entry = `\n[ ${date} ${time} ] TAG: ${tag}\n`;
  entry += `MISS: ${miss}\n`;
  entry += `FIX: ${fix}\n`;
  if (context) {
    entry += `CONTEXT: ${context}\n`;
  }

  return entry;
}

/**
 * Log heartbeat entry to self-review.md
 */
async function logHeartbeatEntry(entry: string): Promise<void> {
  try {
    await appendFile(SELF_REVIEW_PATH, entry + '\n', 'utf-8');
  } catch (error) {
    console.error('Failed to log heartbeat entry:', error);
    throw error;
  }
}

/**
 * Log heartbeat to daily memory file
 */
async function logToDailyMemory(message: string): Promise<void> {
  try {
    const date = getCurrentDate();
    const memoryFile = join(MEMORY_PATH, `${date}.md`);

    const timestamp = new Date().toISOString();
    const entry = `\n## Heartbeat ${timestamp}\n${message}\n`;

    await appendFile(memoryFile, entry, 'utf-8');
  } catch (error) {
    console.error('Failed to log to memory:', error);
  }
}

/**
 * Read recent self-review entries to check for patterns
 */
async function readRecentSelfReview(limit: number = 5): Promise<string[]> {
  try {
    if (!existsSync(SELF_REVIEW_PATH)) {
      return [];
    }

    const content = await readFile(SELF_REVIEW_PATH, 'utf-8');
    const entries = content.split('\n[').reverse().slice(0, limit);
    return entries.map((e) => '[' + e);
  } catch {
    return [];
  }
}

/**
 * Run heartbeat with self-reflection questions
 */
export async function runHeartbeat(projectsPath?: string): Promise<{
  status: string;
  hasAlerts: boolean;
  message: string;
}> {
  try {
    // 1. Run proactive checks first
    const proactiveResults = await runProactiveChecks(projectsPath);
    const proactiveMessage = formatProactiveChecksMessage(proactiveResults);

    // 2. Generate heartbeat response
    let heartbeatMessage = `💓 Heartbeat ${getCurrentTime()} - ${getCurrentDate()}\n`;

    if (proactiveResults.hasAlerts) {
      heartbeatMessage += '\n⚠️ ALERTS DETECTED:\n';
      heartbeatMessage += proactiveMessage + '\n';
      heartbeatMessage += 'Review required before continuing.';
    } else {
      heartbeatMessage += '\n✅ No alerts. Systems nominal.';
      heartbeatMessage += '\n\nSelf-reflection questions queued for next interaction.';
    }

    // 4. Log to daily memory
    await logToDailyMemory(heartbeatMessage);

    // 5. If no alerts, this is a silent heartbeat
    if (!proactiveResults.hasAlerts) {
      return {
        status: 'HEARTBEAT_OK',
        hasAlerts: false,
        message: 'HEARTBEAT_OK - All systems nominal',
      };
    }

    return {
      status: 'HEARTBEAT_ALERT',
      hasAlerts: true,
      message: heartbeatMessage,
    };
  } catch (error) {
    console.error('Heartbeat error:', error);
    return {
      status: 'HEARTBEAT_ERROR',
      hasAlerts: true,
      message: `Heartbeat error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Add a manual heartbeat entry (for when the AI identifies a mistake)
 */
export async function addHeartbeatEntry(
  questionId: string,
  miss: string,
  fix: string,
  context?: string
): Promise<void> {
  const entry = formatHeartbeatEntry(questionId, miss, fix, context);
  await logHeartbeatEntry(entry);
}

/**
 * Get heartbeat status for display
 */
export async function getHeartbeatStatus(): Promise<{
  lastRun: string | null;
  recentEntries: string[];
  needsAttention: boolean;
}> {
  const date = getCurrentDate();
  const memoryFile = join(MEMORY_PATH, `${date}.md`);

  let lastRun: string | null = null;
  let needsAttention = false;

  if (existsSync(memoryFile)) {
    const content = await readFile(memoryFile, 'utf-8');
    const matches = content.matchAll(/## Heartbeat ([\d-T:]+)/g);
    const runs = Array.from(matches);
    if (runs.length > 0) {
      lastRun = runs[0][1];
    }

    // Check for alerts
    needsAttention = content.includes('ALERTS DETECTED');
  }

  const recentEntries = await readRecentSelfReview(5);

  return {
    lastRun,
    recentEntries,
    needsAttention,
  };
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const projectsPath = process.argv[2];
  const result = await runHeartbeat(projectsPath);

  console.log(result.message);

  // Exit with error code if alerts detected
  if (result.hasAlerts) {
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
