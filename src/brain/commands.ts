/**
 * Brain Commands - Telegram commands for the brain system
 *
 * These commands extend the bot with agentic capabilities.
 */

import type { BotCommand } from '../types.js';
import { getMemoryStore } from './memory/memory-store.js';
import { getTaskQueue } from './tasks/task-queue.js';
import { getOrchestrator } from './agents/agent-orchestrator.js';
import { getGitAutomation } from './git/git-automation.js';
import { getBrain } from './brain-manager.js';
import { getContextIndexer } from './context/context-indexer.js';

/**
 * Get all brain-related Telegram commands
 */
export function getBrainCommands(): BotCommand[] {
  return [
    // Memory commands
    {
      command: 'remember',
      description: 'Store something in memory (e.g., /remember key value)',
      handler: async (ctx) => {
        const args = ctx.message?.text?.split(' ').slice(1);
        if (!args || args.length < 2) {
          await ctx.reply(
            'Usage: /remember <key> <value>\n' +
            'Example: /remember project-path /home/user/project'
          );
          return;
        }
        const key = args[0];
        const value = args.slice(1).join(' ');

        try {
          const memory = getMemoryStore();
          await memory.setFact(key, value);
          await ctx.reply(`✅ Remembered: ${key}`);
        } catch (error) {
          await ctx.reply(`❌ Failed to save: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'recall',
      description: 'Search memory (e.g., /recall query)',
      handler: async (ctx) => {
        const query = ctx.message?.text?.split(' ').slice(1).join(' ');
        if (!query) {
          await ctx.reply('Usage: /recall <query>\nExample: /recall project');
          return;
        }

        try {
          const memory = getMemoryStore();
          const results = memory.searchFacts(query);

          if (results.length === 0) {
            await ctx.reply(`No matches found for "${query}"`);
            return;
          }

          const response = results
            .slice(0, 10) // Limit to 10 results
            .map(({ key, value }) => `<b>${key}</b>: ${value}`)
            .join('\n');

          await ctx.reply(`Found ${results.length} result(s):\n\n${response}`, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to search: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'context',
      description: 'View project context',
      handler: async (ctx) => {
        // Try to get project path from memory
        const memory = getMemoryStore();
        const projectPath = memory.getFactTyped<string>('current-project');

        if (!projectPath) {
          await ctx.reply(
            'No project context found.\n' +
            'Set your project with: /remember current-project <path>'
          );
          return;
        }

        try {
          const projectMemory = await memory.getProjectMemory(projectPath);
          const decisions = await memory.getDecisions(projectPath);
          const patterns = await memory.getPatterns(projectPath);

          let response = `<b>Project:</b> ${projectMemory.projectName}\n`;
          response += `<b>Path:</b> ${projectMemory.path}\n`;
          response += `<b>Last Updated:</b> ${new Date(projectMemory.lastUpdated).toLocaleString()}\n\n`;

          if (decisions.length > 0) {
            response += `<b>Recent Decisions (${decisions.length}):</b>\n`;
            decisions.slice(-3).forEach(d => {
              response += `• ${d.title}\n`;
            });
          }

          if (patterns.length > 0) {
            response += `\n<b>Patterns (${patterns.length}):</b>\n`;
            patterns.slice(-3).forEach(p => {
              response += `• ${p.name}\n`;
            });
          }

          await ctx.reply(response, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to load context: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'index',
      description: 'Index project for context awareness',
      handler: async (ctx) => {
        const memory = getMemoryStore();
        let projectPath = memory.getFactTyped<string>('current-project');

        // Allow passing path as argument
        const args = ctx.message?.text?.split(' ').slice(1);
        if (args && args.length > 0 && args[0] && !args[0].startsWith('/')) {
          projectPath = args[0];
        }

        if (!projectPath) {
          await ctx.reply(
            'No project set. Use: /remember current-project <path>\n' +
            'Or pass path: /index C:\\Users\\YourName\\project'
          );
          return;
        }

        try {
          const indexer = getContextIndexer();
          await ctx.reply(`🔍 Indexing project: ${projectPath}...`);

          const fingerprint = await indexer.indexProject(projectPath);

          const languageList = Object.entries(fingerprint.languages)
            .map(([lang, count]) => `${lang}: ${count}`)
            .join(', ');

          const response =
            `<b>✅ Index Complete</b>\n\n` +
            `<b>Project:</b> ${fingerprint.projectName}\n` +
            `<b>Files:</b> ${fingerprint.fileCount}\n` +
            `<b>Lines:</b> ${fingerprint.totalLines.toLocaleString()}\n` +
            `<b>Languages:</b> ${languageList}\n\n` +
            `<b>Entry Points:</b> ${fingerprint.structure.entryPoints.length}\n` +
            `<b>Test Files:</b> ${fingerprint.structure.testFiles.length}\n` +
            `<b>Config Files:</b> ${fingerprint.structure.configFiles.length}\n\n` +
            `Now use /search <query> to find code!`;

          await ctx.reply(response, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to index: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'search',
      description: 'Search indexed code',
      handler: async (ctx) => {
        const query = ctx.message?.text?.split(' ').slice(1).join(' ');
        if (!query) {
          await ctx.reply('Usage: /search <query>\nExample: /search authentication');
          return;
        }

        try {
          const memory = getMemoryStore();
          const projectPath = memory.getFactTyped<string>('current-project');

          if (!projectPath) {
            await ctx.reply('No project set. Use: /remember current-project <path>');
            return;
          }

          const indexer = getContextIndexer();
          const result = indexer.getContext(projectPath, query);

          if (result.files.length === 0) {
            await ctx.reply(`No results found for "${query}"\n\nMake sure to run /index first!`);
            return;
          }

          let response = `<b>🔍 Search: "${query}"</b>\n\n`;
          response += `${result.summary}\n\n`;

          // Show matching files (limit to 10)
          response += `<b>Files:</b>\n`;
          for (const file of result.files.slice(0, 10)) {
            response += `• <code>${file.relativePath}</code>\n`;
            if (file.exports && file.exports.length > 0) {
              response += `  exports: ${file.exports.slice(0, 3).join(', ')}\n`;
            }
            if (file.classes && file.classes.length > 0) {
              response += `  classes: ${file.classes.join(', ')}\n`;
            }
          }

          if (result.symbols.length > 0) {
            response += `\n<b>Symbols:</b>\n`;
            response += result.symbols.slice(0, 10).join(', ');
          }

          await ctx.reply(response, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to search: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'file',
      description: 'Get file info from index',
      handler: async (ctx) => {
        const relativePath = ctx.message?.text?.split(' ').slice(1).join(' ');
        if (!relativePath) {
          await ctx.reply('Usage: /file <relative-path>\nExample: /file src/auth/login.ts');
          return;
        }

        try {
          const memory = getMemoryStore();
          const projectPath = memory.getFactTyped<string>('current-project');

          if (!projectPath) {
            await ctx.reply('No project set. Use: /remember current-project <path>');
            return;
          }

          const indexer = getContextIndexer();
          const fileInfo = indexer.getFileInfo(projectPath, relativePath);

          if (!fileInfo) {
            await ctx.reply(`File not found: ${relativePath}\n\nMake sure to run /index first!`);
            return;
          }

          let response = `<b>📄 ${fileInfo.relativePath}</b>\n\n`;
          response += `<b>Language:</b> ${fileInfo.language}\n`;
          response += `<b>Lines:</b> ${fileInfo.lineCount}\n`;
          response += `<b>Size:</b> ${(fileInfo.size / 1024).toFixed(1)} KB\n`;
          response += `<b>Modified:</b> ${new Date(fileInfo.modified).toLocaleString()}\n\n`;

          if (fileInfo.exports && fileInfo.exports.length > 0) {
            response += `<b>Exports:</b> ${fileInfo.exports.join(', ')}\n`;
          }
          if (fileInfo.imports && fileInfo.imports.length > 0) {
            response += `<b>Imports:</b> ${fileInfo.imports.slice(0, 5).join(', ')}\n`;
          }
          if (fileInfo.classes && fileInfo.classes.length > 0) {
            response += `<b>Classes:</b> ${fileInfo.classes.join(', ')}\n`;
          }
          if (fileInfo.functions && fileInfo.functions.length > 0) {
            response += `<b>Functions:</b> ${fileInfo.functions.slice(0, 10).join(', ')}\n`;
          }
          if (fileInfo.types && fileInfo.types.length > 0) {
            response += `<b>Types:</b> ${fileInfo.types.slice(0, 10).join(', ')}\n`;
          }

          await ctx.reply(response, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to get file info: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },

    // Task commands
    {
      command: 'task',
      description: 'Create a background task (e.g., /task description --bg)',
      handler: async (ctx) => {
        const text = ctx.message?.text?.trim();
        if (!text || text === '/task') {
          await ctx.reply('Usage: /task <description> [--bg]\nExample: /task Run tests --bg');
          return;
        }

        const description = text.replace('/task', '').trim().replace(/--bg/g, '').trim();
        const isBackground = text.includes('--bg');

        if (!description) {
          await ctx.reply('Please provide a task description');
          return;
        }

        try {
          const taskQueue = getTaskQueue();
          const chatId = ctx.chat?.id || 0;
          const taskId = await taskQueue.addTask({
            type: 'custom',
            title: description.split(' ').slice(0, 5).join(' '), // First few words as title
            description,
            priority: 'medium',
            status: isBackground ? 'pending' : 'queued',
            chatId,
          });

          if (isBackground) {
            await ctx.reply(`✅ Task queued: <b>${taskId}</b>\n${description}`, { parse_mode: 'HTML' });
          } else {
            await ctx.reply(`✅ Task created: <b>${taskId}</b>\n${description}`, { parse_mode: 'HTML' });
          }
        } catch (error) {
          await ctx.reply(`❌ Failed to create task: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'tasks',
      description: 'List all active tasks',
      handler: async (ctx) => {
        try {
          const taskQueue = getTaskQueue();
          const chatId = ctx.chat?.id || 0;
          const tasks = taskQueue.getTasksForChat(chatId);

          if (tasks.length === 0) {
            await ctx.reply('No active tasks for this chat');
            return;
          }

          const pending = tasks.filter((t: any) => t.status === 'pending' || t.status === 'queued');
          const running = tasks.filter((t: any) => t.status === 'running');
          const completed = tasks.filter((t: any) => t.status === 'completed');

          let response = `<b>Tasks:</b>\n\n`;
          response += `📥 Pending: ${pending.length}\n`;
          response += `🔄 Running: ${running.length}\n`;
          response += `✅ Completed: ${completed.length}\n\n`;

          if (pending.length > 0) {
            response += `<b>Pending:</b>\n`;
            pending.slice(0, 5).forEach((t: any) => {
              response += `• ${t.id}: ${t.description}\n`;
            });
          }

          if (running.length > 0) {
            response += `\n<b>Running:</b>\n`;
            running.slice(0, 5).forEach((t: any) => {
              response += `• ${t.id}: ${t.description}\n`;
            });
          }

          await ctx.reply(response, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to list tasks: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'cancel',
      description: 'Cancel a task (e.g., /cancel <task-id>)',
      handler: async (ctx) => {
        const taskId = ctx.message?.text?.split(' ')[1];
        if (!taskId) {
          await ctx.reply('Usage: /cancel <task-id>\nUse /tasks to see active tasks');
          return;
        }

        try {
          const taskQueue = getTaskQueue();
          await taskQueue.cancelTask(taskId);
          await ctx.reply(`✅ Task ${taskId} cancelled`);
        } catch (error) {
          await ctx.reply(`❌ Failed to cancel task: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },

    // Agent commands
    {
      command: 'agent',
      description: 'Run a specific agent (e.g., /agent scout "explore auth")',
      handler: async (ctx) => {
        const text = ctx.message?.text?.trim();
        const parts = text?.replace('/agent', '').trim().split(/\s+/);

        if (!parts || parts.length < 2) {
          await ctx.reply(
            'Usage: /agent <type> <task>\n' +
            'Types: scout, builder, reviewer, tester, deployer\n' +
            'Example: /agent scout explore auth system'
          );
          return;
        }

        const agentType = parts[0];
        const taskDesc = parts.slice(1).join(' ');

        try {
          const orchestrator = getOrchestrator();
          const workflow = await orchestrator.orchestrate({
            name: `${agentType}-${Date.now()}`,
            description: taskDesc,
            tasks: [{
              agentId: agentType,
              taskId: `task-${Date.now()}`,
              dependencies: [],
              status: 'pending',
            }],
          });

          if (workflow.status === 'completed') {
            await ctx.reply(`✅ Agent completed:\n\n${taskDesc}`, { parse_mode: 'HTML' });
          } else if (workflow.status === 'failed') {
            await ctx.reply(`❌ Agent failed:\n\n${taskDesc}`);
          } else {
            await ctx.reply(`⏳ Agent queued:\n\n${taskDesc}`);
          }
        } catch (error) {
          await ctx.reply(`❌ Failed to run agent: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'agents',
      description: 'Show running agents',
      handler: async (ctx) => {
        try {
          const orchestrator = getOrchestrator();
          const agents = orchestrator.getAllAgents();

          if (agents.length === 0) {
            await ctx.reply('No agents configured');
            return;
          }

          const response = agents
            .map((a: any) => `<b>${a.type}</b>: ${a.status}\n`)
            .join('\n');

          await ctx.reply(`<b>Available Agents:</b>\n\n${response}`, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to list agents: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },

    // Git commands
    {
      command: 'git',
      description: 'Git operations (commit, pr, status)',
      handler: async (ctx) => {
        const args = ctx.message?.text?.split(' ').slice(1);
        const subCommand = args?.[0];

        // Get current project path from memory
        const memory = getMemoryStore();
        const projectPath = memory.getFactTyped<string>('current-project');

        if (!projectPath && ['commit', 'pr', 'status'].includes(subCommand || '')) {
          await ctx.reply(
            'No project set. Use: /remember current-project <path>\n' +
            'Example: /remember current-project C:\\Users\\YourName\\project'
          );
          return;
        }

        const git = getGitAutomation();

        switch (subCommand) {
          case 'commit': {
            const result = await git.smartCommit(projectPath!, { autoStage: true });
            if (result.success) {
              await ctx.reply(
                `✅ Committed: ${result.message}\n` +
                `Hash: ${result.commitHash || 'unknown'}`
              );
            } else {
              await ctx.reply(`❌ Commit failed: ${result.error || 'Unknown error'}`);
            }
            break;
          }
          case 'pr': {
            // Get current branch first
            const branch = await git.getCurrentBranch(projectPath!);
            const draft = await git.generatePRDescription(projectPath!, branch);
            await ctx.reply(`<b>PR Draft:</b>\n\n${draft.title}\n\n${draft.body}`, { parse_mode: 'HTML' });
            break;
          }
          case 'status': {
            const status = await git.getBranchStatus(projectPath!);
            await ctx.reply(
              `<b>Git Status:</b>\n\n` +
              `Branch: ${status.branch}\n` +
              `Ahead: ${status.ahead}\n` +
              `Behind: ${status.behind}\n` +
              `Staged: ${status.staged}\n` +
              `Modified: ${status.modified}\n` +
              `Untracked: ${status.untracked}`,
              { parse_mode: 'HTML' }
            );
            break;
          }
          default:
            await ctx.reply(
              'Usage: /git <commit|pr|status>\n' +
              '• commit - Smart commit with auto-generated message\n' +
              '• pr - Generate PR description\n' +
              '• status - Show git status'
            );
        }
      },
    },

    // Profile & metrics
    {
      command: 'profile',
      description: 'View/edit your profile',
      handler: async (ctx) => {
        try {
          const brain = getBrain();
          const identity = brain.getIdentity();
          const personality = brain.getPersonality();
          const preferences = brain.getPreferences();

          let response = `<b>Profile</b>\n\n`;
          response += `<b>Bot Name:</b> ${identity.name} ${identity.emoji}\n`;
          response += `<b>User:</b> ${brain.getUserName()}\n`;
          response += `<b>Timezone:</b> ${brain.getTimezone()}\n\n`;

          response += `<b>Communication:</b>\n`;
          response += `• Style: ${personality.communication.style}\n`;
          response += `• Tone: ${personality.communication.tone}\n\n`;

          response += `<b>Languages:</b> ${personality.coding.languages.join(', ')}\n\n`;

          response += `<b>Git:</b>\n`;
          response += `• Default branch: ${preferences.git.defaultBranch}\n`;
          response += `• Commit style: ${preferences.git.commitMessageStyle}\n`;

          await ctx.reply(response, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to load profile: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'metrics',
      description: 'Show performance metrics',
      handler: async (ctx) => {
        try {
          const brain = getBrain();
          const metrics = await brain.getTodayMetrics();

          let response = `<b>📊 Daily Metrics</b>\n\n`;
          response += `<b>Date:</b> ${metrics.date}\n\n`;
          response += `<b>Tasks:</b>\n`;
          response += `• Completed: ${metrics.tasksCompleted}\n`;
          response += `• Failed: ${metrics.tasksFailed}\n\n`;
          response += `<b>Claude:</b>\n`;
          response += `• Queries: ${metrics.claudeQueries}\n\n`;
          response += `<b>Code:</b>\n`;
          response += `• Files modified: ${metrics.filesModified}\n`;
          response += `• Lines changed: ${metrics.linesOfCodeChanged}\n\n`;
          response += `<b>Active Projects:</b> ${metrics.activeProjects.length || 0}\n`;
          response += `${metrics.activeProjects.slice(0, 3).map((p: string) => `• ${p}`).join('\n')}`;

          await ctx.reply(response, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },

    // Scheduling
    {
      command: 'schedule',
      description: 'Schedule a task (e.g., /schedule "0 2 * * *" task)',
      handler: async (ctx) => {
        const text = ctx.message?.text?.trim();
        // Extract cron pattern and task description
        const match = text?.match(/\/schedule\s+"([^"]+)"\s+(.+)/);

        if (!match) {
          await ctx.reply(
            'Usage: /schedule "<cron>" <task>\n' +
            'Example: /schedule "0 2 * * *" Run nightly backup\n' +
            'Cron format: minute hour day month weekday'
          );
          return;
        }

        const [, cron, taskDesc] = match;

        try {
          const taskQueue = getTaskQueue();
          const chatId = ctx.chat?.id || 0;
          await taskQueue.addSchedule({
            cronExpression: cron,
            enabled: true,
            task: {
              type: 'custom',
              title: taskDesc.split(' ').slice(0, 5).join(' '),
              description: taskDesc,
              priority: 'medium',
              status: 'pending',
              chatId,
            },
          });

          await ctx.reply(`✅ Scheduled:\n${taskDesc}\nCron: ${cron}`);
        } catch (error) {
          await ctx.reply(`❌ Failed to schedule: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
    {
      command: 'schedules',
      description: 'List scheduled tasks',
      handler: async (ctx) => {
        try {
          const taskQueue = getTaskQueue();
          const schedules = taskQueue.getSchedules();

          if (schedules.length === 0) {
            await ctx.reply('No scheduled tasks');
            return;
          }

          const response = schedules
            .map((s: any) => `<b>${s.id}</b>\n${s.cronExpression}\n${s.task.description}`)
            .join('\n\n');

          await ctx.reply(`<b>Scheduled Tasks:</b>\n\n${response}`, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Failed to list schedules: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
  ];
}
