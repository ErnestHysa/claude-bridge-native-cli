/**
 * Approval Workflow - Interactive approval system for autonomous actions
 *
 * The Approval Workflow manages the approval process for autonomous AI actions:
 * - Queue actions requiring approval
 * - Interactive approval via Telegram inline buttons
 * - Track approval history and decisions
 * - Support bulk approvals
 * - Handle approval expiration and reminders
 *
 * Approval types:
 * - Single action approval
 * - Bulk/category approval
 * - Scheduled auto-approval for trusted actions
 * - Delegation to other users
 */

import { getMemoryStore } from '../memory/memory-store.js';
import { getTransparencyTracker } from '../transparency/transparency-tracker.js';
import { getPermissionManager, PermissionLevel } from '../permission/permission-manager.js';

// ============================================
// Types
// ============================================

/**
 * Approval status
 */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

/**
 * Approval request
 */
export interface ApprovalRequest {
  id: string;
  chatId: number;
  projectPath: string;
  userId?: number;             // Telegram user who should approve

  // Action details
  actionId: string;
  actionType: string;
  actionCategory: string;
  title: string;
  description: string;
  reasoning: string;

  // Risk assessment
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  estimatedDuration: number;   // minutes

  // Files affected
  filesAffected: string[];

  // Metadata
  createdAt: number;
  expiresAt: number;
  reminderSentAt?: number;

  // Status
  status: ApprovalStatus;
  approvedBy?: number;
  approvedAt?: number;
  deniedReason?: string;

  // Context
  context?: Record<string, unknown>;

  // Telegram message info for inline buttons
  telegramMessageId?: number;
}

/**
 * Approval decision
 */
export interface ApprovalDecision {
  requestId: string;
  approved: boolean;
  approvedBy: number;
  approvedAt: number;
  reason?: string;
}

/**
 * Approval batch
 */
export interface ApprovalBatch {
  id: string;
  chatId: number;
  projectPath: string;
  requestIds: string[];
  category?: string;           // Only include requests of this category
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
}

/**
 * Approval policy
 */
export interface ApprovalPolicy {
  chatId: number;
  projectPath: string;
  autoApproveLowRisk: boolean;
  autoApproveTestActions: boolean;
  requireApprovalForDeploy: boolean;
  requireApprovalForDependency: boolean;
  requireApprovalForRefactoring: boolean;
  approvalTimeout: number;      // milliseconds
  reminderInterval: number;      // milliseconds before expiration
}

/**
 * Approval statistics
 */
export interface ApprovalStats {
  totalRequests: number;
  pending: number;
  approved: number;
  denied: number;
  expired: number;
  byCategory: Record<string, number>;
  avgApprovalTime: number;      // milliseconds
  approvalRate: number;         // 0-1
}

// ============================================
// Configuration
// ============================================

const APPROVAL_CONFIG = {
  // Default approval timeout (24 hours)
  defaultTimeout: 24 * 60 * 60 * 1000,

  // Reminder interval (1 hour before expiration)
  defaultReminderInterval: 60 * 60 * 1000,

  // Maximum pending approvals per user
  maxPendingPerUser: 50,

  // Retention period for completed approvals (30 days)
  retentionPeriod: 30 * 24 * 60 * 60 * 1000,

  // Bulk approval limit
  maxBulkApprovals: 20,
};

// ============================================
// Approval Workflow Class
// ============================================

export class ApprovalWorkflow {
  private memory = getMemoryStore();
  private requests = new Map<string, ApprovalRequest>();
  private batches = new Map<string, ApprovalBatch>();
  private policies = new Map<string, ApprovalPolicy>(); // key: chatId:projectPath
  private active = false;
  private reminderTimer?: NodeJS.Timeout;

