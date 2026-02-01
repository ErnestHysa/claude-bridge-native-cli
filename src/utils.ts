/**
 * Utility functions for Claude Bridge Native CLI
 */

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

/**
 * Logger class for consistent logging
 */
export class Logger {
  private level: "debug" | "info" | "warn" | "error";

  constructor(level: "debug" | "info" | "warn" | "error" = "info") {
    this.level = level;
  }

  private shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.level];
  }

  private formatMessage(
    level: string,
    message: string,
    meta?: Record<string, unknown>
  ): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, meta));
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, meta));
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, meta));
    }
  }
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
