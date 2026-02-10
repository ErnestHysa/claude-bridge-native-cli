/**
 * Long-term Memory Persistence
 *
 * Manages persistent memory across sessions including conversation summaries,
 * learned patterns, user preferences, and project knowledge.
 */

import { Logger } from '../../utils.js';
import { generateId } from '../../utils.js';
import type {
  LongTermMemory,
  ConversationSummary,
  LearnedPattern,
  PersistentPreference,
  CommandEntry,
  Intent,
} from './types.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger('info');

/**
 * Memory storage directories
 */
const LONG_TERM_DIR = 'src/brain/memory/long-term';
const PATTERNS_DIR = 'src/brain/memory/patterns';
const SUMMARIES_DIR = 'src/brain/memory/long-term/summaries';
const PREFERENCES_DIR = 'src/brain/memory/long-term/preferences';

/**
 * Maximum items per category before compaction
 */
const MAX_SUMMARIES = 100;
const MAX_PATTERNS = 500;

/**
 * Memory Persistor class
 */
export class MemoryPersistor {
  private memories: Map<number, LongTermMemory>;
  private storageEnabled: boolean;

  constructor(storageEnabled: boolean = true) {
    this.memories = new Map();
    this.storageEnabled = storageEnabled;

    if (this.storageEnabled) {
      this.ensureDirectories();
      this.loadAllMemories();
    }
  }

  /**
   * Get or create memory for a chat
   */
  getMemory(chatId: number): LongTermMemory {
    let memory = this.memories.get(chatId);

    if (!memory) {
      memory = this.createMemory(chatId);
      this.memories.set(chatId, memory);
    }

    return memory;
  }

  /**
   * Add a conversation summary
   */
  addSummary(chatId: number, summary: Omit<ConversationSummary, 'id'>): void {
    const memory = this.getMemory(chatId);

    const newSummary: ConversationSummary = {
      id: generateId(),
      ...summary,
    };

    memory.summaries.push(newSummary);

    // Compact if too many
    if (memory.summaries.length > MAX_SUMMARIES) {
      this.compactSummaries(chatId);
    }

    memory.lastUpdated = Date.now();
    this.saveMemory(chatId);

    logger.debug(`Added summary for chat ${chatId}: ${summary.topic}`);
  }

  /**
   * Get recent summaries for a chat
   */
  getSummaries(chatId: number, limit?: number): ConversationSummary[] {
    const memory = this.getMemory(chatId);
    const sorted = [...memory.summaries].sort((a, b) => b.endTime - a.endTime);

    if (limit) {
      return sorted.slice(0, limit);
    }

    return sorted;
  }

  /**
   * Search summaries by keyword
   */
  searchSummaries(chatId: number, keyword: string): ConversationSummary[] {
    const memory = this.getMemory(chatId);
    const lowerKeyword = keyword.toLowerCase();

    return memory.summaries.filter(summary =>
      summary.topic.toLowerCase().includes(lowerKeyword) ||
      summary.keyPoints.some(point => point.toLowerCase().includes(lowerKeyword)) ||
      summary.decisions.some(decision => decision.toLowerCase().includes(lowerKeyword))
    );
  }

  /**
   * Add a learned pattern
   */
  addPattern(chatId: number, pattern: Omit<LearnedPattern, 'id' | 'lastSeen'>): void {
    const memory = this.getMemory(chatId);

    // Check if pattern already exists
    const existing = memory.patterns.find(
      p => p.type === pattern.type && p.pattern === pattern.pattern
    );

    if (existing) {
      existing.frequency++;
      existing.lastSeen = Date.now();
      existing.confidence = Math.min(1, existing.confidence + 0.1);
    } else {
      const newPattern: LearnedPattern = {
        id: generateId(),
        ...pattern,
        lastSeen: Date.now(),
      };

      memory.patterns.push(newPattern);
    }

    // Compact if too many
    if (memory.patterns.length > MAX_PATTERNS) {
      this.compactPatterns(chatId);
    }

    memory.lastUpdated = Date.now();
    this.saveMemory(chatId);

    logger.debug(`Added pattern for chat ${chatId}: ${pattern.pattern}`);
  }

