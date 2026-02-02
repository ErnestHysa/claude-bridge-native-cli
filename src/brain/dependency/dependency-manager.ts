/**
 * Dependency Manager - Automated dependency management
 *
 * The Dependency Manager automatically handles project dependencies:
 * - Detects outdated dependencies
 * - Checks for security vulnerabilities
 * - Automatically updates safe dependencies
 * - Creates intentions for changes requiring approval
 * - Tracks dependency health over time
 *
 * Policies:
 * - Patch updates: Auto-approve (x.x.Z)
 * - Minor updates: Supervised (x.Y.z)
 * - Major updates: Require approval (X.y.z)
 * - Vulnerabilities: Immediate attention
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { getIntentionEngine } from '../intention/intention-engine.js';
import { getMemoryStore } from '../memory/memory-store.js';
import { getGitAutomation } from '../git/git-automation.js';

// ============================================
// Types
// ============================================

/**
 * Dependency update type
 */
export type UpdateType = 'patch' | 'minor' | 'major' | 'prerelease';

/**
 * Dependency source
 */
export type DependencySource = 'dependencies' | 'devDependencies' | 'peerDependencies';

/**
 * Severity of a vulnerability
 */
export type VulnerabilitySeverity = 'low' | 'moderate' | 'high' | 'critical';

/**
 * A package dependency
 */
export interface Dependency {
  name: string;
  version: string;
  source: DependencySource;
  type?: 'dependency' | 'devDependency' | 'peerDependency';
}

/**
 * An available update for a dependency
 */
export interface DependencyUpdate {
  name: string;
  current: string;
  wanted: string;       // Latest version matching semver range
  latest: string;       // Absolute latest
  updateType: UpdateType;
  source: DependencySource;
  projectPath: string;
  timestamp: number;
}

/**
 * A security vulnerability
 */
export interface Vulnerability {
  name: string;
  severity: VulnerabilitySeverity;
  vulnerableVersions: string[];
  patchedVersions: string[];
  title: string;
  description: string;
  url: string;
  projectPath: string;
  timestamp: number;
}

/**
 * Dependency health summary
 */
export interface DependencyHealth {
  projectPath: string;
  totalDependencies: number;
  outdated: number;
  vulnerable: number;
  lastChecked: number;
  updatesAvailable: DependencyUpdate[];
  vulnerabilities: Vulnerability[];
  healthScore: number;  // 0-100
}

/**
 * Update policy for a dependency type
 */
export interface UpdatePolicy {
  autoUpdatePatch: boolean;
  autoUpdateMinor: boolean;
  autoUpdateMajor: boolean;
  requireApprovalForVulnerable: boolean;
  excludePackages: string[];
}

// ============================================
// Configuration
// ============================================

const DEPENDENCY_CONFIG = {
  // Default update policies
  defaultPolicy: {
    autoUpdatePatch: true,
    autoUpdateMinor: false,
    autoUpdateMajor: false,
    requireApprovalForVulnerable: true,
    excludePackages: [],
  } as UpdatePolicy,

  // Check interval (ms) - 6 hours
  checkInterval: 6 * 60 * 60 * 1000,

  // npm audit timeout (ms)
  auditTimeout: 60 * 1000,

  // npm outdated timeout (ms)
  outdatedTimeout: 60 * 1000,
};

// ============================================
// Dependency Manager Class
// ============================================

export class DependencyManager {
  private memory = getMemoryStore();
  private active = false;
  private checkTimer?: NodeJS.Timeout;
  private healthCache = new Map<string, DependencyHealth>();

  /**
   * Start the dependency manager
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadPolicies();

    // Start periodic checks
    this.checkTimer = setInterval(() => {
      this.checkAllProjects();
    }, DEPENDENCY_CONFIG.checkInterval);

    console.log('[DependencyManager] Started');
  }

  /**
   * Stop the dependency manager
   */
  stop(): void {
    this.active = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    console.log('[DependencyManager] Stopped');
  }

