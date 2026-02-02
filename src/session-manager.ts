/**
 * Session Manager - Manages per-Telegram-chat sessions
 */

import type {
  ChatSession,
  ClaudeProcess,
  ConversationMessage,
  Project,
  EditApprovalRequest
} from "./types.js";
import { killClaudeProcess } from "./claude-spawner.js";
import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Session Manager class
 */
export class SessionManager {
  private sessions = new Map<number, ChatSession>();
  private projectSessions = new Map<string, Set<number>>(); // projectName → chatIds
  private sessionsDir: string;
  private autoSaveEnabled = true;
  // Reserved for future use: enforce concurrent session limits
  // private _maxConcurrentSessions: number;

  constructor(options?: { maxConcurrentSessions?: number; sessionsDir?: string }) {
    // Use provided sessionsDir or default to brain/sessions
    this.sessionsDir = options?.sessionsDir ?? join(process.cwd(), 'src', 'brain', 'sessions');

    // Ensure sessions directory exists
    if (!existsSync(this.sessionsDir)) {
      // Create directory synchronously for constructor
      mkdirSync(this.sessionsDir, { recursive: true });
    }

    // Reserved for future use
    // this._maxConcurrentSessions = options?.maxConcurrentSessions ?? 5;
    void options?.maxConcurrentSessions;
  }

  /**
   * Get or create a session for a chat
   */
  getOrCreateSession(
    chatId: number,
    userInfo?: { username?: string; firstName?: string; lastName?: string }
  ): ChatSession {
    let session = this.sessions.get(chatId);

    if (!session) {
      session = {
        chatId,
        username: userInfo?.username,
        firstName: userInfo?.firstName,
        lastName: userInfo?.lastName,
        currentProject: null,
        claudeProcess: null,
        conversationHistory: [],
        pendingApproval: null,
        status: "idle",
        lastActivity: Date.now(),
      };
      this.sessions.set(chatId, session);
    }

    return session;
  }

  /**
   * Get a session by chat ID
   */
  getSession(chatId: number): ChatSession | undefined {
    return this.sessions.get(chatId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Set the current project for a session
   */
  setSessionProject(chatId: number, project: Project | null): void {
    const session = this.sessions.get(chatId);
    if (!session) return;

    // Remove from old project's session set
    if (session.currentProject) {
      const oldSet = this.projectSessions.get(session.currentProject.name);
      if (oldSet) {
        oldSet.delete(chatId);
        if (oldSet.size === 0) {
          this.projectSessions.delete(session.currentProject.name);
        }
      }
    }

    // Update session
    session.currentProject = project;
    session.lastActivity = Date.now();

    // Add to new project's session set
    if (project) {
      let newSet = this.projectSessions.get(project.name);
      if (!newSet) {
        newSet = new Set();
        this.projectSessions.set(project.name, newSet);
      }
      newSet.add(chatId);
    }

    // Auto-save
    if (this.autoSaveEnabled) {
      this.saveSession(chatId).catch(err => console.error('Auto-save failed:', err));
    }
  }

  /**
   * Get all chats using a specific project
   */
  getChatsUsingProject(projectName: string): number[] {
    const chatSet = this.projectSessions.get(projectName);
    return chatSet ? Array.from(chatSet) : [];
  }

  /**
   * Set the Claude process for a session
   */
  setClaudeProcess(chatId: number, process: ClaudeProcess | null): void {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.claudeProcess = process;
    session.status = process ? "processing" : "idle";
    session.lastActivity = Date.now();
  }

  /**
   * Add a message to conversation history
   */
  addToConversation(chatId: number, message: ConversationMessage): void {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.conversationHistory.push(message);
    session.lastActivity = Date.now();

    // Limit history size
    const maxHistory = 100;
    if (session.conversationHistory.length > maxHistory) {
      session.conversationHistory = session.conversationHistory.slice(-maxHistory);
    }

    // Auto-save (debounced - only save after every few messages would be better, but simple for now)
    if (this.autoSaveEnabled) {
      this.saveSession(chatId).catch(err => console.error('Auto-save failed:', err));
    }
  }

  /**
   * Get conversation history for a session
   */
  getConversationHistory(chatId: number): ConversationMessage[] {
    const session = this.sessions.get(chatId);
    return session?.conversationHistory ?? [];
  }

  /**
   * Clear conversation history for a session
   */
  clearConversationHistory(chatId: number): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.conversationHistory = [];
    }
  }

  /**
   * Set pending approval for a session
   */
  setPendingApproval(
    chatId: number,
    approval: EditApprovalRequest | null
  ): void {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.pendingApproval = approval;
    session.status = approval ? "awaiting_approval" : "idle";
  }

  /**
   * Get pending approval for a session
   */
  getPendingApproval(chatId: number) {
    const session = this.sessions.get(chatId);
    return session?.pendingApproval ?? null;
  }

