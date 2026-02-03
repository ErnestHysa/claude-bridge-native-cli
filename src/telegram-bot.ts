/**
 * Telegram Bot Handler for Claude Bridge Native CLI
 */

import TelegramBot from "node-telegram-bot-api";
import type { Message, CallbackQuery } from "node-telegram-bot-api";
import { SessionManager } from "./session-manager.js";
import { ProjectManager } from "./project-manager-class.js";
import { ClaudeSpawner } from "./claude-spawner-class.js";
import type { BridgeConfig } from "./types.js";
import { escapeHtml, chunkMessage, formatRelativeTime, Logger, sanitizePath, generateId } from "./utils.js";
import {
  getBrain,
  getMemoryStore,
  createSetupWizard,
  getIdentityManager,
  getContextIndexer,
  getOrchestrator,
  getTaskQueue,
  startScheduledJobs,
  loadSelfReviewContext,
  getTestWatcher,
  getNotificationRouter,
  getCodeAnalyzer,
  getPatternLearner,
  getIntentionEngine,
  getDecisionMaker,
  getGoalSystem,
  type SetupWizard,
  type AgentType,
  type NotificationType,
} from "./brain/index.js";

// Worker imports for self-improvement system
import { runHeartbeat, runProactiveChecksWorker } from "./brain/scripts/worker-manager.js";
import { getHeartbeatStatus } from "./brain/scripts/heartbeat-worker.js";

// Brain system initialization
let brainInitialized = false;

// Per-chat setup wizard instances (not singleton - each chat gets its own)
const setupWizards = new Map<number, SetupWizard>();

async function ensureBrainInitialized() {
  if (!brainInitialized) {
    await getBrain().initialize();
    // Memory store is now initialized within BrainManager.initialize()
    brainInitialized = true;
  }
}

/**
 * Check if user is in setup mode
 */
function isInSetup(chatId: number): boolean {
  return setupWizards.has(chatId);
}


/**
 * Handle setup wizard interaction
 */
async function handleSetupWizard(
  msg: Message,
  bot: TelegramBot,
): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;

  // Get or create wizard instance for this chat (per-chat, not singleton)
  let wizard = setupWizards.get(chatId);
  if (!wizard) {
    wizard = createSetupWizard(chatId);
    setupWizards.set(chatId, wizard);
  }

  // Process input and get next step
  const result = wizard.processInput(text);

  // Send the next message
  await bot.sendMessage(chatId, wizard.getCurrentStepMessage(), {
    parse_mode: "HTML",
  });

  // If setup complete, save profile and mark complete
  if (result.nextState === 'complete') {
    const profile = wizard.getProfile();
    const identityManager = getIdentityManager();

    await identityManager.updateIdentity(profile.identity);
    await identityManager.updatePersonality(profile.personality);
    await identityManager.updatePreferences(profile.preferences);
    await identityManager.markSetupComplete();
    await getBrain().markSetupComplete();

    // Clear from setup map
    setupWizards.delete(chatId);
  }
}

/**
 * Telegram Bot class
 */
export class TelegramBotHandler {
  private bot: TelegramBot;
  private sessionManager: SessionManager;
  private projectManager: ProjectManager;
  private claudeSpawner: ClaudeSpawner;
  private config: BridgeConfig;
  private logger: Logger;

  // Callback data prefixes
  private static readonly CB_SELECT_PROJECT = "select_project:";
  private static readonly CB_RM_PROJECT = "rm_project:";
  private static readonly CB_APPROVE_EDIT = "approve_edit:";
  private static readonly CB_REJECT_EDIT = "reject_edit:";
  private static readonly CB_CANCEL = "cancel";

  constructor(token: string, config: BridgeConfig) {
    this.bot = new TelegramBot(token, { polling: true });
    this.config = config;
    this.logger = new Logger(config.logLevel);

    // Get brain sessions directory
    const brain = getBrain();
    const sessionsDir = brain.getSessionsDir();

    this.sessionManager = new SessionManager({
      maxConcurrentSessions: config.maxConcurrentSessions,
      sessionsDir,
    });

    this.projectManager = new ProjectManager(config.projectsBase);
    this.claudeSpawner = new ClaudeSpawner(config);

    this.setupHandlers();
    this.setupCommands();
  }

