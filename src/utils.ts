/**
 * Utility functions for Claude Bridge Native CLI
 */

import winston from 'winston';
import winstonDailyRotateFile from 'winston-daily-rotate-file';
import path from 'node:path';
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// ES module equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.dirname(__dirname);
const BRAIN_DIR = path.join(PROJECT_ROOT, 'brain');
const LOGS_DIR = path.join(BRAIN_DIR, 'logs');

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Sanitize a file path for safe display in error messages
 * Removes sensitive information while keeping the path recognizable
 */
export function sanitizePath(path: string): string {
  if (!path) return "";

  // Replace common user profile paths with generic placeholders
  const sanitized = path
    .replace(/C:\\Users\\[^\\]+/gi, "C:\\Users\\[USER]")
    .replace(/C:\\Users\\[^\\]+/gi, "C:/Users/[USER]")
    .replace(/\/home\/[^\/]+/gi, "/home/[USER]")
    .replace(/\/Users\/[^\/]+/gi, "/Users/[USER]");

  // If the path is still too long, truncate it
  if (sanitized.length > 100) {
    return sanitized.substring(0, 50) + "..." + sanitized.substring(sanitized.length - 47);
  }

  return sanitized;
}

/**
 * Format a duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

/**
 * Format a timestamp to relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Escape HTML special characters for Telegram HTML parsing
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape Markdown special characters for Telegram Markdown parsing
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`")
    .replace(/\.?\./g, "\\."); // Escape ...
}

/**
 * Chunk a long message into smaller pieces for Telegram
 * Telegram message limit is 4096 characters
 */
export function chunkMessage(message: string, maxLength = 4000): string[] {
  const chunks: string[] = [];
  let currentChunk = "";

  const lines = message.split("\n");

  for (const line of lines) {
    const testChunk = currentChunk + (currentChunk ? "\n" : "") + line;

    if (testChunk.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = line;

      // If a single line is too long, split it
      while (currentChunk.length > maxLength) {
        chunks.push(currentChunk.slice(0, maxLength));
        currentChunk = currentChunk.slice(maxLength);
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
 * Create a Telegram inline keyboard with buttons
 */
export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardRow {
  buttons: InlineButton[];
}

export function createInlineKeyboard(rows: InlineKeyboardRow[]): {
  inline_keyboard: InlineButton[][];
} {
  return {
    inline_keyboard: rows.map((row) => row.buttons),
  };
}

/**
 * Extract code blocks from markdown text
 */
export function extractCodeBlocks(text: string): Array<{
  language: string;
  code: string;
  fullMatch: string;
}> {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const blocks: Array<{
    language: string;
    code: string;
    fullMatch: string;
  }> = [];

  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || "text",
      code: match[2],
      fullMatch: match[0],
    });
  }

  return blocks;
}

/**
 * Detect if text contains file operations that may need approval
 */
export function detectFileOperations(
  text: string
): Array<{ type: "edit" | "delete" | "create"; path: string }> {
  const operations: Array<{ type: "edit" | "delete" | "create"; path: string }> =
    [];

  // Match "Reading file:" lines (read operations, no approval needed)
  // Match "Editing file:" lines
  const editMatch = text.matchAll(
    /Editing\s+(?:file|existing file):\s*([^\n\r]+)$/gim
  );
  for (const match of editMatch) {
    operations.push({ type: "edit", path: match[1].trim() });
  }

  // Match "Creating file:" lines
  const createMatch = text.matchAll(/Creating\s+(?:new )?file:\s*([^\n\r]+)$/gim);
  for (const match of createMatch) {
    operations.push({ type: "create", path: match[1].trim() });
  }

  // Match delete-related patterns
  const deleteMatch = text.matchAll(
    /(?:Deleting|Delete|Removing|Remove)\s+(?:file|directory|folder|):\s*([^\n\r]+)$/gim
  );
  for (const match of deleteMatch) {
    operations.push({ type: "delete", path: match[1].trim() });
  }

  return operations;
}

/**
 * Parse Claude's tool use output for file operations
 */
export function parseToolUse(output: string): {
  edits: Array<{ path: string; action: "create" | "edit" | "delete" }>;
  errors: string[];
} {
  const edits: Array<{ path: string; action: "create" | "edit" | "delete" }> = [];
  const errors: string[] = [];

  const lines = output.split("\n");

  for (const line of lines) {
    // Check for tool use indicators
    if (line.includes("Tool used:") || line.includes("Using tool:")) {
      const toolName = line.split(/:\s*/).pop()?.toLowerCase() || "";

      if (
        toolName.includes("edit") ||
        toolName.includes("write") ||
        toolName.includes("create")
      ) {
        // Look for file path in nearby lines
        const pathMatch = output
          .substring(output.indexOf(line), output.indexOf(line) + 200)
          .match(/(?:file|path):\s*([^\n\r]+)/i);

        if (pathMatch) {
          edits.push({
            path: pathMatch[1].trim(),
            action: toolName.includes("create") ? "create" : "edit",
          });
        }
      }
    }
  }

  // Check for error indicators
  const errorLines = output.split("\n").filter((line) =>
    /error|failed|unable|cannot/i.test(line)
  );
  errors.push(...errorLines);

  return { edits, errors };
}

// ============================================================================
// Logging System - Winston-based persistent logging
// ============================================================================

/**
 * Log levels
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  HTTP = 'http',
  DEBUG = 'debug',
  SILLY = 'silly',
}

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  timestamp: string;
  level: string;
  action: string;
  chatId?: number;
  userId?: number;
  projectPath?: string;
  details: Record<string, unknown>;
  result?: 'success' | 'failure' | 'pending';
}

/**
 * Logger class for consistent logging
 * Wraps Winston for persistent file-based logging
 */
export class Logger {
  private level: "debug" | "info" | "warn" | "error";
  private winston: any = null;
  private initialized = false;

  constructor(level: "debug" | "info" | "warn" | "error" = "info") {
    this.level = level;
    // Initialize logging immediately
    this.initWinston();
  }

  private initWinston(): void {
    if (this.initialized) return;

    try {
      // Create Winston logger using imported modules
      this.winston = winston.createLogger({
        level: this.level,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          winston.format.json()
        ),
        defaultMeta: { service: 'claude-bridge' },
        transports: [
          // Console
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize({ all: true }),
              winston.format.timestamp({ format: 'HH:mm:ss' }),
              winston.format.printf((info: any) => {
                const { timestamp, level, message, ...meta } = info;
                let msg = `${timestamp} [${level}]: ${message}`;
                if (Object.keys(meta).length > 0 && meta !== null && typeof meta === 'object') {
                  const cleanMeta = { ...meta };
                  delete cleanMeta.service;
                  delete cleanMeta.level;
                  delete cleanMeta.timestamp;
                  if (Object.keys(cleanMeta).length > 0) {
                    msg += ` ${JSON.stringify(cleanMeta)}`;
                  }
                }
                return msg;
              })
            ),
          }),
          // App log (info+)
          new winstonDailyRotateFile({
            filename: path.join(LOGS_DIR, 'app-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d',
            level: 'info',
          }),
          // Error log
          new winstonDailyRotateFile({
            filename: path.join(LOGS_DIR, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '90d',
            level: 'error',
          }),
          // Audit log
          new winstonDailyRotateFile({
            filename: path.join(LOGS_DIR, 'audit-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '365d',
            level: 'info',
          }),
        ],
        exceptionHandlers: [
          new winston.transports.File({
            filename: path.join(LOGS_DIR, 'exceptions.log'),
          }),
        ],
        rejectionHandlers: [
          new winston.transports.File({
            filename: path.join(LOGS_DIR, 'rejections.log'),
          }),
        ],
      });

      this.initialized = true;
    } catch (error) {
      console.error('[Logger] Failed to initialize Winston:', error);
      this.initialized = true;
    }
  }

  private shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.level];
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      if (this.winston) {
        this.winston.debug(message, meta);
      } else {
        console.debug(`[${new Date().toISOString()}] DEBUG: ${message}`, meta || '');
      }
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      if (this.winston) {
        this.winston.info(message, meta);
      } else {
        console.info(`[${new Date().toISOString()}] INFO: ${message}`, meta || '');
      }
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      if (this.winston) {
        this.winston.warn(message, meta);
      } else {
        console.warn(`[${new Date().toISOString()}] WARN: ${message}`, meta || '');
      }
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      if (this.winston) {
        this.winston.error(message, meta);
      } else {
        console.error(`[${new Date().toISOString()}] ERROR: ${message}`, meta || '');
      }
    }
  }
}

