/**
 * Automation Manager - Loads automation markdown files and schedules them.
 */

import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getBrain } from '../brain-manager.js';
import { getTaskQueue } from '../tasks/task-queue.js';
import { getMorningBriefing } from '../briefing/morning-briefing.js';
import { parseAutomationMarkdown, extractSection } from './automation-parser.js';
import { convertNaturalLanguageToCron } from './nl-to-cron.js';
import { getNextCronRun } from './cron-utils.js';

export type AutomationStatus = 'active' | 'paused' | 'disabled';

export interface AutomationDefinition {
  id: string;
  title: string;
  schedule: string;
  timezone: string;
  status: AutomationStatus;
  createdBy?: string;
  createdAt?: string;
  chatId?: number;
  projectPaths?: string[];
  action: 'claude_query' | 'morning_briefing';
  taskDescription: string;
  constraints: {
    maxConcurrentTasks?: number;
    maxRunsPerDay?: number;
    maxTaskDurationMinutes?: number;
  };
  sourcePath: string;
}

interface AutomationStateEntry {
  id: string;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  runsToday: number;
  lastRunDay?: string;
}

interface AutomationStateFile {
  entries: Record<string, AutomationStateEntry>;
}

export class AutomationManager {
  private brain = getBrain();
  private automationsDir: string;
  private stateFile: string;
  private automations = new Map<string, AutomationDefinition>();
  private state: AutomationStateFile = { entries: {} };
  private active = false;
  private checkTimer?: NodeJS.Timeout;

  constructor() {
    this.automationsDir = join(this.brain.getBrainDir(), 'automations');
    this.stateFile = join(this.automationsDir, 'state.json');
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;

    await this.ensureDirectory();
    await this.loadState();
    await this.loadAutomations();

    this.checkTimer = setInterval(() => {
      this.checkAutomations().catch(error => {
        console.error('[AutomationManager] Check failed', error);
      });
    }, 60 * 1000);

    console.log('[AutomationManager] Started');
  }