  /**
   * Setup bot command handlers
   */
  private setupCommands(): void {
    this.bot.setMyCommands([
      { command: "start", description: "Start the bot and see available commands" },
      { command: "projects", description: "List available projects" },
      { command: "select", description: "Select a project to work on" },
      { command: "addproject", description: "Add a project by path" },
      { command: "rmproject", description: "Remove a project" },
      { command: "rescan", description: "Rescan for projects" },
      { command: "status", description: "Show current session status" },
      { command: "cancel", description: "Cancel current operation" },
      { command: "help", description: "Show help message" },
      // Brain commands
      { command: "remember", description: "Store something in memory" },
      { command: "recall", description: "Search memory" },
      { command: "context", description: "View project context" },
      { command: "task", description: "Create a background task" },
      { command: "tasks", description: "List all active tasks" },
      { command: "agent", description: "Run a specific agent" },
      { command: "agents", description: "Show running agents" },
      { command: "git", description: "Git operations (commit, pr, status)" },
      { command: "metrics", description: "Show performance metrics" },
      { command: "profile", description: "View your profile" },
      { command: "schedule", description: "Schedule a task with cron" },
      { command: "schedules", description: "List scheduled tasks" },
      { command: "watch", description: "Watch project for test failures" },
      { command: "notifications", description: "Manage notification preferences" },
      { command: "analyze", description: "Analyze code quality" },
      { command: "learn", description: "Learn code patterns" },
      // Self-improvement commands
      { command: "heartbeat", description: "Run heartbeat check manually" },
      { command: "semantic", description: "Semantic memory search" },
      { command: "briefing", description: "Generate daily briefing" },
      { command: "checks", description: "Run proactive checks" },
      { command: "selfreview", description: "View learning log" },
      // Autonomous AI commands
      { command: "intentions", description: "View active intentions" },
      { command: "decisions", description: "View recent AI decisions" },
      { command: "goals", description: "View goals and progress" },
      { command: "autonomous", description: "Autonomous mode status" },
      { command: "permissions", description: "View/set permission level" },
      { command: "approve", description: "Approve a pending action" },
      { command: "deny", description: "Deny a pending action" },
    ]).catch((err) => {
      this.logger.error("Failed to set bot commands", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Setup all message and callback handlers
   */
  private setupHandlers(): void {
    // Command handlers
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));
    this.bot.onText(/\/projects/, (msg) => this.handleProjects(msg));
    this.bot.onText(/\/select/, (msg) => this.handleSelect(msg));
    this.bot.onText(/\/addproject(?:\s+(.+))?/, (msg, match) =>
      this.handleAddProject(msg, match?.[1])
    );
    this.bot.onText(/\/rmproject(?:\s+(.+))?/, (msg, match) =>
      this.handleRemoveProject(msg, match?.[1])
    );
    this.bot.onText(/\/rescan/, (msg) => this.handleRescan(msg));
    this.bot.onText(/\/status/, (msg) => this.handleStatus(msg));
    this.bot.onText(/\/cancel/, (msg) => this.handleCancel(msg));

    // Brain command handlers
    this.bot.onText(/\/remember(?:\s+(.+))?/, (msg, match) =>
      this.handleRemember(msg, match?.[1])
    );
    this.bot.onText(/\/recall(?:\s+(.+))?/, (msg, match) =>
      this.handleRecall(msg, match?.[1])
    );
    this.bot.onText(/\/context/, (msg) => this.handleContext(msg));
    this.bot.onText(/\/task(?:\s+(.+))?/, (msg, match) =>
      this.handleTask(msg, match?.[1])
    );
    this.bot.onText(/\/tasks/, (msg) => this.handleTasks(msg));
    this.bot.onText(/\/agent(?:\s+(.+))?/, (msg, match) =>
      this.handleAgent(msg, match?.[1])
    );
    this.bot.onText(/\/agents/, (msg) => this.handleAgents(msg));
    this.bot.onText(/\/git(?:\s+(.+))?/, (msg, match) =>
      this.handleGit(msg, match?.[1])
    );
    this.bot.onText(/\/metrics/, (msg) => this.handleMetrics(msg));
    this.bot.onText(/\/logs(?:\s+(.+))?/, (msg, match) =>
      this.handleLogs(msg, match?.[1])
    );
    this.bot.onText(/\/profile(?:\s+(.+))?/, (msg, match) =>
      this.handleProfile(msg, match?.[1])
    );
    this.bot.onText(/\/schedule(?:\s+(.+))?/, (msg) =>
      this.handleSchedule(msg)
    );
    this.bot.onText(/\/schedules/, (msg) => this.handleSchedules(msg));

    // State management commands
    this.bot.onText(/\/state/, (msg) => this.handleState(msg));
    this.bot.onText(/\/recovery/, (msg) => this.handleRecovery(msg));
    this.bot.onText(/\/export/, (msg) => this.handleExport(msg));

    // Test watcher command
    this.bot.onText(/\/watch(?:\s+(.+))?/, (msg, match) =>
      this.handleWatch(msg, match?.[1])
    );

    // Notification settings command
    this.bot.onText(/\/notifications(?:\s+(.+))?/, (msg, match) =>
      this.handleNotifications(msg, match?.[1])
    );

    // Code analysis command
    this.bot.onText(/\/analyze(?:\s+(.+))?/, (msg, match) =>
      this.handleAnalyze(msg, match?.[1])
    );

    // Pattern learning command
    this.bot.onText(/\/learn(?:\s+(.+))?/, (msg, match) =>
      this.handleLearn(msg, match?.[1])
    );

    // Self-improvement commands
    this.bot.onText(/\/heartbeat/, (msg) => this.handleHeartbeat(msg));
    this.bot.onText(/\/briefing/, (msg) => this.handleBriefing(msg));
    this.bot.onText(/\/checks/, (msg) => this.handleChecks(msg));
    this.bot.onText(/\/selfreview/, (msg) => this.handleSelfReview(msg));

    // Autonomous AI commands
    this.bot.onText(/\/intentions(?:\s+(.+))?/, (msg, match) =>
      this.handleIntentions(msg, match?.[1])
    );
    this.bot.onText(/\/decisions(?:\s+(.+))?/, (msg, match) =>
      this.handleDecisions(msg, match?.[1])
    );
    this.bot.onText(/\/goals(?:\s+(.+))?/, (msg, match) =>
      this.handleGoals(msg, match?.[1])
    );
    this.bot.onText(/\/autonomous(?:\s+(.+))?/, (msg, match) =>
      this.handleAutonomous(msg, match?.[1])
    );
    this.bot.onText(/\/permissions(?:\s+(.+))?/, (msg, match) =>
      this.handlePermissions(msg, match?.[1])
    );
    this.bot.onText(/^\/approve(?:\s+(.+))?$/, (msg, match) =>
      this.handleApprove(msg, match?.[1])
    );
    this.bot.onText(/^\/deny(?:\s+(.+))?$/, (msg, match) =>
      this.handleDeny(msg, match?.[1])
    );

    // Semantic search command
    this.bot.onText(/\/semantic(?:\s+(.+))?$/, (msg, match) =>
      this.handleSemanticSearch(msg, match?.[1])
    );

    // Context indexer commands
    this.bot.onText(/^\/index(?:\s+(.+))?$/, (msg, match) =>
      this.handleIndex(msg, match?.[1])
    );
    this.bot.onText(/^\/search(?:\s+(.+))?$/, (msg, match) =>
      this.handleSearch(msg, match?.[1])
    );
    this.bot.onText(/^\/file(?:\s+(.+))?$/, (msg, match) =>
      this.handleFileInfo(msg, match?.[1])
    );

    // Callback query handlers (inline buttons)
    this.bot.on("callback_query", (query) => this.handleCallbackQuery(query));

    // Text messages (prompts for Claude)
    this.bot.on("message", (msg) => this.handleTextMessage(msg));

    // Error handling
    this.bot.on("polling_error", (err) => {
      this.logger.error("Telegram polling error", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Check if user is authorized
   */
  private isAuthorized(msg: Message): boolean {
    const userId = msg.from?.id;
    const username = msg.from?.username;

    // Check by ID
    if (userId && this.config.allowedUserIds.includes(userId)) {
      return true;
    }

    // Check by username
    if (username && this.config.allowedUsers.includes(username)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a user from a callback query is authorized
   */
  private isCallbackAuthorized(from: { id?: number; username?: string }): boolean {
    const userId = from.id;
    const username = from.username;

    // Check by ID
    if (userId && this.config.allowedUserIds.includes(userId)) {
      return true;
    }

    // Check by username
    if (username && this.config.allowedUsers.includes(username)) {
      return true;
    }

    return false;
  }

  /**
   * Send authorization error
   */
  private async sendNotAuthorized(msg: Message): Promise<void> {
    await this.bot.sendMessage(
      msg.chat.id,
      "You are not authorized to use this bot."
    );
  }

  /**
   * Handle /start command
   */
  private async handleStart(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;
    const userInfo = {
      username: msg.from?.username,
      firstName: msg.from?.first_name,
      lastName: msg.from?.last_name,
    };

    this.sessionManager.getOrCreateSession(chatId, userInfo);
    await ensureBrainInitialized();

    // Check if setup is needed
    if (getBrain().isSetupNeeded()) {
      const wizard = createSetupWizard(chatId);
      setupWizards.set(chatId, wizard);

      await this.bot.sendMessage(
        chatId,
        wizard.getCurrentStepMessage(),
        { parse_mode: "HTML" }
      );
      return;
    }

    const brain = getBrain();

    await this.bot.sendMessage(
      chatId,
      `${brain.getEmoji()} Welcome back, <b>${escapeHtml(brain.getUserName())}</b>! 🧠

I help you interact with Claude Code CLI through Telegram.
Now with <b>agentic brain</b> capabilities for persistent memory and autonomous tasks.

<b>Core Commands:</b>
/projects - List available projects
/select - Select a project to work on
/status - Show current status
/cancel - Cancel current operation
/help - Show detailed help

<b>Brain Commands 🧠</b>
/remember &lt;key&gt; &lt;value&gt; - Store in memory
/recall &lt;query&gt; - Search memory
/context - View project context
/index &lt;path&gt; - Index project for context awareness
/search &lt;query&gt; - Search indexed code
/file &lt;path&gt; - Get file details from index
/task &lt;desc&gt; [--bg] - Create background task
/tasks - List active tasks
/agent &lt;type&gt; &lt;task&gt; - Run specialized agent
/git &lt;command&gt; - Git operations (commit, status, log)
/metrics - Show daily metrics
/logs [type] [lines] - View logs

<b>Getting started:</b>
1. Use /projects to see available projects
2. Use /select or send a message to choose a project
3. Send your prompt to work with Claude!

<b>Agents available:</b> scout, builder, reviewer, tester, deployer`,
      { parse_mode: "HTML" }
    );
  }

  /**
   * Handle /help command
   */
  private async handleHelp(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const brain = getBrain();

    await this.bot.sendMessage(
      msg.chat.id,
      `${brain.getEmoji()} <b>Claude Bridge CLI - Help</b>

<b>Core Commands:</b>
/start - Initialize the bot
/projects - List all available projects
/select - Select a project with inline keyboard
/addproject &lt;path&gt; - Add a project by absolute path
/rmproject &lt;name&gt; - Remove a project
/rescan - Rescan the projects directory
/status - Show current session and project info
/cancel - Cancel the current Claude operation

<b>Brain Commands 🧠</b>
/remember &lt;key&gt; &lt;value&gt; - Store something in memory
/recall &lt;query&gt; - Search stored memories
/semantic &lt;query&gt; - Semantic memory search
/context - View project context and decisions
/index &lt;path&gt; - Index project for context awareness
/search &lt;query&gt; - Search indexed code
/file &lt;path&gt; - Get file details from index
/task &lt;description&gt; [--bg] - Create a new task
/tasks - List all your active tasks
/agent &lt;type&gt; &lt;task&gt; - Run a specialized agent
/agents - Show running agents
/git commit - Smart commit with AI message
/git status - Show git status
/git log - Show recent commits
/metrics - Show today's performance metrics
/logs [type] [lines] - View logs (app/error/audit, default 20 lines)
/state - View system state and checkpoints
/recovery - View crash recovery status
/export - Export state data to file
/profile - View your profile
/schedule &lt;cron&gt; &lt;task&gt; - Schedule a task
/schedules - List scheduled tasks

<b>Code Intelligence 🧠</b>
/analyze - Analyze code quality
/learn - Learn code patterns from project

<b>Self-Improvement 🔄</b>
/heartbeat - Run heartbeat check manually
/briefing - Generate daily briefing
/checks - Run proactive checks
/selfreview - View learning log

<b>Autonomous AI 🤖</b>
/intentions - View active intentions
/decisions - View pending/approved decisions
/goals - Manage goals
/autonomous &lt;on|off|status&gt; - Toggle autonomous mode
/permissions &lt;level&gt; - Set permission level
/approve &lt;id&gt; - Approve pending action
/deny &lt;id&gt; - Deny pending action

<b>Workflow:</b>
1. Select a project using /select
2. Send your prompt as a message
3. Claude will process and respond
4. Use /remember to store important info for later

<b>File Edit Approval:</b>
• Read operations: Auto-approved
• Single file edits: Auto-approved (configurable)
• Deletes: Require approval
• Mass changes (5+ files): Require approval`,
      { parse_mode: "HTML" }
    );
  }

  /**
   * Handle /projects command
   */
  private async handleProjects(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;
    const projects = this.projectManager.getProjects();

    if (projects.length === 0) {
      await this.bot.sendMessage(
        chatId,
        "No projects found. Use /addproject to add one or /rescan to scan the projects directory."
      );
      return;
    }

    const session = this.sessionManager.getSession(chatId);
    const currentProjectName = session?.currentProject?.name;

    let message = `<b>Available Projects (${projects.length}):</b>\n\n`;

    for (const project of projects) {
      const isCurrent = project.name === currentProjectName;
      const gitInfo = project.isGit
        ? `${project.status === "active" ? "🔴" : "🟢"} ${project.branch || "main"}`
        : "📦";

      const sessions = this.sessionManager.getChatsUsingProject(project.name);
      const sessionCount = sessions.length;

      message += `${isCurrent ? "✅" : "⚪"} <b>${escapeHtml(project.name)}</b>\n`;
      message += `   ${gitInfo} • ${sessionCount} session${sessionCount === 1 ? "" : "s"}\n`;
      message += `   📁 ${escapeHtml(project.path)}\n\n`;
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  }

  /**
   * Handle /select command
   */
  private async handleSelect(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;
    const projects = this.projectManager.getProjects();

    if (projects.length === 0) {
      await this.bot.sendMessage(
        chatId,
        "No projects available. Use /addproject to add one or /rescan to scan the projects directory."
      );
      return;
    }

    const session = this.sessionManager.getSession(chatId);
    const currentProjectName = session?.currentProject?.name;

    // Create inline keyboard
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];

    for (const project of projects) {
      const isCurrent = project.name === currentProjectName;
      keyboard.push([
        {
          text: `${isCurrent ? "✅ " : ""}${project.name}`,
          callback_data: `${TelegramBotHandler.CB_SELECT_PROJECT}${project.name}`,
        },
      ]);
    }

    await this.bot.sendMessage(chatId, "Select a project:", {
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  /**
   * Handle /addproject command
   */
  private async handleAddProject(msg: Message, pathArg?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    if (!pathArg) {
      await this.bot.sendMessage(
        chatId,
        "Usage: /addproject <path>\n\nExample: /addproject C:\\Users\\Projects\\MyProject"
      );
      return;
    }

    const project = this.projectManager.addProject(pathArg);

    if (!project) {
      await this.bot.sendMessage(
        chatId,
        `Failed to add project. Path may not exist or is not a valid project.\n\nPath: ${escapeHtml(sanitizePath(pathArg))}`
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      `Project added:\n\n<b>${escapeHtml(project.name)}</b>\n📁 ${escapeHtml(project.path)}`,
      { parse_mode: "HTML" }
    );
  }

  /**
   * Handle /rmproject command
   */
  private async handleRemoveProject(msg: Message, nameArg?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    if (!nameArg) {
      // Show list to select
      const projects = this.projectManager.getProjects();
      if (projects.length === 0) {
        await this.bot.sendMessage(chatId, "No projects to remove.");
        return;
      }

      const keyboard: TelegramBot.InlineKeyboardButton[][] = projects.map((p) => [
        {
          text: p.name,
          callback_data: `${TelegramBotHandler.CB_RM_PROJECT}${p.name}`,
        },
      ]);

      await this.bot.sendMessage(chatId, "Select project to remove:", {
        reply_markup: { inline_keyboard: keyboard },
      });
      return;
    }

    const removed = this.projectManager.removeProject(nameArg);

    if (removed) {
      await this.bot.sendMessage(chatId, `Project removed: ${escapeHtml(nameArg)}`, {
        parse_mode: "HTML",
      });
    } else {
      await this.bot.sendMessage(chatId, `Project not found: ${escapeHtml(nameArg)}`, {
        parse_mode: "HTML",
      });
    }
  }

  /**
   * Handle /rescan command
   */
  private async handleRescan(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    const result = await this.bot.sendMessage(chatId, "Scanning for projects...");

    const detectionResult = this.projectManager.rescan();

    await this.bot.editMessageText(
      `Scan complete. Found ${detectionResult.projects.length} project${detectionResult.projects.length === 1 ? "" : "s"
      } in ${escapeHtml(detectionResult.scanPath)}`,
      {
        chat_id: chatId,
        message_id: result.message_id,
      }
    );
  }

  /**
   * Handle /status command
   */
  private async handleStatus(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;
    const session = this.sessionManager.getSession(chatId);

    if (!session) {
      await this.bot.sendMessage(chatId, "No active session. Use /start to begin.");
      return;
    }

    let status = `<b>Session Status:</b>\n\n`;
    status += `User: ${escapeHtml(session.username || session.firstName || "Unknown")}\n`;
    status += `Status: ${this.formatStatus(session.status)}\n`;
    status += `Last Activity: ${formatRelativeTime(session.lastActivity)}\n\n`;

    if (session.currentProject) {
      status += `<b>Current Project:</b>\n`;
      status += `Name: ${escapeHtml(session.currentProject.name)}\n`;
      status += `Path: ${escapeHtml(session.currentProject.path)}\n`;

      if (session.currentProject.isGit) {
        status += `Branch: ${escapeHtml(session.currentProject.branch || "main")}\n`;
        status += `Status: ${session.currentProject.status || "unknown"}\n`;
      }
    } else {
      status += `<b>Current Project:</b> None selected\n`;
    }

    if (session.claudeProcess) {
      status += `\n<b>Claude Process:</b>\n`;
      status += `PID: ${session.claudeProcess.pid}\n`;
      status += `Status: ${session.claudeProcess.status}\n`;
      status += `Duration: ${formatRelativeTime(session.claudeProcess.startTime)}\n`;
    }

    const conversationLength = session.conversationHistory.length;
    if (conversationLength > 0) {
      status += `\n<b>Conversation:</b> ${conversationLength} messages\n`;
    }

    await this.bot.sendMessage(chatId, status, { parse_mode: "HTML" });
  }

  /**
   * Handle /cancel command
   */
  private async handleCancel(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;
    const session = this.sessionManager.getSession(chatId);

    if (!session) {
      await this.bot.sendMessage(chatId, "No active session to cancel.");
      return;
    }

    if (session.claudeProcess && session.claudeProcess.status === "running") {
      this.claudeSpawner.killProcess(session.claudeProcess);
      this.sessionManager.setClaudeProcess(chatId, null);
      this.sessionManager.setSessionStatus(chatId, "idle");
      await this.bot.sendMessage(chatId, "Claude process cancelled.");
    } else if (session.pendingApproval) {
      this.sessionManager.setPendingApproval(chatId, null);
      this.sessionManager.setSessionStatus(chatId, "idle");
      await this.bot.sendMessage(chatId, "Pending approval cancelled.");
    } else {
      await this.bot.sendMessage(chatId, "Nothing to cancel.");
    }
  }

  // ===========================================
  // Brain Command Handlers
  // ===========================================

  /**
   * Handle /remember command - Store something in memory
   */
  private async handleRemember(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    if (!args) {
      await this.bot.sendMessage(
        chatId,
        "Usage: /remember <key> <value>\n\nExample: /remember api_key xyz123"
      );
      return;
    }

    const parts = args.split(" ");
    if (parts.length < 2) {
      await this.bot.sendMessage(
        chatId,
        "Usage: /remember <key> <value>\n\nExample: /remember api_key xyz123"
      );
      return;
    }

    const key = parts[0];
    const value = parts.slice(1).join(" ");

    // Store in brain memory
    await getBrain().remember(key, value);

    // Also store in vector store for semantic search
    const memory = getMemoryStore();
    await memory.storeEmbedding(
      `remember-${key}-${Date.now()}`,
      `${key}: ${value}`,
      { type: 'remember', key, chatId }
    );

    await this.bot.sendMessage(
      chatId,
      `${getBrain().getEmoji()} Remembered: <b>${escapeHtml(key)}</b> = <code>${escapeHtml(value)}</code>\n\n💾 Stored in semantic memory - use /semantic to search later.`,
      { parse_mode: "HTML" }
    );
  }

  /**
   * Handle /recall command - Search memory
   */
  private async handleRecall(msg: Message, query?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    if (!query) {
      await this.bot.sendMessage(
        chatId,
        "Usage: /recall <query>\n\nExample: /recall api_key"
      );
      return;
    }

    // Search memory
    const results = await getBrain().searchFacts(query);

    if (results.length === 0) {
      await this.bot.sendMessage(
        chatId,
        `${getBrain().getEmoji()} No memories found matching "<b>${escapeHtml(query)}</b>"`,
        { parse_mode: "HTML" }
      );
      return;
    }

    let response = `${getBrain().getEmoji()} Found <b>${results.length}</b> memories:\n\n`;
    for (const mem of results.slice(0, 5)) {
      response += `• <b>${escapeHtml(mem.key)}</b>: ${escapeHtml(String(mem.value))}\n`;
    }

    await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
  }

  /**
   * Handle /context command - View project context
   */
  private async handleContext(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const session = this.sessionManager.getSession(chatId);

    if (!session?.currentProject) {
      await this.bot.sendMessage(
        chatId,
        "No project selected. Use /select first."
      );
      return;
    }

    const memory = await getMemoryStore().getProjectMemory(session.currentProject.path);

    if (!memory) {
      await this.bot.sendMessage(
        chatId,
        `No context stored for <b>${escapeHtml(session.currentProject.name)}</b> yet.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    let response = `${getBrain().getEmoji()} <b>Project Context: ${escapeHtml(memory.projectName)}</b>\n\n`;

    if (memory.context.description) {
      response += `<b>Description:</b> ${escapeHtml(memory.context.description)}\n\n`;
    }

    if (memory.context.techStack?.length) {
      response += `<b>Tech Stack:</b> ${escapeHtml(memory.context.techStack.join(", "))}\n\n`;
    }

    if (memory.decisions.length > 0) {
      response += `<b>Recent Decisions:</b> ${memory.decisions.length}\n`;
    }

    if (memory.patterns.length > 0) {
      response += `<b>Known Patterns:</b> ${memory.patterns.length}\n`;
    }

    await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
  }

  /**
   * Handle /task command - Create a background task
   */
  private async handleTask(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    if (!args) {
      await this.bot.sendMessage(
        chatId,
        "Usage: /task <description> [--bg]\n\nExample: /task run tests --bg"
      );
      return;
    }

    const isBackground = args.includes("--bg");
    const description = args.replace("--bg", "").trim();

    // Store task in memory
    await getBrain().remember(`task_${Date.now()}`, {
      description,
      chatId,
      background: isBackground,
      status: "pending",
    });

    await this.bot.sendMessage(
      chatId,
      `${getBrain().getEmoji()} Task created: <b>${escapeHtml(description)}</b>${isBackground ? " (background)" : ""}`,
      { parse_mode: "HTML" }
    );
  }

  /**
   * Handle /tasks command - List active tasks
   */
  private async handleTasks(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    // Search for tasks belonging to this chat
    const results = await getBrain().searchFacts(`task_${chatId}`);

    const userTasks = results.filter(r => {
      const val = r.value as Record<string, unknown>;
      return (val.status as string) === "pending";
    });

    if (userTasks.length === 0) {
      await this.bot.sendMessage(
        chatId,
        `${getBrain().getEmoji()} No active tasks.`
      );
      return;
    }

    let response = `${getBrain().getEmoji()} <b>Active Tasks (${userTasks.length}):</b>\n\n`;
    for (const task of userTasks) {
      const val = task.value as Record<string, unknown>;
      response += `• <code>${task.key.slice(-8)}</code> ${escapeHtml(String(val.description))}\n`;
    }

    await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
  }

  /**
   * Handle /agent command - Run a specific agent
   */
  private async handleAgent(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    if (!args) {
      await this.bot.sendMessage(
        chatId,
        `Usage: /agent &lt;type&gt; &lt;task&gt;\n\nAvailable agents:\n• <b>scout</b> - Explore codebase\n• <b>builder</b> - Write code\n• <b>reviewer</b> - Review code\n• <b>tester</b> - Run tests\n• <b>deployer</b> - Deploy`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const parts = args.split(" ");
    const agentType = parts[0];
    const task = parts.slice(1).join(" ");

    const validAgents = ["scout", "builder", "reviewer", "tester", "deployer"];

    if (!validAgents.includes(agentType)) {
      await this.bot.sendMessage(
        chatId,
        `Unknown agent type: <b>${escapeHtml(agentType)}</b>\n\nValid types: ${validAgents.join(", ")}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!task) {
      await this.bot.sendMessage(
        chatId,
        `Usage: /agent ${agentType} <task description>\n\nExample: /agent scout "explore the authentication system"\n\nNote: Builder will write code using Claude CLI (can take a long time)\nReviewer will analyze code for issues\nTester will run your test suite\nDeployer will build and prepare for deployment`
      );
      return;
    }

    const session = this.sessionManager.getSession(chatId);
    if (!session?.currentProject) {
      await this.bot.sendMessage(
        chatId,
        `No project selected. Use /select first.`
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      `${getBrain().getEmoji()} Starting <b>${escapeHtml(agentType)}</b> agent: ${escapeHtml(task)}...\n\n🕐 This may take a while...`,
      { parse_mode: "HTML" }
    );

    // Execute the agent
    try {
      const orchestrator = getOrchestrator();

      // Get the appropriate agent
      const agents = orchestrator.getAgentsByType(agentType as AgentType);
      if (!agents || agents.length === 0) {
        await this.bot.sendMessage(
          chatId,
          `❌ No ${agentType} agent available.`
        );
        return;
      }

      // Create and execute workflow - orchestrate() waits for completion
      const workflow = await orchestrator.orchestrate({
        name: `${agentType} task: ${task.substring(0, 50)}`,
        description: task,
        tasks: [{
          agentId: agents[0].id,
          taskId: generateId(),
          dependencies: [],
          status: 'pending' as const,
          result: { projectPath: session.currentProject.path, task },
        }],
      });

      // Get the result from the completed workflow
      const finalTask = workflow.tasks[0];
      if (!finalTask) {
        await this.bot.sendMessage(
          chatId,
          `❌ No task result found.`
        );
        return;
      }

      const result = finalTask.result as { status: string; findings?: unknown; output?: string; error?: string; summary?: string; duration?: number; environment?: string; steps?: unknown };

      if (finalTask.status === 'failed' || result.error) {
        await this.bot.sendMessage(
          chatId,
          `❌ Agent failed: ${escapeHtml(result.error || 'Unknown error')}`
        );
        return;
      }

      // Format response based on agent type
      let response = `✅ <b>${escapeHtml(agentType)} Agent Complete</b>\n\n`;

      if (agentType === 'scout' && result.findings) {
        const findings = result.findings as { files: number; functions: number; classes: number; tests: number; patterns: string[]; queryResults?: string[] };
        response += `📁 <b>Project Analysis</b>\n`;
        response += `Files: ${findings.files}\n`;
        response += `Functions: ${findings.functions}\n`;
        response += `Classes: ${findings.classes}\n`;
        response += `Tests: ${findings.tests}\n`;
        if (findings.patterns.length > 0) {
          response += `\n<b>Patterns:</b> ${findings.patterns.slice(0, 3).join(', ')}\n`;
        }
        if (findings.queryResults && findings.queryResults.length > 0) {
          response += `\n<b>Query Results:</b>\n${findings.queryResults.join('\n')}\n`;
        }
      } else if (agentType === 'builder' && result.output) {
        response += `📝 <b>Code Changes Made</b>\n\n`;
        response += `<pre>${escapeHtml(result.output)}</pre>\n`;
        response += `\n⏱️ Duration: ${Math.round((result.duration as number) / 1000)}s`;
      } else if (agentType === 'reviewer' && result.findings) {
        const findings = result.findings as { summary: string; issues: Array<{ type: string; message: string }> };
        response += `🔍 <b>Code Review Results</b>\n\n`;
        response += `${findings.summary}\n`;
        if (findings.issues.length > 0 && findings.issues.length <= 10) {
          response += `\n<b>Issues Found:</b>\n`;
          for (const issue of findings.issues) {
            response += `• [${issue.type}] ${escapeHtml(issue.message)}\n`;
          }
        }
      } else if (agentType === 'tester') {
        response += `🧪 <b>Test Results</b>\n\n`;
        response += `${result.summary}\n`;
        if (result.output) {
          response += `\n<pre>${escapeHtml(result.output)}</pre>\n`;
        }
      } else if (agentType === 'deployer') {
        const deployResult = result as { environment: string; steps: Array<{ step: string; status: string; output?: string }> };
        response += `🚀 <b>Deployment</b>\n\n`;
        response += `Environment: ${deployResult.environment}\n\n`;
        for (const step of deployResult.steps) {
          const icon = step.status === 'complete' ? '✅' : step.status === 'failed' ? '❌' : '⏭️';
          response += `${icon} ${step.step}: ${step.output || step.status}\n`;
        }
      } else {
        response += JSON.stringify(result, null, 2);
      }

      await this.bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Agent execution failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`
      );
    }
  }

  /**
   * Handle /git command - Git operations
   */
  private async handleGit(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const session = this.sessionManager.getSession(chatId);

    if (!args) {
      await this.bot.sendMessage(
        chatId,
        `Usage: /git <command>\n\nAvailable:\n• <b>commit</b> - Smart commit with AI message\n• <b>status</b> - Git status\n• <b>log</b> - Recent commits`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!session?.currentProject) {
      await this.bot.sendMessage(
        chatId,
        "No project selected. Use /select first."
      );
      return;
    }

    const subCommand = args.split(" ")[0];

    switch (subCommand) {
      case "commit":
        await this.bot.sendMessage(
          chatId,
          `${getBrain().getEmoji()} Creating smart commit...\n\nThis feature will analyze your changes and generate an appropriate commit message.`
        );
        break;
      case "status":
        await this.bot.sendMessage(
          chatId,
          `${getBrain().getEmoji()} Git status for <b>${escapeHtml(session.currentProject.name)}</b>:\n\nBranch: ${session.currentProject.branch || "main"}\nStatus: ${session.currentProject.status || "unknown"}`,
          { parse_mode: "HTML" }
        );
        break;
      case "log":
        await this.bot.sendMessage(
          chatId,
          `${getBrain().getEmoji()} Recent commits:\n\nThis feature will show recent commit history.`
        );
        break;
      default:
        await this.bot.sendMessage(
          chatId,
          `Unknown git command: <b>${escapeHtml(subCommand)}</b>\n\nAvailable: commit, status, log`,
          { parse_mode: "HTML" }
        );
    }
  }

  /**
   * Handle /metrics command - Show performance metrics
   */
  private async handleMetrics(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    const metrics = await getBrain().getTodayMetrics();
    const brain = getBrain();

    let response = `${brain.getEmoji()} <b>Today's Metrics:</b>\n\n`;
    response += `Tasks Completed: ${metrics.tasksCompleted}\n`;
    response += `Tasks Failed: ${metrics.tasksFailed}\n`;
    response += `Claude Queries: ${metrics.claudeQueries}\n`;
    response += `Files Modified: ${metrics.filesModified}\n`;
    response += `Lines Changed: ${metrics.linesOfCodeChanged}\n`;
    response += `Active Projects: ${metrics.activeProjects.length || 0}\n`;
    response += `Uptime: ${Math.floor(metrics.uptimeMs / 60000)}m\n`;

    await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
  }

  /**
   * Handle /logs command - View log files
   * Usage: /logs [type] [lines]
   * Types: app, error, audit (default: app)
   * Lines: number of lines to show (default: 20)
   */
  private async handleLogs(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    // Parse arguments
    let logType: 'app' | 'error' | 'audit' = 'app';
    let lineCount = 20;

    if (args) {
      const parts = args.trim().split(/\s+/);
      for (const part of parts) {
        if (part === 'app' || part === 'error' || part === 'audit') {
          logType = part;
        } else if (/^\d+$/.test(part)) {
          lineCount = Math.min(Math.max(parseInt(part, 10), 1), 100); // Limit 1-100
        }
      }
    }

    try {
      // Import log functions
      const { getRecentLogs, getLogsDir } = await import('./utils.js');

      const logs = await getRecentLogs(logType, lineCount);

      if (logs.length === 0) {
        await this.bot.sendMessage(
          chatId,
          `📋 No ${logType} logs found for today.\n\nLog directory: ${getLogsDir()}`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // Build response
      let response = `📋 <b>Recent ${logType.toUpperCase()} Logs</b> (${logs.length} lines):\n\n`;

      // Show last N lines (most recent first)
      const recentLogs = logs.slice(-lineCount).reverse();

      for (const log of recentLogs) {
        // Parse JSON log and format nicely
        try {
          const parsed = JSON.parse(log);
          const timestamp = parsed.timestamp || parsed.time || '?';
          const level = parsed.level || 'info';
          const message = parsed.message || log;

          // Truncate long messages
          const truncatedMessage = message.length > 150 ? message.slice(0, 150) + '...' : message;

          response += `<code>[${timestamp}] [${level.toUpperCase()}]</code> ${escapeHtml(truncatedMessage)}\n`;
        } catch {
          // Not JSON, just show as-is (truncated)
          const truncated = log.length > 150 ? log.slice(0, 150) + '...' : log;
          response += `<code>${escapeHtml(truncated)}</code>\n`;
        }
      }

      // Split into chunks if too long
      const chunks = this.chunkLogResponse(response);

      for (const chunk of chunks) {
        await this.bot.sendMessage(chatId, chunk, { parse_mode: "HTML" });
      }
    } catch (error) {
      this.logger.error('Error fetching logs', { error });
      await this.bot.sendMessage(
        chatId,
        `❌ Error fetching logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Split a response into chunks to avoid Telegram message size limits
   */
  private chunkLogResponse(response: string, maxSize = 4000): string[] {
    const chunks: string[] = [];
    const lines = response.split('\n');
    let currentChunk = '';

    for (const line of lines) {
      const testChunk = currentChunk + (currentChunk ? '\n' : '') + line;

      if (testChunk.length > maxSize) {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = line;

        // If a single line is too long, split it
        while (currentChunk.length > maxSize) {
          chunks.push(currentChunk.slice(0, maxSize));
          currentChunk = currentChunk.slice(maxSize);
        }
      } else {
        currentChunk = testChunk;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Handle /state command - View system state and checkpoints
   */
  private async handleState(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    try {
      // Get checkpoint info
      const { getCheckpointManager } = await import('./brain/checkpoint/index.js');
      const checkpointMgr = getCheckpointManager();
      const checkpointInfo = await checkpointMgr.getCheckpointInfo();

      // Get database stats
      const { getDatabaseManager } = await import('./brain/database/index.js');
      const dbMgr = getDatabaseManager();
      const dbStats = dbMgr.getStats();

      // Get metrics
      const { getBrain } = await import('./brain/brain-manager.js');
      const metrics = await getBrain().getTodayMetrics();

      let response = `📊 <b>System State</b>\n\n`;

      response += `<b>📁 Checkpoints:</b> ${checkpointInfo.count}\n`;
      if (checkpointInfo.lastCheckpointAge !== null) {
        const age = Math.floor(checkpointInfo.lastCheckpointAge / 1000);
        response += `Last: ${age}s ago\n`;
      }

      response += `<b>🗄️ Database:</b>\n`;
      response += `  Sessions: ${dbStats.sessionsCount}\n`;
      response += `  Tasks: ${dbStats.tasksCount}\n`;
      response += `  Audit logs: ${dbStats.auditCount}\n`;
      response += `  Decisions: ${dbStats.decisionsCount}\n`;
      response += `  Size: ${(dbStats.dbSize / 1024).toFixed(1)} KB\n`;

      response += `<b>📈 Metrics (Today):</b>\n`;
      response += `  Tasks: ${metrics.tasksCompleted} done, ${metrics.tasksFailed} failed\n`;
      response += `  Queries: ${metrics.claudeQueries}\n`;
      response += `  Files: ${metrics.filesModified} modified\n`;
      response += `  Uptime: ${Math.floor(metrics.uptimeMs / 60000)}m\n`;

      await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
    } catch (error) {
      this.logger.error('Error fetching state', { error });
      await this.bot.sendMessage(
        chatId,
        `❌ Error fetching state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /recovery command - View crash recovery info
   */
  private async handleRecovery(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    try {
      const { getRecoveryManager } = await import('./brain/recovery/index.js');
      const recoveryMgr = getRecoveryManager();
      const info = await recoveryMgr.getRecoveryInfo();

      let response = `🔄 <b>Recovery Status</b>\n\n`;

      if (info.lastHeartbeat) {
        response += `<b>Current Heartbeat:</b>\n`;
        response += `  PID: ${info.lastHeartbeat.pid}\n`;
        response += `  Status: ${info.lastHeartbeat.status}\n`;
        response += `  Uptime: ${Math.floor(info.lastHeartbeat.uptime / 1000)}s\n`;
        response += `  Active sessions: ${info.lastHeartbeat.activeSessions}\n`;
        response += `  Active tasks: ${info.lastHeartbeat.activeTasks}\n`;
      } else {
        response += `<b>Heartbeat:</b> Not active\n`;
      }

      if (info.hasUncleanShutdown) {
        response += `\n⚠️ <b>Unclean shutdown detected!</b>\n`;
        response += `Time since heartbeat: ${Math.floor((info.timeSinceHeartbeat || 0) / 1000)}s\n`;
      }

      response += `\n<b>Crash Reports:</b> ${info.crashReports.length}\n`;
      if (info.crashReports.length > 0) {
        response += `Recent crashes:\n`;
        for (const crash of info.crashReports.slice(0, 3)) {
          const date = new Date(crash.timestamp).toLocaleString();
          response += `  • ${date} - ${crash.crashReason}\n`;
        }
      }

      await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
    } catch (error) {
      this.logger.error('Error fetching recovery info', { error });
      await this.bot.sendMessage(
        chatId,
        `❌ Error fetching recovery info: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /export command - Export state data
   */
  private async handleExport(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    try {
      const { getDatabaseManager } = await import('./brain/database/index.js');
      const dbMgr = getDatabaseManager();

      const jsonData = dbMgr.exportToJson();

      // Save to file
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const exportPath = join(process.cwd(), 'brain', `export-${Date.now()}.json`);

      await writeFile(exportPath, jsonData, 'utf-8');

      await this.bot.sendMessage(
        chatId,
        `📤 State exported to:\n${escapeHtml(exportPath)}\n\nSize: ${(jsonData.length / 1024).toFixed(1)} KB`
      );
    } catch (error) {
      this.logger.error('Error exporting state', { error });
      await this.bot.sendMessage(
        chatId,
        `❌ Error exporting state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /profile command - View/edit user profile
   */
  private async handleProfile(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const brain = getBrain();
    const identityManager = getIdentityManager();

    // Handle setting location
    if (args) {
      const parts = args.split(' ');
      if (parts[0] === 'location' && parts.length > 1) {
        const location = parts.slice(1).join(' ');
        const preferences = identityManager.getPreferences();
        preferences.user.location = location;
        await identityManager.updatePreferences(preferences);
        await this.bot.sendMessage(chatId, `✅ Location updated to: ${escapeHtml(location)}`);
        return;
      }
    }

    const identity = brain.getIdentity();
    const personality = brain.getPersonality();
    const preferences = brain.getPreferences();

    let response = `${identity.emoji} <b>Profile</b>\n\n`;
    response += `<b>Bot Name:</b> ${escapeHtml(identity.name)} ${identity.emoji}\n`;
    response += `<b>User:</b> ${escapeHtml(brain.getUserName())}\n`;
    response += `<b>Timezone:</b> ${escapeHtml(brain.getTimezone())}\n`;
    response += `<b>Location:</b> ${escapeHtml(preferences.user?.location || 'Not set (default: Kos,Greece)')}\n\n`;

    response += `<b>Communication:</b>\n`;
    response += `• Style: ${escapeHtml(personality.communication.style)}\n`;
    response += `• Tone: ${escapeHtml(personality.communication.tone)}\n\n`;

    response += `<b>Languages:</b> ${personality.coding.languages.map(escapeHtml).join(", ")}\n\n`;

    response += `<b>Git:</b>\n`;
    response += `• Default branch: ${escapeHtml(preferences.git.defaultBranch)}\n`;
    response += `• Commit style: ${escapeHtml(preferences.git.commitMessageStyle)}\n\n`;

    response += `<b>Set Location:</b>\n`;
    response += `• Use: /profile location &lt;city,country&gt;\n`;
    response += `• Example: /profile location New York,USA`;

    await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
  }

  /**
   * Handle /agents command - Show running agents
   */
  private async handleAgents(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    try {
      const orchestrator = getOrchestrator();
      const agents = orchestrator.getAllAgents();

      if (agents.length === 0) {
        await this.bot.sendMessage(chatId, "No agents configured");
        return;
      }

      const response = agents
        .map((a: any) => `<b>${escapeHtml(a.type)}</b>: ${escapeHtml(a.status)}`)
        .join("\n");

      await this.bot.sendMessage(chatId, `<b>Available Agents:</b>\n\n${response}`, { parse_mode: "HTML" });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to list agents: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /schedule command - Schedule a task with cron
   */
  private async handleSchedule(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    // Extract cron pattern and task description
    const match = text?.match(/\/schedule\s+"([^"]+)"\s+(.+)/);

    if (!match) {
      await this.bot.sendMessage(
        chatId,
        "Usage: /schedule \"<cron>\" <task>\n" +
        "Example: /schedule \"0 2 * * *\" Run nightly backup\n" +
        "Cron format: minute hour day month weekday"
      );
      return;
    }

    const [, cron, taskDesc] = match;

    try {
      const taskQueue = getTaskQueue();
      await taskQueue.addSchedule({
        cronExpression: cron,
        enabled: true,
        task: {
          type: "custom",
          title: taskDesc.split(" ").slice(0, 5).join(" "),
          description: taskDesc,
          priority: "medium",
          status: "pending",
          chatId,
        },
      });

      await this.bot.sendMessage(chatId, `✅ Scheduled:\n${taskDesc}\nCron: ${cron}`);
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to schedule: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /schedules command - List scheduled tasks
   */
  private async handleSchedules(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    try {
      const taskQueue = getTaskQueue();
      const schedules = taskQueue.getSchedules();

      if (schedules.length === 0) {
        await this.bot.sendMessage(chatId, "No scheduled tasks");
        return;
      }

      const response = schedules
        .map((s: any) => `<b>${escapeHtml(s.id)}</b>\n${escapeHtml(s.cronExpression)}\n${escapeHtml(s.task.description)}`)
        .join("\n\n");

      await this.bot.sendMessage(chatId, `<b>Scheduled Tasks:</b>\n\n${response}`, { parse_mode: "HTML" });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to list schedules: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /watch command - Watch project for test failures
   * Usage: /watch <start|stop|status> [project]
   */
  private async handleWatch(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const session = this.sessionManager.getSession(chatId);

    if (!args) {
      await this.bot.sendMessage(
        chatId,
        `Usage: /watch <start|stop|status>\n\n• <b>start</b> - Start watching current project\n• <b>stop</b> - Stop watching\n• <b>status</b> - Show watch status`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const parts = args.trim().split(/\s+/);
    const action = parts[0].toLowerCase();

    const testWatcher = getTestWatcher();
    await testWatcher.initialize();

    if (action === "start") {
      if (!session?.currentProject) {
        await this.bot.sendMessage(chatId, "No project selected. Use /select first.");
        return;
      }

      try {
        await testWatcher.startWatcher(
          session.currentProject.path,
          session.currentProject.name,
          chatId
        );

        await this.bot.sendMessage(
          chatId,
          `👀 Now watching <b>${escapeHtml(session.currentProject.name)}</b> for test failures.\n\nTests will run automatically when files change.`,
          { parse_mode: "HTML" }
        );
      } catch (error) {
        await this.bot.sendMessage(
          chatId,
          `❌ Failed to start watcher: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else if (action === "stop") {
      if (!session?.currentProject) {
        await this.bot.sendMessage(chatId, "No project selected.");
        return;
      }

      const stopped = await testWatcher.stopWatcher(session.currentProject.path, chatId);

      if (stopped) {
        await this.bot.sendMessage(
          chatId,
          `⏹️ Stopped watching <b>${escapeHtml(session.currentProject.name)}</b>`,
          { parse_mode: "HTML" }
        );
      } else {
        await this.bot.sendMessage(chatId, "No active watcher for this project.");
      }
    } else if (action === "status") {
      const watchers = testWatcher.getWatchersForChat(chatId);

      if (watchers.length === 0) {
        await this.bot.sendMessage(chatId, "No active watchers.");
        return;
      }

      let response = `👀 <b>Active Watchers (${watchers.length}):</b>\n\n`;

      for (const watcher of watchers) {
        const lastRun = watcher.lastRunAt
          ? `Last run: ${formatRelativeTime(Date.now() - watcher.lastRunAt)} ago`
          : "Not run yet";

        let resultInfo = "";
        if (watcher.lastResult) {
          const r = watcher.lastResult;
          resultInfo = `\nResult: ✅ ${r.passed} passed, ❌ ${r.failed} failed (${Math.round(r.duration / 1000)}s)`;
        }

        response += `• <b>${escapeHtml(watcher.projectName)}</b>\n`;
        response += `  Status: ${watcher.status}\n`;
        response += `  ${lastRun}${resultInfo}\n\n`;
      }

      await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
    } else {
      await this.bot.sendMessage(
        chatId,
        `Unknown action: <b>${escapeHtml(action)}</b>\n\nUse: start, stop, or status`,
        { parse_mode: "HTML" }
      );
    }
  }

  /**
   * Handle /notifications command - Manage notification preferences
   * Usage: /notifications <status|enable|disable|digest|types|quiet>
   */
  private async handleNotifications(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const router = getNotificationRouter();
    await router.initialize();

    if (!args) {
      const prefs = router.getPreferences(chatId);
      const types = prefs.types;

      let response = `🔔 <b>Notification Settings</b>\n\n`;
      response += `Status: ${prefs.enabled ? '✅ Enabled' : '❌ Disabled'}\n\n`;

      response += `<b>Notification Types:</b>\n`;
      for (const [type, enabled] of Object.entries(types)) {
        response += `  ${enabled ? '✅' : '❌'} ${type}\n`;
      }

      if (prefs.quietHoursStart !== undefined) {
        response += `\n<b>Quiet Hours:</b> ${prefs.quietHoursStart}:00 - ${prefs.quietHoursEnd}:00\n`;
      }

      if (prefs.minimumImmediatePriority) {
        response += `<b>Min Priority:</b> ${prefs.minimumImmediatePriority}\n`;
      }

      response += `\n<b>Digest:</b> ${prefs.digestEnabled ? '✅ Every ' + prefs.digestInterval + ' min' : '❌ Disabled'}\n`;

      response += `\n<b>Actions:</b>\n`;
      response += `/notifications enable|disable - Toggle notifications\n`;
      response += `/notifications types - Toggle specific types\n`;
      response += `/notifications digest <min> - Set digest interval\n`;
      response += `/notifications quiet <start> <end> - Set quiet hours`;

      await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      return;
    }

    const parts = args.trim().split(/\s+/);
    const action = parts[0].toLowerCase();

    if (action === "enable") {
      const prefs = router.getPreferences(chatId);
      prefs.enabled = true;
      await router.setPreferences(prefs);
      await this.bot.sendMessage(chatId, "✅ Notifications enabled");
    } else if (action === "disable") {
      const prefs = router.getPreferences(chatId);
      prefs.enabled = false;
      await router.setPreferences(prefs);
      await this.bot.sendMessage(chatId, "❌ Notifications disabled");
    } else if (action === "types") {
      if (parts.length < 3) {
        await this.bot.sendMessage(
          chatId,
          `Usage: /notifications types <type> <on|off>\n\nTypes: error, security, deployment, test, lint, info, success`
        );
        return;
      }

      const type = parts[1] as NotificationType;
      const enabled = parts[2].toLowerCase() === "on" || parts[2].toLowerCase() === "enable";

      const validTypes: NotificationType[] = ['error', 'security', 'deployment', 'test', 'lint', 'info', 'success'];

      if (!validTypes.includes(type)) {
        await this.bot.sendMessage(chatId, `❌ Invalid type. Valid types: ${validTypes.join(', ')}`);
        return;
      }

      await router.setNotificationType(chatId, type, enabled);
      await this.bot.sendMessage(chatId, `✅ ${type} notifications ${enabled ? 'enabled' : 'disabled'}`);
    } else if (action === "digest") {
      if (parts.length < 2) {
        await this.bot.sendMessage(chatId, "Usage: /notifications digest <minutes>");
        return;
      }

      const interval = parseInt(parts[1], 10);
      if (isNaN(interval) || interval < 5 || interval > 1440) {
        await this.bot.sendMessage(chatId, "❌ Invalid interval. Use 5-1440 minutes");
        return;
      }

      const prefs = router.getPreferences(chatId);
      prefs.digestEnabled = true;
      prefs.digestInterval = interval;
      await router.setPreferences(prefs);
      await this.bot.sendMessage(chatId, `✅ Digest interval set to ${interval} minutes`);
    } else if (action === "quiet") {
      if (parts.length < 3) {
        await this.bot.sendMessage(chatId, "Usage: /notifications quiet <start_hour> <end_hour>\nExample: /notifications quiet 22 7");
        return;
      }

      const start = parseInt(parts[1], 10);
      const end = parseInt(parts[2], 10);

      if (isNaN(start) || isNaN(end) || start < 0 || start > 23 || end < 0 || end > 23) {
        await this.bot.sendMessage(chatId, "❌ Invalid hours. Use 0-23");
        return;
      }

      await router.setQuietHours(chatId, start, end);
      await this.bot.sendMessage(chatId, `✅ Quiet hours set to ${start}:00 - ${end}:00`);
    } else {
      await this.bot.sendMessage(
        chatId,
        `Unknown action: <b>${escapeHtml(action)}</b>\n\nUse: status, enable, disable, types, digest, quiet`,
        { parse_mode: "HTML" }
      );
    }
  }

  /**
   * Handle /analyze command - Analyze code quality
   * Usage: /analyze [complexity|security|duplication|dependencies|all]
   */
  private async handleAnalyze(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const session = this.sessionManager.getSession(chatId);

    if (!session?.currentProject) {
      await this.bot.sendMessage(chatId, "No project selected. Use /select first.");
      return;
    }

    const analysisType = args?.toLowerCase() || 'summary';

    await this.bot.sendMessage(
      chatId,
      `🔍 Analyzing <b>${escapeHtml(session.currentProject.name)}</b> for ${escapeHtml(analysisType)}...\n\nThis may take a moment...`,
      { parse_mode: "HTML" }
    );

    try {
      const analyzer = getCodeAnalyzer();
      const report = await analyzer.analyzeProject(session.currentProject.path);

      let response = `📊 <b>Code Analysis Report</b>\n\n`;
      response += `<b>Project:</b> ${escapeHtml(session.currentProject.name)}\n`;
      response += `<b>Analyzed:</b> ${report.summary.totalFiles} files\n\n`;

      // Summary section
      response += `<b>Summary:</b>\n`;
      response += `• High complexity files: ${report.summary.highComplexityFiles}\n`;
      response += `• Security issues: ${report.summary.securityIssues}\n`;
      response += `• Critical security: ${report.summary.criticalSecurityIssues}\n`;
      response += `• Duplication rate: ${report.summary.duplicationRate.toFixed(1)}%\n\n`;

      // Type-specific details
      if (analysisType === 'all' || analysisType === 'complexity') {
        response += `<b>Complexity Analysis:</b>\n`;
        const highComplexityFiles = report.complexity.filter(c => c.rating === 'high' || c.rating === 'very-high').slice(0, 5);
        for (const file of highComplexityFiles) {
          response += `• ${escapeHtml(file.file)}: ${file.complexity.toFixed(1)} avg (${file.rating})\n`;
        }
        if (report.complexity.length > 5) {
          response += `  ... and ${report.complexity.length - 5} more\n`;
        }
        response += '\n';
      }

      if (analysisType === 'all' || analysisType === 'security') {
        response += `<b>Security Issues:</b>\n`;
        for (const file of report.security.slice(0, 5)) {
          const critical = file.issues.filter(i => i.severity === 'critical').length;
          const high = file.issues.filter(i => i.severity === 'high').length;
          response += `• ${escapeHtml(file.file)}: ${file.issues.length} issues (Critical: ${critical}, High: ${high})\n`;
        }
        if (report.security.length > 5) {
          response += `  ... and ${report.security.length - 5} more files\n`;
        }
        if (report.security.length === 0) {
          response += `No security issues found!\n`;
        }
        response += '\n';
      }

      if (analysisType === 'all' || analysisType === 'duplication') {
        response += `<b>Code Duplication:</b>\n`;
        response += `• Duplicate lines: ${report.duplication.totalDuplicateLines}\n`;
        response += `• Duplication rate: ${report.duplication.duplicationPercentage.toFixed(1)}%\n`;
        if (report.duplication.duplicates.length > 0) {
          response += `• Found ${report.duplication.duplicates.length} duplicate fragments\n`;
        }
        response += '\n';
      }

      if (analysisType === 'all' || analysisType === 'dependencies') {
        response += `<b>Dependencies:</b>\n`;
        response += `• Total: ${report.dependencies.dependencyCount}\n`;
        response += `• With vulnerabilities: ${report.dependencies.dependencies.filter(d => (d.vulnerabilities || 0) > 0).length}\n`;
        response += `• Package lock: ${report.dependencies.hasPackageLock ? '✅' : '❌'}\n\n`;
      }

      // Recommendations
      if (report.recommendations.length > 0) {
        response += `<b>Recommendations:</b>\n`;
        for (const rec of report.recommendations.slice(0, 5)) {
          response += `• ${escapeHtml(rec)}\n`;
        }
        response += '\n';
      }

      // Send in chunks if too long
      const messages = chunkMessage(response, 4000);
      for (const msgChunk of messages) {
        await this.bot.sendMessage(chatId, msgChunk, { parse_mode: "HTML" });
      }
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Analysis failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`
      );
    }
  }

  /**
   * Handle /learn command - Learn code patterns
   * Usage: /learn [analyze|suggest|show]
   */
  private async handleLearn(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const session = this.sessionManager.getSession(chatId);

    if (!session?.currentProject) {
      await this.bot.sendMessage(chatId, "No project selected. Use /select first.");
      return;
    }

    const action = args?.toLowerCase() || 'show';

    const learner = getPatternLearner();

    if (action === 'analyze') {
      await this.bot.sendMessage(
        chatId,
        `🧠 Analyzing <b>${escapeHtml(session.currentProject.name)}</b> for patterns...\n\nThis may take a moment...`,
        { parse_mode: "HTML" }
      );

      try {
        const patterns = await learner.learnPatterns(session.currentProject.path);

        let response = `📚 <b>Learned Patterns</b>\n\n`;
        response += `<b>Project:</b> ${escapeHtml(session.currentProject.name)}\n`;
        response += `<b>Analyzed:</b> ${new Date(patterns.lastAnalyzed).toLocaleString()}\n\n`;

        // Naming conventions
        const uniqueConventions = new Set(Array.from(patterns.namingConventions.values()).map(c => c.type));
        if (uniqueConventions.size > 0) {
          response += `<b>Naming Conventions:</b> ${Array.from(uniqueConventions).join(', ')}\n\n`;
        }

        // Top libraries
        const topLibs = Array.from(patterns.libraries.values())
          .sort((a, b) => b.importCount - a.importCount)
          .slice(0, 10);

        if (topLibs.length > 0) {
          response += `<b>Top Libraries:</b>\n`;
          for (const lib of topLibs) {
            response += `• ${escapeHtml(lib.name)} (${lib.importCount} imports)\n`;
          }
          response += '\n';
        }

        // Code structures
        if (patterns.structures.length > 0) {
          response += `<b>Code Structures:</b>\n`;
          const uniqueStructures = patterns.structures.slice(0, 8);
          for (const struct of uniqueStructures) {
            response += `• ${escapeHtml(struct.description)}\n`;
          }
          response += '\n';
        }

        // Workflows
        if (patterns.workflows.length > 0) {
          response += `<b>Detected Workflows:</b>\n`;
          for (const wf of patterns.workflows) {
            response += `• ${escapeHtml(wf.name)}: ${escapeHtml(wf.description)} (${Math.round(wf.confidence * 100)}% confidence)\n`;
          }
        }

        await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      } catch (error) {
        await this.bot.sendMessage(
          chatId,
          `❌ Learning failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`
        );
      }
    } else if (action === 'suggest') {
      try {
        const suggestion = await learner.generateCodeSuggestion(session.currentProject.path, 'general');

        await this.bot.sendMessage(
          chatId,
          `💡 <b>Code Suggestions for ${escapeHtml(session.currentProject.name)}</b>\n\n<pre>${escapeHtml(suggestion)}</pre>`,
          { parse_mode: "HTML" }
        );
      } catch (error) {
        await this.bot.sendMessage(
          chatId,
          `❌ Failed to generate suggestions: ${escapeHtml(error instanceof Error ? error.message : String(error))}`
        );
      }
    } else {
      // Show learned patterns
      try {
        const patterns = await learner.getPatterns(session.currentProject.path);

        if (!patterns) {
          await this.bot.sendMessage(
            chatId,
            `No patterns learned yet for <b>${escapeHtml(session.currentProject.name)}</b>.\n\nUse /learn analyze to start learning.`
          );
          return;
        }

        let response = `📚 <b>Stored Patterns</b>\n\n`;
        response += `<b>Project:</b> ${escapeHtml(session.currentProject.name)}\n`;
        response += `<b>Last Analyzed:</b> ${formatRelativeTime(Date.now() - patterns.lastAnalyzed)} ago\n\n`;

        // Naming conventions
        response += `<b>Naming Conventions:</b>\n`;
        const uniqueConventions = Array.from(patterns.namingConventions.values())
          .reduce((acc, c) => acc.set(c.type, Math.max(acc.get(c.type) || 0, c.confidence)), new Map());

        for (const [type, confidence] of uniqueConventions) {
          response += `• ${type} (${confidence} uses)\n`;
        }

        // Top libraries
        const topLibs = Array.from(patterns.libraries.values())
          .sort((a, b) => b.importCount - a.importCount)
          .slice(0, 5);

        if (topLibs.length > 0) {
          response += `\n<b>Top Libraries:</b>\n`;
          for (const lib of topLibs) {
            response += `• ${escapeHtml(lib.name)}\n`;
          }
        }

        response += `\n<b>Actions:</b>\n`;
        response += `/learn analyze - Re-analyze codebase\n`;
        response += `/learn suggest - Get code suggestions`;

        await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      } catch (error) {
        await this.bot.sendMessage(
          chatId,
          `❌ Failed to load patterns: ${escapeHtml(error instanceof Error ? error.message : String(error))}`
        );
      }
    }
  }

  /**
   * Handle /heartbeat command - Run heartbeat check manually
   */
  private async handleHeartbeat(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    try {
      await this.bot.sendMessage(chatId, "💓 Running heartbeat check...");

      const memory = getMemoryStore();
      const projectsPath = memory.getFactTyped<string>("projects-base") || process.cwd();

      const result = await runHeartbeat(projectsPath);

      if (result.success) {
        await this.bot.sendMessage(chatId, `✅ ${result.output || "Heartbeat complete - no issues detected"}`);
      } else {
        await this.bot.sendMessage(chatId, `⚠️ ${result.output || result.error || "Heartbeat detected issues"}`);
      }
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /briefing command - Generate daily briefing
   */
  private async handleBriefing(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    try {
      await this.bot.sendMessage(chatId, "📋 Generating briefing...");

      const identityManager = getIdentityManager();
      const preferences = identityManager.getPreferences();
      const location = preferences.user?.location || "Kos,Greece";

      const { generateBriefing, logBriefing } = await import("./brain/scripts/briefing-worker.js");
      const briefing = await generateBriefing(location);

      if (briefing.success) {
        // Send in chunks if too long
        const message = briefing.message;
        if (message.length > 4000) {
          const chunks = message.match(/[\s\S]{1,4000}/g) || [];
          for (const chunk of chunks) {
            await this.bot.sendMessage(chatId, chunk, { parse_mode: "HTML" });
          }
        } else {
          await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
        }

        // Log to memory
        await logBriefing(message);
      } else {
        await this.bot.sendMessage(chatId, "❌ Failed to generate briefing");
      }
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Briefing failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /checks command - Run proactive checks
   */
  private async handleChecks(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    try {
      await this.bot.sendMessage(chatId, "🔍 Running proactive checks...");

      const memory = getMemoryStore();
      const projectsPath = memory.getFactTyped<string>("projects-base") || process.cwd();

      const result = await runProactiveChecksWorker(projectsPath);

      if (result.success) {
        await this.bot.sendMessage(chatId, `✅ ${result.output || "No issues found"}`);
      } else {
        await this.bot.sendMessage(chatId, `⚠️ ${result.output || result.error || "Checks completed with alerts"}`);
      }
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Checks failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /self-review command - View learning log
   */
  private async handleSelfReview(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    const chatId = msg.chat.id;

    try {
      const status = await getHeartbeatStatus();

      let response = `📝 Self-Review Learning Log\n\n`;

      if (status.lastRun) {
        response += `Last Heartbeat: ${status.lastRun}\n`;
      }

      if (status.needsAttention) {
        response += `\n⚠️ Attention Required: Recent alerts detected\n`;
      } else {
        response += `\n✅ No recent alerts\n`;
      }

      response += `\nRecent Entries (last 5):\n`;

      if (status.recentEntries.length === 0) {
        response += `\nNo entries yet. The learning log will populate as the AI identifies patterns and improvements.`;
      } else {
        for (const entry of status.recentEntries) {
          const lines = entry.split("\n").slice(0, 4).join("\n");
          response += `\n${lines}\n`;
          if (entry.length > 200) {
            response += `...\n`;
          }
        }
      }

      // Send without parse_mode to avoid HTML parsing issues with <tags> in entries
      await this.bot.sendMessage(chatId, response);
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to load self-review: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /semantic command - Semantic memory search
   */
  private async handleSemanticSearch(msg: Message, query?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const memory = getMemoryStore();

    if (!query) {
      await this.bot.sendMessage(
        chatId,
        `Usage: /semantic <query>\n\nExample: /semantic how do I handle authentication?\n\nThis searches your memory using semantic similarity, finding related content even without exact keyword matches.`
      );
      return;
    }

    try {
      const results = await memory.semanticSearch(query, 5);

      if (results.length === 0) {
        await this.bot.sendMessage(
          chatId,
          `🔍 No semantic matches found for "<b>${escapeHtml(query)}</b>"\n\nTip: Use /remember to store more information in memory.`
        );
        return;
      }

      let response = `🔍 <b>Semantic Search: "${escapeHtml(query)}"</b>\n\n`;
      response += `Found <b>${results.length}</b> similar memories:\n\n`;

      for (const result of results) {
        const percent = Math.round(result.similarity * 100);
        response += `<b>[${percent}%]</b> ${escapeHtml(result.text.substring(0, 100))}${result.text.length > 100 ? '...' : ''}\n`;
        if (result.metadata?.source) {
          response += `   📁 Source: ${escapeHtml(String(result.metadata.source))}\n`;
        }
        response += `\n`;
      }

      await this.bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Semantic search failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /index command - Index project for context awareness
   */
  private async handleIndex(msg: Message, args?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const memory = getMemoryStore();

    // Get project path from args or memory
    let projectPath = args || memory.getFactTyped<string>('current-project');

    if (!projectPath) {
      await this.bot.sendMessage(
        chatId,
        `No project path specified.\n\n` +
        `Usage: /index <project-path>\n` +
        `Or first set: /remember current-project <path>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    try {
      const indexer = getContextIndexer();
      await this.bot.sendMessage(chatId, `🔍 Indexing project: ${projectPath}...`);

      const fingerprint = await indexer.indexProject(projectPath);

      const languageList = Object.entries(fingerprint.languages)
        .map(([lang, count]) => `${lang}: ${count}`)
        .join(', ');

      const response =
        `✅ <b>Index Complete</b>\n\n` +
        `<b>Project:</b> ${fingerprint.projectName}\n` +
        `<b>Files:</b> ${fingerprint.fileCount}\n` +
        `<b>Lines:</b> ${fingerprint.totalLines.toLocaleString()}\n` +
        `<b>Languages:</b> ${languageList}\n\n` +
        `<b>Entry Points:</b> ${fingerprint.structure.entryPoints.length}\n` +
        `<b>Test Files:</b> ${fingerprint.structure.testFiles.length}\n` +
        `<b>Config Files:</b> ${fingerprint.structure.configFiles.length}\n\n` +
        `Now use /search <query> to find code!`;

      await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to index: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /search command - Search indexed code
   */
  private async handleSearch(msg: Message, query?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    if (!query) {
      await this.bot.sendMessage(
        chatId,
        `Usage: /search <query>\n\nExample: /search authentication`
      );
      return;
    }

    try {
      const memory = getMemoryStore();
      const projectPath = memory.getFactTyped<string>('current-project');

      if (!projectPath) {
        await this.bot.sendMessage(
          chatId,
          `No project set.\n\nUse: /remember current-project <path>\nThen run: /index`
        );
        return;
      }

      const indexer = getContextIndexer();
      const result = indexer.getContext(projectPath, query);

      if (result.files.length === 0) {
        await this.bot.sendMessage(
          chatId,
          `No results found for "<b>${escapeHtml(query)}</b>"\n\nMake sure to run /index first!`,
          { parse_mode: "HTML" }
        );
        return;
      }

      let response = `🔍 <b>Search: "${escapeHtml(query)}"</b>\n\n`;
      response += `${result.summary}\n\n`;

      // Show matching files (limit to 10)
      response += `<b>Files:</b>\n`;
      for (const file of result.files.slice(0, 10)) {
        response += `• <code>${escapeHtml(file.relativePath)}</code>\n`;
        if (file.exports && file.exports.length > 0) {
          response += `  exports: ${escapeHtml(file.exports.slice(0, 3).join(', '))}\n`;
        }
        if (file.classes && file.classes.length > 0) {
          response += `  classes: ${escapeHtml(file.classes.join(', '))}\n`;
        }
      }

      if (result.symbols.length > 0) {
        response += `\n<b>Symbols:</b>\n`;
        response += escapeHtml(result.symbols.slice(0, 10).join(', '));
      }

      await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to search: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle /file command - Get file info from index
   */
  private async handleFileInfo(msg: Message, relativePath?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;

    if (!relativePath) {
      await this.bot.sendMessage(
        chatId,
        `Usage: /file <relative-path>\n\nExample: /file src/auth/login.ts`
      );
      return;
    }

    try {
      const memory = getMemoryStore();
      const projectPath = memory.getFactTyped<string>('current-project');

      if (!projectPath) {
        await this.bot.sendMessage(
          chatId,
          `No project set.\n\nUse: /remember current-project <path>`
        );
        return;
      }

      const indexer = getContextIndexer();
      const fileInfo = indexer.getFileInfo(projectPath, relativePath);

      if (!fileInfo) {
        await this.bot.sendMessage(
          chatId,
          `File not found: <b>${escapeHtml(relativePath)}</b>\n\nMake sure to run /index first!`,
          { parse_mode: "HTML" }
        );
        return;
      }

      let response = `📄 <b>${escapeHtml(fileInfo.relativePath)}</b>\n\n`;
      response += `<b>Language:</b> ${fileInfo.language}\n`;
      response += `<b>Lines:</b> ${fileInfo.lineCount}\n`;
      response += `<b>Size:</b> ${(fileInfo.size / 1024).toFixed(1)} KB\n`;
      response += `<b>Modified:</b> ${new Date(fileInfo.modified).toLocaleString()}\n\n`;

      if (fileInfo.exports && fileInfo.exports.length > 0) {
        response += `<b>Exports:</b> ${escapeHtml(fileInfo.exports.join(', '))}\n`;
      }
      if (fileInfo.imports && fileInfo.imports.length > 0) {
        response += `<b>Imports:</b> ${escapeHtml(fileInfo.imports.slice(0, 5).join(', '))}\n`;
      }
      if (fileInfo.classes && fileInfo.classes.length > 0) {
        response += `<b>Classes:</b> ${escapeHtml(fileInfo.classes.join(', '))}\n`;
      }
      if (fileInfo.functions && fileInfo.functions.length > 0) {
        response += `<b>Functions:</b> ${escapeHtml(fileInfo.functions.slice(0, 10).join(', '))}\n`;
      }
      if (fileInfo.types && fileInfo.types.length > 0) {
        response += `<b>Types:</b> ${escapeHtml(fileInfo.types.slice(0, 10).join(', '))}\n`;
      }

      await this.bot.sendMessage(chatId, response, { parse_mode: "HTML" });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to get file info: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle callback queries from inline keyboards
   */
  private async handleCallbackQuery(query: CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const data = query.data;

    if (!chatId || !data) return;

    // Check authorization using proper callback authorization check
    if (query.from && !this.isCallbackAuthorized(query.from)) {
      await this.bot.answerCallbackQuery(query.id, { text: "Not authorized" });
      return;
    }

    // Handle project selection
    if (data.startsWith(TelegramBotHandler.CB_SELECT_PROJECT)) {
      const projectName = data.slice(TelegramBotHandler.CB_SELECT_PROJECT.length);
      await this.handleProjectSelection(chatId, projectName, query.message?.message_id);
    }
    // Handle remove project
    else if (data.startsWith(TelegramBotHandler.CB_RM_PROJECT)) {
      const projectName = data.slice(TelegramBotHandler.CB_RM_PROJECT.length);
      await this.handleRemoveProjectByCallback(chatId, projectName, query.message?.message_id);
    }
    // Handle approve edit
    else if (data.startsWith(TelegramBotHandler.CB_APPROVE_EDIT)) {
      await this.handleEditApproval(chatId, data, true, query);
    }
    // Handle reject edit
    else if (data.startsWith(TelegramBotHandler.CB_REJECT_EDIT)) {
      await this.handleEditApproval(chatId, data, false, query);
    }
    // Handle cancel
    else if (data === TelegramBotHandler.CB_CANCEL) {
      await this.handleCancel({ chat: { id: chatId } } as Message);
    }

    await this.bot.answerCallbackQuery(query.id);
  }

  /**
   * Handle project selection from inline keyboard
   */
  private async handleProjectSelection(
    chatId: number,
    projectName: string,
    messageId?: number
  ): Promise<void> {
    const project = this.projectManager.getProject(projectName);

    if (!project) {
      await this.bot.sendMessage(chatId, `Project not found.`, {
        parse_mode: "HTML",
      });
      return;
    }

    this.sessionManager.setSessionProject(chatId, project);

    const response = `Project selected: <b>${escapeHtml(project.name)}</b>\n\n`;
    const gitInfo = project.isGit
      ? `🔧 Branch: ${escapeHtml(project.branch || "main")}\n`
      : "";
    const status = project.isGit ? `📊 Status: ${project.status}\n` : "";

    const message = `${response}${gitInfo}${status}\nSend your prompt to begin!`;

    if (messageId) {
      try {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
        });
      } catch {
        // Message might be too old, send new one
        await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
      }
    } else {
      await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    }
  }

  /**
   * Handle project removal from inline keyboard callback
   */
  private async handleRemoveProjectByCallback(
    chatId: number,
    projectName: string,
    messageId?: number
  ): Promise<void> {
    const removed = this.projectManager.removeProject(projectName);

    const message = removed
      ? `Project removed successfully.`
      : `Project not found.`;

    if (messageId) {
      try {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch {
        // Message might be too old, send new one
        await this.bot.sendMessage(chatId, message);
      }
    } else {
      await this.bot.sendMessage(chatId, message);
    }
  }

  /**
   * Handle edit approval/rejection
   */
  private async handleEditApproval(
    chatId: number,
    _data: string,
    approved: boolean,
    query: CallbackQuery
  ): Promise<void> {
    const session = this.sessionManager.getSession(chatId);

    if (!session?.pendingApproval) {
      await this.bot.sendMessage(chatId, "No pending approval to process.");
      return;
    }

    const messageId = query.message?.message_id;
    if (!messageId) {
      await this.bot.sendMessage(chatId, "Cannot edit message: message ID not found.");
      return;
    }

    if (approved) {
      // Note: File edit application is not yet implemented
      // Claude Code CLI handles file edits directly during execution
      // This approval system is reserved for future multi-step edit workflows
      await this.bot.editMessageText("⚠️ Edit approval acknowledged.", {
        chat_id: chatId,
        message_id: messageId,
      });

      await this.bot.sendMessage(
        chatId,
        "Note: File edits are applied directly by Claude CLI during execution. " +
        "This approval flow is reserved for future multi-step edit workflows."
      );
    } else {
      await this.bot.editMessageText("❌ Edits rejected.", {
        chat_id: chatId,
        message_id: messageId,
      });
    }

    this.sessionManager.setPendingApproval(chatId, null);
    this.sessionManager.setSessionStatus(chatId, "idle");
  }

  /**
   * Handle text messages (prompts for Claude)
   */
  private async handleTextMessage(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userInfo = `${msg.from?.username || msg.from?.first_name || "unknown"} (${chatId})`;

    // Skip if it's a command
    if (text?.startsWith("/")) return;
    if (!text) return;

    // Log incoming message
    this.logger.info(`📨 Message from ${userInfo}`);
    this.logger.debug(`  Content: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);

    // Check authorization
    if (!this.isAuthorized(msg)) {
      this.logger.warn(`⛔ Unauthorized access attempt by ${userInfo}`);
      return this.sendNotAuthorized(msg);
    }

    // Check if user is in setup mode
    if (isInSetup(chatId)) {
      await handleSetupWizard(msg, this.bot);
      return;
    }

    const session = this.sessionManager.getOrCreateSession(chatId, {
      username: msg.from?.username,
      firstName: msg.from?.first_name,
      lastName: msg.from?.last_name,
    });

    this.logger.debug(`  Session: ${session.currentProject?.name || "no project"} (${session.status})`);

    // Check if user has a project selected
    if (!session.currentProject) {
      // Offer project selection
      const projects = this.projectManager.getProjects();

      if (projects.length === 0) {
        await this.bot.sendMessage(
          chatId,
          "No projects available. Please add a project first using /addproject."
        );
        return;
      }

      if (projects.length === 1) {
        // Auto-select the only project
        this.sessionManager.setSessionProject(chatId, projects[0]);
        // Refresh session by getting it again to get the updated state
        const updatedSession = this.sessionManager.getSession(chatId);
        if (updatedSession?.currentProject) {
          await this.bot.sendMessage(
            chatId,
            `Auto-selected project: ${escapeHtml(updatedSession.currentProject.name)}\n\nProcessing your prompt...`,
            { parse_mode: "HTML" }
          );
        }
      } else {
        // Show selection keyboard
        const keyboard: TelegramBot.InlineKeyboardButton[][] = projects.map((p) => [
          {
            text: p.name,
            callback_data: `${TelegramBotHandler.CB_SELECT_PROJECT}${p.name}`,
          },
        ]);

        await this.bot.sendMessage(
          chatId,
          "Please select a project first:",
          {
            reply_markup: { inline_keyboard: keyboard },
          }
        );
        return;
      }
    }

    // Ensure we have a project at this point
    if (!session.currentProject) {
      await this.bot.sendMessage(chatId, "No project selected. Please use /select first.");
      return;
    }

    // Check if there's already a running process
    if (session.status === "processing" && session.claudeProcess) {
      await this.bot.sendMessage(
        chatId,
        "A Claude process is already running. Use /cancel to stop it first."
      );
      return;
    }

    // Add user message to conversation history
    this.sessionManager.addToConversation(chatId, {
      role: "user",
      content: text,
      timestamp: Date.now(),
    });

    // Load self-review context for better responses
    let enhancedPrompt = text;
    try {
      const selfReviewContext = await loadSelfReviewContext();
      if (selfReviewContext) {
        enhancedPrompt = `${text}\n\n${selfReviewContext}`;
        this.logger.debug("Loaded self-review context for response");
      }
    } catch (error) {
      this.logger.warn("Failed to load self-review context", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Send typing indicator
    await this.bot.sendChatAction(chatId, "typing");

    // Spawn Claude process
    try {
      // Result message will be edited with streaming output
      const resultMessage = await this.bot.sendMessage(
        chatId,
        "🤖 Starting..."
      );

      this.logger.info(`🚀 Spawning Claude process for ${userInfo}`);
      this.logger.debug(`  Project: ${session.currentProject.name}`);
      this.logger.debug(`  Path: ${session.currentProject.path}`);
      this.logger.debug(`  Model: ${this.config.claudeDefaultModel}`);

      // Streaming state
      let fullOutput = "";
      let streamBuffer = "";
      let lastStreamTime = Date.now();
      let streamMessageId = resultMessage.message_id;
      const KEEP_ALIVE_INTERVAL = 60_000; // Send keep-alive every 60 seconds

      // Update the result message with "still working" indicator
      const updateStatusMessage = async (output: string) => {
        try {
          const elapsed = Math.floor((Date.now() - lastStreamTime) / 1000);
          const preview = output.slice(-300);
          const statusMsg = `🤖 Claude working... (${elapsed}s since last output)\n\n<pre>${escapeHtml(preview)}${output.length > 300 ? "..." : ""}</pre>`;
          await this.bot.editMessageText(statusMsg, {
            chat_id: chatId,
            message_id: streamMessageId,
            parse_mode: "HTML",
          });
        } catch {
          // Message might be too old or deleted - ignore
        }
      };

      // Spawn with streaming callback
      const claudeProcess = this.claudeSpawner.spawnProcess({
        project: session.currentProject,
        prompt: enhancedPrompt,
        model: this.config.claudeDefaultModel,
        onOutput: (data: string) => {
          streamBuffer += data;
          fullOutput += data;
          lastStreamTime = Date.now();

          // Send chunked update if buffer is large enough
          if (streamBuffer.length >= 100) {
            updateStatusMessage(fullOutput);
            streamBuffer = "";
          }
        },
      });

      this.sessionManager.setClaudeProcess(chatId, claudeProcess);
      this.logger.info(`⏳ Claude PID ${claudeProcess.pid} started for ${userInfo} (no timeout, streaming enabled)`);

      // Keep-alive updater - sends updates if no output for a while
      const keepAliveInterval = setInterval(() => {
        if (claudeProcess.status !== "running") {
          clearInterval(keepAliveInterval);
          return;
        }

        const timeSinceOutput = Date.now() - lastStreamTime;
        if (timeSinceOutput >= KEEP_ALIVE_INTERVAL) {
          updateStatusMessage(fullOutput);
        }
      }, 30_000); // Check every 30 seconds

      // Wait for result (no timeout - runs indefinitely)
      const result = await this.claudeSpawner.waitForProcess(claudeProcess);

      clearInterval(keepAliveInterval);

      this.logger.info(`✅ Claude PID ${claudeProcess.pid} completed for ${userInfo}`);
      this.logger.debug(`  Duration: ${result.duration}ms`);
      this.logger.debug(`  Exit code: ${result.exitCode}`);
      this.logger.debug(`  Output size: ${result.output.length} chars`);

      // Track metrics
      try {
        const { getBrain } = await import('./brain/brain-manager.js');
        getBrain().trackMetrics({
          claudeQueries: 1,
          activeProject: session.currentProject?.name
        });
      } catch {
        // Metrics tracking is optional
      }

      // Delete the status message
      try {
        await this.bot.deleteMessage(resultMessage.chat.id, streamMessageId);
      } catch {
        // Message might be too old - ignore
      }

      // Send final response in chunks
      const chunks = chunkMessage(result.output);
      this.logger.debug(`  Sending ${chunks.length} chunk(s) to Telegram`);
      for (const chunk of chunks) {
        await this.bot.sendMessage(chatId, `<pre>${escapeHtml(chunk)}</pre>`, {
          parse_mode: "HTML",
        });
      }

      // Add assistant response to history
      this.sessionManager.addToConversation(chatId, {
        role: "assistant",
        content: result.output,
        timestamp: Date.now(),
      });

      // Update session status
      this.sessionManager.setClaudeProcess(chatId, null);
      this.sessionManager.setSessionStatus(chatId, "idle");

    } catch (error) {
      this.logger.error(`❌ Error processing request for ${userInfo}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.bot.sendMessage(
        chatId,
        `Error: ${error instanceof Error ? escapeHtml(error.message) : "Unknown error"}\n\nUse /cancel if needed, then try again.`
      );
      this.sessionManager.setClaudeProcess(chatId, null);
      this.sessionManager.setSessionStatus(chatId, "idle");
    }
  }

  /**
   * Format status for display
   */
  private formatStatus(status: string): string {
    const statusEmojis: Record<string, string> = {
      idle: "😴 Idle",
      processing: "⚙️ Processing",
      awaiting_approval: "⏳ Awaiting Approval",
    };
    return statusEmojis[status] || status;
  }

  /**
   * Handle /intentions command - View active intentions
   */
  private async handleIntentions(msg: Message, action?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const intentionEngine = getIntentionEngine();
    const session = this.sessionManager.getSession(chatId);
    const projectPath = session?.currentProject?.path || "";

    // Handle actions: remove, clear
    if (action === "clear") {
      const cleared = intentionEngine.clearExpired();
      await this.bot.sendMessage(chatId, `🗑️ Cleared ${cleared} expired intentions.`);
      return;
    }

    if (action?.startsWith("remove:")) {
      const intentionId = action.split(":")[1];
      const removed = intentionEngine.removeIntention(intentionId);
      if (removed) {
        await this.bot.sendMessage(chatId, `✅ Intention removed.`);
      } else {
        await this.bot.sendMessage(chatId, `❌ Intention not found.`);
      }
      return;
    }

    // Show all intentions for this user/project
    const intentions = intentionEngine.getIntentions({
      chatId,
      projectPath,
      active: true,
    });

    if (intentions.length === 0) {
      await this.bot.sendMessage(chatId, "📭 No active intentions.\n\nIntentions are created automatically when triggers are detected (test failures, high complexity, etc.).");
      return;
    }

    let message = `💭 <b>Active Intentions (${intentions.length})</b>\n\n`;

    for (const intention of intentions.slice(0, 10)) {
      const priorityEmoji = intention.priority === "urgent" ? "🔴" :
                           intention.priority === "high" ? "🟠" :
                           intention.priority === "medium" ? "🟡" : "🟢";
      const typeEmoji = this.getIntentionTypeEmoji(intention.type);

      message += `${priorityEmoji} ${typeEmoji} <b>${escapeHtml(intention.title)}</b>\n`;
      message += `   ID: ${intention.id.substring(0, 16)}...\n`;
      message += `   ${escapeHtml(intention.description.substring(0, 100))}${intention.description.length > 100 ? "..." : ""}\n`;
      message += `   Confidence: ${Math.round(intention.confidence * 100)}%\n\n`;
    }

    if (intentions.length > 10) {
      message += `\n... and ${intentions.length - 10} more`;
    }

    message += `\n<i>Actions: /intentions clear, /intentions remove:&lt;id&gt;</i>`;

    await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  }

  /**
   * Handle /decisions command - View pending/approved decisions
   */
  private async handleDecisions(msg: Message, filter?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const decisionMaker = getDecisionMaker();

    // Get all decisions and filter for this user
    const allDecisions = decisionMaker.getDecisions({
      requiresApproval: filter === "pending" ? true : undefined,
      active: true,
    });

    // Filter by chatId - we store chatId in the decision metadata or filter by checking intention source
    const decisions = allDecisions.filter(() => {
      // Since decisions don't directly have chatId, we'd need to check through the intention
      // For now, show all active decisions
      return true;
    });

    if (decisions.length === 0) {
      const status = filter === "pending" ? "pending" : "recent";
      await this.bot.sendMessage(chatId, `📋 No ${status} decisions.\n\nDecisions are created when the AI evaluates intentions and determines actions to take.`);
      return;
    }

    let message = `🤔 <b>Decisions (${decisions.length})</b>\n\n`;

    for (const decision of decisions.slice(0, 10)) {
      const statusEmoji = decision.requiresApproval ? "⏳" :
                         decision.canAutoExecute ? "✅" : "❌";

      message += `${statusEmoji} <b>${escapeHtml(decision.id.substring(0, 12))}</b>\n`;
      message += `   ${escapeHtml(decision.reasoning.substring(0, 80))}...\n`;

      if (decision.requiresApproval) {
        message += `   <i>Requires approval - /approve ${decision.id}</i>\n`;
      }

      if (decision.risks.length > 0) {
        message += `   ⚠️ Risks: ${decision.risks.length}\n`;
      }

      message += "\n";
    }

    if (decisions.length > 10) {
      message += `\n... and ${decisions.length - 10} more`;
    }

    message += `\n<i>Filters: /decisions pending</i>`;

    await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  }

  /**
   * Handle /goals command - Manage goals
   */
  private async handleGoals(msg: Message, action?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const goalSystem = getGoalSystem();
    const session = this.sessionManager.getSession(chatId);
    const projectPath = session?.currentProject?.path;

    // Handle subcommands
    if (action?.startsWith("create:")) {
      // Usage: /goals create:quality|feature|maintenance|learning <title> <description>
      const args = action.substring(7).split(":");
      if (args.length >= 2) {
        // For now, simple implementation
        await this.bot.sendMessage(chatId, "📝 Goal creation via chat is limited. Use the full CLI or web interface for detailed goal setup.\n\nExample goal types:\n• quality - Test coverage, complexity reduction\n• feature - Implement new features\n• maintenance - Reduce tech debt, dependencies\n• learning - Understand codebase");
        return;
      }
    }

    if (action?.startsWith("complete:")) {
      const goalId = action.split(":")[1];
      const success = await goalSystem.completeGoal(goalId);
      if (success) {
        await this.bot.sendMessage(chatId, `✅ Goal ${goalId} marked as complete!`);
      } else {
        await this.bot.sendMessage(chatId, `❌ Failed to complete goal ${goalId}`);
      }
      return;
    }

    if (action?.startsWith("pause:")) {
      const goalId = action.split(":")[1];
      const success = await goalSystem.pauseGoal(goalId);
      if (success) {
        await this.bot.sendMessage(chatId, `⏸️ Goal ${goalId} paused.`);
      } else {
        await this.bot.sendMessage(chatId, `❌ Failed to pause goal ${goalId}`);
      }
      return;
    }

    if (action?.startsWith("resume:")) {
      const goalId = action.split(":")[1];
      const success = await goalSystem.resumeGoal(goalId);
      if (success) {
        await this.bot.sendMessage(chatId, `▶️ Goal ${goalId} resumed.`);
      } else {
        await this.bot.sendMessage(chatId, `❌ Failed to resume goal ${goalId}`);
      }
      return;
    }

    // Show goals
    const goals = goalSystem.getGoals({
      chatId,
      projectPath,
    });

    if (goals.length === 0) {
      await this.bot.sendMessage(chatId, "🎯 No goals set.\n\n<b>Create a goal:</b>\n/goals create:&lt;type&gt; &lt;title&gt;\n\n<b>Types:</b> quality, feature, maintenance, learning");
      return;
    }

    let message = `🎯 <b>Goals (${goals.length})</b>\n\n`;

    for (const goal of goals.slice(0, 10)) {
      const typeEmoji = goal.type === "quality" ? "📊" :
                       goal.type === "feature" ? "✨" :
                       goal.type === "maintenance" ? "🔧" : "📚";
      const statusEmoji = goal.status === "active" ? "▶️" :
                         goal.status === "paused" ? "⏸️" :
                         goal.status === "completed" ? "✅" : "🚫";

      const progressBar = "█".repeat(Math.floor(goal.progress / 10)) +
                         "░".repeat(10 - Math.floor(goal.progress / 10));

      message += `${statusEmoji} ${typeEmoji} <b>${escapeHtml(goal.title)}</b>\n`;
      message += `   [${progressBar}] ${goal.progress}%\n`;
      message += `   ${goal.target.current}/${goal.target.target} ${goal.target.unit || ""}\n\n`;
    }

    if (goals.length > 10) {
      message += `\n... and ${goals.length - 10} more`;
    }

    message += `\n<i>Actions: /goals pause:&lt;id&gt;, /goals resume:&lt;id&gt;, /goals complete:&lt;id&gt;</i>`;

    await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  }

  /**
   * Handle /autonomous command - Toggle autonomous mode
   */
  private async handleAutonomous(msg: Message, action?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const memory = getMemoryStore();

    const storageKey = `autonomous_mode:${chatId}`;

    if (action === "on") {
      await memory.setFact(storageKey, { enabled: true, since: Date.now() });
      await this.bot.sendMessage(chatId, "🤖 <b>Autonomous mode enabled</b>\n\nThe AI will now proactively work on goals and take actions based on your permission level.\n\nUse /permissions to set your permission level.");
      return;
    }

    if (action === "off") {
      await memory.setFact(storageKey, { enabled: false, since: Date.now() });
      await this.bot.sendMessage(chatId, "🔒 <b>Autonomous mode disabled</b>\n\nThe AI will not take autonomous actions. You can still use all commands manually.");
      return;
    }

    // Show status
    const setting = await memory.getFact(storageKey) as { enabled: boolean } | undefined;
    const isEnabled = setting?.enabled ?? false;

    await this.bot.sendMessage(
      chatId,
      `🤖 <b>Autonomous Mode</b>\n\nStatus: ${isEnabled ? "✅ Enabled" : "❌ Disabled"}\n\n<b>Actions:</b>\n/autonomous on - Enable autonomous mode\n/autonomous off - Disable autonomous mode`,
      { parse_mode: "HTML" }
    );
  }

  /**
   * Handle /permissions command - Set permission level
   */
  private async handlePermissions(msg: Message, level?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const memory = getMemoryStore();

    const validLevels = ["read_only", "advisory", "supervised", "autonomous", "full"];
    const storageKey = `permission_level:${chatId}`;

    if (level && validLevels.includes(level)) {
      await memory.setFact(storageKey, {
        level,
        updatedAt: Date.now(),
      });

      const descriptions: Record<string, string> = {
        read_only: "AI can only read and analyze, no changes",
        advisory: "AI suggests actions but doesn't execute",
        supervised: "AI can act with approval for significant changes",
        autonomous: "AI can act independently on non-critical tasks",
        full: "AI has full autonomy (use with caution)",
      };

      await this.bot.sendMessage(
        chatId,
        `🔐 <b>Permission level set to: ${level}</b>\n\n${descriptions[level]}`
      );
      return;
    }

    // Show current level
    const setting = await memory.getFact(storageKey) as { level: string } | undefined;
    const currentLevel = setting?.level || "supervised";

    let message = `🔐 <b>Permission Level</b>\n\nCurrent: <b>${currentLevel}</b>\n\n<b>Available levels:</b>\n`;
    message += `👁️ read_only - Read only, no changes\n`;
    message += `💡 advisory - Suggest only\n`;
    message += `👥 supervised - Require approval (default)\n`;
    message += `🤖 autonomous - Auto non-critical actions\n`;
    message += `⚡ full - Full autonomy\n\n`;
    message += `<i>Usage: /permissions &lt;level&gt;</i>`;

    await this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  }

  /**
   * Handle /approve command - Approve a pending action
   */
  private async handleApprove(msg: Message, decisionId?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const decisionMaker = getDecisionMaker();

    if (!decisionId) {
      await this.bot.sendMessage(chatId, "Usage: /approve <decision_id>\n\nUse /decisions to see pending actions.");
      return;
    }

    const decision = decisionMaker.getDecision(decisionId);
    if (!decision) {
      await this.bot.sendMessage(chatId, `❌ Decision ${decisionId} not found.`);
      return;
    }

    // Approve the decision by overriding to execute
    const overridden = decisionMaker.overrideDecision(decisionId, true);

    if (overridden) {
      await this.bot.sendMessage(
        chatId,
        `✅ <b>Action Approved</b>\n\n${escapeHtml(decision.reasoning)}\n\nThe action will now be executed.`,
        { parse_mode: "HTML" }
      );
    } else {
      await this.bot.sendMessage(chatId, `❌ Failed to approve decision ${decisionId}. It may have expired or already been processed.`);
    }
  }

  /**
   * Handle /deny command - Deny a pending action
   */
  private async handleDeny(msg: Message, decisionId?: string): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const decisionMaker = getDecisionMaker();

    if (!decisionId) {
      await this.bot.sendMessage(chatId, "Usage: /deny <decision_id>\n\nUse /decisions to see pending actions.");
      return;
    }

    const decision = decisionMaker.getDecision(decisionId);
    if (!decision) {
      await this.bot.sendMessage(chatId, `❌ Decision ${decisionId} not found.`);
      return;
    }

    // Deny the decision by overriding to not execute
    const overridden = decisionMaker.overrideDecision(decisionId, false);

    if (overridden) {
      await this.bot.sendMessage(
        chatId,
        `❌ <b>Action Denied</b>\n\n${escapeHtml(decision.reasoning)}\n\nThe action will not be executed.`,
        { parse_mode: "HTML" }
      );
    } else {
      await this.bot.sendMessage(chatId, `❌ Failed to deny decision ${decisionId}. It may have already been processed.`);
    }
  }

  /**
   * Get emoji for intention type
   */
  private getIntentionTypeEmoji(type: string): string {
    const emojis: Record<string, string> = {
      test: "🧪",
      fix: "🔧",
      refactor: "♻️",
      implement: "✨",
      update: "📦",
      analyze: "🔍",
      optimize: "⚡",
      document: "📝",
      review: "👀",
      deploy: "🚀",
      learn: "🧠",
    };
    return emojis[type] || "💭";
  }

  /**
   * Start the bot
   */
  public async start(): Promise<void> {
    console.log("Bot started successfully!");

    // Load persisted sessions
    try {
      const loadedCount = await this.sessionManager.loadSessions();
      if (loadedCount > 0) {
        console.log(`Restored ${loadedCount} session(s) from disk.`);
      }
    } catch (error) {
      this.logger.error("Failed to load sessions", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start self-improvement scheduled jobs
    try {
      startScheduledJobs();
    } catch (error) {
      this.logger.error("Failed to start scheduled jobs", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Stop the bot
   */
  public async stop(): Promise<void> {
    // Save all sessions before shutdown
    try {
      await this.sessionManager.saveSessions();
      console.log("Sessions saved.");
    } catch (error) {
      this.logger.error("Failed to save sessions", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.bot.stopPolling();
    console.log("Bot stopped.");
  }

  /**
   * Get session manager (for testing/monitoring)
   */
  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Get project manager (for testing/monitoring)
   */
  public getProjectManager(): ProjectManager {
    return this.projectManager;
  }
}
