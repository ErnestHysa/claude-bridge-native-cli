/**
 * Claude Spawner Class - Wrapper for Claude process functions
 */

import type { Project, ClaudeProcess, ClaudeCliResult, BridgeConfig } from "./types.js";
import {
  spawnClaudeProcess,
  waitForClaudeProcess,
  killClaudeProcess,
  buildClaudePrompt,
} from "./claude-spawner.js";

/**
 * Claude Spawner class
 */
export class ClaudeSpawner {
  private config: BridgeConfig;
  private activeProcesses = new Map<number, ClaudeProcess>();

  constructor(config: BridgeConfig) {
    this.config = config;
  }

  /**
   * Spawn a new Claude process
   */
  public spawnProcess(options: {
    project: Project;
    prompt: string;
    model?: string;
    output?: string;
    onOutput?: (data: string) => void;
  }): ClaudeProcess {
    const process = spawnClaudeProcess({
      ...options,
      model: options.model || this.config.claudeDefaultModel,
      timeoutMs: this.config.claudeTimeoutMs,
      onOutput: options.onOutput,
    });

    this.activeProcesses.set(process.pid, process);

    // Set up cleanup when process completes
    // Note: This is a safety net - the registry in claude-spawner.ts handles primary cleanup
    const originalProcess = process;
    const checkStatus = setInterval(() => {
      if (
        originalProcess.status === "completed" ||
        originalProcess.status === "error" ||
        originalProcess.status === "cancelled"
      ) {
        clearInterval(checkStatus);
        this.activeProcesses.delete(originalProcess.pid);
      }
    }, 1000);

    return process;
  }

  /**
   * Wait for a process to complete
   */
  public async waitForProcess(
    process: ClaudeProcess,
    timeoutMs?: number
  ): Promise<ClaudeCliResult> {
    try {
      const result = await waitForClaudeProcess(
        process,
        timeoutMs || this.config.claudeTimeoutMs
      );
      // Cleanup from active processes map after successful completion
      this.activeProcesses.delete(process.pid);
      return result;
    } catch (error) {
      // Cleanup from active processes map after error
      this.activeProcesses.delete(process.pid);
      throw error;
    }
  }

  /**
   * Kill a process
   */
  public killProcess(process: ClaudeProcess): void {
    killClaudeProcess(process);
    // Note: Don't delete from activeProcesses immediately
    // The status checker will clean it up once status changes
  }

  /**
   * Build a prompt with conversation context
   */
  public buildPrompt(
    userPrompt: string,
    history: Array<{ role: string; content: string }>,
    maxHistoryMessages = 10
  ): string {
    return buildClaudePrompt(userPrompt, history, maxHistoryMessages);
  }

  /**
   * Get all active processes
   */
  public getActiveProcesses(): ClaudeProcess[] {
    return Array.from(this.activeProcesses.values());
  }

  /**
   * Get active process count
   */
  public getActiveCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Kill all active processes
   */
  public killAll(): void {
    for (const process of this.activeProcesses.values()) {
      try {
        killClaudeProcess(process);
      } catch {
        // Process may already be dead
      }
    }
    this.activeProcesses.clear();
  }
}
