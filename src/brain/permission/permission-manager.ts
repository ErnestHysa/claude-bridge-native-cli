/**
 * Permission Manager - User permission level management
 *
 * The Permission Manager handles authorization for autonomous AI actions:
 * - Manages user permission levels
 * - Checks permissions before executing actions
 * - Enforces permission-based restrictions
 * - Tracks permission changes for audit
 * - Provides permission escalation/de-escalation
 *
 * Permission levels (from least to most permissive):
 * - read_only: Can only observe and suggest
 * - advisory: Can suggest, needs approval for all actions
 * - supervised: Safe actions auto-approved
 * - autonomous: Can act independently on non-critical tasks
 * - full: Complete autonomy (not recommended for most users)
 */

import { getMemoryStore } from '../memory/memory-store.js';
import { PermissionLevel } from '../decision/decision-maker.js';
import { getTransparencyTracker, type ActionCategory } from '../transparency/transparency-tracker.js';

// Re-export PermissionLevel for convenience
export { PermissionLevel };

// ============================================
// Types
// ============================================

/**
 * Permission check result
 */
export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
  permissionLevel: PermissionLevel;
  checkedAt: number;
}

/**
 * Permission grant
 */
export interface PermissionGrant {
  id: string;
  chatId: number;
  grantedBy: 'user' | 'system';
  level: PermissionLevel;
  previousLevel?: PermissionLevel;
  reason?: string;
  expiresAt?: number;
  grantedAt: number;
}

/**
 * Permission restriction
 */
export interface PermissionRestriction {
  id: string;
  chatId: number;
  type: 'category' | 'action' | 'time' | 'project';
  rule: string;
  allowed: boolean;
  createdAt: number;
}

/**
 * Permission configuration
 */
export interface PermissionConfig {
  chatId: number;
  level: PermissionLevel;
  restrictions: PermissionRestriction[];
  autoEscalation: boolean;    // Allow auto-escalation based on trust
  deescalationOnFailure: boolean; // De-escalate after failures
  defaultLevel: PermissionLevel;
}

/**
 * Permission check request
 */
export interface PermissionRequest {
  chatId: number;
  projectPath: string;
  action: string;
  category: ActionCategory;
  riskLevel: string;
  estimatedDuration: number;
}

// ============================================
// Configuration
// ============================================

const PERMISSION_CONFIG = {
  // Default permission level for new users
  defaultLevel: PermissionLevel.SUPERVISED,

  // Permission-based action restrictions
  levelRestrictions: {
    read_only: {
      canCreateTasks: false,
      canExecuteWithoutApproval: false,
      canRefactorCode: false,
      canAddDependencies: false,
      canModifyTests: false,
      canRunTests: true,
      canViewContext: true,
      canViewReports: true,
    },
    advisory: {
      canCreateTasks: true,
      canExecuteWithoutApproval: false,
      canRefactorCode: false,
      canAddDependencies: false,
      canModifyTests: false,
      canRunTests: true,
      canViewContext: true,
      canViewReports: true,
    },
    supervised: {
      canCreateTasks: true,
      canExecuteWithoutApproval: false,
      canRefactorCode: false,
      canAddDependencies: false,
      canModifyTests: true,
      canRunTests: true,
      canViewContext: true,
      canViewReports: true,
    },
    autonomous: {
      canCreateTasks: true,
      canExecuteWithoutApproval: true,
      canRefactorCode: true,
      canAddDependencies: true,
      canModifyTests: true,
      canRunTests: true,
      canViewContext: true,
      canViewReports: true,
    },
    full: {
      canCreateTasks: true,
      canExecuteWithoutApproval: true,
      canRefactorCode: true,
      canAddDependencies: true,
      canModifyTests: true,
      canRunTests: true,
      canViewContext: true,
      canViewReports: true,
    },
  },

  // Risk thresholds for auto-approval by level
  riskThresholds: {
    read_only: { maxRisk: 'none' },
    advisory: { maxRisk: 'none' },
    supervised: { maxRisk: 'low' },
    autonomous: { maxRisk: 'medium' },
    full: { maxRisk: 'critical' },
  },

  // Actions that always require approval regardless of level
  alwaysRequiresApproval: [
    'deployment',
    'dependency_vulnerable',
    'feature_implementation',
  ],
};

// ============================================
// Permission Manager Class
// ============================================

export class PermissionManager {
  private memory = getMemoryStore();
  private configs = new Map<number, PermissionConfig>();
  private grants = new Map<string, PermissionGrant>();
  private active = false;

  /**
   * Start the permission manager
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadConfigs();

    console.log('[PermissionManager] Started');
  }

  /**
   * Stop the permission manager
   */
  stop(): void {
    this.active = false;
    console.log('[PermissionManager] Stopped');
  }

