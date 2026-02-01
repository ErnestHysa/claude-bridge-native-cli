/**
 * Telegram Bot Handler for Claude Bridge Native CLI
 */

import TelegramBot from "node-telegram-bot-api";
import type { Message, CallbackQuery } from "node-telegram-bot-api";
import { SessionManager } from "./session-manager.js";
import { ProjectManager } from "./project-manager-class.js";
import { ClaudeSpawner } from "./claude-spawner-class.js";
import type { BridgeConfig } from "./types.js";
import { escapeHtml, chunkMessage, formatRelativeTime, Logger, sanitizePath } from "./utils.js";
import {
  getBrain,
  getMemoryStore,
  createSetupWizard,
  getIdentityManager,
  getContextIndexer,
  getOrchestrator,
  getTaskQueue,
  type SetupWizard,
} from "./brain/index.js";

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

    this.sessionManager = new SessionManager({
      maxConcurrentSessions: config.maxConcurrentSessions,
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
    this.bot.onText(/\/profile/, (msg) => this.handleProfile(msg));
    this.bot.onText(/\/schedule(?:\s+(.+))?/, (msg) =>
      this.handleSchedule(msg)
    );
    this.bot.onText(/\/schedules/, (msg) => this.handleSchedules(msg));

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
/profile - View your profile
/schedule &lt;cron&gt; &lt;task&gt; - Schedule a task
/schedules - List scheduled tasks

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
      `Scan complete. Found ${detectionResult.projects.length} project${
        detectionResult.projects.length === 1 ? "" : "s"
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

    await this.bot.sendMessage(
      chatId,
      `${getBrain().getEmoji()} Remembered: <b>${escapeHtml(key)}</b> = <code>${escapeHtml(value)}</code>`,
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
        `Usage: /agent ${agentType} <task description>`
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      `${getBrain().getEmoji()} Starting <b>${escapeHtml(agentType)}</b> agent: ${escapeHtml(task)}...`,
      { parse_mode: "HTML" }
    );

    // TODO: Actually execute the agent
    // For now, just acknowledge
    await this.bot.sendMessage(
      chatId,
      `Agent execution will be implemented. Task queued.`
    );
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
   * Handle /profile command - View user profile
   */
  private async handleProfile(msg: Message): Promise<void> {
    if (!this.isAuthorized(msg)) {
      return this.sendNotAuthorized(msg);
    }

    await ensureBrainInitialized();
    const chatId = msg.chat.id;
    const brain = getBrain();

    const identity = brain.getIdentity();
    const personality = brain.getPersonality();
    const preferences = brain.getPreferences();

    let response = `${identity.emoji} <b>Profile</b>\n\n`;
    response += `<b>Bot Name:</b> ${escapeHtml(identity.name)} ${identity.emoji}\n`;
    response += `<b>User:</b> ${escapeHtml(brain.getUserName())}\n`;
    response += `<b>Timezone:</b> ${escapeHtml(brain.getTimezone())}\n\n`;

    response += `<b>Communication:</b>\n`;
    response += `• Style: ${escapeHtml(personality.communication.style)}\n`;
    response += `• Tone: ${escapeHtml(personality.communication.tone)}\n\n`;

    response += `<b>Languages:</b> ${personality.coding.languages.map(escapeHtml).join(", ")}\n\n`;

    response += `<b>Git:</b>\n`;
    response += `• Default branch: ${escapeHtml(preferences.git.defaultBranch)}\n`;
    response += `• Commit style: ${escapeHtml(preferences.git.commitMessageStyle)}`;

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
        prompt: text,
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
   * Start the bot
   */
  public start(): void {
    console.log("Bot started successfully!");
  }

  /**
   * Stop the bot
   */
  public async stop(): Promise<void> {
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