  /**
   * Check all watched projects for dependency issues
   */
  private async checkAllProjects(): Promise<void> {
    if (!this.active) return;

    const projects = await this.getWatchedProjects();

    for (const projectPath of projects) {
      await this.checkProject(projectPath);
    }
  }

  /**
   * Check a single project for dependency issues
   */
  async checkProject(projectPath: string): Promise<DependencyHealth> {
    const chatId = await this.getChatIdForProject(projectPath);
    if (chatId === null) {
      throw new Error('No chat ID found for project');
    }

    // Get update policy for this project
    const policy = await this.getPolicy(projectPath);

    // Check for outdated dependencies
    const updates = await this.checkOutdated(projectPath);

    // Check for vulnerabilities
    const vulnerabilities = await this.checkVulnerabilities(projectPath);

    // Calculate health score
    const healthScore = this.calculateHealthScore(updates, vulnerabilities);

    const health: DependencyHealth = {
      projectPath,
      totalDependencies: await this.countDependencies(projectPath),
      outdated: updates.length,
      vulnerable: vulnerabilities.length,
      lastChecked: Date.now(),
      updatesAvailable: updates,
      vulnerabilities,
      healthScore,
    };

    // Cache the health
    this.healthCache.set(projectPath, health);
    await this.memory.setFact(`dependency_health:${projectPath}`, health);

    // Handle critical vulnerabilities immediately
    const criticalVulns = vulnerabilities.filter(v => v.severity === 'critical');
    if (criticalVulns.length > 0) {
      await this.handleCriticalVulnerabilities(projectPath, criticalVulns, chatId);
    }

    // Auto-update patch versions if policy allows
    if (policy.autoUpdatePatch) {
      await this.autoUpdatePatches(projectPath, updates, chatId, policy);
    }

    // Create intentions for other updates
    await this.createUpdateIntentions(projectPath, updates, vulnerabilities, chatId);

    return health;
  }

  /**
   * Check for outdated dependencies
   */
  async checkOutdated(projectPath: string): Promise<DependencyUpdate[]> {
    try {
      const output = await this.runNpmCommand(projectPath, 'outdated', ['--json']);
      const data = JSON.parse(output);

      const updates: DependencyUpdate[] = [];

      for (const [name, info] of Object.entries(data)) {
        const pkg = info as {
          current: string;
          wanted: string;
          latest: string;
          location?: string;
        };

        const updateType = this.getUpdateType(pkg.current, pkg.latest);
        const source = await this.getDependencySource(projectPath, name);

        updates.push({
          name,
          current: pkg.current,
          wanted: pkg.wanted,
          latest: pkg.latest,
          updateType,
          source,
          projectPath,
          timestamp: Date.now(),
        });
      }

      return updates;
    } catch (error) {
      // npm outdated returns non-zero when updates are available
      const errorStr = error instanceof Error ? error.message : String(error);
      if (this.isJsonOutput(errorStr)) {
        const data = JSON.parse(this.extractJson(errorStr));
        const updates: DependencyUpdate[] = [];

        for (const [name, info] of Object.entries(data)) {
          const pkg = info as {
            current: string;
            wanted: string;
            latest: string;
          };

          const updateType = this.getUpdateType(pkg.current, pkg.latest);
          const source = await this.getDependencySource(projectPath, name);

          updates.push({
            name,
            current: pkg.current,
            wanted: pkg.wanted,
            latest: pkg.latest,
            updateType,
            source,
            projectPath,
            timestamp: Date.now(),
          });
        }

        return updates;
      }

      console.error('[DependencyManager] Error checking outdated:', error);
      return [];
    }
  }

