/**
 * Notification Router - Priority-based notification filtering and routing
 *
 * Manages notifications with priority levels, rate limiting, and digest functionality.
 * Prevents notification spam while ensuring important messages get through.
 */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getBrain } from '../brain-manager.js';

// Notification types
export type NotificationType =
  | 'error'       // Critical errors requiring immediate attention
  | 'security'    // Security-related alerts
  | 'deployment'  // Deployment status updates
  | 'test'        // Test failures
  | 'lint'        // Lint/code quality issues
  | 'info'        // General informational messages
  | 'success';    // Success messages

// Priority levels
export type NotificationPriority =
  | 'urgent'      // Send immediately, bypass rate limits
  | 'high'        // Send immediately, respect rate limits
  | 'medium'      // Include in digest, or send if quiet period
  | 'low';        // Digest only

// Notification interface
export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  chatId: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
  delivered?: boolean;
}

// User notification preferences
export interface NotificationPreferences {
  chatId: number;
  enabled: boolean;
  // Per-type settings
  types: Partial<Record<NotificationType, boolean>>;
  // Quiet hours (no notifications except urgent)
  quietHoursStart?: number; // Hour (0-23)
  quietHoursEnd?: number;   // Hour (0-23)
  // Minimum priority for immediate delivery
  minimumImmediatePriority?: NotificationPriority;
  // Digest settings
  digestEnabled?: boolean;
  digestInterval?: number; // Minutes between digests (default 60)
  lastDigestSent?: number;
}

// Notification rate limit tracker
interface RateLimitEntry {
  chatId: number;
  type: NotificationType;
  count: number;
  windowStart: number;
}

/**
 * Notification Router class
 */
export class NotificationRouter {
  private brain = getBrain();
  private notificationsDir: string;
  private pendingFile: string;
  private preferencesFile: string;
  private rateLimitsFile: string;

  private pendingNotifications: Map<string, Notification> = new Map();
  private preferences: Map<number, NotificationPreferences> = new Map();
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  // Rate limiting configuration
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly MAX_NOTIFICATIONS_PER_WINDOW = 5;

  constructor() {
    this.notificationsDir = join(this.brain.getBrainDir(), 'notifications');
    this.pendingFile = join(this.notificationsDir, 'pending.json');
    this.preferencesFile = join(this.notificationsDir, 'preferences.json');
    this.rateLimitsFile = join(this.notificationsDir, 'rate-limits.json');
  }

  /**
   * Initialize the notification router
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.notificationsDir)) {
      mkdirSync(this.notificationsDir, { recursive: true });
    }

    await this.loadPendingNotifications();
    await this.loadPreferences();
    await this.loadRateLimits();
  }

  /**
   * Get default priority for a notification type
   */
  private getDefaultPriority(type: NotificationType): NotificationPriority {
    const defaults: Record<NotificationType, NotificationPriority> = {
      error: 'urgent',
      security: 'urgent',
      deployment: 'high',
      test: 'medium',
      lint: 'low',
      info: 'low',
      success: 'low',
    };
    return defaults[type];
  }

  /**
   * Create and queue a notification
   */
  async createNotification(
    type: NotificationType,
    title: string,
    message: string,
    chatId: number,
    priority?: NotificationPriority,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const id = this.generateId();

    const notification: Notification = {
      id,
      type,
      priority: priority ?? this.getDefaultPriority(type),
      title,
      message,
      chatId,
      timestamp: Date.now(),
      metadata,
    };

    // Check if we should deliver immediately
    const shouldDeliver = await this.shouldDeliverImmediately(notification);

    if (shouldDeliver) {
      notification.delivered = true;
      // Store for the bot to pick up
      await this.storeForDelivery(notification);
    } else {
      // Queue for digest
      this.pendingNotifications.set(id, notification);
      await this.savePendingNotifications();
    }

    // Update rate limit
    this.updateRateLimit(notification);

    return id;
  }

  /**
   * Check if a notification should be delivered immediately
   */
  private async shouldDeliverImmediately(notification: Notification): Promise<boolean> {
    // Get user preferences
    const prefs = this.preferences.get(notification.chatId) ?? this.getDefaultPreferences(notification.chatId);

    // Check if notifications are disabled
    if (!prefs.enabled) {
      return false;
    }

    // Check if this type is disabled
    if (prefs.types[notification.type] === false) {
      return false;
    }

    // Urgent notifications always delivered
    if (notification.priority === 'urgent') {
      return true;
    }

    // Check quiet hours
    if (this.isInQuietHours(prefs)) {
      return false;
    }

    // Check rate limit
    if (this.isRateLimited(notification)) {
      return false;
    }

    // Check minimum immediate priority
    const minPriority = prefs.minimumImmediatePriority ?? 'medium';
    const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };

    return priorityOrder[notification.priority] >= priorityOrder[minPriority];
  }

  /**
   * Check if current time is within quiet hours
   */
  private isInQuietHours(prefs: NotificationPreferences): boolean {
    if (prefs.quietHoursStart === undefined || prefs.quietHoursEnd === undefined) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();

    // Handle wraparound (e.g., 22:00 to 06:00)
    if (prefs.quietHoursStart > prefs.quietHoursEnd) {
      return currentHour >= prefs.quietHoursStart || currentHour < prefs.quietHoursEnd;
    }

    return currentHour >= prefs.quietHoursStart && currentHour < prefs.quietHoursEnd;
  }

  /**
   * Check if notification type is rate limited
   */
  private isRateLimited(notification: Notification): boolean {
    const key = `${notification.chatId}-${notification.type}`;
    const entry = this.rateLimits.get(key);

    if (!entry) {
      return false;
    }

    const now = Date.now();
    const windowElapsed = now - entry.windowStart;

    // Reset if window expired
    if (windowElapsed > this.RATE_LIMIT_WINDOW) {
      this.rateLimits.delete(key);
      return false;
    }

    return entry.count >= this.MAX_NOTIFICATIONS_PER_WINDOW;
  }

  /**
   * Update rate limit counter for a notification type
   */
  private updateRateLimit(notification: Notification): void {
    const key = `${notification.chatId}-${notification.type}`;
    const now = Date.now();

    let entry = this.rateLimits.get(key);

    if (!entry) {
      entry = {
        chatId: notification.chatId,
        type: notification.type,
        count: 0,
        windowStart: now,
      };
      this.rateLimits.set(key, entry);
    }

    // Reset window if expired
    const windowElapsed = now - entry.windowStart;
    if (windowElapsed > this.RATE_LIMIT_WINDOW) {
      entry.count = 0;
      entry.windowStart = now;
    }

    entry.count++;
  }

  /**
   * Store notification for immediate delivery
   */
  private async storeForDelivery(notification: Notification): Promise<void> {
    const deliveryFile = join(this.notificationsDir, `deliver-${notification.chatId}-${Date.now()}.json`);

    try {
      await writeFile(deliveryFile, JSON.stringify(notification, null, 2));
    } catch (error) {
      console.error('Failed to store notification for delivery:', error);
    }
  }

  /**
   * Get pending notifications for a chat
   */
  getPendingNotifications(chatId: number): Notification[] {
    return Array.from(this.pendingNotifications.values())
      .filter(n => n.chatId === chatId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get notifications ready for digest
   */
  async getDigestNotifications(chatId: number): Promise<Notification[]> {
    const prefs = this.preferences.get(chatId) ?? this.getDefaultPreferences(chatId);

    if (!prefs.digestEnabled) {
      return [];
    }

    const pending = this.getPendingNotifications(chatId);
    const now = Date.now();
    const digestInterval = (prefs.digestInterval ?? 60) * 60 * 1000;
    const lastDigest = prefs.lastDigestSent ?? 0;

    // Check if it's time for digest
    if (now - lastDigest < digestInterval && pending.length < 10) {
      return [];
    }

    // Get notifications for digest
    const digestNotifications = pending;

    // Update last digest time
    prefs.lastDigestSent = now;
    this.preferences.set(chatId, prefs);
    await this.savePreferences();

    // Clear delivered notifications from pending
    for (const notification of digestNotifications) {
      this.pendingNotifications.delete(notification.id);
    }
    await this.savePendingNotifications();

    return digestNotifications;
  }

  /**
   * Mark notification as delivered
   */
  async markDelivered(notificationId: string): Promise<void> {
    const notification = this.pendingNotifications.get(notificationId);
    if (notification) {
      this.pendingNotifications.delete(notificationId);
      await this.savePendingNotifications();
    }
  }

  /**
   * Get user preferences
   */
  getPreferences(chatId: number): NotificationPreferences {
    return this.preferences.get(chatId) ?? this.getDefaultPreferences(chatId);
  }

  /**
   * Update user preferences
   */
  async setPreferences(prefs: NotificationPreferences): Promise<void> {
    this.preferences.set(prefs.chatId, prefs);
    await this.savePreferences();
  }

  /**
   * Get default preferences for a chat
   */
  private getDefaultPreferences(chatId: number): NotificationPreferences {
    return {
      chatId,
      enabled: true,
      types: {
        error: true,
        security: true,
        deployment: true,
        test: true,
        lint: false,
        info: false,
        success: false,
      },
      minimumImmediatePriority: 'medium',
      digestEnabled: true,
      digestInterval: 60,
    };
  }

  /**
   * Enable/disable notifications for a type
   */
  async setNotificationType(chatId: number, type: NotificationType, enabled: boolean): Promise<void> {
    const prefs = this.getPreferences(chatId);
    prefs.types[type] = enabled;
    await this.setPreferences(prefs);
  }

  /**
   * Set quiet hours
   */
  async setQuietHours(chatId: number, start: number, end: number): Promise<void> {
    const prefs = this.getPreferences(chatId);
    prefs.quietHoursStart = start;
    prefs.quietHoursEnd = end;
    await this.setPreferences(prefs);
  }

  /**
   * Load pending notifications from disk
   */
  private async loadPendingNotifications(): Promise<void> {
    if (!existsSync(this.pendingFile)) {
      return;
    }

    try {
      const content = await readFile(this.pendingFile, 'utf-8');
      const data = JSON.parse(content) as Notification[];

      this.pendingNotifications.clear();
      for (const notification of data) {
        this.pendingNotifications.set(notification.id, notification);
      }
    } catch {
      // Corrupted file, start fresh
    }
  }

  /**
   * Save pending notifications to disk
   */
  private async savePendingNotifications(): Promise<void> {
    const data = Array.from(this.pendingNotifications.values());
    await writeFile(this.pendingFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load preferences from disk
   */
  private async loadPreferences(): Promise<void> {
    if (!existsSync(this.preferencesFile)) {
      return;
    }

    try {
      const content = await readFile(this.preferencesFile, 'utf-8');
      const data = JSON.parse(content) as NotificationPreferences[];

      this.preferences.clear();
      for (const prefs of data) {
        this.preferences.set(prefs.chatId, prefs);
      }
    } catch {
      // Corrupted file, start fresh
    }
  }

  /**
   * Save preferences to disk
   */
  private async savePreferences(): Promise<void> {
    const data = Array.from(this.preferences.values());
    await writeFile(this.preferencesFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load rate limits from disk
   */
  private async loadRateLimits(): Promise<void> {
    if (!existsSync(this.rateLimitsFile)) {
      return;
    }

    try {
      const content = await readFile(this.rateLimitsFile, 'utf-8');
      const data = JSON.parse(content) as RateLimitEntry[];

      // Clean up expired entries
      const now = Date.now();
      this.rateLimits.clear();

      for (const entry of data) {
        if (now - entry.windowStart < this.RATE_LIMIT_WINDOW) {
          this.rateLimits.set(`${entry.chatId}-${entry.type}`, entry);
        }
      }
    } catch {
      // Corrupted file, start fresh
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Clean up old delivery files
   */
  async cleanupOldDeliveries(maxAge = 3600000): Promise<number> {
    const { readdir } = await import('node:fs/promises');
    const now = Date.now();
    let cleaned = 0;

    try {
      const files = await readdir(this.notificationsDir);

      for (const file of files) {
        if (file.startsWith('deliver-') && file.endsWith('.json')) {
          const filePath = join(this.notificationsDir, file);
          try {
            const stats = await readFile(filePath, 'utf-8');
            const notification = JSON.parse(stats) as Notification;

            if (now - notification.timestamp > maxAge) {
              await unlink(filePath);
              cleaned++;
            }
          } catch {
            // Invalid file, delete it
            await unlink(filePath);
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return cleaned;
  }
}

// Global singleton
let globalNotificationRouter: NotificationRouter | null = null;

export function getNotificationRouter(): NotificationRouter {
  if (!globalNotificationRouter) {
    globalNotificationRouter = new NotificationRouter();
  }
  return globalNotificationRouter;
}

export function resetNotificationRouter(): void {
  globalNotificationRouter = null;
}
