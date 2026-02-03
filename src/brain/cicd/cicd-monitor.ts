/**
 * CI/CD Monitor - Monitor CI/CD pipelines for projects
 *
 * Features:
 * - Monitor GitHub Actions workflows
 * - Monitor GitLab CI pipelines
 * - Track build status (success, failure, in progress)
 * - Notify on build failures
 * - Provide build summaries
 * - Support for Jenkins (planned)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getBrain } from '../brain-manager.js';

const execAsync = promisify(exec);

// ============================================
// Types
// ============================================

export type CIProvider = 'github' | 'gitlab' | 'jenkins' | 'circleci' | 'travisci';

export type BuildStatus = 'success' | 'failed' | 'in_progress' | 'pending' | 'unknown';

export interface CIBuild {
  id: string;
  provider: CIProvider;
  projectPath: string;
  branch: string;
  commitHash: string;
  commitMessage: string;
  author: string;
  status: BuildStatus;
  url?: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  workflowName?: string;
  trigger?: 'push' | 'pull_request' | 'manual' | 'scheduled';
}

export interface CIConfig {
  provider: CIProvider;
  enabled: boolean;
  checkInterval?: number; // minutes
  notifyOnFailure?: boolean;
  notifyOnSuccess?: boolean;
  branches?: string[]; // branches to monitor, empty = all
}

export interface CIProject {
  path: string;
  config: CIConfig;
  lastCheck?: number;
  builds: CIBuild[];
}

// ============================================
// CI/CD Monitor Class
// ============================================

export class CIMonitor {
  private brain = getBrain();
  private configDir: string;
  private configFile: string;
  private projects: Map<string, CIProject> = new Map();
  private checking = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.configDir = join(this.brain.getBrainDir(), 'cicd');
    this.configFile = join(this.configDir, 'projects.json');
  }

  /**
   * Initialize the CI monitor
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.configDir)) {
      await mkdir(this.configDir, { recursive: true });
    }

    // Load projects
    await this.loadProjects();

    // Start monitoring
    this.startMonitoring();

    console.log('[CIMonitor] Initialized with', this.projects.size, 'projects');
  }

  /**
   * Add a project to monitor
   */
  async addProject(projectPath: string, config: CIConfig): Promise<void> {
    const project: CIProject = {
      path: projectPath,
      config,
      builds: [],
    };

    this.projects.set(projectPath, project);
    await this.saveProjects();

    // Initial check
    await this.checkProject(projectPath);
  }

  /**
   * Remove a project from monitoring
   */
  async removeProject(projectPath: string): Promise<boolean> {
    const deleted = this.projects.delete(projectPath);
    if (deleted) {
      await this.saveProjects();
    }
    return deleted;
  }

  /**
   * Get all monitored projects
   */
  getProjects(): CIProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * Get builds for a project
   */
  getBuilds(projectPath: string, limit = 10): CIBuild[] {
    const project = this.projects.get(projectPath);
    if (!project) return [];
    return project.builds.slice(0, limit);
  }

  /**
   * Get recent failed builds across all projects
   */
  getFailedBuilds(limit = 10): CIBuild[] {
    const failed: CIBuild[] = [];
    for (const project of this.projects.values()) {
      for (const build of project.builds) {
        if (build.status === 'failed') {
          failed.push(build);
        }
      }
    }
    return failed.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }

  /**
   * Get build statistics summary
   */
  getStats(): {
    totalProjects: number;
    totalBuilds: number;
    successCount: number;
    failedCount: number;
    inProgressCount: number;
  } {
    let totalBuilds = 0;
    let successCount = 0;
    let failedCount = 0;
    let inProgressCount = 0;

    for (const project of this.projects.values()) {
      for (const build of project.builds) {
        totalBuilds++;
        switch (build.status) {
          case 'success':
            successCount++;
            break;
          case 'failed':
            failedCount++;
            break;
          case 'in_progress':
          case 'pending':
            inProgressCount++;
            break;
        }
      }
    }

    return {
      totalProjects: this.projects.size,
      totalBuilds,
      successCount,
      failedCount,
      inProgressCount,
    };
  }

  /**
   * Trigger an immediate check of all projects
   */
  async checkAll(): Promise<void> {
    if (this.checking) return;

    this.checking = true;
    try {
      for (const projectPath of this.projects.keys()) {
        await this.checkProject(projectPath);
      }
    } finally {
      this.checking = false;
    }
  }

  /**
   * Check a specific project for new builds
   */
  async checkProject(projectPath: string): Promise<CIBuild[]> {
    const project = this.projects.get(projectPath);
    if (!project || !project.config.enabled) return [];

    project.lastCheck = Date.now();
    const newBuilds: CIBuild[] = [];

    try {
      switch (project.config.provider) {
        case 'github':
          newBuilds.push(...await this.checkGitHub(projectPath, project.config));
          break;
        case 'gitlab':
          newBuilds.push(...await this.checkGitLab(projectPath, project.config));
          break;
        case 'jenkins':
          newBuilds.push(...await this.checkJenkins(projectPath, project.config));
          break;
        case 'circleci':
          newBuilds.push(...await this.checkCircleCI(projectPath, project.config));
          break;
        case 'travisci':
          newBuilds.push(...await this.checkTravisCI(projectPath, project.config));
          break;
      }

      // Save after check
      await this.saveProjects();

      return newBuilds;
    } catch (error) {
      console.error(`[CIMonitor] Error checking ${projectPath}:`, error);
      return [];
    }
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.checking = false;
  }

  // ===========================================
  // Private Methods
  // ===========================================

  private startMonitoring(): void {
    // Check every 5 minutes by default
    const interval = 5 * 60 * 1000;

    this.intervalId = setInterval(() => {
      this.checkAll().catch(console.error);
    }, interval);
  }

  private async loadProjects(): Promise<void> {
    if (!existsSync(this.configFile)) {
      return;
    }

    try {
      const content = await readFile(this.configFile, 'utf-8');
      const data = JSON.parse(content) as Record<string, CIProject>;

      for (const [path, project] of Object.entries(data)) {
        this.projects.set(path, project);
      }
    } catch (error) {
      console.error('[CIMonitor] Failed to load projects:', error);
    }
  }

  private async saveProjects(): Promise<void> {
    const data: Record<string, CIProject> = {};
    for (const [path, project] of this.projects.entries()) {
      data[path] = project;
    }
    await writeFile(this.configFile, JSON.stringify(data, null, 2));
  }

  private shouldMonitorBranch(config: CIConfig, branch: string): boolean {
    if (!config.branches || config.branches.length === 0) return true;
    return config.branches.includes(branch);
  }

  // ===========================================
  // Provider-specific checks
  // ===========================================

  private async checkGitHub(projectPath: string, config: CIConfig): Promise<CIBuild[]> {
    const builds: CIBuild[] = [];

    try {
      // Check if gh CLI is available
      const { stdout: ghVersion } = await execAsync('gh --version 2>&1', { cwd: projectPath });
      if (!ghVersion.includes('gh version')) {
        return builds;
      }

      // Get repository info
      const { stdout: repoInfo } = await execAsync('git remote get-url origin', { cwd: projectPath });
      const repoMatch = repoInfo.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
      if (!repoMatch) return builds;

      const owner = repoMatch[1];
      const repo = repoMatch[2];

      // Get current branch
      const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
      const branch = branchOutput.trim();

      if (!this.shouldMonitorBranch(config, branch)) {
        return builds;
      }

      // Get recent workflow runs
      const { stdout: runsOutput } = await execAsync(
        `gh run list --repo ${owner}/${repo} --limit 10 --json databaseId,status,conclusion,headBranch,headSha,headCommitMessage,startedAt,createdAt,name,event,workflowName`,
        { cwd: projectPath, timeout: 30000 }
      );

      const runs = JSON.parse(runsOutput) as Array<{
        databaseId: number;
        status: string;
        conclusion: string | null;
        headBranch: string;
        headSha: string;
        headCommitMessage: string;
        startedAt: string;
        createdAt: string;
        name: string;
        event: string;
        workflowName: string;
      }>;

      // Get existing build IDs
      const existingIds = new Set(
        this.projects.get(projectPath)?.builds.map((b) => b.id) || []
      );

      for (const run of runs) {
        const buildId = `github-${run.databaseId}`;

        // Skip if already tracked
        if (existingIds.has(buildId)) continue;

        const status = this.mapGitHubStatus(run.status, run.conclusion);

        const build: CIBuild = {
          id: buildId,
          provider: 'github',
          projectPath,
          branch: run.headBranch,
          commitHash: run.headSha.substring(0, 8),
          commitMessage: run.headCommitMessage.split('\n')[0],
          author: '', // GitHub API doesn't provide this in run list without extra calls
          status,
          url: `https://github.com/${owner}/${repo}/actions/runs/${run.databaseId}`,
          startedAt: new Date(run.startedAt || run.createdAt).getTime(),
          workflowName: run.workflowName,
          trigger: this.mapGitHubEvent(run.event),
        };

        if (status === 'success' || status === 'failed') {
          build.completedAt = new Date(run.createdAt).getTime();
          build.duration = build.completedAt - build.startedAt;
        }

        builds.push(build);
        this.projects.get(projectPath)?.builds.unshift(build);
      }
    } catch (error) {
      // Silently fail for projects without GitHub Actions
      if ((error as { stderr?: string }).stderr?.includes('not a git command')) {
        // Not a git repo or not using GitHub
      }
    }

    return builds;
  }

  private async checkGitLab(projectPath: string, config: CIConfig): Promise<CIBuild[]> {
    const builds: CIBuild[] = [];

    try {
      // Check if git CLI is available and get GitLab remote
      const { stdout: remoteOutput } = await execAsync('git remote get-url origin', { cwd: projectPath });
      if (!remoteOutput.includes('gitlab')) {
        return builds;
      }

      const repoMatch = remoteOutput.match(/gitlab\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
      if (!repoMatch) return builds;

      // Get current branch
      const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
      const branch = branchOutput.trim();

      if (!this.shouldMonitorBranch(config, branch)) {
        return builds;
      }

      // Try to get pipeline info via git log (basic implementation)
      const { stdout: logOutput } = await execAsync('git log -10 --pretty="%H|%s|%an|%ci"', {
        cwd: projectPath,
      });

      const existingIds = new Set(
        this.projects.get(projectPath)?.builds.map((b) => b.id) || []
      );

      for (const line of logOutput.trim().split('\n')) {
        const [hash, message, author, date] = line.split('|');
        const buildId = `gitlab-${hash}`;

        if (existingIds.has(buildId)) continue;

        // For GitLab without API access, we create basic build entries
        // Real status would require GitLab API token
        const build: CIBuild = {
          id: buildId,
          provider: 'gitlab',
          projectPath,
          branch,
          commitHash: hash.substring(0, 8),
          commitMessage: message,
          author,
          status: 'unknown', // Would need API to get real status
          startedAt: new Date(date).getTime(),
        };

        builds.push(build);
        this.projects.get(projectPath)?.builds.unshift(build);
      }
    } catch {
      // Not a GitLab project or error
    }

    return builds;
  }

  private async checkJenkins(_projectPath: string, _config: CIConfig): Promise<CIBuild[]> {
    // TODO: Implement Jenkins monitoring
    // Requires Jenkins server URL and credentials
    return [];
  }

  private async checkCircleCI(_projectPath: string, _config: CIConfig): Promise<CIBuild[]> {
    // TODO: Implement CircleCI monitoring
    return [];
  }

  private async checkTravisCI(_projectPath: string, _config: CIConfig): Promise<CIBuild[]> {
    // TODO: Implement Travis CI monitoring
    return [];
  }

  // ===========================================
  // Helper Methods
  // ===========================================

  private mapGitHubStatus(status: string, conclusion: string | null): BuildStatus {
    if (status === 'completed') {
      if (conclusion === 'success') return 'success';
      if (conclusion === 'failure') return 'failed';
      // cancelled maps to unknown
      return 'unknown';
    }
    if (status === 'in_progress') return 'in_progress';
    if (status === 'queued') return 'pending';
    return 'unknown';
  }

  private mapGitHubEvent(event: string): CIBuild['trigger'] {
    if (event === 'push') return 'push';
    if (event === 'pull_request') return 'pull_request';
    if (event === 'schedule') return 'scheduled';
    return 'manual';
  }
}

// ============================================
// Global Singleton
// ============================================

let globalCIMonitor: CIMonitor | null = null;

export function getCIMonitor(): CIMonitor {
  if (!globalCIMonitor) {
    globalCIMonitor = new CIMonitor();
  }
  return globalCIMonitor;
}