  /**
   * Check if an action is allowed
   */
  async checkPermission(request: PermissionRequest): Promise<PermissionCheck> {
    const config = await this.getConfig(request.chatId);
    const level = config.level;

    // Check if action requires approval
    const requiresApproval = this.doesActionRequireApproval(request, config);

    // Check level-based restrictions
    const restrictions = PERMISSION_CONFIG.levelRestrictions[level];

    // Check category-specific restrictions
    let allowed = true;
    let reason: string | undefined = undefined;

    if (request.category === 'deployment' && !this.canDeploy(level)) {
      allowed = false;
      reason = 'Deployment requires higher permission level';
    }

    if (request.category === 'dependency_update' && !restrictions.canAddDependencies) {
      allowed = false;
      reason = 'Dependency updates not allowed at this permission level';
    }

    if (request.category === 'refactoring' && !restrictions.canRefactorCode) {
      allowed = false;
      reason = 'Refactoring not allowed at this permission level';
    }

    if (request.category === 'feature_implementation' && !restrictions.canCreateTasks) {
      allowed = false;
      reason = 'Feature implementation requires higher permission level';
    }

    // Check risk thresholds
    const maxRisk = PERMISSION_CONFIG.riskThresholds[level].maxRisk;
    const riskOrder = ['none', 'low', 'medium', 'high', 'critical'];
    const currentRiskIndex = riskOrder.indexOf(request.riskLevel as any);
    const maxRiskIndex = riskOrder.indexOf(maxRisk as any);
    if (currentRiskIndex > maxRiskIndex) {
      allowed = false;
      reason = `Action risk (${request.riskLevel}) exceeds allowed level (${maxRisk})`;
    }

    // Check time-based restrictions
    const timeRestriction = this.checkTimeRestrictions(request, config);
    if (!timeRestriction.allowed) {
      allowed = false;
      reason = timeRestriction.reason;
    }

    // Check category-based restrictions
    const categoryRestriction = this.checkCategoryRestrictions(request, config);
    if (!categoryRestriction.allowed) {
      allowed = false;
      reason = categoryRestriction.reason;
    }

    return {
      allowed,
      reason,
      requiresApproval,
      permissionLevel: level,
      checkedAt: Date.now(),
    };
  }

  /**
   * Check if action requires approval
   */
  private doesActionRequireApproval(request: PermissionRequest, config: PermissionConfig): boolean {
    // Always approval for certain categories
    if (PERMISSION_CONFIG.alwaysRequiresApproval.includes(request.category)) {
      return true;
    }

    // Check if level allows auto-execution
    const restrictions = PERMISSION_CONFIG.levelRestrictions[config.level];
    if (!restrictions.canExecuteWithoutApproval) {
      return true;
    }

    // Check risk threshold
    const maxRisk = PERMISSION_CONFIG.riskThresholds[config.level].maxRisk;
    const riskOrder = ['none', 'low', 'medium', 'high', 'critical'];
    const currentRiskIndex = riskOrder.indexOf(request.riskLevel as any);
    const maxRiskIndex = riskOrder.indexOf(maxRisk as any);
    if (currentRiskIndex > maxRiskIndex) {
      return true;
    }

    return false;
  }

  /**
   * Check if deployment is allowed at a level
   */
  canDeploy(level: PermissionLevel): boolean {
    return level === PermissionLevel.AUTONOMOUS || level === PermissionLevel.FULL;
  }

  /**
   * Get user permission config
   */
  async getConfig(chatId: number): Promise<PermissionConfig> {
    let config = this.configs.get(chatId);

    if (!config) {
      // Create default config
      config = {
        chatId,
        level: PERMISSION_CONFIG.defaultLevel,
        restrictions: [],
        autoEscalation: false,
        deescalationOnFailure: false,
        defaultLevel: PERMISSION_CONFIG.defaultLevel,
      };
      this.configs.set(chatId, config);
      await this.storeConfig(config);
    }

    return config;
  }

  /**
   * Set permission level
   */
  async setLevel(chatId: number, level: PermissionLevel, reason?: string): Promise<void> {
    const config = await this.getConfig(chatId);
    const previousLevel = config.level;

    // Create grant record
    const grant: PermissionGrant = {
      id: this.generateGrantId(),
      chatId,
      grantedBy: 'user',
      level,
      previousLevel,
      reason,
      grantedAt: Date.now(),
    };

    this.grants.set(grant.id, grant);
    await this.memory.setFact(`permission_grant:${grant.id}`, grant);

    // Update config
    config.level = level;
    await this.storeConfig(config);

    // Log to transparency tracker
    const tracker = getTransparencyTracker();
    await tracker.logAction({
      category: 'other',
      status: 'completed',
      projectPath: 'system',
      chatId,
      title: `Permission level changed to ${level}`,
      description: reason || 'User permission level change',
      reasoning: `User changed permission from ${previousLevel} to ${level}`,
      requiresApproval: false,
      approvedBy: 'user',
      riskLevel: 'none',
      riskFactors: [],
      metadata: { previousLevel, newLevel: level },
    });
  }

  /**
   * Get permission level for a user
   */
  async getLevel(chatId: number): Promise<PermissionLevel> {
    const config = await this.getConfig(chatId);
    return config.level;
  }