  /**
   * Start the approval workflow
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadRequests();
    await this.loadPolicies();

    // Start reminder timer
    this.startReminderTimer();

    console.log('[ApprovalWorkflow] Started');
  }

  /**
   * Stop the approval workflow
   */
  stop(): void {
    this.active = false;
    if (this.reminderTimer) {
      clearTimeout(this.reminderTimer);
      this.reminderTimer = undefined;
    }
    console.log('[ApprovalWorkflow] Stopped');
  }

  /**
   * Request approval for an action
   */
  async requestApproval(request: Omit<ApprovalRequest, 'id' | 'createdAt' | 'status'>): Promise<ApprovalRequest> {
    // Check if approval is needed based on policy
    const policy = await this.getPolicy(request.chatId, request.projectPath);
    const needsApproval = await this.checkNeedsApproval(request, policy);

    if (!needsApproval) {
      // Auto-approve
      const autoApproved: ApprovalRequest = {
        ...request,
        id: this.generateRequestId(),
        createdAt: Date.now(),
        status: 'approved',
        approvedBy: 0, // System
        approvedAt: Date.now(),
      };
      this.requests.set(autoApproved.id, autoApproved);
      await this.storeRequest(autoApproved);

      // Log to transparency tracker
      const tracker = getTransparencyTracker();
      await tracker.logAction({
        category: request.actionCategory as any,
        status: 'approved',
        projectPath: request.projectPath,
        chatId: request.chatId,
        title: request.title,
        description: request.description,
        reasoning: request.reasoning + ' (Auto-approved based on policy)',
        requiresApproval: false,
        approvedBy: 'auto',
        riskLevel: request.riskLevel,
        riskFactors: [],
        metadata: request.context || {},
      });

      return autoApproved;
    }

    const approvalRequest: ApprovalRequest = {
      ...request,
      id: this.generateRequestId(),
      createdAt: Date.now(),
      status: 'pending',
      expiresAt: Date.now() + (policy.approvalTimeout || APPROVAL_CONFIG.defaultTimeout),
    };

    this.requests.set(approvalRequest.id, approvalRequest);
    await this.storeRequest(approvalRequest);

    // Log to transparency tracker
    const tracker = getTransparencyTracker();
    await tracker.logAction({
      category: request.actionCategory as any,
      status: 'pending',
      projectPath: request.projectPath,
      chatId: request.chatId,
      title: request.title,
      description: request.description,
      reasoning: request.reasoning,
      requiresApproval: true,
      riskLevel: request.riskLevel,
      riskFactors: [],
      metadata: request.context || {},
    });

    console.log(`[ApprovalWorkflow] Approval requested: ${approvalRequest.id}`);

    return approvalRequest;
  }

  /**
   * Approve a request
   */
  async approve(requestId: string, approvedBy: number, reason?: string): Promise<boolean> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    request.status = 'approved';
    request.approvedBy = approvedBy;
    request.approvedAt = Date.now();

    await this.storeRequest(request);

    // Update transparency tracker
    const tracker = getTransparencyTracker();
    await tracker.recordApproval(request.actionId, {
      actionId: request.actionId,
      approvedBy: 'user',
      approvedAt: Date.now(),
      reason,
    });

    await tracker.updateAction(request.actionId, { status: 'approved' });