  /**
   * Get patterns for a chat
   */
  getPatterns(chatId: number, type?: LearnedPattern['type']): LearnedPattern[] {
    const memory = this.getMemory(chatId);
    let patterns = [...memory.patterns].sort((a, b) => b.frequency - a.frequency);

    if (type) {
      patterns = patterns.filter(p => p.type === type);
    }

    return patterns;
  }

  /**
   * Get patterns by confidence threshold
   */
  getHighConfidencePatterns(chatId: number, minConfidence: number = 0.5): LearnedPattern[] {
    const memory = this.getMemory(chatId);
    return memory.patterns.filter(p => p.confidence >= minConfidence);
  }

  /**
   * Update persistent preferences
   */
  updatePreferences(chatId: number, updates: Partial<PersistentPreference>): void {
    const memory = this.getMemory(chatId);

    memory.preferences = {
      ...memory.preferences,
      ...updates,
    };

    // Merge arrays instead of replacing
    if (updates.preferredTools) {
      memory.preferences.preferredTools = {
        ...memory.preferences.preferredTools,
        ...updates.preferredTools,
      };
    }

    if (updates.commonPaths) {
      memory.preferences.commonPaths = [
        ...memory.preferences.commonPaths,
        ...updates.commonPaths,
      ];
    }

    if (updates.aliasMappings) {
      memory.preferences.aliasMappings = {
        ...memory.preferences.aliasMappings,
        ...updates.aliasMappings,
      };
    }

    memory.lastUpdated = Date.now();
    this.saveMemory(chatId);

    logger.debug(`Updated preferences for chat ${chatId}`);
  }

  /**
   * Get preferences for a chat
   */
  getPreferences(chatId: number): PersistentPreference {
    const memory = this.getMemory(chatId);
    return { ...memory.preferences };
  }

  /**
   * Learn from command history
   */
  learnFromCommand(chatId: number, command: CommandEntry): void {
    // Learn command usage patterns
    const commandWords = command.command.toLowerCase().split(/\s+/);

    // Learn tool preferences
    if (command.intent.tool) {
      this.updatePreferences(chatId, {
        preferredTools: {
          [commandWords[0]]: command.intent.tool,
        },
      });
    }

    // Learn file relationships (if file was involved)
    const filePath = command.intent.parameters.find(p => p.name === 'filePath');
    if (filePath && typeof filePath.value === 'string') {
      const extension = filePath.value.split('.').pop();
      if (extension) {
        this.addPattern(chatId, {
          type: 'file_relationship',
          pattern: `Files with .${extension} extension`,
          frequency: 1,
          confidence: 0.3,
        });
      }
    }

    // Learn workflow patterns (sequences of commands)
    // TODO: Could add more sophisticated pattern detection here
  }

  /**
   * Create conversation summary from session data
   */
  createSummary(
    _chatId: number,
    sessionData: {
      startTime: number;
      endTime: number;
      commands: CommandEntry[];
      keyTopics?: string[];
    }
  ): ConversationSummary {
    const { startTime, endTime, commands, keyTopics } = sessionData;

    // Determine main topic
    const topic = this.determineTopic(commands, keyTopics);

    // Extract key points from commands
    const keyPoints = this.extractKeyPoints(commands);

    // Extract decisions made
    const decisions = this.extractDecisions(commands);

    // Suggest next steps
    const nextSteps = this.suggestNextSteps(commands);

    return {
      id: generateId(),
      startTime,
      endTime,
      topic,
      keyPoints,
      decisions,
      nextSteps,
    };
  }

  /**
   * Determine main topic of conversation
   */
  private determineTopic(commands: CommandEntry[], keyTopics?: string[]): string {
    if (keyTopics && keyTopics.length > 0) {
      return keyTopics[0];
    }

    // Analyze command intents to determine topic
    const intents = commands.map(c => c.intent.type);
    const intentCounts = new Map<string, number>();

    for (const intent of intents) {
      intentCounts.set(intent, (intentCounts.get(intent) || 0) + 1);
    }

    // Find most common intent
    let maxCount = 0;
    let dominantIntent: Intent['type'] = 'unknown';

    for (const [intent, count] of intentCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantIntent = intent as Intent['type'];
      }
    }

