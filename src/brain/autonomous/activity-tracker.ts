/**
 * Activity Tracker
 *
 * Tracks user activity for autonomous mode control.
 * Manages user state (ACTIVE, INACTIVE, AWAY) based on messages and time windows.
 */

import { getMemoryStore } from '../memory/memory-store.js';
import type {
  UserActivityData,
  UserActivityState,
  InactiveHours,
  AutonomousMode,
  TimeWindow,
} from '../types.js';

// Storage keys
const ACTIVITY_STATE_KEY = (chatId: number) => `activity_state:${chatId}`;
const INACTIVE_HOURS_KEY = (chatId: number) => `inactive_hours:${chatId}`;

// Default inactive hours (3 AM to 11 AM)
const DEFAULT_INACTIVE_HOURS: InactiveHours = {
  start: '03:00',
  end: '11:00',
  enabled: false, // Disabled by default
};

// Away threshold (2 hours of no activity)
const AWAY_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/**
 * Parse HH:MM time string to minutes from midnight
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Get current time in minutes from midnight
 */
function getCurrentTimeMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Parse time window string (HH:MM-HH:MM) to TimeWindow
 */
export function parseTimeWindow(timeWindow: string): TimeWindow | null {
  const match = timeWindow.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, startHour, startMin, endHour, endMin] = match;
  const startMinutes = parseInt(startHour) * 60 + parseInt(startMin);
  const endMinutes = parseInt(endHour) * 60 + parseInt(endMin);

  return { startMinutes, endMinutes };
}

/**
 * Format TimeWindow to HH:MM-HH:MM string
 */
