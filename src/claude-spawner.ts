/**
 * Claude Code CLI Spawner - Spawns and manages claude CLI processes
 */

import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { Project, ClaudeCliResult, ClaudeProcess } from "./types.js";

// Maximum output buffer size to prevent unbounded memory growth
const MAX_OUTPUT_BUFFER_SIZE = 10_000_000; // 10MB limit per process
const MAX_OUTPUT_LINES = 10_000; // Maximum number of output lines

// Store child process references for proper cleanup
const childProcessRegistry = new Map<number, ChildProcess>();

/**
 * Spawn a Claude CLI process
 */
export function spawnClaudeProcess(options: {
  project: Project;
  prompt: string;
  model?: string;
  output?: string;
  timeoutMs?: number;
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'delegate' | 'dontAsk' | 'plan';
}): ClaudeProcess {
  const { project, prompt, model, output, timeoutMs, permissionMode = 'acceptEdits' } = options;

  // Verify project path exists
  if (!existsSync(project.path)) {
    throw new Error(`Project path does not exist: ${project.path}`);
  }

  // Build CLI arguments
  // Note: With shell: false, arguments are passed directly without shell interpretation
  // The prompt is passed as the last positional argument
  const args: string[] = [];

  // Add non-interactive flag
  args.push("--print");

  // Add permission mode to allow file edits
  // acceptEdits: Auto-accept all edit permissions (files can be written)
  // bypassPermissions: Skip all permission checks (use with caution)
  args.push("--permission-mode", permissionMode);

  // Add model if specified
  if (model) args.push("--model", model);

  // Note: --editor is not a valid CLI option for Claude CLI
  // Editor is configured via settings files, not command line

  // Add output format if specified (maps to --output-format flag)
  if (output) args.push("--output-format", output);

  // Add the prompt as the final positional argument
  args.push(prompt);

  // Spawn the process
  // Using shell: false for security and to avoid shell escaping issues
  const childProcess = spawn("claude", args, {
    cwd: project.path, // Set working directory directly, no --cwd flag needed
    env: {
      ...process.env,
      // Ensure claude can access terminal if needed
      TERM: process.env.TERM || "xterm-256color",
    },
    stdio: ["ignore", "pipe", "pipe"], // stdin ignored, stdout and stderr captured
    shell: false, // No shell needed - args are passed directly
  });

  console.log(`[claude-spawner] Spawned PID ${childProcess.pid} with ${prompt.length} char prompt`);
  console.debug(`[claude-spawner] Command: claude ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`);

  const claudeProc: ClaudeProcess = {
    pid: childProcess.pid!,
    project,
    prompt,
    startTime: Date.now(),
    status: "running",
    outputBuffer: [],
  };

  // Store child process reference for proper cleanup
  childProcessRegistry.set(claudeProc.pid, childProcess);

  // Track total buffer size
  let currentBufferSize = 0;

  // Helper to add output with size limits
  const addOutput = (data: string) => {
    const dataSize = Buffer.byteLength(data, "utf8");

    // Check if adding would exceed limits
    if (currentBufferSize + dataSize > MAX_OUTPUT_BUFFER_SIZE ||
        claudeProc.outputBuffer.length >= MAX_OUTPUT_LINES) {
      claudeProc.outputBuffer.push(
        `[OUTPUT TRUNCATED] Buffer limit reached. Previous output omitted.`
      );
      return;
    }

    claudeProc.outputBuffer.push(data);
    currentBufferSize += dataSize;
  };

  // Handle stdout
  childProcess.stdout?.on("data", (data) => {
    const output = data.toString();
    console.debug(`[claude-spawner] PID ${claudeProc.pid} stdout: ${output.slice(0, 200)}${output.length > 200 ? "..." : ""}`);
    addOutput(output);
  });

  // Handle stderr
  childProcess.stderr?.on("data", (data) => {
    const output = data.toString();
    console.error(`[claude-spawner] PID ${claudeProc.pid} stderr: ${output}`);
    addOutput(`[ERROR] ${output}`);
  });

  // Handle process exit
  childProcess.on("close", (code) => {
    console.log(`[claude-spawner] PID ${claudeProc.pid} closed with code ${code}`);
    claudeProc.status = code === 0 ? "completed" : "error";
    // Clean up registry after process completes
    childProcessRegistry.delete(claudeProc.pid);
  });

  // Handle process error
  childProcess.on("error", (err) => {
    console.error(`[claude-spawner] PID ${claudeProc.pid} error:`, err);
    claudeProc.status = "error";
    claudeProc.outputBuffer.push(`[SPAWN ERROR] ${String(err)}`);
    childProcessRegistry.delete(claudeProc.pid);
  });

  // Set timeout if specified
  if (timeoutMs) {
    const timeoutHandle = setTimeout(() => {
      if (claudeProc.status === "running") {
        claudeProc.status = "error";
        claudeProc.outputBuffer.push(`[TIMEOUT] Process killed after ${timeoutMs}ms`);

        // Kill and clean up in one operation
        const childProc = childProcessRegistry.get(claudeProc.pid);
        if (childProc) {
          childProc.kill("SIGKILL");
          childProcessRegistry.delete(claudeProc.pid);
        } else {
          // Registry entry already gone, try by PID
          try {
            process.kill(claudeProc.pid, "SIGKILL");
          } catch {
            // Process already dead
          }
        }
      }
    }, timeoutMs);

    // Clear timeout if process completes naturally
    // Note: we attach to 'close' event which fires once, so we need to be careful
    const cleanupTimeout = () => clearTimeout(timeoutHandle);
    childProcess.once("close", cleanupTimeout);
  }

  return claudeProc;
}