    // Generate topic from dominant intent
    const topicMap: Record<string, string> = {
      search_files: 'File exploration',
      search_content: 'Code searching',
      edit_file: 'Code editing',
      create_file: 'File creation',
      run_command: 'Command execution',
      run_tests: 'Testing',
      analyze_code: 'Code analysis',
      explain_code: 'Code explanation',
      refactor_code: 'Refactoring',
      git_operation: 'Git operations',
    };

    return topicMap[dominantIntent] || 'General work session';
  }

  /**
   * Extract key points from commands
   */
  private extractKeyPoints(commands: CommandEntry[]): string[] {
    const points: string[] = [];

    for (const cmd of commands) {
      // Extract from intent parameters
      for (const param of cmd.intent.parameters) {
        if (param.name === 'filePath' && typeof param.value === 'string') {
          points.push(`Worked on ${this.basename(param.value)}`);
        } else if (param.name === 'command') {
          points.push(`Executed: ${param.value}`);
        }
      }

      // Limit key points
      if (points.length >= 10) break;
    }

    return points;
  }

  /**
   * Extract decisions made during session
   */
  private extractDecisions(commands: CommandEntry[]): string[] {
    const decisions: string[] = [];

    for (const cmd of commands) {
      if (cmd.intent.type === 'confirm_action') {
        decisions.push('Confirmed an action');
      } else if (cmd.intent.type === 'edit_file') {
        decisions.push('Made file edits');
      } else if (cmd.intent.type === 'create_file') {
        decisions.push('Created new file');
      } else if (cmd.intent.type === 'git_operation') {
        decisions.push('Performed git operation');
      }
    }

    return decisions;
  }

  /**
   * Suggest next steps based on session
   */
  private suggestNextSteps(commands: CommandEntry[]): string[] {
    const steps: string[] = [];

    // Check if tests were run
    const hasTests = commands.some(c =>
      c.intent.type === 'run_tests' ||
      c.command.includes('test')
    );

    if (!hasTests && commands.some(c => c.intent.type === 'edit_file')) {
      steps.push('Run tests to verify changes');
    }

    // Check if git commit was made
    const hasCommit = commands.some(c =>
      c.command.includes('commit') ||
      c.command.includes('push')
    );

    if (!hasCommit && commands.some(c => c.intent.type === 'edit_file')) {
      steps.push('Commit changes to git');
    }

    return steps;
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(chatId: number): {
    summariesCount: number;
    patternsCount: number;
    lastUpdated: number;
    totalSize: number;
  } {
    const memory = this.getMemory(chatId);

    return {
      summariesCount: memory.summaries.length,
      patternsCount: memory.patterns.length,
      lastUpdated: memory.lastUpdated,
      totalSize: JSON.stringify(memory).length,
    };
  }

  /**
   * Compact old summaries
   */
  private compactSummaries(chatId: number): void {
    const memory = this.getMemory(chatId);

    // Keep recent summaries and consolidate older ones
    const recentCount = Math.floor(MAX_SUMMARIES * 0.7);
    const oldSummaries = memory.summaries.slice(0, -recentCount);

    // Create consolidated summary
    if (oldSummaries.length > 1) {
      const consolidated: ConversationSummary = {
        id: generateId(),
        startTime: oldSummaries[0].startTime,
        endTime: oldSummaries[oldSummaries.length - 1].endTime,
        topic: `${oldSummaries.length} consolidated sessions`,
        keyPoints: oldSummaries.flatMap(s => s.keyPoints).slice(0, 20),
        decisions: oldSummaries.flatMap(s => s.decisions).slice(0, 10),
      };

      memory.summaries = [
        consolidated,
        ...memory.summaries.slice(-recentCount),
      ];
    }

    logger.debug(`Compacted summaries for chat ${chatId}`);
  }

  /**
   * Compact low-confidence patterns
   */
  private compactPatterns(chatId: number): void {
    const memory = this.getMemory(chatId);

    // Keep high-confidence patterns and recent patterns
    const highConfidence = memory.patterns.filter(p => p.confidence >= 0.5);
    const recentPatterns = memory.patterns
      .filter(p => p.confidence < 0.5)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, Math.floor(MAX_PATTERNS * 0.3));

    memory.patterns = [...highConfidence, ...recentPatterns];

    logger.debug(`Compacted patterns for chat ${chatId}`);
  }

  /**
   * Clear all memory for a chat
   */
  clearMemory(chatId: number): void {
    this.memories.delete(chatId);
    this.deleteMemoryFile(chatId);
    logger.debug(`Cleared memory for chat ${chatId}`);
  }

  /**
   * Create new memory object
   */
  private createMemory(chatId: number): LongTermMemory {
    return {
      chatId,
      summaries: [],
      patterns: [],
      preferences: {
        preferredTools: {},
        commonPaths: [],
        aliasMappings: {},
        personalityHints: [],
      },
      lastUpdated: Date.now(),
    };
  }

  /**
   * Save memory to disk
   */
  private saveMemory(chatId: number): void {
    if (!this.storageEnabled) return;

    try {
      const memory = this.memories.get(chatId);
      if (!memory) return;

      const filePath = this.getMemoryFilePath(chatId);
      writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`Failed to save memory for chat ${chatId}: ${error}`);
    }
  }

  /**
   * Load memory from disk
   */
  private loadMemory(chatId: number): LongTermMemory | null {
    if (!this.storageEnabled) return null;

    try {
      const filePath = this.getMemoryFilePath(chatId);
      if (!existsSync(filePath)) return null;

      const data = readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as LongTermMemory;
    } catch (error) {
      logger.error(`Failed to load memory for chat ${chatId}: ${error}`);
      return null;
    }
  }

  /**
   * Load all memories from disk
   */
  private loadAllMemories(): void {
    if (!this.storageEnabled) return;

    try {
      if (!existsSync(LONG_TERM_DIR)) return;

      const files = readdirSync(LONG_TERM_DIR);
      let loaded = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const match = file.match(/^memory_(\d+)\.json$/);
        if (!match) continue;

        const chatId = parseInt(match[1], 10);
        const memory = this.loadMemory(chatId);

        if (memory) {
          this.memories.set(chatId, memory);
          loaded++;
        }
      }

      logger.info(`Loaded ${loaded} long-term memories from disk`);
    } catch (error) {
      logger.error(`Failed to load memories: ${error}`);
    }
  }

  /**
   * Delete memory file from disk
   */
  private deleteMemoryFile(chatId: number): void {
    if (!this.storageEnabled) return;

    try {
      const filePath = this.getMemoryFilePath(chatId);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (error) {
      logger.error(`Failed to delete memory file for chat ${chatId}: ${error}`);
    }
  }

  /**
   * Get file path for a memory
   */
  private getMemoryFilePath(chatId: number): string {
    return join(LONG_TERM_DIR, `memory_${chatId}.json`);
  }

  /**
   * Ensure storage directories exist
   */
  private ensureDirectories(): void {
    const dirs = [LONG_TERM_DIR, PATTERNS_DIR, SUMMARIES_DIR, PREFERENCES_DIR];

    for (const dir of dirs) {
      try {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
          logger.debug(`Created memory directory: ${dir}`);
        }
      } catch (error) {
        logger.error(`Failed to create directory ${dir}: ${error}`);
      }
    }
  }

  /**
   * Save all memories (for graceful shutdown)
   */
  saveAll(): void {
    if (!this.storageEnabled) return;

    for (const chatId of this.memories.keys()) {
      this.saveMemory(chatId);
    }

    logger.debug(`Saved ${this.memories.size} long-term memories to disk`);
  }

  /**
   * Get basename from path
   */
  private basename(path: string): string {
    return path.split(/[/\\]/).pop() || path;
  }
}

/**
 * Default singleton instance
 */
let defaultPersistor: MemoryPersistor | null = null;

export function getMemoryPersistor(storageEnabled?: boolean): MemoryPersistor {
  if (!defaultPersistor) {
    defaultPersistor = new MemoryPersistor(storageEnabled);
  }
  return defaultPersistor;
}

export function resetMemoryPersistor(): void {
  if (defaultPersistor) {
    defaultPersistor.saveAll();
    defaultPersistor = null;
  }
}
