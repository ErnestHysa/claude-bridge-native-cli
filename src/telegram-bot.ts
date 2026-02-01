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

    await this.bot.sendMessage(
      chatId,
      `Welcome to Claude Bridge CLI! 🤖

I help you interact with Claude Code CLI through Telegram.

<b>Available commands:</b>
/projects - List available projects
/select - Select a project to work on
/addproject - Add a project by path
/status - Show current status
/cancel - Cancel current operation
/help - Show this help message

<b>Getting started:</b>
1. Use /projects to see available projects
2. Use /select or send a message to choose a project
3. Once a project is selected, just send your prompt!

Note: Please select a project before sending prompts.`,
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

    await this.bot.sendMessage(
      msg.chat.id,
      `<b>Claude Bridge CLI - Help</b>

<b>Commands:</b>
/start - Initialize the bot
/projects - List all available projects
/select - Select a project with an inline keyboard
/addproject &lt;path&gt; - Add a project by absolute path
/rmproject &lt;name&gt; - Remove a project
/rescan - Rescan the projects directory
/status - Show current session and project info
/cancel - Cancel the current Claude operation
/help - Show this help

<b>Workflow:</b>
1. Select a project using /select
2. Send your prompt as a message
3. Claude will process and respond
4. For file edits, you'll be asked to approve dangerous operations

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
      const resultMessage = await this.bot.sendMessage(
        chatId,
        "🤖 Processing your request..."
      );

      this.logger.info(`🚀 Spawning Claude process for ${userInfo}`);
      this.logger.debug(`  Project: ${session.currentProject.name}`);
      this.logger.debug(`  Path: ${session.currentProject.path}`);
      this.logger.debug(`  Model: ${this.config.claudeDefaultModel}`);

      const claudeProcess = this.claudeSpawner.spawnProcess({
        project: session.currentProject,
        prompt: text,
        model: this.config.claudeDefaultModel,
      });

      this.sessionManager.setClaudeProcess(chatId, claudeProcess);
      this.logger.info(`⏳ Claude PID ${claudeProcess.pid} started for ${userInfo}`);

      // Wait for result
      const result = await this.claudeSpawner.waitForProcess(claudeProcess);

      this.logger.info(`✅ Claude PID ${claudeProcess.pid} completed for ${userInfo}`);
      this.logger.debug(`  Duration: ${result.duration}ms`);
      this.logger.debug(`  Exit code: ${result.exitCode}`);
      this.logger.debug(`  Output size: ${result.output.length} chars`);

      // Update result message
      await this.bot.deleteMessage(resultMessage.chat.id, resultMessage.message_id);

      // Send response in chunks
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
        `Error: ${error instanceof Error ? escapeHtml(error.message) : "Unknown error"}`
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
