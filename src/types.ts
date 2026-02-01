/**
 * TypeScript types for Claude Bridge Native CLI
 */

// ===========================================
// Project Types
// ===========================================

export interface Project {
  name: string;
  path: string;
  isGit: boolean;
  lastModified: number;
  sessionCount: number;
  branch?: string;
  status?: 'active' | 'idle' | 'error';
}

export interface ProjectDetectionResult {
  projects: Project[];
  scannedAt: number;
  scanPath: string;
}

// ===========================================
// Session Types (Per Telegram Chat)
// ===========================================

export interface ChatSession {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  currentProject: Project | null;
  claudeProcess: ClaudeProcess | null;
  conversationHistory: ConversationMessage[];
  pendingApproval: EditApprovalRequest | null;
  status: 'idle' | 'processing' | 'awaiting_approval';
  lastActivity: number;
}

export interface ClaudeProcess {
  pid: number;
  project: Project;
  prompt: string;
  startTime: number;
  status: 'starting' | 'running' | 'completed' | 'error' | 'cancelled';
  outputBuffer: string[];
  onOutput?: (data: string) => void;  // Streaming callback
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

// ===========================================
// Edit Approval Types
// ===========================================

export interface EditApprovalRequest {
  id: string;
  project: Project;
  files: FileEdit[];
  type: 'edit' | 'delete' | 'create';
  timestamp: number;
}

export interface FileEdit {
  path: string;
  action: 'modify' | 'create' | 'delete';
  diff?: string;
  newContent?: string;
  lineCount?: number;
}

// ===========================================
// Claude CLI Types
// ===========================================

export interface ClaudeCliOptions {
  cwd: string;
  prompt: string;
  model?: string;
  editor?: string;
  // Output format for Claude CLI --output-format option
  // Valid values: "text" (default), "json", "stream-json"
  output?: 'text' | 'json' | 'stream-json';
  maxTokens?: number;
}

export interface ClaudeCliResult {
  exitCode: number;
  output: string;
  edits: FileEdit[];
  errors: string[];
  duration: number;
}

// ===========================================
// Telegram Bot Types
// ===========================================

export interface TelegramConfig {
  botToken: string;
  botUsername: string;
  allowedUsers: string[];
  allowedUserIds: number[];
}

export interface BotCommand {
  command: string;
  description: string;
  handler: (ctx: any) => Promise<void>;
}

// ===========================================
// Configuration Types
// ===========================================

export interface BridgeConfig {
  // Telegram
  telegramBotToken: string;
  telegramBotUsername: string;
  allowedUsers: string[];
  allowedUserIds: number[];

  // Projects
  projectsBase: string;
  autoScanIntervalMs: number;

  // Claude CLI
  claudeDefaultModel: string;
  claudeTimeoutMs: number;
  claudePermissionMode: 'acceptEdits' | 'bypassPermissions' | 'default' | 'delegate' | 'dontAsk' | 'plan';

  // Sessions
  sessionTimeoutMs: number;
  maxConcurrentSessions: number;

  // File Operations
  autoApproveSafeEdits: boolean;
  autoApproveReads: boolean;
  requireApprovalForDeletes: boolean;
  requireApprovalForMassChanges: boolean;
  massChangeThreshold: number;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ===========================================
// Error Types
// ===========================================

export class BridgeError extends Error {
  code: string;
  context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.context = context;
  }
}