  stop(): void {
    this.active = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  getAutomations(): AutomationDefinition[] {
    return Array.from(this.automations.values());
  }

  getAutomation(id: string): AutomationDefinition | undefined {
    return this.automations.get(id);
  }

  async reload(): Promise<void> {
    await this.loadAutomations();
  }

  async createAutomationFile(
    definition: Omit<AutomationDefinition, 'sourcePath' | 'constraints'> & {
      constraints?: AutomationDefinition['constraints'];
    },
  ): Promise<string> {
    await this.ensureDirectory();
    const filename = `${definition.id}.md`;
    const fullPath = join(this.automationsDir, filename);
    const content = this.renderAutomationMarkdown(definition);
    await writeFile(fullPath, content, 'utf-8');
    await this.loadAutomations();
    return fullPath;
  }

  async updateAutomationStatus(id: string, status: AutomationStatus): Promise<void> {
    const automation = this.automations.get(id);
    if (!automation) {
      throw new Error(`Automation ${id} not found.`);
    }

    const content = await readFile(automation.sourcePath, 'utf-8');
    const parsed = parseAutomationMarkdown(content);
    parsed.frontmatter.status = status;
    const updated = this.renderAutomationMarkdown({
      ...automation,
      status,
      taskDescription: automation.taskDescription,
      constraints: automation.constraints,
      sourcePath: automation.sourcePath,
    }, parsed.body);
    await writeFile(automation.sourcePath, updated, 'utf-8');
    await this.loadAutomations();
  }

  async deleteAutomation(id: string): Promise<void> {
    const automation = this.automations.get(id);
    if (!automation) {
      throw new Error(`Automation ${id} not found.`);
    }
    await unlink(automation.sourcePath);
    this.automations.delete(id);
    delete this.state.entries[id];
    await this.saveState();
  }

  private async ensureDirectory(): Promise<void> {
    if (!existsSync(this.automationsDir)) {
      await mkdir(this.automationsDir, { recursive: true });
    }
  }

  private async loadAutomations(): Promise<void> {
    this.automations.clear();
    const files = await readdir(this.automationsDir, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const fullPath = join(this.automationsDir, file.name);
      const content = await readFile(fullPath, 'utf-8');
      const parsed = parseAutomationMarkdown(content);
      const definition = this.buildDefinition(parsed, fullPath);
      if (definition) {
        this.automations.set(definition.id, definition);
        this.ensureState(definition.id);
      }
    }

    await this.saveState();
  }

  private buildDefinition(parsed: ReturnType<typeof parseAutomationMarkdown>, sourcePath: string): AutomationDefinition | null {
    const frontmatter = parsed.frontmatter;
    const id = String(frontmatter['automation-id'] ?? basename(sourcePath).replace(/\.md$/, ''));
    const rawSchedule = String(frontmatter.schedule ?? '').trim();
    if (!id || !rawSchedule) {
      console.warn('[AutomationManager] Skipping automation with missing id or schedule', sourcePath);
      return null;
    }

    let schedule = rawSchedule;
    try {
      if (!isCronExpression(rawSchedule)) {
        schedule = convertNaturalLanguageToCron(rawSchedule).cron;
      }
    } catch (error) {
      console.warn('[AutomationManager] Failed to parse schedule', rawSchedule, error);
      return null;
    }

    const timezone = String(frontmatter.timezone ?? this.brain.getTimezone());
    const status = (frontmatter.status as AutomationStatus) ?? 'active';
    const action = (frontmatter.action as 'claude_query' | 'morning_briefing') ?? 'claude_query';

    const taskDescription =
      extractSection(parsed.body, 'Task') ||
      extractSection(parsed.body, 'Workflow') ||
      parsed.body ||
      'Run automation task.';

    return {
      id,
      title: extractSection(parsed.body, 'Title') || id,
      schedule,
      timezone,
      status,
      createdBy: frontmatter['created-by'] as string | undefined,
      createdAt: frontmatter['created-at'] as string | undefined,
      chatId: frontmatter['chat-id'] ? Number(frontmatter['chat-id']) : undefined,
      projectPaths: frontmatter['project-paths'] as string[] | undefined,
      action,
      taskDescription,
      constraints: {
        maxConcurrentTasks: frontmatter['max-concurrent-tasks'] ? Number(frontmatter['max-concurrent-tasks']) : undefined,
        maxRunsPerDay: frontmatter['max-runs-per-day'] ? Number(frontmatter['max-runs-per-day']) : undefined,
        maxTaskDurationMinutes: frontmatter['max-task-duration-minutes']
          ? Number(frontmatter['max-task-duration-minutes'])
          : undefined,
      },
      sourcePath,
    };
  }

  private renderAutomationMarkdown(
    definition: Omit<AutomationDefinition, 'sourcePath' | 'constraints'> & {
      sourcePath?: string;
      constraints?: AutomationDefinition['constraints'];
    },
    bodyOverride?: string,
  ): string {
    const constraints = definition.constraints ?? {};
    const frontmatter = [
      `automation-id: ${definition.id}`,
      `schedule: "${definition.schedule}"`,
      `timezone: "${definition.timezone}"`,
      `created-by: ${definition.createdBy ?? 'user'}`,
      `created-at: ${definition.createdAt ?? new Date().toISOString().split('T')[0]}`,
      `status: ${definition.status}`,
      `action: ${definition.action}`,
      definition.chatId ? `chat-id: ${definition.chatId}` : null,
      definition.projectPaths && definition.projectPaths.length > 0
        ? `project-paths:\n${definition.projectPaths.map(path => `  - ${path}`).join('\n')}`
        : null,
      constraints.maxConcurrentTasks
        ? `max-concurrent-tasks: ${constraints.maxConcurrentTasks}`
        : null,
      constraints.maxRunsPerDay
        ? `max-runs-per-day: ${constraints.maxRunsPerDay}`
        : null,
      constraints.maxTaskDurationMinutes
        ? `max-task-duration-minutes: ${constraints.maxTaskDurationMinutes}`
        : null,
    ].filter(Boolean).join('\n');

    const body = bodyOverride ?? `# ${definition.title}\n\n## Task\n${definition.taskDescription}\n`;

    return `---\n${frontmatter}\n---\n\n${body}\n`;
  }

  private ensureState(id: string): AutomationStateEntry {
    if (!this.state.entries[id]) {
      this.state.entries[id] = {
        id,
        runCount: 0,
        runsToday: 0,
      };
    }
    return this.state.entries[id];
  }

  private async loadState(): Promise<void> {
    if (!existsSync(this.stateFile)) {
      this.state = { entries: {} };
      return;
    }

    try {
      const content = await readFile(this.stateFile, 'utf-8');
      this.state = JSON.parse(content) as AutomationStateFile;
    } catch {
      this.state = { entries: {} };
    }
  }

  private async saveState(): Promise<void> {
    await writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  private async checkAutomations(): Promise<void> {
    const now = Date.now();
    const taskQueue = getTaskQueue();

    for (const automation of this.automations.values()) {
      if (automation.status !== 'active') continue;
      const state = this.ensureState(automation.id);

      if (!state.nextRun) {
        const nextRun = this.safeGetNextRun(automation, now);
        state.nextRun = nextRun ?? state.nextRun;
        await this.saveState();
      }

      if (state.nextRun && state.nextRun <= now) {
        if (!this.isAllowedToRun(automation, taskQueue)) {
          const nextRun = this.safeGetNextRun(automation, now);
          state.nextRun = nextRun ?? state.nextRun;
          await this.saveState();
          continue;
        }

        await this.runAutomation(automation);

        state.lastRun = now;
        state.runCount += 1;
        state.runsToday = this.calculateRunsToday(state, now, automation.timezone);
        const nextRun = this.safeGetNextRun(automation, now);
        state.nextRun = nextRun ?? state.nextRun;
        await this.saveState();
      }
    }
  }

  private calculateRunsToday(state: AutomationStateEntry, now: number, timezone: string): number {
    const todayKey = this.getDateKey(now, timezone);
    if (state.lastRunDay !== todayKey) {
      state.lastRunDay = todayKey;
      return 1;
    }
    return state.runsToday + 1;
  }

  private isAllowedToRun(automation: AutomationDefinition, taskQueue: ReturnType<typeof getTaskQueue>): boolean {
    const state = this.ensureState(automation.id);

    if (automation.constraints.maxRunsPerDay !== undefined) {
      const todayKey = this.getDateKey(Date.now(), automation.timezone);
      if (state.lastRunDay === todayKey && state.runsToday >= automation.constraints.maxRunsPerDay) {
        return false;
      }
    }

    if (automation.constraints.maxConcurrentTasks !== undefined) {
      const running = taskQueue.getRunningTasks().length;
      if (running >= automation.constraints.maxConcurrentTasks) {
        return false;
      }
    }

    return true;
  }

  private getDateKey(timestamp: number, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(new Date(timestamp));
  }

  private safeGetNextRun(automation: AutomationDefinition, from: number): number | undefined {
    try {
      return getNextCronRun(automation.schedule, from, automation.timezone);
    } catch (error) {
      console.warn('[AutomationManager] Failed to compute next run', automation.id, error);
      return undefined;
    }
  }

  private async runAutomation(automation: AutomationDefinition): Promise<void> {
    if (automation.action === 'morning_briefing') {
      if (!automation.chatId) {
        console.warn('[AutomationManager] Missing chatId for morning briefing automation', automation.id);
        return;
      }
      await getMorningBriefing().generateBriefing(automation.chatId, {
        projectPath: automation.projectPaths?.[0],
      });
      return;
    }

    if (!automation.chatId) {
      console.warn('[AutomationManager] Missing chatId for automation', automation.id);
      return;
    }

    const taskQueue = getTaskQueue();
    await taskQueue.addTask({
      type: 'claude_query',
      title: automation.title,
      description: automation.taskDescription,
      priority: 'medium',
      status: 'pending',
      chatId: automation.chatId,
      metadata: {
        automationId: automation.id,
        timeoutMs: automation.constraints.maxTaskDurationMinutes
          ? automation.constraints.maxTaskDurationMinutes * 60 * 1000
          : undefined,
      },
    });
  }
}

function isCronExpression(value: string): boolean {
  return value.trim().split(/\s+/).length === 5;
}

let globalAutomationManager: AutomationManager | null = null;

export function getAutomationManager(): AutomationManager {
  if (!globalAutomationManager) {
    globalAutomationManager = new AutomationManager();
  }
  return globalAutomationManager;
}
