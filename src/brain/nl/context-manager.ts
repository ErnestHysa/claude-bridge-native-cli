/**
 * Context Manager for Natural Language Interface
 *
 * Tracks per-conversation state including working directory,
 * open files, command history, and explicit context.
 */

import { Logger } from '../../utils.js';
import type {
  ConversationContext,
  CommandEntry,
  ContextPreferences,
  Intent,
} from './types.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger('info');

/**
 * Default context preferences
 */
const DEFAULT_PREFERENCES: ContextPreferences = {
  autoConfirmReads: true,
  autoConfirmSafeEdits: false,
  preferredLanguage: 'en',
  defaultFilePattern: '*',
};

/**
 * Maximum history to keep per conversation
 */
const MAX_COMMAND_HISTORY = 100;
const MAX_EXPLICIT_CONTEXT = 50;
const MAX_OPEN_FILES = 20;

/**
 * Context storage directory
 */
const CONTEXT_STORAGE_DIR = 'src/brain/sessions/context';

/**
 * Context Manager class
 *
 * Manages per-chat conversation context for natural language processing
 */
export class ContextManager {
  private contexts: Map<number, ConversationContext>;
  private storageDir: string;
  private persistenceEnabled: boolean;

  constructor(storageDir: string = CONTEXT_STORAGE_DIR, persistenceEnabled: boolean = true) {
    this.contexts = new Map();
    this.storageDir = storageDir;
    this.persistenceEnabled = persistenceEnabled;

    if (this.persistenceEnabled) {
      this.ensureStorageDirectory();
      this.loadAllContexts();
    }
  }

  /**
   * Get or create context for a chat
   */
  getContext(chatId: number, workingDirectory: string = ''): ConversationContext {
    let context = this.contexts.get(chatId);

    if (!context) {
      context = this.createContext(chatId, workingDirectory);
      this.contexts.set(chatId, context);
      logger.debug(`Created new context for chat ${chatId}`);
    }

    return context;
  }

  /**
   * Get context without creating if it doesn't exist
   */
  getContextIfExists(chatId: number): ConversationContext | undefined {
    return this.contexts.get(chatId);
  }

  /**
   * Update working directory for a chat
   */
  setWorkingDirectory(chatId: number, directory: string): void {
    const context = this.getContext(chatId);
    context.workingDirectory = directory;
    this.saveContext(chatId);
    logger.debug(`Set working directory for chat ${chatId} to ${directory}`);
  }

  /**
   * Get working directory for a chat
   */
  getWorkingDirectory(chatId: number): string {
    const context = this.getContext(chatId);
    return context.workingDirectory;
  }

  /**
   * Add a file to the open files set
   */
  addOpenFile(chatId: number, filePath: string): void {
    const context = this.getContext(chatId);

    // Trim if too many open files
    if (context.openFiles.size >= MAX_OPEN_FILES) {
      const firstFile = context.openFiles.values().next().value;
      if (firstFile !== undefined) {
        context.openFiles.delete(firstFile);
      }
    }

    context.openFiles.add(filePath);
    this.saveContext(chatId);
    logger.debug(`Added open file ${filePath} for chat ${chatId}`);
  }

  /**
   * Remove a file from the open files set
   */
  removeOpenFile(chatId: number, filePath: string): void {
    const context = this.getContext(chatId);
    context.openFiles.delete(filePath);
    this.saveContext(chatId);
    logger.debug(`Removed open file ${filePath} for chat ${chatId}`);
  }

  /**
   * Get all open files for a chat
   */
  getOpenFiles(chatId: number): Set<string> {
    const context = this.getContext(chatId);
    return context.openFiles;
  }

  /**
   * Clear all open files for a chat
   */
  clearOpenFiles(chatId: number): void {
    const context = this.getContext(chatId);
    context.openFiles.clear();
    this.saveContext(chatId);
    logger.debug(`Cleared open files for chat ${chatId}`);
  }