export function formatTimeWindow(window: TimeWindow): string {
  const startHours = Math.floor(window.startMinutes / 60);
  const startMins = window.startMinutes % 60;
  const endHours = Math.floor(window.endMinutes / 60);
  const endMins = window.endMinutes % 60;

  return `${String(startHours).padStart(2, '0')}:${String(startMins).padStart(2, '0')}-${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
}

/**
 * Check if current time is within the inactive hours window
 */
export function isWithinInactiveHours(inactiveHours: InactiveHours): boolean {
  if (!inactiveHours.enabled) return false;

  const currentMinutes = getCurrentTimeMinutes();
  const startMinutes = parseTimeToMinutes(inactiveHours.start);
  const endMinutes = parseTimeToMinutes(inactiveHours.end);

  // Handle window that crosses midnight (e.g., 23:00-03:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Activity Tracker class
 */
export class ActivityTracker {
  private memory = getMemoryStore();
  private cache = new Map<number, UserActivityData>();

  /**
   * Get user activity data
   */
  async getUserActivityData(chatId: number): Promise<UserActivityData> {
    // Check cache first
    if (this.cache.has(chatId)) {
      return this.cache.get(chatId)!;
    }

    // Load from memory
    const stateKey = ACTIVITY_STATE_KEY(chatId);
    const stored = await this.memory.getFact(stateKey) as UserActivityData | undefined;

    if (stored) {
      this.cache.set(chatId, stored);
      return stored;
    }

    // Create default
    const inactiveHoursKey = INACTIVE_HOURS_KEY(chatId);
    const storedHours = await this.memory.getFact(inactiveHoursKey) as InactiveHours | undefined;

    const defaultData: UserActivityData = {
      chatId,
      state: 'ACTIVE',
      inactiveHours: storedHours || DEFAULT_INACTIVE_HOURS,
      lastActivity: Date.now(),
      autonomousEnabled: false,
      stateSince: Date.now(),
    };

    this.cache.set(chatId, defaultData);
    return defaultData;
  }

  /**
   * Save user activity data
   */
  async saveUserActivityData(data: UserActivityData): Promise<void> {
    const stateKey = ACTIVITY_STATE_KEY(data.chatId);
    await this.memory.setFact(stateKey, data);
    this.cache.set(data.chatId, data);
  }

  /**
   * Set user inactive hours
   */
  async setInactiveHours(
    chatId: number,
    start: string,
    end: string,
    enabled = true
  ): Promise<UserActivityData> {
    const data = await this.getUserActivityData(chatId);

    data.inactiveHours = { start, end, enabled };
    await this.saveUserActivityData(data);

    // Also store separately for quick access
    const hoursKey = INACTIVE_HOURS_KEY(chatId);
    await this.memory.setFact(hoursKey, data.inactiveHours);

    return data;
  }

  /**
   * Get user inactive hours
   */
  async getInactiveHours(chatId: number): Promise<InactiveHours> {
    const data = await this.getUserActivityData(chatId);
    return data.inactiveHours;
  }

  /**
   * Set user activity state
   */
  async setUserState(
    chatId: number,
    state: UserActivityState
  ): Promise<UserActivityData> {
    const data = await this.getUserActivityData(chatId);
    data.state = state;
    data.stateSince = Date.now();
    await this.saveUserActivityData(data);
    return data;
  }

  /**
   * Get current user activity state
   */
  async getUserState(chatId: number): Promise<UserActivityState> {
    const data = await this.getUserActivityData(chatId);
    return data.state;
  }

  /**
   * Update last activity timestamp (call when user sends a message)
   */
  async recordActivity(chatId: number): Promise<UserActivityData> {
    const data = await this.getUserActivityData(chatId);
    data.lastActivity = Date.now();

    // If user was INACTIVE or AWAY, mark as ACTIVE
    if (data.state === 'INACTIVE' || data.state === 'AWAY') {
      data.state = 'ACTIVE';
      data.stateSince = Date.now();
    }

    await this.saveUserActivityData(data);
    return data;
  }

  /**
   * Update and re-evaluate user state based on time and activity
   */
  async evaluateState(chatId: number): Promise<{
    state: UserActivityState;
    autonomousMode: AutonomousMode;
    data: UserActivityData;
  }> {
    const data = await this.getUserActivityData(chatId);
    const now = Date.now();
    const withinInactiveHours = isWithinInactiveHours(data.inactiveHours);
    const timeSinceActivity = now - data.lastActivity;

    let newState: UserActivityState = data.state;
    let autonomousMode: AutonomousMode = 'active_command';

    // Priority 1: Check if user recently sent a message
    if (timeSinceActivity < AWAY_THRESHOLD_MS) {
      newState = 'ACTIVE';
      autonomousMode = 'active_command';
    }
    // Priority 2: Within inactive hours and no recent activity
    else if (withinInactiveHours) {
      newState = 'INACTIVE';
      autonomousMode = 'inactive_autonomous';
    }
    // Priority 3: No activity for a while (AWAY state)
    else if (timeSinceActivity >= AWAY_THRESHOLD_MS) {
      newState = 'AWAY';
      autonomousMode = 'away_pending';
    }

    // Update state if changed
    if (newState !== data.state) {
      data.state = newState;
      data.stateSince = now;
      await this.saveUserActivityData(data);
    }

    // Override autonomous mode if manually disabled/enabled
    if (data.autonomousEnabled) {
      autonomousMode = 'inactive_autonomous';
    } else if (data.state === 'ACTIVE') {
      autonomousMode = 'active_command';
    }

    return { state: newState, autonomousMode, data };
  }

  /**
   * Enable/disable autonomous mode manually
   */
  async setAutonomousEnabled(chatId: number, enabled: boolean): Promise<UserActivityData> {
    const data = await this.getUserActivityData(chatId);
    data.autonomousEnabled = enabled;
    await this.saveUserActivityData(data);
    return data;
  }

  /**
   * Check if autonomous mode is active for user
   */
  async isAutonomousMode(chatId: number): Promise<boolean> {
    const { autonomousMode, data } = await this.evaluateState(chatId);
    return autonomousMode === 'inactive_autonomous' || data.autonomousEnabled;
  }

  /**
   * Get all users currently in inactive/autonomous mode
   */
  async getAutonomousUsers(): Promise<UserActivityData[]> {
    const users: UserActivityData[] = [];

    // This would scan all known users - for now return cached ones
    for (const [chatId, data] of this.cache.entries()) {
      const { autonomousMode } = await this.evaluateState(chatId);
      if (autonomousMode === 'inactive_autonomous') {
        users.push(data);
      }
    }

    return users;
  }

  /**
   * Clear cache entry
   */
  clearCache(chatId?: number): void {
    if (chatId) {
      this.cache.delete(chatId);
    } else {
      this.cache.clear();
    }
  }
}

// Singleton instance
let trackerInstance: ActivityTracker | null = null;

/**
 * Get the activity tracker singleton
 */
export function getActivityTracker(): ActivityTracker {
  if (!trackerInstance) {
    trackerInstance = new ActivityTracker();
  }
  return trackerInstance;
}

/**
 * Reset the activity tracker (mainly for testing)
 */
export function resetActivityTracker(): void {
  trackerInstance = null;
}