  /**
   * Add a permission restriction
   */
  async addRestriction(restriction: Omit<PermissionRestriction, 'id' | 'createdAt'>): Promise<void> {
    const config = await this.getConfig(restriction.chatId);

    const newRestriction: PermissionRestriction = {
      id: this.generateRestrictionId(),
      createdAt: Date.now(),
      ...restriction,
    };

    config.restrictions.push(newRestriction);
    await this.storeConfig(config);
  }

  /**
   * Remove a permission restriction
   */
  async removeRestriction(chatId: number, restrictionId: string): Promise<boolean> {
    const config = await this.getConfig(chatId);
    const initialLength = config.restrictions.length;

    config.restrictions = config.restrictions.filter(r => r.id !== restrictionId);

    if (config.restrictions.length < initialLength) {
      await this.storeConfig(config);
      return true;
    }

    return false;
  }

  /**
   * Clear all restrictions for a user
   */
  async clearRestrictions(chatId: number): Promise<void> {
    const config = await this.getConfig(chatId);
    config.restrictions = [];
    await this.storeConfig(config);
  }

  /**
   * Check time-based restrictions
   */
  private checkTimeRestrictions(_request: PermissionRequest, config: PermissionConfig): { allowed: boolean; reason?: string } {
    for (const restriction of config.restrictions) {
      if (restriction.type !== 'time') continue;

      if (restriction.rule === 'quiet_hours') {
        const hour = new Date().getHours();
        // Quiet hours: 10 PM - 6 AM
        const isQuietHours = hour >= 22 || hour < 6;
        if (isQuietHours && !restriction.allowed) {
          return { allowed: false, reason: 'Action not allowed during quiet hours' };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Check category-based restrictions
   */
  private checkCategoryRestrictions(request: PermissionRequest, config: PermissionConfig): { allowed: boolean; reason?: string } {
    for (const restriction of config.restrictions) {
      if (restriction.type !== 'category') continue;

      if (restriction.rule === request.category && !restriction.allowed) {
        return { allowed: false, reason: `Category "${request.category}" is restricted` };
      }
    }

    return { allowed: true };
  }

  /**
   * Escalate permission level temporarily
   */
  async escalatePermission(chatId: number, temporaryLevel: PermissionLevel, duration: number): Promise<boolean> {
    const config = await this.getConfig(chatId);
    const previousLevel = config.level;

    // Create temporary grant
    const grant: PermissionGrant = {
      id: this.generateGrantId(),
      chatId,
      grantedBy: 'system',
      level: temporaryLevel,
      previousLevel,
      reason: `Temporary escalation for ${duration}ms`,
      expiresAt: Date.now() + duration,
      grantedAt: Date.now(),
    };

    this.grants.set(grant.id, grant);
    await this.memory.setFact(`permission_grant:${grant.id}`, grant);

    // Update config temporarily
    config.level = temporaryLevel;
    await this.storeConfig(config);

    // Schedule de-escalation
    setTimeout(async () => {
      await this.setLevel(chatId, previousLevel, 'Temporary escalation expired');
    }, duration);

    return true;
  }

  /**
   * Get permission grants for a user
   */
  async getGrants(chatId: number): Promise<PermissionGrant[]> {
    const grants: PermissionGrant[] = [];

    for (const grant of this.grants.values()) {
      if (grant.chatId === chatId) {
        // Check if not expired
        if (grant.expiresAt && grant.expiresAt < Date.now()) {
          continue;
        }
        grants.push(grant);
      }
    }

    return grants.sort((a, b) => b.grantedAt - a.grantedAt);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalConfigs: number;
    byLevel: Record<PermissionLevel, number>;
    totalGrants: number;
    activeRestrictions: number;
  } {
    const configs = Array.from(this.configs.values());
    const byLevel: Record<string, number> = {};

    for (const level of Object.values(PermissionLevel)) {
      byLevel[level] = 0;
    }

    for (const config of configs) {
      byLevel[config.level]++;
    }

    let totalRestrictions = 0;
    for (const config of configs) {
      totalRestrictions += config.restrictions.length;
    }

    return {
      totalConfigs: configs.length,
      byLevel: byLevel as Record<PermissionLevel, number>,
      totalGrants: this.grants.size,
      activeRestrictions: totalRestrictions,
    };
  }

  /**
   * Store config in memory
   */
  private async storeConfig(config: PermissionConfig): Promise<void> {
    await this.memory.setFact(`permission_config:${config.chatId}`, config);
  }

  /**
   * Load configs from memory
   */
  private async loadConfigs(): Promise<void> {
    // Configs are loaded on demand
  }

  /**
   * Generate unique IDs
   */
  private generateGrantId(): string {
    return `grant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateRestrictionId(): string {
    return `restriction-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalPermissionManager: PermissionManager | null = null;

export function getPermissionManager(): PermissionManager {
  if (!globalPermissionManager) {
    globalPermissionManager = new PermissionManager();
  }
  return globalPermissionManager;
}

export function resetPermissionManager(): void {
  if (globalPermissionManager) {
    globalPermissionManager.stop();
  }
  globalPermissionManager = null;
}
