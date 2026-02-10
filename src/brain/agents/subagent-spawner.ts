/**
 * Subagent Spawner - Launch isolated agent tasks
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SubagentSession, SubagentTaskDefinition } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUBAGENT_DIR = join(process.cwd(), 'brain', 'agents', 'subagents');
const TASK_DIR = join(SUBAGENT_DIR, 'tasks');
const RESULT_DIR = join(SUBAGENT_DIR, 'results');
const HEARTBEAT_DIR = join(SUBAGENT_DIR, 'heartbeats');

async function ensureDirectories(): Promise<void> {
  for (const dir of [SUBAGENT_DIR, TASK_DIR, RESULT_DIR, HEARTBEAT_DIR]) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

function buildSessionId(taskId: string): string {
  return `subagent-${taskId}-${Math.random().toString(36).substring(2, 8)}`;
}

export async function spawnSubagent(task: SubagentTaskDefinition): Promise<SubagentSession> {
  await ensureDirectories();

  const sessionId = buildSessionId(task.id);
  const taskPath = join(TASK_DIR, `${sessionId}.json`);
  const resultPath = join(RESULT_DIR, `${sessionId}.json`);
  const heartbeatPath = join(HEARTBEAT_DIR, `${sessionId}.json`);

  await writeFile(taskPath, JSON.stringify(task, null, 2), 'utf-8');

  const scriptPath = join(__dirname, 'subagent-worker.ts');

  const child = spawn('npm', ['exec', '--', 'tsx', scriptPath, taskPath, resultPath, heartbeatPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
    shell: true,
  });

  const pid = child.pid || 0;

  child.stdout?.on('data', (data) => {
    console.log(`[Subagent:${sessionId}] ${data.toString().trim()}`);
  });

  child.stderr?.on('data', (data) => {
    console.error(`[Subagent:${sessionId}] ${data.toString().trim()}`);
  });

  const session: SubagentSession = {
    id: sessionId,
    taskId: task.id,
    agentType: task.agentType,
    pid,
    status: 'starting',
    createdAt: Date.now(),
    heartbeatPath,
    resultPath,
    taskPath,
  };

  return session;
}
