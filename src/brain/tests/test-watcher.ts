/**
 * Test Watcher - Watches project files and runs tests on changes
 *
 * Provides continuous testing by watching files and running tests
 * when changes are detected. Supports npm test, jest, vitest, and other runners.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getBrain } from '../brain-manager.js';

const execAsync = promisify(exec);

// Test result interfaces
export interface TestResult {
  projectPath: string;
  testName: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  timestamp: number;
  output: string;
  failures?: Array<{ file: string; test: string; error: string }>;
}

export interface CoverageData {
  projectPath: string;
  timestamp: number;
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

export interface WatchSession {
  id: string;
  projectPath: string;
  projectName: string;
  status: 'running' | 'stopped' | 'error';
  startedAt: number;
  lastRunAt?: number;
  lastResult?: TestResult;
  chatId: number; // Telegram chat to notify
}

// Watcher state
const activeWatchers = new Map<string, {
  session: WatchSession;
  timer: NodeJS.Timeout;
}>();

/**
 * Test Watcher class
 */
export class TestWatcher {
  private brain = getBrain();
  private watchersDir: string;
  private watchersFile: string;

  constructor() {
    this.watchersDir = join(this.brain.getBrainDir(), 'watchers');
    this.watchersFile = join(this.watchersDir, 'test-watchers.json');
  }

  /**
   * Initialize the test watcher
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.watchersDir)) {
      mkdirSync(this.watchersDir, { recursive: true });
    }
    await this.loadWatchers();
  }

  /**
   * Start watching a project for test changes
   */
  async startWatcher(
    projectPath: string,
    projectName: string,
    chatId: number
  ): Promise<string> {
    const watcherId = this.generateWatcherId(projectPath, chatId);

    // Check if already watching
    if (activeWatchers.has(watcherId)) {
      throw new Error(`Already watching ${projectName}`);
    }

    // Verify project has tests
    const testCommand = await this.detectTestCommand(projectPath);
    if (!testCommand) {
      throw new Error(`No test command found for ${projectName}`);
    }

    const session: WatchSession = {
      id: watcherId,
      projectPath,
      projectName,
      status: 'running',
      startedAt: Date.now(),
      chatId,
    };

    // Store active watcher with polling interval
    // Note: Using polling instead of chokidar for fewer dependencies
    const pollInterval = 30000; // Check every 30 seconds
    let lastHash = await this.getDirectoryHash(projectPath);

    const timer = setInterval(async () => {
      try {
        const currentHash = await this.getDirectoryHash(projectPath);

        if (currentHash !== lastHash) {
          lastHash = currentHash;
          session.lastRunAt = Date.now();

          // Run tests
          const result = await this.runTests(projectPath, testCommand);
          session.lastResult = result;

          // Save result
          await this.saveTestResult(result);

          // Notify if tests failed
          if (result.failed > 0) {
            await this.sendFailureNotification(session, result);
          }
        }
      } catch (error) {
        console.error(`Watcher error for ${watcherId}:`, error);
        session.status = 'error';
      }
    }, pollInterval);

    activeWatchers.set(watcherId, { session, timer });
    await this.saveWatchers();

    return watcherId;
  }

  /**
   * Stop watching a project
   */
  async stopWatcher(projectPath: string, chatId: number): Promise<boolean> {
    const watcherId = this.generateWatcherId(projectPath, chatId);
    const watcher = activeWatchers.get(watcherId);

    if (!watcher) {
      return false;
    }

    clearInterval(watcher.timer);
    activeWatchers.delete(watcherId);
    await this.saveWatchers();

    return true;
  }

  /**
   * Get all active watchers for a chat
   */
  getWatchersForChat(chatId: number): WatchSession[] {
    return Array.from(activeWatchers.values())
      .filter(w => w.session.chatId === chatId)
      .map(w => w.session);
  }

  /**
   * Get a specific watcher
   */
  getWatcher(watcherId: string): WatchSession | undefined {
    return activeWatchers.get(watcherId)?.session;
  }

