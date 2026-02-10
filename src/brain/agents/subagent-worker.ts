/**
 * Subagent Worker - Executes a task in an isolated process
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { SubagentResult, SubagentTaskDefinition } from '../types.js';
import { AgentOrchestrator } from './agent-orchestrator.js';

const [taskPath, resultPath, heartbeatPath] = process.argv.slice(2);

if (!taskPath || !resultPath || !heartbeatPath) {
  console.error('Usage: subagent-worker <taskPath> <resultPath> <heartbeatPath>');
  process.exit(1);
}

interface HeartbeatPayload {
  timestamp: number;
  status: string;
  pid: number;
}

async function writeHeartbeat(status: string): Promise<void> {
  const payload: HeartbeatPayload = {
    timestamp: Date.now(),
    status,
    pid: process.pid,
  };

  await writeFile(heartbeatPath, JSON.stringify(payload, null, 2), 'utf-8');
}

async function main(): Promise<void> {
  if (!existsSync(taskPath)) {
    throw new Error(`Task file not found: ${taskPath}`);
  }

  const taskContent = await readFile(taskPath, 'utf-8');
  const task = JSON.parse(taskContent) as SubagentTaskDefinition;

  const orchestrator = new AgentOrchestrator();
  const startedAt = Date.now();

  await writeHeartbeat('starting');

  const heartbeatInterval = setInterval(() => {
    writeHeartbeat('running').catch((error) => {
      console.error('[SubagentWorker] Failed to write heartbeat:', error);
    });
  }, task.heartbeatIntervalMs ?? 30_000);

  let result: SubagentResult;

  try {
    const output = await orchestrator.runTaskForAgentType(task.agentType, {
      projectPath: task.projectPath,
      prompt: task.description,
      ...task.metadata,
    });

    const failureReason = detectFailure(output);

    result = {
      success: !failureReason,
      output,
      error: failureReason || undefined,
      startedAt,
      completedAt: Date.now(),
      attempt: task.attempt,
    };

    await writeHeartbeat(failureReason ? 'failed' : 'completed');
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      startedAt,
      completedAt: Date.now(),
      attempt: task.attempt,
    };

    await writeHeartbeat('failed');
  } finally {
    clearInterval(heartbeatInterval);
  }

  await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');

  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  const result: SubagentResult = {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    startedAt: Date.now(),
    completedAt: Date.now(),
    attempt: 1,
  };

  await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');
  process.exitCode = 1;
});

function detectFailure(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;

  const record = output as Record<string, unknown>;
  const status = typeof record.status === 'string' ? record.status.toLowerCase() : '';

  if (status === 'error' || status === 'failed') {
    return typeof record.error === 'string' ? record.error : 'Task reported error status';
  }

  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error;
  }

  if (typeof record.exitCode === 'number' && record.exitCode !== 0) {
    return `Task exited with code ${record.exitCode}`;
  }

  return null;
}