  /**
   * Check for security vulnerabilities
   */
  async checkVulnerabilities(projectPath: string): Promise<Vulnerability[]> {
    try {
      const output = await this.runNpmCommand(projectPath, 'audit', ['--json']);
      const data = JSON.parse(output);

      const vulnerabilities: Vulnerability[] = [];

      if (data.vulnerabilities) {
        for (const [name, info] of Object.entries(data.vulnerabilities)) {
          const vuln = info as {
            severity: VulnerabilitySeverity;
            vulnerableVersions: string[];
            patchedVersions: string[];
            title: string;
            description: string;
            url: string;
          };

          vulnerabilities.push({
            name,
            severity: vuln.severity,
            vulnerableVersions: vuln.vulnerableVersions,
            patchedVersions: vuln.patchedVersions,
            title: vuln.title,
            description: vuln.description,
            url: vuln.url,
            projectPath,
            timestamp: Date.now(),
          });
        }
      }

      return vulnerabilities;
    } catch (error) {
      // npm audit returns non-zero when vulnerabilities are found
      const errorStr = error instanceof Error ? error.message : String(error);
      if (this.isJsonOutput(errorStr)) {
        const data = JSON.parse(this.extractJson(errorStr));
        const vulnerabilities: Vulnerability[] = [];

        if (data.vulnerabilities) {
          for (const [name, info] of Object.entries(data.vulnerabilities)) {
            const vuln = info as {
              severity: VulnerabilitySeverity;
              vulnerableVersions: string[];
              patchedVersions: string[];
              title: string;
              description: string;
              url: string;
            };

            vulnerabilities.push({
              name,
              severity: vuln.severity,
              vulnerableVersions: vuln.vulnerableVersions,
              patchedVersions: vuln.patchedVersions,
              title: vuln.title,
              description: vuln.description,
              url: vuln.url,
              projectPath,
              timestamp: Date.now(),
            });
          }
        }

        return vulnerabilities;
      }

      console.error('[DependencyManager] Error checking vulnerabilities:', error);
      return [];
    }
  }

  /**
   * Auto-update patch versions
   */
  private async autoUpdatePatches(
    projectPath: string,
    updates: DependencyUpdate[],
    _chatId: number,
    policy: UpdatePolicy
  ): Promise<void> {
    const patchUpdates = updates.filter(u => {
      if (u.updateType !== 'patch') return false;
      if (policy.excludePackages.includes(u.name)) return false;
      return true;
    });

    if (patchUpdates.length === 0) return;

    // Group by package and update
    const packages = patchUpdates.map(u => u.name);

    try {
      await this.runNpmCommand(projectPath, 'install', [...packages, '--save-exact']);
      await this.memory.setFact(`dependency_update:${projectPath}:${Date.now()}`, {
        type: 'patch',
        packages,
        timestamp: Date.now(),
      });

      // Create a git commit for the update
      const git = getGitAutomation();
      try {
        await git.smartCommit(projectPath, {
          autoStage: true,
          conventionalCommits: true,
          generateMessage: true,
        });
      } catch {
        // Git commit might fail if not in a git repo
      }
    } catch (error) {
      console.error('[DependencyManager] Error auto-updating patches:', error);
    }
  }