  /**
   * Run tests for a project
   */
  async runTests(projectPath: string, command?: string): Promise<TestResult> {
    const testCommand = command || await this.detectTestCommand(projectPath);

    if (!testCommand) {
      throw new Error('No test command found');
    }

    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(testCommand, {
        cwd: projectPath,
        timeout: 120000, // 2 minute timeout
      });

      const output = stdout || stderr || '';
      const duration = Date.now() - startTime;

      const parsed = this.parseTestOutput(output);

      return {
        projectPath,
        testName: 'Test Run',
        passed: parsed.passed,
        failed: parsed.failed,
        skipped: parsed.skipped,
        duration,
        timestamp: Date.now(),
        output: output.substring(0, 5000), // Limit output size
        failures: parsed.failures,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as { stdout?: string; stderr?: string; message?: string };

      return {
        projectPath,
        testName: 'Test Run',
        passed: 0,
        failed: 1,
        skipped: 0,
        duration,
        timestamp: Date.now(),
        output: err.stderr || err.stdout || err.message || 'Unknown error',
      };
    }
  }

  /**
   * Detect the test command for a project
   */
  async detectTestCommand(projectPath: string): Promise<string | null> {
    const packageJsonPath = join(projectPath, 'package.json');

    if (!existsSync(packageJsonPath)) {
      return null;
    }

    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      // Check for test scripts
      if (packageJson.scripts?.test) {
        return 'npm test';
      }

      // Check for test runners in dependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (deps.vitest) {
        return 'npx vitest run';
      }

      if (deps.jest) {
        return 'npx jest';
      }

      if (deps.mocha) {
        return 'npx mocha';
      }

      if (deps['test-runner'] || deps.tap) {
        return 'npm run test || npx tap';
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse test output to extract results
   */
  private parseTestOutput(output: string): {
    passed: number;
    failed: number;
    skipped: number;
    failures: Array<{ file: string; test: string; error: string }>;
  } {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ file: string; test: string; error: string }> = [];

    const lines = output.split('\n');

    for (const line of lines) {
      // Jest format: "PASS src/test.ts" or "FAIL src/test.ts"
      if (line.includes('PASS') && !line.includes('PASS')) {
        passed++;
      }
      if (line.includes('FAIL')) {
        failed++;
      }
      if (line.includes('skip') || line.includes('pending')) {
        skipped++;
      }

      // Extract summary from common runners
      const summaryMatch = line.match(/(\d+)\s*passing?,\s*(\d+)\s*failing/);
      if (summaryMatch) {
        passed = parseInt(summaryMatch[1], 10);
        failed = parseInt(summaryMatch[2], 10);
      }

      // Vitest format
      const vitestMatch = line.match(/✓ (\d+)/);
      if (vitestMatch) {
        passed = parseInt(vitestMatch[1], 10);
      }
    }

    // Try to extract failures
    const failureSections = output.split('FAIL ')[1];
    if (failureSections) {
      const lines = failureSections.split('\n');
      let currentFile = '';
      let currentTest = '';
      let errorLines: string[] = [];

      for (const line of lines) {
        if (line.includes('›')) {
          currentTest = line.trim();
        }
        if (line.includes('Error:') || line.includes('expect')) {
          errorLines.push(line.trim());
        }

        if (currentFile && currentTest && errorLines.length > 0) {
          failures.push({
            file: currentFile,
            test: currentTest,
            error: errorLines.join('\n').substring(0, 200),
          });
          errorLines = [];
        }
      }
    }

    return { passed, failed, skipped, failures };
  }

  /**
   * Send failure notification to Telegram
   * This is a placeholder - the actual Telegram bot should call this
   */
  private async sendFailureNotification(
    session: WatchSession,
    result: TestResult
  ): Promise<void> {
    // Store notification for the bot to pick up
    const notification = {
      type: 'test_failure',
      chatId: session.chatId,
      project: session.projectName,
      failed: result.failed,
      passed: result.passed,
      timestamp: result.timestamp,
    };

    const notificationFile = join(this.watchersDir, `notify-${session.chatId}-${Date.now()}.json`);
    await writeFile(notificationFile, JSON.stringify(notification, null, 2));
  }

