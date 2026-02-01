/**
 * Configuration management for Claude Bridge Native CLI
 */

import { readFileSync, existsSync } from "node:fs";
import { normalize } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";
import type { BridgeConfig } from "./types.js";

// Load environment variables
dotenvConfig();

// Configuration schema
const configSchema = z.object({
  // Telegram
  telegramBotToken: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  telegramBotUsername: z.string().min(1, "TELEGRAM_BOT_USERNAME is required"),
  allowedUsers: z.string().default(""),
  allowedUserIds: z.string().default(""),

  // Projects
  projectsBase: z.string().default("C:\\Users\\ErnestHome\\DEVPROJECTS"),
  autoScanIntervalMs: z.number().default(300_000), // 5 minutes

  // Claude CLI
  claudeDefaultModel: z.string().default("claude-3-5-sonnet"),
  claudeTimeoutMs: z.number().default(0), // 0 = no timeout (run indefinitely), 300000 = 5 minutes
  claudePermissionMode: z.enum(["acceptEdits", "bypassPermissions", "default", "delegate", "dontAsk", "plan"]).default("acceptEdits"),

  // Sessions
  sessionTimeoutMs: z.number().default(3600000), // 1 hour
  maxConcurrentSessions: z.number().default(5),

  // File Operations
  autoApproveSafeEdits: z.boolean().default(true),
  autoApproveReads: z.boolean().default(true),
  requireApprovalForDeletes: z.boolean().default(true),
  requireApprovalForMassChanges: z.boolean().default(true),
  massChangeThreshold: z.number().default(5),

  // Logging
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/**
 * Internal config type (with string arrays as comma-separated strings)
 */
interface RawConfig {
  telegramBotToken: string;
  telegramBotUsername: string;
  allowedUsers: string;
  allowedUserIds: string;
  projectsBase?: string;
  autoScanIntervalMs?: number;
  claudeDefaultModel?: string;
  claudeTimeoutMs?: number;
  claudePermissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'delegate' | 'dontAsk' | 'plan';
  sessionTimeoutMs?: number;
  maxConcurrentSessions?: number;
  autoApproveSafeEdits?: boolean;
  autoApproveReads?: boolean;
  requireApprovalForDeletes?: boolean;
  requireApprovalForMassChanges?: boolean;
  massChangeThreshold?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Load and validate configuration
 */
export function loadConfig(configPath?: string): BridgeConfig {
  // If configPath provided, try to load from it
  if (configPath && existsSync(configPath)) {
    try {
      const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      return transformConfig(configSchema.parse(rawConfig));
    } catch (err) {
      console.warn(`Failed to load config from ${configPath}:`, err);
    }
  }

  // Load from environment variables
  const raw = configSchema.parse({
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
    allowedUsers: process.env.ALLOWED_USERS ?? "",
    allowedUserIds: process.env.ALLOWED_USER_IDS ?? "",

    projectsBase: process.env.PROJECTS_BASE,
    autoScanIntervalMs: process.env.AUTO_SCAN_INTERVAL_MS
      ? Number.parseInt(process.env.AUTO_SCAN_INTERVAL_MS, 10)
      : undefined,

    claudeDefaultModel: process.env.CLAUDE_DEFAULT_MODEL,
    claudeTimeoutMs: process.env.CLAUDE_TIMEOUT_MS
      ? Number.parseInt(process.env.CLAUDE_TIMEOUT_MS, 10)
      : undefined,
    claudePermissionMode: process.env.CLAUDE_PERMISSION_MODE as 'acceptEdits' | 'bypassPermissions' | 'default' | 'delegate' | 'dontAsk' | 'plan' | undefined,

    sessionTimeoutMs: process.env.SESSION_TIMEOUT_MS
      ? Number.parseInt(process.env.SESSION_TIMEOUT_MS, 10)
      : undefined,
    maxConcurrentSessions: process.env.MAX_CONCURRENT_SESSIONS
      ? Number.parseInt(process.env.MAX_CONCURRENT_SESSIONS, 10)
      : undefined,

    autoApproveSafeEdits: process.env.AUTO_APPROVE_SAFE_EDITS === "true",
    autoApproveReads: process.env.AUTO_APPROVE_READS !== "false",
    requireApprovalForDeletes: process.env.REQUIRE_APPROVAL_FOR_DELETES !== "false",
    requireApprovalForMassChanges: process.env.REQUIRE_APPROVAL_FOR_MASS_CHANGES !== "false",
    massChangeThreshold: process.env.MASS_CHANGE_THRESHOLD
      ? Number.parseInt(process.env.MASS_CHANGE_THRESHOLD, 10)
      : undefined,

    logLevel: process.env.LOG_LEVEL,
  });

  return transformConfig(raw);
}

/**
 * Transform raw config to BridgeConfig (convert comma-separated strings to arrays)
 */
function transformConfig(raw: RawConfig): BridgeConfig {
  return {
    telegramBotToken: raw.telegramBotToken,
    telegramBotUsername: raw.telegramBotUsername,
    allowedUsers: raw.allowedUsers ? raw.allowedUsers.split(",").map(u => u.trim()).filter(u => u) : [],
    allowedUserIds: raw.allowedUserIds ? raw.allowedUserIds.split(",").map(id => Number.parseInt(id.trim(), 10)).filter(id => !Number.isNaN(id)) : [],
    projectsBase: raw.projectsBase ?? "C:\\Users\\ErnestHome\\DEVPROJECTS",
    autoScanIntervalMs: raw.autoScanIntervalMs ?? 300_000,
    claudeDefaultModel: raw.claudeDefaultModel ?? "claude-3-5-sonnet",
    claudeTimeoutMs: raw.claudeTimeoutMs ?? 0, // 0 = no timeout (run indefinitely)
    claudePermissionMode: raw.claudePermissionMode ?? "acceptEdits",
    sessionTimeoutMs: raw.sessionTimeoutMs ?? 3600000,
    maxConcurrentSessions: raw.maxConcurrentSessions ?? 5,
    autoApproveSafeEdits: raw.autoApproveSafeEdits ?? true,
    autoApproveReads: raw.autoApproveReads ?? true,
    requireApprovalForDeletes: raw.requireApprovalForDeletes ?? true,
    requireApprovalForMassChanges: raw.requireApprovalForMassChanges ?? true,
    massChangeThreshold: raw.massChangeThreshold ?? 5,
    logLevel: raw.logLevel ?? "info",
  };
}

/**
 * Get the projects base directory, normalized
 */
export function getProjectsBase(config: BridgeConfig): string {
  return normalize(config.projectsBase);
}

/**
 * Get allowed user IDs list (already parsed as array)
 */
export function getAllowedUserIds(config: BridgeConfig): number[] {
  return config.allowedUserIds;
}

/**
 * Get allowed usernames list (already parsed as array)
 */
export function getAllowedUsernames(config: BridgeConfig): string[] {
  return config.allowedUsers;
}

/**
 * Validate configuration is complete
 */
export function validateConfig(config: BridgeConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.telegramBotToken || config.telegramBotToken === "your_bot_token_here") {
    errors.push("TELEGRAM_BOT_TOKEN must be set");
  }

  if (!config.telegramBotUsername || config.telegramBotUsername === "your_bot_username_here") {
    errors.push("TELEGRAM_BOT_USERNAME must be set");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Global config instance (lazy loaded)
let globalConfig: BridgeConfig | null = null;

/**
 * Get global configuration instance
 */
export function getGlobalConfig(): BridgeConfig {
  if (!globalConfig) {
    globalConfig = loadConfig();
    const validation = validateConfig(globalConfig);
    if (!validation.valid) {
      throw new Error(`Invalid configuration:\n${validation.errors.join("\n")}`);
    }
  }
  return globalConfig;
}

/**
 * Reset global config (useful for testing)
 */
export function resetGlobalConfig(): void {
  globalConfig = null;
}
