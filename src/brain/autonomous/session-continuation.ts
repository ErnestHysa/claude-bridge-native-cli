/**
 * Session Continuation System
 *
 * Handles continuation of work across sessions:
 * - /continue command to resume previous work
 * - Session handoff between active and autonomous modes
 * - Persistence of incomplete tasks and context
 *
 * Use Cases:
 * - User leaves mid-task, AI continues during inactive hours
 * - Long-running tasks that span multiple sessions
 * - Autonomous mode picks up where user left off
 * - User reviews and continues autonomous work
 */

import { getMemoryStore } from '../memory/memory-store.js';
import { getNightWorkQueue } from './night-work-queue.js';

// ============================================
// Types
// ============================================

/**
 * Session state
 */
export type SessionState = 'active' | 'paused' | 'handed_off' | 'completed';

/**
 * A continuation session
 */
export interface ContinuationSession {
  id: string;
  chatId: number;
  projectPath?: string;
  state: SessionState;
  title: string;
  description: string;

  // Context for continuation
  context: {
    lastMessage?: string;
    lastCommand?: string;
    projectId?: string;
    files?: string[];
    branch?: string;
  };

  // Task tracking
  tasks: ContinuationTask[];

  // Timestamps
  createdAt: number;
  updatedAt: number;
  handedOffAt?: number;
  resumedAt?: number;
  completedAt?: number;

  // Metadata
  priority: 'low' | 'medium' | 'high' | 'urgent';
  tags: string[];
}

/**
 * A task within a continuation session
 */
export interface ContinuationTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: 'user' | 'autonomous'; // Who should handle this task
  createdAt: number;
  completedAt?: number;
}

// ============================================
// Storage Keys
// ============================================

const SESSION_KEY = (chatId: number, sessionId: string) =>
  `continuation_session:${chatId}:${sessionId}`;
const ACTIVE_SESSION_KEY = (chatId: number) =>
  `continuation_active:${chatId}`;
const ALL_SESSIONS_KEY = (chatId: number) =>
  `continuation_sessions:${chatId}`;

// ============================================
// Session Continuation Manager
// ============================================

export class SessionContinuationManager {
  private memory = getMemoryStore();
  private workQueue = getNightWorkQueue();