  /**
   * Handle critical vulnerabilities
   */
  private async handleCriticalVulnerabilities(
    projectPath: string,
    vulnerabilities: Vulnerability[],
    chatId: number
  ): Promise<void> {
    const intentionEngine = getIntentionEngine();

    for (const vuln of vulnerabilities) {
      await intentionEngine.processTrigger({
        type: 'dependency_vulnerable',
        projectPath,
        chatId,
        data: {
          name: vuln.name,
          severity: vuln.severity,
          title: vuln.title,
          description: vuln.description,
          url: vuln.url,
          patchedVersions: vuln.patchedVersions,
        },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Create intentions for updates
   */
  private async createUpdateIntentions(
    projectPath: string,
    updates: DependencyUpdate[],
    vulnerabilities: Vulnerability[],
    chatId: number
  ): Promise<void> {
    const intentionEngine = getIntentionEngine();

    // Create intention for outdated dependencies
    const needsUpdate = updates.filter(u => u.updateType !== 'patch');
    if (needsUpdate.length > 0) {
      await intentionEngine.processTrigger({
        type: 'dependency_outdated',
        projectPath,
        chatId,
        data: {
          count: needsUpdate.length,
          updates: needsUpdate.map(u => ({
            name: u.name,
            current: u.current,
            latest: u.latest,
            type: u.updateType,
          })),
        },
        timestamp: Date.now(),
      });
    }

    // Create intentions for non-critical vulnerabilities
    const nonCriticalVulns = vulnerabilities.filter(v => v.severity !== 'critical');
    if (nonCriticalVulns.length > 0) {
      await intentionEngine.processTrigger({
        type: 'dependency_vulnerable',
        projectPath,
        chatId,
        data: {
          count: nonCriticalVulns.length,
          vulnerabilities: nonCriticalVulns.map(v => ({
            name: v.name,
            severity: v.severity,
            title: v.title,
          })),
        },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Update a specific dependency
   */
  async updateDependency(
    projectPath: string,
    packageName: string,
    version?: string
  ): Promise<boolean> {
    try {
      const args = version ? [`${packageName}@${version}`] : [packageName];
      await this.runNpmCommand(projectPath, 'install', [...args, '--save-exact']);

      // Record the update
      await this.memory.setFact(`dependency_update:${projectPath}:${Date.now()}`, {
        type: 'manual',
        package: packageName,
        version,
        timestamp: Date.now(),
      });

      return true;
    } catch (error) {
      console.error('[DependencyManager] Error updating dependency:', error);
      return false;
    }
  }

  /**
   * Fix vulnerabilities using npm audit fix
   */
  async fixVulnerabilities(projectPath: string, force = false): Promise<boolean> {
    try {
      const args = force ? ['--force'] : [];
      await this.runNpmCommand(projectPath, 'audit', ['fix', ...args]);
      return true;
    } catch (error) {
      console.error('[DependencyManager] Error fixing vulnerabilities:', error);
      return false;
    }
  }

  /**
   * Get the health of a project
   */
  getHealth(projectPath: string): DependencyHealth | null {
    return this.healthCache.get(projectPath) ?? null;
  }

  /**
   * Get update policy for a project
   */
  async getPolicy(projectPath: string): Promise<UpdatePolicy> {
    try {
      const policy = await this.memory.getFact(`dependency_policy:${projectPath}`) as UpdatePolicy | undefined;
      return policy ?? DEPENDENCY_CONFIG.defaultPolicy;
    } catch {
      return DEPENDENCY_CONFIG.defaultPolicy;
    }
  }

  /**
   * Set update policy for a project
   */
  async setPolicy(projectPath: string, policy: Partial<UpdatePolicy>): Promise<UpdatePolicy> {
    const current = await this.getPolicy(projectPath);
    const updated: UpdatePolicy = {
      ...current,
      ...policy,
    };

    await this.memory.setFact(`dependency_policy:${projectPath}`, updated);
    return updated;
  }

  /**
   * Run an npm command
   */
  private async runNpmCommand(projectPath: string, command: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('npm', [command, ...args], {
        cwd: projectPath,
        shell: true,
        env: { ...process.env, NODE_ENV: 'production' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`npm ${command} failed: ${stderr || stdout}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get the dependency source for a package
   */
  private async getDependencySource(projectPath: string, packageName: string): Promise<DependencySource> {
    try {
      const packageJsonPath = join(projectPath, 'package.json');
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      if (pkg.dependencies?.[packageName]) return 'dependencies';
      if (pkg.devDependencies?.[packageName]) return 'devDependencies';
      if (pkg.peerDependencies?.[packageName]) return 'peerDependencies';

      return 'dependencies';
    } catch {
      return 'dependencies';
    }
  }

  /**
   * Get the update type between two versions
   */
  private getUpdateType(current: string, latest: string): UpdateType {
    const currentParts = current.replace(/^v/, '').split('.').map(Number);
    const latestParts = latest.replace(/^v/, '').split('-')[0].split('.').map(Number);

    // Handle pre-release
    if (latest.includes('-')) return 'prerelease';

    // Major version bump
    if (latestParts[0] > currentParts[0]) return 'major';

    // Minor version bump
    if (latestParts[1] > currentParts[1]) return 'minor';

    // Patch version bump
    if (latestParts[2] > currentParts[2]) return 'patch';

    return 'patch';
  }

  /**
   * Count total dependencies
   */
  private async countDependencies(projectPath: string): Promise<number> {
    try {
      const packageJsonPath = join(projectPath, 'package.json');
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      const deps = Object.keys(pkg.dependencies || {}).length;
      const devDeps = Object.keys(pkg.devDependencies || {}).length;
      const peerDeps = Object.keys(pkg.peerDependencies || {}).length;

      return deps + devDeps + peerDeps;
    } catch {
      return 0;
    }
  }

  /**
   * Calculate health score
   */
  private calculateHealthScore(updates: DependencyUpdate[], vulnerabilities: Vulnerability[]): number {
    let score = 100;

    // Deduct for outdated dependencies
    const majorUpdates = updates.filter(u => u.updateType === 'major').length;
    const minorUpdates = updates.filter(u => u.updateType === 'minor').length;
    const patchUpdates = updates.filter(u => u.updateType === 'patch').length;

    score -= majorUpdates * 10;
    score -= minorUpdates * 3;
    score -= patchUpdates * 1;

    // Deduct for vulnerabilities
    const criticalVulns = vulnerabilities.filter(v => v.severity === 'critical').length;
    const highVulns = vulnerabilities.filter(v => v.severity === 'high').length;
    const moderateVulns = vulnerabilities.filter(v => v.severity === 'moderate').length;
    const lowVulns = vulnerabilities.filter(v => v.severity === 'low').length;

    score -= criticalVulns * 50;
    score -= highVulns * 20;
    score -= moderateVulns * 5;
    score -= lowVulns * 1;

    return Math.max(0, score);
  }

  /**
   * Get chat ID for a project
   */
  private async getChatIdForProject(projectPath: string): Promise<number | null> {
    try {
      const key = `project:${projectPath}:chatId`;
      const chatId = await this.memory.getFact(key) as number | undefined;
      return chatId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get watched projects
   */
  private async getWatchedProjects(): Promise<string[]> {
    try {
      const projects = await this.memory.getFact('watched_projects') as string[] | undefined;
      return projects ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Load policies from memory
   */
  private async loadPolicies(): Promise<void> {
    // Policies are loaded on demand
  }

  /**
   * Check if error output contains JSON
   */
  private isJsonOutput(error: unknown): boolean {
    const str = error instanceof Error ? error.message : String(error);
    try {
      const extracted = this.extractJson(str);
      JSON.parse(extracted);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract JSON from error output
   */
  private extractJson(str: string): string {
    // Find JSON object in string
    const start = str.indexOf('{');
    const end = str.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return str.substring(start, end + 1);
    }
    return '{}';
  }

  /**
   * Get statistics
   */
  getStats(): {
    trackedProjects: number;
    totalOutdated: number;
    totalVulnerable: number;
    avgHealthScore: number;
  } {
    const healths = Array.from(this.healthCache.values());

    let totalOutdated = 0;
    let totalVulnerable = 0;
    let totalHealthScore = 0;

    for (const health of healths) {
      totalOutdated += health.outdated;
      totalVulnerable += health.vulnerable;
      totalHealthScore += health.healthScore;
    }

    return {
      trackedProjects: healths.length,
      totalOutdated,
      totalVulnerable,
      avgHealthScore: healths.length > 0 ? totalHealthScore / healths.length : 100,
    };
  }
}

// ============================================
// Global Singleton
// ============================================

let globalDependencyManager: DependencyManager | null = null;

export function getDependencyManager(): DependencyManager {
  if (!globalDependencyManager) {
    globalDependencyManager = new DependencyManager();
  }
  return globalDependencyManager;
}

export function resetDependencyManager(): void {
  if (globalDependencyManager) {
    globalDependencyManager.stop();
  }
  globalDependencyManager = null;
}