  /**
   * Add a command to history
   */
  addCommandToHistory(
    chatId: number,
    command: string,
    intent: Intent,
    result?: string,
    duration?: number,
    success: boolean = true
  ): void {
    const context = this.getContext(chatId);

    const entry: CommandEntry = {
      command,
      intent,
      result,
      timestamp: Date.now(),
      duration,
      success,
    };

    context.recentCommands.push(entry);

    // Trim history if too long
    if (context.recentCommands.length > MAX_COMMAND_HISTORY) {
      context.recentCommands = context.recentCommands.slice(-MAX_COMMAND_HISTORY);
    }

    // Update last intent
    context.lastIntent = intent;

    this.saveContext(chatId);
    logger.debug(`Added command to history for chat ${chatId}: ${command}`);
  }

  /**
   * Get command history for a chat
   */
  getCommandHistory(chatId: number, limit?: number): CommandEntry[] {
    const context = this.getContext(chatId);
    if (limit) {
      return context.recentCommands.slice(-limit);
    }
    return [...context.recentCommands];
  }

  /**
   * Get the last intent for a chat
   */
  getLastIntent(chatId: number): Intent | undefined {
    const context = this.getContext(chatId);
    return context.lastIntent;
  }

  /**
   * Add explicit context statement
   */
  addExplicitContext(chatId: number, statement: string): void {
    const context = this.getContext(chatId);

    context.explicitContext.push(statement);

    // Trim if too many
    if (context.explicitContext.length > MAX_EXPLICIT_CONTEXT) {
      context.explicitContext = context.explicitContext.slice(-MAX_EXPLICIT_CONTEXT);
    }

    this.saveContext(chatId);
    logger.debug(`Added explicit context for chat ${chatId}: ${statement}`);
  }

  /**
   * Get all explicit context statements
   */
  getExplicitContext(chatId: number): string[] {
    const context = this.getContext(chatId);
    return [...context.explicitContext];
  }