  /**
   * Create a new continuation session
   */
  async createSession(session: Omit<ContinuationSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContinuationSession> {
    const newSession: ContinuationSession = {
      ...session,
      id: this.generateSessionId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Store the session
    await this.memory.setFact(SESSION_KEY(newSession.chatId, newSession.id), newSession);

    // Set as active if needed
    await this.memory.setFact(ACTIVE_SESSION_KEY(newSession.chatId), newSession.id);

    // Add to user's sessions list
    await this.addSessionToList(newSession.chatId, newSession.id);

    return newSession;
  }

  /**
   * Get a session by ID
   */
  async getSession(chatId: number, sessionId: string): Promise<ContinuationSession | null> {
    const stored = await this.memory.getFact(SESSION_KEY(chatId, sessionId)) as ContinuationSession | undefined;
    return stored || null;
  }

  /**
   * Get the active session for a user
   */
  async getActiveSession(chatId: number): Promise<ContinuationSession | null> {
    const activeId = await this.memory.getFact(ACTIVE_SESSION_KEY(chatId)) as string | undefined;
    if (!activeId) return null;

    return this.getSession(chatId, activeId);
  }

  /**
   * Get all sessions for a user
   */
  async getAllSessions(chatId: number): Promise<ContinuationSession[]> {
    const sessionIds = await this.memory.getFact(ALL_SESSIONS_KEY(chatId)) as string[] | undefined;
    if (!sessionIds) return [];

    const sessions: ContinuationSession[] = [];
    for (const id of sessionIds) {
      const session = await this.getSession(chatId, id);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get sessions that can be continued (paused or handed_off)
   */
  async getContinuableSessions(chatId: number): Promise<ContinuationSession[]> {
    const allSessions = await this.getAllSessions(chatId);
    return allSessions.filter(s => s.state === 'paused' || s.state === 'handed_off');
  }

  /**
   * Update a session
   */
  async updateSession(chatId: number, sessionId: string, updates: Partial<ContinuationSession>): Promise<void> {
    const session = await this.getSession(chatId, sessionId);
    if (!session) return;

    const updated = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.memory.setFact(SESSION_KEY(chatId, sessionId), updated);
  }

  /**
   * Pause the active session
   */
  async pauseSession(chatId: number): Promise<ContinuationSession | null> {
    const active = await this.getActiveSession(chatId);
    if (!active) return null;

    await this.updateSession(chatId, active.id, { state: 'paused' });
    return this.getSession(chatId, active.id);
  }

  /**
   * Resume a session
   */
  async resumeSession(chatId: number, sessionId: string): Promise<ContinuationSession | null> {
    const session = await this.getSession(chatId, sessionId);
    if (!session) return null;

    await this.updateSession(chatId, sessionId, {
      state: 'active',
      resumedAt: Date.now(),
    });

    // Set as active
    await this.memory.setFact(ACTIVE_SESSION_KEY(chatId), sessionId);

    return this.getSession(chatId, sessionId);
  }

  /**
   * Complete a session
   */
  async completeSession(chatId: number, sessionId: string): Promise<void> {
    const session = await this.getSession(chatId, sessionId);
    if (!session) return;

    await this.updateSession(chatId, sessionId, {
      state: 'completed',
      completedAt: Date.now(),
    });

    // Clear active if this was the active session
    const activeId = await this.memory.getFact(ACTIVE_SESSION_KEY(chatId)) as string | undefined;
    if (activeId === sessionId) {
      await this.memory.deleteFact(ACTIVE_SESSION_KEY(chatId));
    }
  }

  /**
   * Hand off a session to autonomous mode
   * This creates tasks in the night work queue for autonomous completion
   */
  async handoffToAutonomous(chatId: number, sessionId?: string): Promise<{
    session: ContinuationSession | null;
    tasksCreated: number;
  }> {
    let session: ContinuationSession | null;

    if (sessionId) {
      session = await this.getSession(chatId, sessionId);
    } else {
      session = await this.getActiveSession(chatId);
    }

    if (!session) {
      return { session: null, tasksCreated: 0 };
    }

    // Create night work tasks for incomplete session tasks
    let tasksCreated = 0;
    for (const task of session.tasks) {
      if (task.status === 'pending' || task.status === 'in_progress') {
        // Only assign tasks marked for autonomous
        if (task.assignedTo === 'autonomous' || !task.assignedTo) {
          await this.workQueue.addTask({
            type: 'custom',
            priority: task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium',
            title: task.title,
            description: task.description,
            source: 'pending_session',
            sourceId: session.id,
            chatId: chatId,
            requiredPermission: 'autonomous',
            maxRetries: 2,
            context: {
              projectId: session.context.projectId,
              metadata: {
                sessionId: session.id,
                taskId: task.id,
              },
            },
          });
          tasksCreated++;
        }
      }
    }

    // Update session state
    await this.updateSession(chatId, session.id, {
      state: 'handed_off',
      handedOffAt: Date.now(),
    });

    return {
      session: await this.getSession(chatId, session.id),
      tasksCreated,
    };
  }

  /**
   * Resume work from autonomous mode (user takes over)
   */
  async resumeFromAutonomous(chatId: number): Promise<ContinuationSession | null> {
    // Find the most recently handed off session
    const sessions = await this.getAllSessions(chatId);
    const handedOff = sessions.find(s => s.state === 'handed_off');

    if (!handedOff) return null;

    return this.resumeSession(chatId, handedOff.id);
  }

  /**
   * Add a task to a session
   */
  async addTaskToSession(
    chatId: number,
    sessionId: string,
    task: Omit<ContinuationTask, 'id' | 'createdAt'>
  ): Promise<void> {
    const session = await this.getSession(chatId, sessionId);
    if (!session) return;

    const newTask: ContinuationTask = {
      ...task,
      id: this.generateTaskId(),
      createdAt: Date.now(),
    };

    const updatedTasks = [...session.tasks, newTask];
    await this.updateSession(chatId, sessionId, { tasks: updatedTasks });
  }

  /**
   * Update a task in a session
   */
  async updateSessionTask(
    chatId: number,
    sessionId: string,
    taskId: string,
    updates: Partial<ContinuationTask>
  ): Promise<void> {
    const session = await this.getSession(chatId, sessionId);
    if (!session) return;

    const updatedTasks = session.tasks.map(t =>
      t.id === taskId ? { ...t, ...updates } : t
    );

    await this.updateSession(chatId, sessionId, { tasks: updatedTasks });
  }

  /**
   * Delete a session
   */
  async deleteSession(chatId: number, sessionId: string): Promise<void> {
    await this.memory.deleteFact(SESSION_KEY(chatId, sessionId));

    // Remove from sessions list
    const sessionIds = await this.memory.getFact(ALL_SESSIONS_KEY(chatId)) as string[] | undefined;
    if (sessionIds) {
      const filtered = sessionIds.filter(id => id !== sessionId);
      await this.memory.setFact(ALL_SESSIONS_KEY(chatId), filtered);
    }

    // Clear active if this was the active session
    const activeId = await this.memory.getFact(ACTIVE_SESSION_KEY(chatId)) as string | undefined;
    if (activeId === sessionId) {
      await this.memory.deleteFact(ACTIVE_SESSION_KEY(chatId));
    }
  }

  /**
   * Format a session for display
   */
  formatSession(session: ContinuationSession): string {
    const stateEmoji = {
      active: '🔄',
      paused: '⏸️',
      handed_off: '🤖',
      completed: '✅',
    };

    const priorityEmoji = {
      urgent: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };

    let message = `${stateEmoji[session.state]} <b>${this.escapeHtml(session.title)}</b>\n`;
    message += `   ${priorityEmoji[session.priority]} ${session.description}\n`;

    // Show tasks summary
    const pendingTasks = session.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    if (pendingTasks.length > 0) {
      message += `   Tasks: ${pendingTasks.length} pending\n`;
    }

    // Show timestamp
    const date = new Date(session.updatedAt);
    message += `   Updated: ${date.toLocaleString()}\n`;

    return message;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Add a session to the user's sessions list
   */
  private async addSessionToList(chatId: number, sessionId: string): Promise<void> {
    const sessionIds = await this.memory.getFact(ALL_SESSIONS_KEY(chatId)) as string[] | undefined;
    const updated = sessionIds ? [...sessionIds, sessionId] : [sessionId];
    await this.memory.setFact(ALL_SESSIONS_KEY(chatId), updated);
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session:${Date.now()}:${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    return `task:${Date.now()}:${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Escape HTML for Telegram
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// ============================================
// Singleton
// ============================================

let managerInstance: SessionContinuationManager | null = null;

/**
 * Get the session continuation manager singleton
 */
export function getSessionContinuationManager(): SessionContinuationManager {
  if (!managerInstance) {
    managerInstance = new SessionContinuationManager();
  }
  return managerInstance;
}

/**
 * Reset the manager (mainly for testing)
 */
export function resetSessionContinuationManager(): void {
  managerInstance = null;
}