  /**
   * Set session status
   */
  setSessionStatus(chatId: number, status: ChatSession["status"]): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.status = status;
      session.lastActivity = Date.now();
    }
  }

  /**
   * Get session status
   */
  getSessionStatus(chatId: number): ChatSession["status"] | undefined {
    return this.sessions.get(chatId)?.status;
  }

  /**
   * Update last activity time
   */
  updateActivity(chatId: number): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Remove a session (logout/cleanup)
   */
  async removeSession(chatId: number): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    // Kill Claude process if running
    if (session.claudeProcess) {
      killClaudeProcess(session.claudeProcess);
    }

    // Remove from project sessions
    if (session.currentProject) {
      const projectSet = this.projectSessions.get(session.currentProject.name);
      if (projectSet) {
        projectSet.delete(chatId);
        if (projectSet.size === 0) {
          this.projectSessions.delete(session.currentProject.name);
        }
      }
    }

    this.sessions.delete(chatId);

    // Delete saved session file
    await this.deleteSavedSession(chatId);
  }

  /**
   * Get all active Claude processes
   */
  getActiveClaudeProcesses(): ClaudeProcess[] {
    const processes: ClaudeProcess[] = [];

    for (const session of this.sessions.values()) {
      if (session.claudeProcess && session.claudeProcess.status === "running") {
        processes.push(session.claudeProcess);
      }
    }

    return processes;
  }

  /**
   * Get active session count for a project
   */
  getActiveSessionCount(projectName: string): number {
    return this.getChatsUsingProject(projectName).filter((chatId) => {
      const session = this.sessions.get(chatId);
      return session?.status === "processing" || session?.status === "awaiting_approval";
    }).length;
  }

  /**
   * Clean up idle sessions
   */
  async cleanupIdleSessions(timeoutMs: number): Promise<number[]> {
    const now = Date.now();
    const removedChatIds: number[] = [];

    for (const [chatId, session] of this.sessions.entries()) {
      // Remove idle sessions (no activity for timeout)
      if (
        now - session.lastActivity > timeoutMs &&
        session.status === "idle" &&
        !session.claudeProcess
      ) {
        removedChatIds.push(chatId);
        await this.removeSession(chatId);
      }
    }

    return removedChatIds;
  }

  /**
   * Get session statistics
   */
  getStats() {
    const totalSessions = this.sessions.size;
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status === "processing" || s.status === "awaiting_approval"
    ).length;

    const activeClaudeProcesses = this.getActiveClaudeProcesses().length;

    return {
      totalSessions,
      activeSessions,
      activeClaudeProcesses,
      projectBreakdown: Object.fromEntries(
        Array.from(this.projectSessions.entries()).map(([name, chatSet]) => [
          name,
          { total: chatSet.size, active: this.getActiveSessionCount(name) },
        ])
      ),
    };
  }

  // ===========================================
  // Session Persistence
  // ===========================================

  /**
   * Save a single session to disk
   */
  private async saveSession(chatId: number): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    const filePath = join(this.sessionsDir, `${chatId}.json`);

    // Create a serializable version of the session
    // Note: claudeProcess is NOT saved as it contains live process handles
    const serializableSession = {
      chatId: session.chatId,
      username: session.username,
      firstName: session.firstName,
      lastName: session.lastName,
      currentProject: session.currentProject,
      conversationHistory: session.conversationHistory,
      status: session.status === "processing" ? "idle" : session.status, // Reset processing status on reload
      lastActivity: session.lastActivity,
      savedAt: Date.now(),
    };

    try {
      await writeFile(filePath, JSON.stringify(serializableSession, null, 2));
    } catch (error) {
      console.error(`Failed to save session for chat ${chatId}:`, error);
    }
  }

  /**
   * Load a single session from disk
   */
  private async loadSession(chatId: number): Promise<ChatSession | null> {
    const filePath = join(this.sessionsDir, `${chatId}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        chatId: number;
        username?: string;
        firstName?: string;
        lastName?: string;
        currentProject: Project | null;
        conversationHistory: ConversationMessage[];
        status: ChatSession["status"];
        lastActivity: number;
      };

      // Reconstruct the session
      const session: ChatSession = {
        chatId: data.chatId,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        currentProject: data.currentProject,
        claudeProcess: null, // Never restore live processes
        conversationHistory: data.conversationHistory ?? [],
        pendingApproval: null,
        status: data.status === "processing" ? "idle" : data.status,
        lastActivity: data.lastActivity,
      };

      return session;
    } catch (error) {
      console.error(`Failed to load session for chat ${chatId}:`, error);
      return null;
    }
  }

  /**
   * Save all sessions to disk
   */
  async saveSessions(): Promise<void> {
    const savePromises: Promise<void>[] = [];

    for (const [chatId] of this.sessions.entries()) {
      savePromises.push(this.saveSession(chatId));
    }

    await Promise.allSettled(savePromises);
  }

  /**
   * Load all sessions from disk
   */
  async loadSessions(): Promise<number> {
    if (!existsSync(this.sessionsDir)) {
      return 0;
    }

    try {
      const files = await readdir(this.sessionsDir);
      const chatIds = files
        .filter(f => f.endsWith('.json'))
        .map(f => parseInt(f.replace('.json', ''), 10))
        .filter(n => !isNaN(n));

      let loaded = 0;
      for (const chatId of chatIds) {
        const session = await this.loadSession(chatId);
        if (session) {
          this.sessions.set(chatId, session);

          // Restore project sessions mapping
          if (session.currentProject) {
            let projectSet = this.projectSessions.get(session.currentProject.name);
            if (!projectSet) {
              projectSet = new Set();
              this.projectSessions.set(session.currentProject.name, projectSet);
            }
            projectSet.add(chatId);
          }

          loaded++;
        }
      }

      return loaded;
    } catch (error) {
      console.error('Failed to load sessions:', error);
      return 0;
    }
  }

  /**
   * Delete a saved session file
   */
  async deleteSavedSession(chatId: number): Promise<void> {
    const filePath = join(this.sessionsDir, `${chatId}.json`);
    if (existsSync(filePath)) {
      try {
        await unlink(filePath);
      } catch (error) {
        console.error(`Failed to delete saved session for chat ${chatId}:`, error);
      }
    }
  }

  /**
   * Enable or disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }

  /**
   * Get the sessions directory path
   */
  getSessionsDir(): string {
    return this.sessionsDir;
  }
}
