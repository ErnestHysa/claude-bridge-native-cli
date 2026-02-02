/**
 * Worker Manager
 *
 * Spawns isolated CLI instances for background workers.
 * Each worker runs in its own process to prevent interference.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ERRORS_PATH = join(process.cwd(), 'brain', 'errors');

// Ensure errors directory exists
async function ensureErrorsDir(): Promise<void> {
  if (!existsSync(ERRORS_PATH)) {
    await mkdir(ERRORS_PATH, { recursive: true });
  }
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Log error to file with PID, timestamp, and session ID
 */
async function logError(
  pid: number,
  sessionId: string,
  workerType: string,
  error: string
): Promise<void> {
  await ensureErrorsDir();

  const timestamp = new Date().toISOString();
  const timestampClean = timestamp.replace(/[:.]/g, '-');
  const filename = `pid-${pid}-${timestampClean}-${sessionId}.log`;

  const logPath = join(ERRORS_PATH, filename);
  const logContent = `[${timestamp}] Worker: ${workerType}\n`;
  const logMessage = `Session: ${sessionId}\nPID: ${pid}\nError: ${error}\n`;

  await writeFile(logPath, logContent + logMessage, 'utf-8');
}

/**
 * Worker configuration
 */
export interface WorkerConfig {
  type: 'heartbeat' | 'briefing' | 'proactive_checks' | 'custom';
  script: string;
  args?: string[];
  timeout?: number;
  retryOnFailure?: boolean;
  maxRetries?: number;
}

/**
 * Worker result
 */
export interface WorkerResult {
  success: boolean;
  pid: number;
  sessionId: string;
  output: string;
  error?: string;
  exitCode: number | null;
}

/**
 * Predefined workers
 * Note: Scripts are TypeScript files, run with tsx via npm exec
 */
export const WORKERS: Record<string, WorkerConfig> = {
  heartbeat: {
    type: 'heartbeat',
    script: join(__dirname, 'heartbeat-worker.ts'),
    timeout: 60000, // 1 minute
    retryOnFailure: false,
  },
  briefing: {
    type: 'briefing',
    script: join(__dirname, 'briefing-worker.ts'),
    timeout: 120000, // 2 minutes
    retryOnFailure: true,
    maxRetries: 2,
  },
  proactive_checks: {
    type: 'proactive_checks',
    script: join(__dirname, 'proactive-checks.ts'),
    timeout: 30000, // 30 seconds
    retryOnFailure: false,
  },
};

/**
 * Spawn a worker in an isolated CLI instance
 */
export async function spawnWorker(
  config: WorkerConfig | keyof typeof WORKERS,
  projectsPath?: string
): Promise<WorkerResult> {
  const workerConfig = typeof config === 'string' ? WORKERS[config] : config;
  const sessionId = generateSessionId();

  // Prepare args
  const args = workerConfig.args || [];
  if (projectsPath) {
    args.push(projectsPath);
  }

  return new Promise((resolve) => {
    let output = '';
    let errorOutput = '';

    // Use npm exec to run tsx - more reliable on Windows
    const child = spawn('npm', ['exec', '--', 'tsx', workerConfig.script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'production',
      },
      detached: false,
      shell: true, // Required for npm on Windows
    }) as ChildProcess;

    const pid = child.pid || 0;

    // Set timeout
    if (workerConfig.timeout) {
      setTimeout(() => {
        if (child.pid) {
          child.kill('SIGTERM');
        }
      }, workerConfig.timeout);
    }

    // Collect stdout
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
    }

    // Collect stderr
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
    }

    // Handle exit
    child.on('exit', async (code, signal) => {
      const success = code === 0;

      // Log errors if not successful
      if (!success) {
        const errorMsg = errorOutput || `Process ${signal || code}`;
        await logError(pid, sessionId, workerConfig.type, errorMsg);
      }

      resolve({
        success,
        pid,
        sessionId,
        output: output.trim(),
        error: errorOutput.trim() || undefined,
        exitCode: code,
      });
    });

    // Handle error
    child.on('error', async (err) => {
      await logError(pid, sessionId, workerConfig.type, err.message);
      resolve({
        success: false,
        pid,
        sessionId,
        output: '',
        error: err.message,
        exitCode: -1,
      });
    });
  });
}

/**
 * Spawn worker with retry logic
 */
export async function spawnWorkerWithRetry(
  config: WorkerConfig | keyof typeof WORKERS,
  projectsPath?: string
): Promise<WorkerResult> {
  const workerConfig = typeof config === 'string' ? WORKERS[config] : config;
  const maxRetries = workerConfig.maxRetries || 0;

  let lastResult: WorkerResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await spawnWorker(config, projectsPath);

    if (result.success || attempt === maxRetries) {
      if (attempt > 0) {
        console.log(`Worker ${workerConfig.type} succeeded on attempt ${attempt + 1}`);
      }
      return result;
    }

    lastResult = result;
    console.log(`Worker ${workerConfig.type} failed, retrying (${attempt + 1}/${maxRetries})...`);

    // Wait before retry (exponential backoff)
    await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
  }

  return lastResult!;
}

/**
 * Run heartbeat worker
 */
export async function runHeartbeat(projectsPath?: string): Promise<WorkerResult> {
  return spawnWorkerWithRetry('heartbeat', projectsPath);
}

/**
 * Run briefing worker
 */
export async function runBriefing(location?: string): Promise<WorkerResult> {
  const config = { ...WORKERS.briefing };
  config.args = location ? [location] : [];
  return spawnWorkerWithRetry(config);
}

/**
 * Run proactive checks worker
 */
export async function runProactiveChecksWorker(projectsPath?: string): Promise<WorkerResult> {
  return spawnWorkerWithRetry('proactive_checks', projectsPath);
}

/**
 * Log worker activity to memory
 */
export async function logWorkerActivity(
  workerType: string,
  result: WorkerResult
): Promise<void> {
  try {
    const { getCurrentDate } = await import('./heartbeat-worker.js');
    const date = getCurrentDate();
    const memoryPath = join(process.cwd(), 'brain', 'memory');
    const memoryFile = join(memoryPath, `${date}.md`);

    let log = `\n## Worker Activity: ${workerType}\n`;
    log += `- PID: ${result.pid}\n`;
    log += `- Session: ${result.sessionId}\n`;
    log += `- Success: ${result.success ? 'Yes' : 'No'}\n`;
    log += `- Exit Code: ${result.exitCode}\n`;

    if (result.error) {
      log += `- Error: ${result.error}\n`;
    }

    await appendFile(memoryFile, log, 'utf-8');
  } catch {
    // Silent fail
  }
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const workerType = process.argv[2] as keyof typeof WORKERS;
  const projectsPath = process.argv[3];

  if (!workerType || !WORKERS[workerType]) {
    console.error('Usage: node worker-manager.js <worker_type> [projects_path]');
    console.error('Available workers:', Object.keys(WORKERS).join(', '));
    process.exit(1);
  }

  const result = await spawnWorkerWithRetry(workerType, projectsPath);

  if (result.output) {
    console.log(result.output);
  }

  if (result.error) {
    console.error(result.error);
  }

  await logWorkerActivity(workerType, result);

  process.exit(result.success ? 0 : 1);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
