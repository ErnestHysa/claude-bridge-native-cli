/**
 * Memory Store - Persistent storage for conversations, decisions, patterns
 *
 * Handles all long-term memory operations including:
 * - Conversation history
 * - Project decisions and rationale
 * - Learned code patterns
 * - User preferences and facts
 */

import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getBrain } from '../brain-manager.js';
import type {
  ConversationMemory,
  ProjectMemory,
  Decision,
  Pattern,
  ConversationMessage,
} from '../types.js';

/**
 * In-memory cache for fast access
 */
interface MemoryCache {
  conversations: Map<number, ConversationMemory>;
  projects: Map<string, ProjectMemory>;
  facts: Map<string, unknown>;
}

/**
 * Memory Store - manages persistent memory storage
 */
export class MemoryStore {
  private brain = getBrain();
  private memoryDir: string;
  private conversationDir: string;
  private knowledgeDir: string;
  private projectDir: string;
  private factsFile: string;
  private cache: MemoryCache;
  private factsSavePromise: Promise<void> | null = null; // Mutex for facts save

  constructor() {
    this.memoryDir = this.brain.getMemoryDir();
    this.conversationDir = join(this.memoryDir, 'conversations');
    this.knowledgeDir = join(this.memoryDir, 'knowledge');
    this.projectDir = this.brain.getProjectsDir();
    this.factsFile = join(this.knowledgeDir, 'facts.json');

    this.cache = {
      conversations: new Map(),
      projects: new Map(),
      facts: new Map(),
    };
  }

  // ===========================================
  // Initialization
  // ===========================================

  /**
   * Initialize the memory store - ensure directories exist and load cache
   */
  async initialize(): Promise<void> {
    // Ensure directories exist
    for (const dir of [this.conversationDir, this.knowledgeDir, this.projectDir]) {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
    }

    // Load facts into cache
    await this.loadFacts();
  }

  // ===========================================
  // Fact Memory (Key-Value Storage)
  // ===========================================

  /**
   * Store a fact (key-value pair)
   */
  async setFact(key: string, value: unknown): Promise<void> {
    this.cache.facts.set(key, value);
    try {
      await this.saveFacts();
    } catch (error) {
      // Rollback on save failure
      this.cache.facts.delete(key);
      throw error;
    }
  }

  /**
   * Get a fact by key
   */
  getFact(key: string): unknown | undefined {
    return this.cache.facts.get(key);
  }

  /**
   * Get a fact with type
   */
  getFactTyped<T>(key: string): T | undefined {
    return this.cache.facts.get(key) as T | undefined;
  }

  /**
   * Search facts by key pattern
   */
  searchFacts(pattern: string): Array<{ key: string; value: unknown }> {
    const regex = new RegExp(pattern, 'i');
    const results: Array<{ key: string; value: unknown }> = [];

    for (const [key, value] of this.cache.facts.entries()) {
      if (regex.test(key)) {
        results.push({ key, value });
      }
    }

    return results;
  }

  /**
   * Delete a fact
   */
  async deleteFact(key: string): Promise<boolean> {
    const deleted = this.cache.facts.delete(key);
    if (deleted) {
      try {
        await this.saveFacts();
      } catch (error) {
        // Rollback on save failure - we don't have the old value, so we can't restore
        // Just log and continue; the fact will be missing from disk but cache is consistent
        console.error(`Failed to save facts after deleting ${key}:`, error);
      }
    }
    return deleted;
  }

  /**
   * Load facts from disk
   */
  private async loadFacts(): Promise<void> {
    if (!existsSync(this.factsFile)) {
      return;
    }

    try {
      const content = await readFile(this.factsFile, 'utf-8');
      const facts = JSON.parse(content);
      for (const [key, value] of Object.entries(facts)) {
        this.cache.facts.set(key, value);
      }
    } catch {
      // File corrupted, start fresh
      this.cache.facts.clear();
    }
  }

  /**
   * Save facts to disk with mutex to prevent race conditions
   * Chains save operations so concurrent calls wait for the previous one to complete
   */
  private async saveFacts(): Promise<void> {
    // Create a snapshot of current facts to serialize
    const factsObj: Record<string, unknown> = {};
    for (const [key, value] of this.cache.facts.entries()) {
      factsObj[key] = value;
    }

    // If there's a pending save, wait for it then do a new save
    if (this.factsSavePromise) {
      await this.factsSavePromise;
    }

    // Create new save promise
    this.factsSavePromise = (async () => {
      try {
        await writeFile(this.factsFile, JSON.stringify(factsObj, null, 2));
      } finally {
        this.factsSavePromise = null;
      }
    })();

    return this.factsSavePromise;
  }

