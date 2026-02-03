/**
 * Conversation Indexer - Index and search chat history
 *
 * Features:
 * - Index all messages sent/received
 * - Full-text search through conversations
 * - Search by keyword, date range, chat
 * - Context-aware results
 * - Persistent storage in database
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getBrain } from '../brain-manager.js';
import type { Message } from 'node-telegram-bot-api';

// ============================================
// Types
// ============================================

export interface ConversationMessage {
  id: string;
  chatId: number;
  chatName?: string;
  userId: number;
  username?: string;
  messageType: 'user' | 'bot' | 'system';
  text: string;
  timestamp: number;
  command?: string;
  replyTo?: number;
  projectId?: string;
}

export interface SearchQuery {
  query: string;
  chatId?: number;
  userId?: number;
  startDate?: Date;
  endDate?: Date;
  command?: string;
  limit?: number;
}

export interface SearchResult {
  message: ConversationMessage;
  score: number;
  context?: {
    before: ConversationMessage[];
    after: ConversationMessage[];
  };
}

// ============================================
// Conversation Indexer Class
// ============================================

export class ConversationIndexer {
  private brain = getBrain();
  private dataDir: string;
  private indexFile: string;
  private messages: Map<string, ConversationMessage> = new Map();
  private chatIndex: Map<number, string[]> = new Map(); // chatId -> message IDs
  private userIndex: Map<number, string[]> = new Map(); // userId -> message IDs

  constructor() {
    this.dataDir = join(this.brain.getBrainDir(), 'conversations');
    this.indexFile = join(this.dataDir, 'index.json');
  }

  /**
   * Initialize the conversation indexer
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }

    // Load existing index
    await this.loadIndex();

    console.log('[ConversationIndexer] Initialized with', this.messages.size, 'messages');
  }

  /**
   * Index a message
   */
  async indexMessage(msg: Message, messageType: 'user' | 'bot' | 'system', text: string): Promise<void> {
    const message: ConversationMessage = {
      id: this.generateMessageId(msg.message_id, msg.chat.id, msg.date),
      chatId: msg.chat.id,
      userId: msg.from?.id || 0,
      username: msg.from?.username,
      messageType,
      text: text.substring(0, 10000), // Limit text length
      timestamp: msg.date * 1000, // Convert to milliseconds
    };

    // Extract command if present
    if (text.startsWith('/')) {
      const parts = text.split(' ');
      message.command = parts[0];
    }

    // Add to indexes
    this.messages.set(message.id, message);
    this.addToChatIndex(message.chatId, message.id);
    this.addToUserIndex(message.userId, message.id);

    // Save index periodically (not on every message)
    if (this.messages.size % 100 === 0) {
      await this.saveIndex();
    }
  }

  /**
   * Search messages
   */
  search(query: SearchQuery): SearchResult[] {
    const results: SearchResult[] = [];
    const searchLower = query.query.toLowerCase();

    // Filter by chat if specified
    let messageIds: string[];
    if (query.chatId) {
      messageIds = this.chatIndex.get(query.chatId) || [];
    } else {
      messageIds = Array.from(this.messages.keys());
    }

    // Filter by user if specified
    if (query.userId) {
      const userMessages = this.userIndex.get(query.userId) || [];
      messageIds = messageIds.filter(id => userMessages.includes(id));
    }

    // Search through messages
    for (const id of messageIds) {
      const message = this.messages.get(id);
      if (!message) continue;

      // Date filtering
      if (query.startDate && message.timestamp < query.startDate.getTime()) continue;
      if (query.endDate && message.timestamp > query.endDate.getTime()) continue;

      // Command filtering
      if (query.command && message.command !== query.command) continue;

      // Text search
      if (searchLower) {
        const textLower = message.text.toLowerCase();
        if (!textLower.includes(searchLower)) continue;
      }

      // Calculate relevance (recency boost)
      const age = Date.now() - message.timestamp;
      const recencyScore = Math.max(0, 1 - age / (30 * 24 * 60 * 60 * 1000)); // Decay over 30 days

      // Text match score
      let textScore = 0;
      if (searchLower) {
        const textLower = message.text.toLowerCase();
        const exactMatch = textLower === searchLower;
        const startsWith = textLower.startsWith(searchLower);
        if (exactMatch) textScore = 1;
        else if (startsWith) textScore = 0.8;
        else textScore = 0.5;
      }

      results.push({
        message,
        score: (recencyScore * 0.3) + (textScore * 0.7),
      });
    }

    // Sort by relevance and apply limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, query.limit || 50);
  }

  /**
   * Get conversation history for a chat
   */
  getHistory(chatId: number, limit = 50): ConversationMessage[] {
    const messageIds = this.chatIndex.get(chatId) || [];
    const messages = messageIds
      .map(id => this.messages.get(id))
      .filter((m): m is ConversationMessage => m !== undefined)
      .sort((a, b) => b.timestamp - a.timestamp);

    return messages.slice(0, limit);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalMessages: number;
    chatsCount: number;
    usersCount: number;
    byCommand: Record<string, number>;
    byChat: Map<number, number>;
  } {
    const byCommand: Record<string, number> = {};
    const byChat = new Map<number, number>();

    for (const message of this.messages.values()) {
      // Count by command
      if (message.command) {
        byCommand[message.command] = (byCommand[message.command] || 0) + 1;
      }

      // Count by chat
      byChat.set(message.chatId, (byChat.get(message.chatId) || 0) + 1);
    }

    return {
      totalMessages: this.messages.size,
      chatsCount: this.chatIndex.size,
      usersCount: this.userIndex.size,
      byCommand,
      byChat,
    };
  }

  /**
   * Get recent activity
   */
  getRecentActivity(limit = 20): ConversationMessage[] {
    const all = Array.from(this.messages.values());
    all.sort((a, b) => b.timestamp - a.timestamp);
    return all.slice(0, limit);
  }

  /**
   * Clear messages for a chat (for privacy)
   */
  async clearChat(chatId: number): Promise<number> {
    const messageIds = this.chatIndex.get(chatId) || [];
    let cleared = 0;

    for (const id of messageIds) {
      if (this.messages.delete(id)) {
        cleared++;
      }
    }

    this.chatIndex.delete(chatId);
    await this.saveIndex();

    return cleared;
  }

  /**
   * Get context around a message
   */
  getContext(messageId: string, before = 2, after = 2): SearchResult['context'] {
    const message = this.messages.get(messageId);
    if (!message) return undefined;

    const chatMessages = this.chatIndex.get(message.chatId) || [];
    const idx = chatMessages.indexOf(messageId);

    if (idx === -1) return undefined;

    const beforeIds = chatMessages.slice(Math.max(0, idx - before), idx);
    const afterIds = chatMessages.slice(idx + 1, idx + 1 + after);

    return {
      before: beforeIds
        .map(id => this.messages.get(id))
        .filter((m): m is ConversationMessage => m !== undefined),
      after: afterIds
        .map(id => this.messages.get(id))
        .filter((m): m is ConversationMessage => m !== undefined),
    };
  }

  /**
   * Save index to disk
   */
  async saveIndex(): Promise<void> {
    const data = {
      messages: Array.from(this.messages.entries()),
      chatIndex: Array.from(this.chatIndex.entries()),
      userIndex: Array.from(this.userIndex.entries()),
    };

    await writeFile(this.indexFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load index from disk
   */
  private async loadIndex(): Promise<void> {
    if (!existsSync(this.indexFile)) {
      return;
    }

    try {
      const content = await readFile(this.indexFile, 'utf-8');
      const data = JSON.parse(content);

      this.messages = new Map(data.messages || []);
      this.chatIndex = new Map(data.chatIndex || []);
      this.userIndex = new Map(data.userIndex || []);

      // Limit message count in memory (keep last 10000 per chat)
      this.pruneOldMessages();
    } catch (error) {
      console.error('[ConversationIndexer] Failed to load index:', error);
    }
  }

  /**
   * Prune old messages to keep memory usage manageable
   */
  private pruneOldMessages(): void {
    const maxAge = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days
    const maxPerChat = 10000;

    for (const [chatId, messageIds] of this.chatIndex.entries()) {
      // Remove old messages
      const validIds = messageIds.filter(id => {
        const msg = this.messages.get(id);
        return msg && msg.timestamp > maxAge;
      });

      // Limit per chat
      if (validIds.length > maxPerChat) {
        // Keep most recent
        const sorted = validIds
          .map(id => ({ id, msg: this.messages.get(id) }))
          .filter((item): item is { id: string; msg: ConversationMessage } => item.msg !== undefined)
          .sort((a, b) => b.msg.timestamp - a.msg.timestamp)
          .slice(0, maxPerChat);

        this.chatIndex.set(chatId, sorted.map(item => item.id));

        // Remove messages not in the kept set
        for (const id of messageIds) {
          if (!sorted.find(item => item.id === id)) {
            this.messages.delete(id);
          }
        }
      } else {
        this.chatIndex.set(chatId, validIds);
      }
    }
  }

  private addToChatIndex(chatId: number, messageId: string): void {
    let ids = this.chatIndex.get(chatId);
    if (!ids) {
      ids = [];
      this.chatIndex.set(chatId, ids);
    }
    ids.push(messageId);
  }

  private addToUserIndex(userId: number, messageId: string): void {
    let ids = this.userIndex.get(userId);
    if (!ids) {
      ids = [];
      this.userIndex.set(userId, ids);
    }
    ids.push(messageId);
  }

  private generateMessageId(msgId: number, chatId: number, date: number): string {
    return `${chatId}-${msgId}-${date}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalConversationIndexer: ConversationIndexer | null = null;

export function getConversationIndexer(): ConversationIndexer {
  if (!globalConversationIndexer) {
    globalConversationIndexer = new ConversationIndexer();
  }
  return globalConversationIndexer;
}
