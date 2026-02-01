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

/**
 * Session Manager class
 */
export class SessionManager {
  private sessions = new Map<number, ChatSession>();
  private projectSessions = new Map<string, Set<number>>(); // projectName → chatIds
  // Reserved for future use: enforce concurrent session limits
  // private _maxConcurrentSessions: number;

  constructor(options?: { maxConcurrentSessions?: number }) {
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
  removeSession(chatId: number): void {
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
  cleanupIdleSessions(timeoutMs: number): number[] {
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
        this.removeSession(chatId);
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
}