  // ===========================================
  // Conversation Memory
  // ===========================================

  /**
   * Save a conversation message to memory
   */
  async saveMessage(
    chatId: number,
    message: ConversationMessage,
    projectId?: string,
  ): Promise<void> {
    const conv = await this.getConversation(chatId) || this.createConversation(chatId, projectId);

    // Keep only last 100 messages per conversation
    if (conv.messages.length >= 100) {
      conv.messages.shift(); // Remove oldest
    }

    conv.messages.push(message);
    conv.updatedAt = Date.now();

    // Update cache and save
    this.cache.conversations.set(chatId, conv);
    await this.saveConversation(conv);
  }

  /**
   * Get conversation history for a chat
   */
  async getConversation(chatId: number): Promise<ConversationMemory | null> {
    // Check cache first
    if (this.cache.conversations.has(chatId)) {
      return this.cache.conversations.get(chatId)!;
    }

    // Load from disk
    const filePath = join(this.conversationDir, `${chatId}.json`);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const conv: ConversationMemory = JSON.parse(content);
      this.cache.conversations.set(chatId, conv);
      return conv;
    } catch {
      return null;
    }
  }

  /**
   * Get recent messages from a conversation
   */
  async getRecentMessages(chatId: number, count = 10): Promise<ConversationMessage[]> {
    const conv = await this.getConversation(chatId);
    if (!conv) return [];
    return conv.messages.slice(-count);
  }

  /**
   * Clear conversation history
   */
  async clearConversation(chatId: number): Promise<void> {
    this.cache.conversations.delete(chatId);
    const filePath = join(this.conversationDir, `${chatId}.json`);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  /**
   * Create a new conversation memory
   */
  private createConversation(
    chatId: number,
    projectId?: string,
  ): ConversationMemory {
    return {
      id: this.generateId(),
      chatId,
      messages: [],
      projectId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Save conversation to disk
   */
  private async saveConversation(conv: ConversationMemory): Promise<void> {
    const filePath = join(this.conversationDir, `${conv.chatId}.json`);
    try {
      await writeFile(filePath, JSON.stringify(conv, null, 2));
    } catch (error) {
      console.error(`Failed to save conversation for chat ${conv.chatId}:`, error);
      throw error;
    }
  }

  /**
   * Search conversations by content
   */
  async searchConversations(
    query: string,
    chatId?: number,
  ): Promise<ConversationMessage[]> {
    const results: ConversationMessage[] = [];
    const files = chatId
      ? [`${chatId}.json`]
      : await readdir(this.conversationDir);

    const queryLower = query.toLowerCase();

    for (const file of files) {
      try {
        const filePath = join(this.conversationDir, file);
        const content = await readFile(filePath, 'utf-8');
        const conv: ConversationMemory = JSON.parse(content);

        for (const msg of conv.messages) {
          if (msg.content.toLowerCase().includes(queryLower)) {
            results.push(msg);
          }
        }
      } catch {
        // Skip invalid files
      }
    }

    return results;
  }

  // ===========================================
  // Project Memory
  // ===========================================

  /**
   * Get or create project memory
   */
  async getProjectMemory(projectPath: string): Promise<ProjectMemory> {
    const projectId = this.hashProjectPath(projectPath);

    // Check cache first
    if (this.cache.projects.has(projectId)) {
      return this.cache.projects.get(projectId)!;
    }

    const filePath = join(this.projectDir, `${projectId}.json`);

    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const memory: ProjectMemory = JSON.parse(content);
        this.cache.projects.set(projectId, memory);
        return memory;
      } catch {
        // File corrupted, create new
      }
    }

    // Create new project memory
    const memory = this.createProjectMemory(projectId, projectPath);
    this.cache.projects.set(projectId, memory);
    await this.saveProjectMemory(memory);
    return memory;
  }

  /**
   * Save project memory
   */
  async saveProjectMemory(memory: ProjectMemory): Promise<void> {
    const filePath = join(this.projectDir, `${memory.projectId}.json`);
    memory.lastUpdated = Date.now();
    this.cache.projects.set(memory.projectId, memory);
    try {
      await writeFile(filePath, JSON.stringify(memory, null, 2));
    } catch (error) {
      console.error(`Failed to save project memory for ${memory.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Add a decision to project memory
   */
  async addDecision(
    projectPath: string,
    decision: Omit<Decision, 'id'>,
  ): Promise<string> {
    const memory = await this.getProjectMemory(projectPath);
    const newDecision: Decision = {
      ...decision,
      id: this.generateId(),
    };
    memory.decisions.push(newDecision);
    await this.saveProjectMemory(memory);
    return newDecision.id;
  }

  /**
   * Get all decisions for a project
   */
  async getDecisions(projectPath: string): Promise<Decision[]> {
    const memory = await this.getProjectMemory(projectPath);
    return memory.decisions;
  }

  /**
   * Add a pattern to project memory
   */
  async addPattern(
    projectPath: string,
    pattern: Omit<Pattern, 'id'>,
  ): Promise<string> {
    const memory = await this.getProjectMemory(projectPath);
    const newPattern: Pattern = {
      ...pattern,
      id: this.generateId(),
    };
    memory.patterns.push(newPattern);
    await this.saveProjectMemory(memory);
    return newPattern.id;
  }

  /**
   * Get all patterns for a project
   */
  async getPatterns(projectPath: string): Promise<Pattern[]> {
    const memory = await this.getProjectMemory(projectPath);
    return memory.patterns;
  }

  /**
   * Update project context
   */
  async updateProjectContext(
    projectPath: string,
    context: Partial<ProjectMemory['context']>,
  ): Promise<void> {
    const memory = await this.getProjectMemory(projectPath);
    memory.context = { ...memory.context, ...context };
    await this.saveProjectMemory(memory);
  }

  /**
   * Create a new project memory
   */
  private createProjectMemory(
    projectId: string,
    projectPath: string,
  ): ProjectMemory {
    // Extract project name from path
    const name = projectPath.split(/[/\\]/).filter(Boolean).pop() || projectPath;

    return {
      projectId,
      projectName: name,
      path: projectPath,
      context: {},
      decisions: [],
      patterns: [],
      lastUpdated: Date.now(),
    };
  }

  /**
   * Hash a project path to create a stable ID
   */
  private hashProjectPath(path: string): string {
    // Simple hash function for project paths
    let hash = 0;
    const normalized = path.toLowerCase().replace(/\\/g, '/');
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `proj-${Math.abs(hash).toString(16)}`;
  }

  // ===========================================
  // Semantic Memory (Embeddings)
  // ===========================================

  /**
   * Store an embedding for semantic search
   * Note: This is a placeholder for future vector database integration
   */
  async storeEmbedding(
    id: string,
    text: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // TODO: Implement with sqlite-vec or similar
    // For now, just store the text
    const embeddingPath = join(this.knowledgeDir, `${id}.json`);
    await writeFile(embeddingPath, JSON.stringify({
      text,
      metadata,
      createdAt: Date.now(),
    }, null, 2));
  }

  /**
   * Semantic search through stored memories
   * Note: Placeholder for future implementation
   */
  async semanticSearch(_query: string, _limit = 5): Promise<Array<{
    id: string;
    text: string;
    similarity: number;
    metadata?: Record<string, unknown>;
  }>> {
    // TODO: Implement vector similarity search
    return [];
  }

  // ===========================================
  // Utilities
  // ===========================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get all stored conversation IDs
   */
  async getConversationIds(): Promise<number[]> {
    const files = await readdir(this.conversationDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => parseInt(f.replace('.json', ''), 10))
      .filter(n => !isNaN(n));
  }

  /**
   * Get all project memories
   */
  async getAllProjectMemories(): Promise<ProjectMemory[]> {
    if (!existsSync(this.projectDir)) {
      return [];
    }

    const files = await readdir(this.projectDir);
    const memories: ProjectMemory[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = join(this.projectDir, file);
          const content = await readFile(filePath, 'utf-8');
          memories.push(JSON.parse(content) as ProjectMemory);
        } catch {
          // Skip invalid files
        }
      }
    }

    return memories;
  }

  /**
   * Clean up old conversations (older than days)
   */
  async cleanupOldConversations(daysOld = 30): Promise<number> {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const ids = await this.getConversationIds();
    let cleaned = 0;

    for (const id of ids) {
      const conv = await this.getConversation(id);
      if (conv && conv.updatedAt < cutoff) {
        await this.clearConversation(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// Global singleton
let globalMemory: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
  if (!globalMemory) {
    globalMemory = new MemoryStore();
  }
  return globalMemory;
}