    console.log(`[ApprovalWorkflow] Request approved: ${requestId} by user ${approvedBy}`);
    return true;
  }

  /**
   * Deny a request
   */
  async deny(requestId: string, deniedBy: number, reason?: string): Promise<boolean> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    request.status = 'denied';
    request.approvedBy = deniedBy;
    request.approvedAt = Date.now();
    request.deniedReason = reason;

    await this.storeRequest(request);

    // Update transparency tracker
    const tracker = getTransparencyTracker();
    await tracker.updateAction(request.actionId, {
      status: 'denied',
      error: reason || 'Request denied',
    });

    console.log(`[ApprovalWorkflow] Request denied: ${requestId} by user ${deniedBy}`);
    return true;
  }

  /**
   * Cancel a request
   */
  async cancel(requestId: string): Promise<boolean> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    request.status = 'cancelled';
    await this.storeRequest(request);

    console.log(`[ApprovalWorkflow] Request cancelled: ${requestId}`);
    return true;
  }

  /**
   * Get pending requests for a user
   */
  getPendingRequests(chatId: number, userId?: number): ApprovalRequest[] {
    let requests = Array.from(this.requests.values())
      .filter(r => r.chatId === chatId && r.status === 'pending');

    if (userId !== undefined) {
      requests = requests.filter(r => r.userId === userId || r.userId === undefined);
    }

    // Sort by creation time (oldest first)
    requests.sort((a, b) => a.createdAt - b.createdAt);

    return requests;
  }

  /**
   * Get a specific request
   */
  getRequest(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  /**
   * Create a bulk approval batch
   */
  async createBatch(options: {
    chatId: number;
    projectPath: string;
    category?: string;
    maxRequests?: number;
  }): Promise<ApprovalBatch | null> {
    const { chatId, projectPath, category, maxRequests = APPROVAL_CONFIG.maxBulkApprovals } = options;

    let requests = Array.from(this.requests.values())
      .filter(r => r.chatId === chatId && r.projectPath === projectPath && r.status === 'pending');

    if (category) {
      requests = requests.filter(r => r.actionCategory === category);
    }

    if (requests.length === 0) {
      return null;
    }

    // Limit the batch size
    requests = requests.slice(0, maxRequests);

    const batch: ApprovalBatch = {
      id: this.generateBatchId(),
      chatId,
      projectPath,
      requestIds: requests.map(r => r.id),
      category,
      createdAt: Date.now(),
      expiresAt: Date.now() + APPROVAL_CONFIG.defaultTimeout,
      status: 'pending',
    };

    this.batches.set(batch.id, batch);
    await this.storeBatch(batch);

    return batch;
  }

  /**
   * Approve all requests in a batch
   */
  async approveBatch(batchId: string, approvedBy: number, reason?: string): Promise<number> {
    const batch = this.batches.get(batchId);
    if (!batch || batch.status !== 'pending') {
      return 0;
    }

    let approvedCount = 0;
    for (const requestId of batch.requestIds) {
      const success = await this.approve(requestId, approvedBy, reason);
      if (success) {
        approvedCount++;
      }
    }

    batch.status = 'approved';
    await this.storeBatch(batch);

    return approvedCount;
  }

  /**
   * Deny all requests in a batch
   */
  async denyBatch(batchId: string, deniedBy: number, reason?: string): Promise<number> {
    const batch = this.batches.get(batchId);
    if (!batch || batch.status !== 'pending') {
      return 0;
    }

    let deniedCount = 0;
    for (const requestId of batch.requestIds) {
      const success = await this.deny(requestId, deniedBy, reason);
      if (success) {
        deniedCount++;
      }
    }

    batch.status = 'denied';
    await this.storeBatch(batch);

    return deniedCount;
  }

  /**
   * Get approval statistics
   */
  getStats(filter?: { chatId?: number; projectPath?: string }): ApprovalStats {
    let requests = Array.from(this.requests.values());

    if (filter?.chatId) {
      requests = requests.filter(r => r.chatId === filter.chatId);
    }

    if (filter?.projectPath) {
      requests = requests.filter(r => r.projectPath === filter.projectPath);
    }

    const pending = requests.filter(r => r.status === 'pending').length;
    const approved = requests.filter(r => r.status === 'approved').length;
    const denied = requests.filter(r => r.status === 'denied').length;
    const expired = requests.filter(r => r.status === 'expired').length;

    const byCategory: Record<string, number> = {};
    for (const r of requests) {
      byCategory[r.actionCategory] = (byCategory[r.actionCategory] || 0) + 1;
    }

    // Calculate average approval time
    const approvedRequests = requests.filter(r => r.status === 'approved' && r.approvedAt);
    const avgApprovalTime = approvedRequests.length > 0
      ? approvedRequests.reduce((sum, r) => sum + (r.approvedAt! - r.createdAt), 0) / approvedRequests.length
      : 0;

    return {
      totalRequests: requests.length,
      pending,
      approved,
      denied,
      expired,
      byCategory,
      avgApprovalTime,
      approvalRate: approvedRequests.length > 0 ? approved / (approved + denied) : 1,
    };
  }

  /**
   * Set approval policy
   */
  async setPolicy(chatId: number, projectPath: string, policy: Partial<ApprovalPolicy>): Promise<void> {
    const key = `${chatId}:${projectPath}`;
    const existing = this.policies.get(key);

    const newPolicy: ApprovalPolicy = {
      chatId,
      projectPath,
      autoApproveLowRisk: policy.autoApproveLowRisk ?? existing?.autoApproveLowRisk ?? false,
      autoApproveTestActions: policy.autoApproveTestActions ?? existing?.autoApproveTestActions ?? true,
      requireApprovalForDeploy: policy.requireApprovalForDeploy ?? existing?.requireApprovalForDeploy ?? true,
      requireApprovalForDependency: policy.requireApprovalForDependency ?? existing?.requireApprovalForDependency ?? false,
      requireApprovalForRefactoring: policy.requireApprovalForRefactoring ?? existing?.requireApprovalForRefactoring ?? false,
      approvalTimeout: policy.approvalTimeout ?? existing?.approvalTimeout ?? APPROVAL_CONFIG.defaultTimeout,
      reminderInterval: policy.reminderInterval ?? existing?.reminderInterval ?? APPROVAL_CONFIG.defaultReminderInterval,
    };

    this.policies.set(key, newPolicy);
    await this.memory.setFact(`approval_policy:${key}`, newPolicy);
  }

  /**
   * Get approval policy
   */
  async getPolicy(chatId: number, projectPath: string): Promise<ApprovalPolicy> {
    const key = `${chatId}:${projectPath}`;
    let policy = this.policies.get(key);

    if (!policy) {
      // Check permission level for default policy
      const permManager = getPermissionManager();
      const level = await permManager.getLevel(chatId);

      policy = {
        chatId,
        projectPath,
        autoApproveLowRisk: level === PermissionLevel.AUTONOMOUS || level === PermissionLevel.FULL,
        autoApproveTestActions: level === PermissionLevel.SUPERVISED || level === PermissionLevel.AUTONOMOUS || level === PermissionLevel.FULL,
        requireApprovalForDeploy: level !== PermissionLevel.FULL,
        requireApprovalForDependency: false,
        requireApprovalForRefactoring: level === PermissionLevel.READ_ONLY || level === PermissionLevel.ADVISORY,
        approvalTimeout: APPROVAL_CONFIG.defaultTimeout,
        reminderInterval: APPROVAL_CONFIG.defaultReminderInterval,
      };

      this.policies.set(key, policy);
    }

    return policy;
  }

  /**
   * Expire old pending requests
   */
  async expireOldRequests(): Promise<number> {
    const now = Date.now();
    let expired = 0;

    for (const [_id, request] of this.requests) {
      if (request.status === 'pending' && request.expiresAt < now) {
        request.status = 'expired';
        await this.storeRequest(request);
        expired++;

        // Update transparency tracker
        const tracker = getTransparencyTracker();
        await tracker.updateAction(request.actionId, { status: 'pending' }); // Still pending, just expired approval
      }
    }

    return expired;
  }

  /**
   * Clean up old completed requests
   */
  async cleanupOldRequests(): Promise<number> {
    const cutoff = Date.now() - APPROVAL_CONFIG.retentionPeriod;
    let cleaned = 0;

    for (const [id, request] of this.requests) {
      if (request.createdAt < cutoff) {
        this.requests.delete(id);
        await this.memory.setFact(`approval_request:${id}`, null);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get requests needing reminders
   */
  getRequestsNeedingReminder(): ApprovalRequest[] {
    const now = Date.now();
    const reminderWindow = 60 * 60 * 1000; // 1 hour

    return Array.from(this.requests.values())
      .filter(r => {
        if (r.status !== 'pending') return false;
        if (r.reminderSentAt) return false; // Already sent

        const timeUntilExpiry = r.expiresAt - now;
        return timeUntilExpiry > 0 && timeUntilExpiry <= reminderWindow;
      });
  }

  /**
   * Mark reminder as sent
   */
  async markReminderSent(requestId: string): Promise<void> {
    const request = this.requests.get(requestId);
    if (request) {
      request.reminderSentAt = Date.now();
      await this.storeRequest(request);
    }
  }

  /**
   * Start reminder timer
   */
  private startReminderTimer(): void {
    const checkReminders = async () => {
      if (!this.active) return;

      // Expire old requests
      await this.expireOldRequests();

      // Check for requests needing reminders
      const needsReminder = this.getRequestsNeedingReminder();
      if (needsReminder.length > 0) {
        // Send reminders (implementation would call bot to send messages)
        for (const request of needsReminder) {
          await this.markReminderSent(request.id);
        }
        console.log(`[ApprovalWorkflow] Sent ${needsReminder.length} reminders`);
      }

      // Check again in 5 minutes
      if (this.active) {
        this.reminderTimer = setTimeout(checkReminders, 5 * 60 * 1000);
      }
    };

    this.reminderTimer = setTimeout(checkReminders, 5 * 60 * 1000);
  }

  /**
   * Check if approval is needed based on policy
   */
  private async checkNeedsApproval(
    request: Omit<ApprovalRequest, 'id' | 'createdAt' | 'status'>,
    policy: ApprovalPolicy
  ): Promise<boolean> {
    // Deployment always requires approval unless at full level
    if (request.actionCategory === 'deployment' && policy.requireApprovalForDeploy) {
      return true;
    }

    // Dependency updates require approval if policy says so
    if (request.actionCategory === 'dependency_update' && policy.requireApprovalForDependency) {
      return true;
    }

    // Refactoring requires approval if policy says so
    if (request.actionCategory === 'refactoring' && policy.requireApprovalForRefactoring) {
      return true;
    }

    // Low risk actions can be auto-approved
    if (request.riskLevel === 'none' || request.riskLevel === 'low') {
      if (policy.autoApproveLowRisk) {
        return false;
      }
    }

    // Test actions can be auto-approved
    if (request.actionCategory === 'test_healing' || request.actionType.includes('test')) {
      if (policy.autoApproveTestActions) {
        return false;
      }
    }

    // Default to requiring approval
    return true;
  }

  /**
   * Store request in memory
   */
  private async storeRequest(request: ApprovalRequest): Promise<void> {
    await this.memory.setFact(`approval_request:${request.id}`, request);
  }

  /**
   * Store batch in memory
   */
  private async storeBatch(batch: ApprovalBatch): Promise<void> {
    await this.memory.setFact(`approval_batch:${batch.id}`, batch);
  }

  /**
   * Load requests from memory
   */
  private async loadRequests(): Promise<void> {
    // Requests are loaded on demand
  }

  /**
   * Load policies from memory
   */
  private async loadPolicies(): Promise<void> {
    // Policies are loaded on demand
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `approval-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate a unique batch ID
   */
  private generateBatchId(): string {
    return `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Global Singleton
// ============================================

let globalApprovalWorkflow: ApprovalWorkflow | null = null;

export function getApprovalWorkflow(): ApprovalWorkflow {
  if (!globalApprovalWorkflow) {
    globalApprovalWorkflow = new ApprovalWorkflow();
  }
  return globalApprovalWorkflow;
}

export function resetApprovalWorkflow(): void {
  if (globalApprovalWorkflow) {
    globalApprovalWorkflow.stop();
  }
  globalApprovalWorkflow = null;
}
