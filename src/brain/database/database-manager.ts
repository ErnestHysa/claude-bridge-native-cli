/**
 * SQLite Database Manager - Persistent storage for critical data
 *
 * Stores critical application data that must survive restarts:
 * - User sessions
 * - Task history
 * - Audit trail
 * - Approval decisions
 * - Error logs
 *
 * Uses better-sqlite3 for synchronous database operations.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// ============================================
// Configuration
// ============================================

const DB_DIR = join(process.cwd(), 'brain', 'database');
const DB_PATH = join(DB_DIR, 'claude-bridge.db');

// ============================================
// Types
// ============================================

export interface SessionRow {
  chat_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  current_project: string | null;
  status: string;
  last_activity: number;
  created_at: number;
  updated_at: number;
}

export interface TaskRow {
  id: string;
  chat_id: number;
  type: string;
  description: string;
  status: string;
  result: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  project: string | null;
}

export interface AuditRow {
  id: string;
  timestamp: number;
  level: string;
  action: string;
  chat_id: number | null;
  user_id: number | null;
  project_path: string | null;
  details: string;
  result: string | null;
}

export interface DecisionRow {
  id: string;
  timestamp: number;
  type: string;
  description: string;
  chat_id: number;
  risk_level: string;
  auto_approved: boolean | number;
  approved: boolean | number;
  approval_source: string | null;
  outcome: string;
  details: string | null;
}

// ============================================
// Database Manager Class
// ============================================

export class DatabaseManager {
  private db: Database.Database | null = null;
  private initialized = false;

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directory exists
      const { mkdirSync } = await import('node:fs');
      if (!existsSync(DB_DIR)) {
        mkdirSync(DB_DIR, { recursive: true });
      }

      // Open database
      this.db = new Database(DB_PATH);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      // Create tables
      this.createTables();

      this.initialized = true;
      console.log('[DatabaseManager] Initialized');
    } catch (error) {
      console.error('[DatabaseManager] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Create database tables
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        chat_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        current_project TEXT,
        status TEXT DEFAULT 'idle',
        last_activity INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity)
    `);

    // Tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        chat_id INTEGER NOT NULL,
        type TEXT,
        description TEXT,
        status TEXT DEFAULT 'pending',
        result TEXT,
        error TEXT,
        created_at INTEGER,
        started_at INTEGER,
        completed_at INTEGER,
        project TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_chat_id ON tasks(chat_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at)
    `);

    // Audit table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY,
        timestamp INTEGER,
        level TEXT,
        action TEXT,
        chat_id INTEGER,
        user_id INTEGER,
        project_path TEXT,
        details TEXT,
        result TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit(timestamp)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit(action)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_chat_id ON audit(chat_id)
    `);

    // Decisions table (for autonomous action approvals)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        timestamp INTEGER,
        type TEXT,
        description TEXT,
        chat_id INTEGER NOT NULL,
        risk_level TEXT,
        auto_approved INTEGER DEFAULT 0,
        approved INTEGER DEFAULT 0,
        approval_source TEXT,
        outcome TEXT,
        details TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_decisions_chat_id ON decisions(chat_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_decisions_approved ON decisions(approved)
    `);
  }

  /**
   * Close the database
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      console.log('[DatabaseManager] Closed');
    }
  }

  // ===========================================
  // Session Operations
  // ===========================================

  upsertSession(session: SessionRow): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO sessions (chat_id, username, first_name, last_name, current_project, status, last_activity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        current_project = excluded.current_project,
        status = excluded.status,
        last_activity = excluded.last_activity,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      session.chat_id,
      session.username,
      session.first_name,
      session.last_name,
      session.current_project,
      session.status,
      session.last_activity,
      session.created_at,
      session.updated_at
    );
  }

  getSession(chatId: number): SessionRow | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM sessions WHERE chat_id = ?');
    return stmt.get(chatId) as SessionRow | null;
  }

  getAllSessions(): SessionRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY last_activity DESC');
    return stmt.all() as SessionRow[];
  }

  deleteSession(chatId: number): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('DELETE FROM sessions WHERE chat_id = ?');
    stmt.run(chatId);
  }

  // ===========================================
  // Task Operations
  // ===========================================

  insertTask(task: TaskRow): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tasks (id, chat_id, type, description, status, result, error, created_at, started_at, completed_at, project)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.chat_id,
      task.type,
      task.description,
      task.status,
      task.result,
      task.error,
      task.created_at,
      task.started_at,
      task.completed_at,
      task.project
    );
  }

  updateTaskStatus(id: string, status: string, result?: string, error?: string): void {
    if (!this.db) throw new Error('Database not initialized');

    const completedAt = status === 'completed' || status === 'failed' ? Date.now() : null;

    const stmt = this.db.prepare(`
      UPDATE tasks SET status = ?, result = ?, error = ?, completed_at = ?
      WHERE id = ?
    `);

    stmt.run(status, result || null, error || null, completedAt, id);
  }

  getTask(id: string): TaskRow | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(id) as TaskRow | null;
  }

  getTasksByChatId(chatId: number, limit = 50): TaskRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?
    `);
    return stmt.all(chatId, limit) as TaskRow[];
  }

  getTasksByStatus(status: string, limit = 50): TaskRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?
    `);
    return stmt.all(status, limit) as TaskRow[];
  }

  // ===========================================
  // Audit Operations
  // ===========================================

  insertAudit(audit: AuditRow): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO audit (id, timestamp, level, action, chat_id, user_id, project_path, details, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      audit.id,
      audit.timestamp,
      audit.level,
      audit.action,
      audit.chat_id,
      audit.user_id,
      audit.project_path,
      audit.details,
      audit.result
    );
  }

  getAuditLogs(limit = 100): AuditRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM audit ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(limit) as AuditRow[];
  }

  getAuditLogsByAction(action: string, limit = 100): AuditRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM audit WHERE action = ? ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(action, limit) as AuditRow[];
  }

  getAuditLogsByChatId(chatId: number, limit = 100): AuditRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM audit WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(chatId, limit) as AuditRow[];
  }

  // ===========================================
  // Decision Operations
  // ===========================================

  insertDecision(decision: DecisionRow): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO decisions (id, timestamp, type, description, chat_id, risk_level, auto_approved, approved, approval_source, outcome, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      decision.id,
      decision.timestamp,
      decision.type,
      decision.description,
      decision.chat_id,
      decision.risk_level,
      decision.auto_approved ? 1 : 0,
      decision.approved ? 1 : 0,
      decision.approval_source,
      decision.outcome,
      decision.details
    );
  }

  getDecisions(chatId: number, limit = 50): DecisionRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM decisions WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(chatId, limit) as DecisionRow[];

    // Convert integer booleans back to booleans
    return rows.map((row: DecisionRow) => ({
      ...row,
      auto_approved: typeof row.auto_approved === 'number' ? row.auto_approved === 1 : row.auto_approved,
      approved: typeof row.approved === 'number' ? row.approved === 1 : row.approved,
    }));
  }

  getPendingDecisions(limit = 50): DecisionRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM decisions WHERE approved = 0 ORDER BY timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(limit) as DecisionRow[];

    return rows.map((row: DecisionRow) => ({
      ...row,
      auto_approved: typeof row.auto_approved === 'number' ? row.auto_approved === 1 : row.auto_approved,
      approved: typeof row.approved === 'number' ? row.approved === 1 : row.approved,
    }));
  }

  // ===========================================
  // Utility Operations
  // ===========================================

  getStats(): {
    sessionsCount: number;
    tasksCount: number;
    auditCount: number;
    decisionsCount: number;
    dbSize: number;
  } {
    if (!this.db) throw new Error('Database not initialized');

    const sessionsCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const tasksCount = this.db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
    const auditCount = this.db.prepare('SELECT COUNT(*) as count FROM audit').get() as { count: number };
    const decisionsCount = this.db.prepare('SELECT COUNT(*) as count FROM decisions').get() as { count: number };

    // Get database file size
    let dbSize = 0;
    try {
      const { statSync } = require('node:fs');
      dbSize = statSync(DB_PATH).size;
    } catch {
      // File might not exist yet
    }

    return {
      sessionsCount: sessionsCount.count,
      tasksCount: tasksCount.count,
      auditCount: auditCount.count,
      decisionsCount: decisionsCount.count,
      dbSize,
    };
  }

  vacuum(): void {
    if (!this.db) throw new Error('Database not initialized');

    console.log('[DatabaseManager] Running VACUUM...');
    this.db.exec('VACUUM');
    console.log('[DatabaseManager] VACUUM complete');
  }

  exportToJson(): string {
    if (!this.db) throw new Error('Database not initialized');

    const exportData = {
      version: '1.0',
      exportedAt: Date.now(),
      sessions: this.getAllSessions(),
      tasks: this.getAllTasks(),
      audit: this.getAuditLogs(1000),
      decisions: this.getAllDecisions(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  private getAllTasks(): TaskRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 1000');
    return stmt.all() as TaskRow[];
  }

  private getAllDecisions(): DecisionRow[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM decisions ORDER BY timestamp DESC LIMIT 1000');
    const rows = stmt.all() as DecisionRow[];

    return rows.map((row: DecisionRow) => ({
      ...row,
      auto_approved: typeof row.auto_approved === 'number' ? row.auto_approved === 1 : row.auto_approved,
      approved: typeof row.approved === 'number' ? row.approved === 1 : row.approved,
    }));
  }
}

// ============================================
// Global Singleton
// ============================================

let globalDatabaseManager: DatabaseManager | null = null;

export function getDatabaseManager(): DatabaseManager {
  if (!globalDatabaseManager) {
    globalDatabaseManager = new DatabaseManager();
  }
  return globalDatabaseManager;
}

export function resetDatabaseManager(): void {
  if (globalDatabaseManager) {
    globalDatabaseManager.close();
  }
  globalDatabaseManager = null;
}