/**
 * Wait for a Claude process to complete and get result
 */
export async function waitForClaudeProcess(
  process: ClaudeProcess,
  timeoutMs?: number
): Promise<ClaudeCliResult> {
  return new Promise((resolve, reject) => {
    const timeout = timeoutMs ?? 300_000; // 5 minutes default

    const timeoutHandle = setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error(`Claude process timed out after ${timeout}ms`));
    }, timeout);

    // Safety timeout to prevent unbounded polling (2x the main timeout)
    const safetyTimeout = setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error(`Process wait exceeded safety limit (${timeout * 2}ms)`));
    }, timeout * 2);

    // Check if process completed
    const checkInterval = setInterval(() => {
      if (
        process.status === "completed" ||
        process.status === "error" ||
        process.status === "cancelled"
      ) {
        clearTimeout(timeoutHandle);
        clearTimeout(safetyTimeout);
        clearInterval(checkInterval);

        const result: ClaudeCliResult = {
          exitCode: process.status === "completed" ? 0 : 1,
          output: process.outputBuffer.join("\n"),
          edits: [], // TODO: parse edits from output
          errors: [],
          duration: Date.now() - process.startTime,
        };

        resolve(result);
      }
    }, 100);
  });
}

/**
 * Kill a Claude process
 */
export function killClaudeProcess(claudeProc: ClaudeProcess): void {
  try {
    claudeProc.status = "cancelled";

    // First try to kill using the child process reference (more reliable)
    const childProcess = childProcessRegistry.get(claudeProc.pid);
    if (childProcess) {
      childProcess.kill("SIGTERM");
    } else {
      // Fallback to PID-based killing
      process.kill(claudeProc.pid, "SIGTERM");
    }

    // Force kill after 5 seconds - use PID directly since registry may be cleaned by then
    setTimeout(() => {
      try {
        // Try by PID directly since the process might have been cleaned from registry
        process.kill(claudeProc.pid, "SIGKILL");
      } catch {
        // Process already dead - this is expected
      }
    }, 5000);
  } catch (error) {
    // Log but don't throw - cleanup should be best-effort
    // Note: Don't delete from registry here - let the process's own 'close' event handle it
  }
}

/**
 * Parse Claude CLI output for file edits
 * This is a placeholder - actual implementation depends on Claude's output format
 */
export function parseClaudeOutput(_output: string): {
  edits: Array<{ path: string; action: "modify" | "create" | "delete" }>;
  errors: string[];
} {
  const edits: Array<{ path: string; action: "modify" | "create" | "delete" }> = [];
  const errors: string[] = [];

  // TODO: Implement parsing based on Claude CLI output format
  // This may need to detect file paths, diffs, etc.

  return { edits, errors };
}

/**
 * Build a Claude prompt with conversation context
 */
export function buildClaudePrompt(
  userPrompt: string,
  history: Array<{ role: string; content: string }>,
  maxHistoryMessages = 10
): string {
  // Start with user's prompt
  let fullPrompt = userPrompt;

  // Add context from recent conversation if available
  if (history.length > 0) {
    const recentHistory = history.slice(-maxHistoryMessages);
    const contextParts: string[] = [];

    for (const msg of recentHistory) {
      if (msg.role === "system") {
        contextParts.push(`System: ${msg.content}`);
      } else if (msg.role === "user") {
        contextParts.push(`User: ${msg.content}`);
      } else if (msg.role === "assistant") {
        contextParts.push(`Assistant: ${msg.content}`);
      }
    }

    if (contextParts.length > 0) {
      fullPrompt =
        "Previous conversation:\n" +
        contextParts.join("\n\n") +
        "\n\n---\n\n" +
        fullPrompt;
    }
  }

  return fullPrompt;
}