  /**
   * Save test result to disk
   */
  private async saveTestResult(result: TestResult): Promise<void> {
    const resultsDir = join(this.watchersDir, 'results');
    if (!existsSync(resultsDir)) {
      mkdirSync(resultsDir, { recursive: true });
    }

    const filename = `${Date.now()}-${result.projectPath.replace(/[^a-z0-9]/gi, '-')}.json`;
    const filepath = join(resultsDir, filename);

    try {
      await writeFile(filepath, JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Failed to save test result:', error);
    }
  }

  /**
   * Get test results for a project
   */
  async getTestResults(projectPath: string, limit = 10): Promise<TestResult[]> {
    const resultsDir = join(this.watchersDir, 'results');
    if (!existsSync(resultsDir)) {
      return [];
    }

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(resultsDir);

    const results: TestResult[] = [];
    const projectSlug = projectPath.replace(/[^a-z0-9]/gi, '-');

    for (const file of files.slice(-limit)) {
      if (file.includes(projectSlug)) {
        try {
          const content = await readFile(join(resultsDir, file), 'utf-8');
          results.push(JSON.parse(content) as TestResult);
        } catch {
          // Skip invalid files
        }
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get a simple hash of directory contents for change detection
   */
  private async getDirectoryHash(dirPath: string): Promise<string> {
    const { stat, readdir } = await import('node:fs/promises');

    async function hashDir(path: string): Promise<string> {
      try {
        const stats = await stat(path);
        if (!stats.isDirectory()) {
          return `${stats.mtimeMs}`;
        }

        const files = await readdir(path);
        const hashes: string[] = [];

        for (const file of files) {
          // Skip node_modules and common build dirs
          if (['node_modules', '.git', 'dist', 'build'].includes(file)) {
            continue;
          }
          hashes.push(await hashDir(join(path, file)));
        }

        return hashes.join('|');
      } catch {
        return '';
      }
    }

    return await hashDir(dirPath);
  }

  /**
   * Generate a watcher ID
   */
  private generateWatcherId(projectPath: string, chatId: number): string {
    return `watch-${chatId}-${projectPath.replace(/[^a-z0-9]/gi, '-')}`;
  }

  /**
   * Save active watchers to disk
   */
  private async saveWatchers(): Promise<void> {
    const data = Array.from(activeWatchers.entries()).map(([id, { session }]) => ({
      id,
      session: {
        ...session,
        // Don't save the timer
      },
    }));

    await writeFile(this.watchersFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load watchers from disk (but don't restart timers)
   */
  private async loadWatchers(): Promise<void> {
    if (!existsSync(this.watchersFile)) {
      return;
    }

    try {
      const content = await readFile(this.watchersFile, 'utf-8');
      const data = JSON.parse(content) as Array<{ id: string; session: WatchSession }>;

      // Load but don't restart - users need to manually restart watchers
      for (const _ of data) {
        // Just store the session data for reference, don't start timers
        // Users can use /watch start to restart
      }
    } catch {
      // Corrupted file, start fresh
    }
  }

  /**
   * Stop all watchers
   */
  async stopAll(): Promise<void> {
    for (const [_id, watcher] of activeWatchers.entries()) {
      clearInterval(watcher.timer);
    }
    activeWatchers.clear();
    await this.saveWatchers();
  }

  /**
   * Get active watcher count
   */
  getActiveCount(): number {
    return activeWatchers.size;
  }
}

// Global singleton
let globalTestWatcher: TestWatcher | null = null;

export function getTestWatcher(): TestWatcher {
  if (!globalTestWatcher) {
    globalTestWatcher = new TestWatcher();
  }
  return globalTestWatcher;
}

export function resetTestWatcher(): void {
  globalTestWatcher = null;
}