// Winston logging helper functions
export function getLogsDir(): string {
  return LOGS_DIR;
}

export async function getRecentLogs(
  type: 'app' | 'error' | 'audit' = 'app',
  limit = 50
): Promise<string[]> {
  const today = new Date().toISOString().split('T')[0];
  const logPath = path.join(LOGS_DIR, `${type}-${today}.log`);

  if (!existsSync(logPath)) {
    return [];
  }

  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.split('\n').filter((line: string) => line.trim());
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

export async function searchLogs(
  query: string,
  type: 'app' | 'error' | 'audit' = 'app',
  days = 7
): Promise<Array<{ date: string; line: string }>> {
  const results: Array<{ date: string; line: string }> = [];

  const files = readdirSync(LOGS_DIR)
    .filter((f: string) => f.startsWith(`${type}-`) && f.endsWith('.log'))
    .sort()
    .slice(-days);

  for (const file of files) {
    const logPath = path.join(LOGS_DIR, file);
    if (!existsSync(logPath)) continue;

    try {
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            date: file.slice(`${type}-`.length, -4),
            line,
          });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return results;
}

export async function getErrorLogs(limit = 50): Promise<string[]> {
  return getRecentLogs('error', limit);
}

export async function getAuditLogs(limit = 100): Promise<string[]> {
  return getRecentLogs('audit', limit);
}

export function logAudit(entry: AuditLogEntry): void {
  const logger = new Logger('info');
  logger.info('AUTONOMOUS_ACTION', {
    ...entry,
    audit: true,
  });
}

export async function clearOldLogs(daysToKeep = 30): Promise<number> {
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  let cleared = 0;

  try {
    const files = readdirSync(LOGS_DIR);
    for (const file of files) {
      if (file === 'exceptions.log' || file === 'rejections.log') {
        continue;
      }

      const filePath = path.join(LOGS_DIR, file);
      if (!existsSync(filePath)) continue;

      try {
        const stats = statSync(filePath);
        if (stats.mtimeMs < cutoff) {
          unlinkSync(filePath);
          cleared++;
        }
      } catch {
        // Skip files that can't be accessed
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return cleared;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (...args: Parameters<T>) {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), wait);
  };
}