  /**
   * Search explicit context for a keyword
   */
  searchExplicitContext(chatId: number, keyword: string): string[] {
    const context = this.getContext(chatId);
    const lowerKeyword = keyword.toLowerCase();
    return context.explicitContext.filter(stmt =>
      stmt.toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * Set project type for context
   */
  setProjectType(chatId: number, projectType: string): void {
    const context = this.getContext(chatId);
    context.projectType = projectType;
    this.saveContext(chatId);
    logger.debug(`Set project type for chat ${chatId} to ${projectType}`);
  }

  /**
   * Get project type for context
   */
  getProjectType(chatId: number): string | undefined {
    const context = this.getContext(chatId);
    return context.projectType;
  }

  /**
   * Update preferences for a chat
   */
  updatePreferences(chatId: number, updates: Partial<ContextPreferences>): void {
    const context = this.getContext(chatId);
    context.preferences = { ...context.preferences, ...updates };
    this.saveContext(chatId);
    logger.debug(`Updated preferences for chat ${chatId}`);
  }

  /**
   * Get preferences for a chat
   */
  getPreferences(chatId: number): ContextPreferences {
    const context = this.getContext(chatId);
    return { ...context.preferences };
  }

  /**
   * Clear all context for a chat
   */
  clearContext(chatId: number): void {
    const context = this.getContext(chatId);

    // Clear everything but preferences
    const preferences = context.preferences;

    context.workingDirectory = '';
    context.openFiles.clear();
    context.recentCommands = [];
    context.explicitContext = [];
    context.lastIntent = undefined;
    context.preferences = preferences;

    this.saveContext(chatId);
    logger.debug(`Cleared context for chat ${chatId}`);
  }

  /**
   * Reset context for a chat (including preferences)
   */
  resetContext(chatId: number): void {
    this.contexts.delete(chatId);
    this.deleteContextFile(chatId);
    logger.debug(`Reset context for chat ${chatId}`);
  }

  /**
   * Get all active chat IDs
   */
  getActiveChats(): number[] {
    return Array.from(this.contexts.keys());
  }

  /**
   * Get context summary for a chat
   */
  getContextSummary(chatId: number): {
    workingDirectory: string;
    openFilesCount: number;
    commandHistoryCount: number;
    explicitContextCount: number;
    projectType?: string;
    lastCommand?: string;
    lastCommandTime?: number;
  } {
    const context = this.getContext(chatId);
    const lastCommand = context.recentCommands[context.recentCommands.length - 1];

    return {
      workingDirectory: context.workingDirectory,
      openFilesCount: context.openFiles.size,
      commandHistoryCount: context.recentCommands.length,
      explicitContextCount: context.explicitContext.length,
      projectType: context.projectType,
      lastCommand: lastCommand?.command,
      lastCommandTime: lastCommand?.timestamp,
    };
  }

  /**
   * Create a new context object
   */
  private createContext(chatId: number, workingDirectory: string): ConversationContext {
    return {
      chatId,
      workingDirectory,
      openFiles: new Set<string>(),
      recentCommands: [],
      explicitContext: [],
      preferences: { ...DEFAULT_PREFERENCES },
    };
  }

  /**
   * Save context to disk
   */
  private saveContext(chatId: number): void {
    if (!this.persistenceEnabled) return;

    try {
      const context = this.contexts.get(chatId);
      if (!context) return;

      const filePath = this.getContextFilePath(chatId);
      const serializable = {
        ...context,
        openFiles: Array.from(context.openFiles), // Convert Set to Array
      };

      writeFileSync(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`Failed to save context for chat ${chatId}: ${error}`);
    }
  }

  /**
   * Load context from disk
   */
  private loadContext(chatId: number): ConversationContext | null {
    if (!this.persistenceEnabled) return null;

    try {
      const filePath = this.getContextFilePath(chatId);
      if (!existsSync(filePath)) return null;

      const data = readFileSync(filePath, 'utf-8');
      const loaded = JSON.parse(data);

      // Convert Array back to Set
      return {
        ...loaded,
        openFiles: new Set<string>(loaded.openFiles || []),
        preferences: { ...DEFAULT_PREFERENCES, ...loaded.preferences },
      };
    } catch (error) {
      logger.error(`Failed to load context for chat ${chatId}: ${error}`);
      return null;
    }
  }

  /**
   * Load all contexts from disk
   */
  private loadAllContexts(): void {
    if (!this.persistenceEnabled) return;

    try {
      if (!existsSync(this.storageDir)) return;

      const files = readdirSync(this.storageDir);
      let loaded = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const match = file.match(/^context_(\d+)\.json$/);
        if (!match) continue;

        const chatId = parseInt(match[1], 10);
        const context = this.loadContext(chatId);

        if (context) {
          this.contexts.set(chatId, context);
          loaded++;
        }
      }

      logger.info(`Loaded ${loaded} contexts from disk`);
    } catch (error) {
      logger.error(`Failed to load contexts: ${error}`);
    }
  }

  /**
   * Delete context file from disk
   */
  private deleteContextFile(chatId: number): void {
    if (!this.persistenceEnabled) return;

    try {
      const filePath = this.getContextFilePath(chatId);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (error) {
      logger.error(`Failed to delete context file for chat ${chatId}: ${error}`);
    }
  }

  /**
   * Get file path for a context
   */
  private getContextFilePath(chatId: number): string {
    return join(this.storageDir, `context_${chatId}.json`);
  }

  /**
   * Ensure storage directory exists
   */
  private ensureStorageDirectory(): void {
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true });
        logger.debug(`Created context storage directory: ${this.storageDir}`);
      }
    } catch (error) {
      logger.error(`Failed to create storage directory: ${error}`);
    }
  }

  /**
   * Save all contexts (for graceful shutdown)
   */
  saveAll(): void {
    if (!this.persistenceEnabled) return;

    for (const chatId of this.contexts.keys()) {
      this.saveContext(chatId);
    }

    logger.debug(`Saved ${this.contexts.size} contexts to disk`);
  }
}

/**
 * Default singleton instance
 */
let defaultManager: ContextManager | null = null;

export function getContextManager(storageDir?: string, persistenceEnabled?: boolean): ContextManager {
  if (!defaultManager) {
    defaultManager = new ContextManager(storageDir, persistenceEnabled);
  }
  return defaultManager;
}

export function resetContextManager(): void {
  if (defaultManager) {
    defaultManager.saveAll();
    defaultManager = null;
  }
}
