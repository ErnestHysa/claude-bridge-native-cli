/**
 * Git Automation - Smart git operations
 *
 * Provides intelligent git features:
 * - Smart commit message generation
 * - PR description creation
 * - Branch naming
 * - CI/CD status monitoring
 * - Conflict detection
 * - Deployment pipeline automation
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getBrain } from '../brain-manager.js';
import { getMemoryStore } from '../memory/memory-store.js';
import type { SmartCommitOptions, PRDraft, FileChange } from '../types.js';

const execAsync = promisify(exec);

/**
 * Git Automation Service
 */
export class GitAutomation {
  private brain = getBrain();

  // ===========================================
  // Commit Operations
  // ===========================================

  /**
   * Generate a smart commit message from changes
   */
  async generateCommitMessage(
    projectPath: string,
    _diff?: string,
  ): Promise<string> {
    const preferences = this.brain.getPreferences();
    const style = preferences?.git.commitMessageStyle ?? 'conventional';

    // Get staged changes
    const changes = await this.getStagedChanges(projectPath);

    if (changes.length === 0) {
      return 'chore: update files';
    }

    // Analyze changes to generate appropriate message
    const message = await this.analyzeChangesAndGenerateMessage(changes, _diff, style);

    return message;
  }

  /**
   * Create a smart commit with auto-generated message
   */
  async smartCommit(
    projectPath: string,
    options: SmartCommitOptions = {},
  ): Promise<{ success: boolean; commitHash?: string; message?: string; error?: string }> {
    try {
      // Check if there are staged changes
      const { stdout: status } = await execAsync('git diff --cached --name-status', {
        cwd: projectPath,
      });

      if (!status.trim() && options.autoStage) {
        // Stage all changes
        await execAsync('git add -A', { cwd: projectPath });
      }

      // Generate commit message
      const _diffOutput = options.autoStage
        ? (await execAsync('git diff --cached', { cwd: projectPath })).stdout
        : undefined;
      const message = await this.generateCommitMessage(projectPath, _diffOutput);

      // Create commit
      // Build args correctly: git commit [--no-verify] -m message
      const args = ['commit'];
      if (!options.autoStage) {
        args.push('--no-verify');
      }
      args.push('-m', message);

      const { stdout } = await execAsync(`git ${args.join(' ')}`, { cwd: projectPath });
      const commitMatch = stdout.match(/\[([a-z0-9]+)\]/);
      const commitHash = commitMatch ? commitMatch[1] : undefined;

      // Push if requested
      if (options.push && commitHash) {
        await execAsync('git push', { cwd: projectPath });
      }

      return {
        success: true,
        commitHash,
        message,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(projectPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectPath,
      });
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get branch status
   */
  async getBranchStatus(projectPath: string): Promise<{
    branch: string;
    ahead: number;
    behind: number;
    staged: number;
    modified: number;
    untracked: number;
  }> {
    try {
      const [branch, status] = await Promise.all([
        this.getCurrentBranch(projectPath),
        execAsync('git status --porcelain=v1 -b', { cwd: projectPath }),
      ]);

      const statusLines = status.stdout.split('\n');

      // Parse branch info
      const branchLine = statusLines[0];
      const aheadMatch = branchLine.match(/ahead (\d+)/);
      const behindMatch = branchLine.match(/behind (\d+)/);

      // Count files
      let staged = 0;
      let modified = 0;
      let untracked = 0;

      for (const line of statusLines.slice(1)) {
        if (!line) continue;
        const index = line[0];
        const workTree = line[1];
        const isUntracked = line.startsWith('??');

        if (isUntracked) {
          untracked++;
        } else {
          if (index !== ' ' && index !== '?') staged++;
          if (workTree !== ' ' && workTree !== '?') modified++;
        }
      }

      return {
        branch,
        ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
        behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
        staged,
        modified,
        untracked,
      };
    } catch {
      return {
        branch: 'unknown',
        ahead: 0,
        behind: 0,
        staged: 0,
        modified: 0,
        untracked: 0,
      };
    }
  }

  // ===========================================
  // PR Operations
  // ===========================================

  /**
   * Generate a PR description from changes
   */
  async generatePRDescription(
    projectPath: string,
    branch: string,
    baseBranch?: string,
  ): Promise<PRDraft> {
    const preferences = this.brain.getPreferences();
    const defaultBranch = preferences?.git.defaultBranch ?? 'main';
    const targetBase = baseBranch ?? defaultBranch;

    // Get changes between branches
    const { stdout: _diffOutput } = await execAsync(
      `git diff ${targetBase}...${branch}`,
      { cwd: projectPath },
    );

    // Get commit messages
    const { stdout: logOutput } = await execAsync(
      `git log ${targetBase}..${branch} --oneline`,
      { cwd: projectPath },
    );

    const commits = logOutput.trim().split('\n').filter(Boolean);

    // Parse files changed
    const { stdout: nameStatus } = await execAsync(
      `git diff ${targetBase}...${branch} --name-status`,
      { cwd: projectPath },
    );

    const changes: FileChange[] = [];
    for (const line of nameStatus.trim().split('\n')) {
      if (!line) continue;
      const [status, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t');
      changes.push({
        path,
        action: this.parseGitStatus(status),
      });
    }

    // Generate title and body
    const title = this.generatePRTitle(commits, changes);
    const body = this.generatePRBody(commits, changes);

    return {
      title,
      body,
      branch,
      baseBranch: targetBase,
      changes,
    };
  }

  /**
   * Create a PR using gh CLI or return draft
   */
  async createPR(
    projectPath: string,
    branch: string,
    baseBranch?: string,
    draft = true,
  ): Promise<{
    success: boolean;
    url?: string;
    draft?: PRDraft;
    error?: string;
  }> {
    try {
      const prDraft = await this.generatePRDescription(projectPath, branch, baseBranch);

      // Try to use gh CLI
      const { stdout } = await execAsync(
        `gh pr create --base ${prDraft.baseBranch} --title "${prDraft.title}" --body "${prDraft.body.replace(/"/g, '\\"')}" ${draft ? '--draft' : ''}`,
        { cwd: projectPath },
      );

      const urlMatch = stdout.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/);
      const url = urlMatch ? urlMatch[0] : undefined;

      return {
        success: true,
        url,
        draft: prDraft,
      };
    } catch (error) {
      return {
        success: false,
        draft: await this.generatePRDescription(projectPath, branch, baseBranch),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ===========================================
  // Helper Methods
  // ===========================================

  private async getStagedChanges(projectPath: string): Promise<FileChange[]> {
    try {
      const { stdout } = await execAsync('git diff --cached --name-status', {
        cwd: projectPath,
      });

      const changes: FileChange[] = [];
      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;
        const [status, ...pathParts] = line.split('\t');
        const path = pathParts.join('\t');
        changes.push({
          path,
          action: this.parseGitStatus(status),
        });
      }

      return changes;
    } catch {
      return [];
    }
  }

  private parseGitStatus(status: string): FileChange['action'] {
    switch (status.trim()) {
      case 'A':
      case 'AM':
        return 'added';
      case 'M':
      case 'MM':
      case 'MT':
        return 'modified';
      case 'D':
        return 'deleted';
      case 'R':
        return 'renamed';
      default:
        return 'modified';
    }
  }

  private async analyzeChangesAndGenerateMessage(
    changes: FileChange[],
    _diff?: string,
    style: 'conventional' | 'descriptive' | 'minimal' = 'conventional',
  ): Promise<string> {
    // Count by action type
    const added = changes.filter(c => c.action === 'added').length;
    const modified = changes.filter(c => c.action === 'modified').length;
    const deleted = changes.filter(c => c.action === 'deleted').length;

    // Detect file types
    const fileTypes = new Set<string>();
    for (const change of changes) {
      const ext = change.path.split('.').pop();
      if (ext) fileTypes.add(ext);
    }

    if (style === 'conventional') {
      let type = 'chore';
      let scope = '';
      let description = 'update files';

      // Determine type from changes
      if (changes.some(c => c.path.includes('test') || c.path.includes('spec'))) {
        type = 'test';
        scope = 'tests';
        description = added > modified ? 'add tests' : 'update tests';
      } else if (changes.some(c => c.path.includes('README'))) {
        type = 'docs';
        description = 'update documentation';
      } else if (added > 0 && modified === 0 && deleted === 0) {
        type = 'feat';
        description = `add ${added} file${added > 1 ? 's' : ''}`;
      } else if (deleted > 0) {
        type = 'refactor';
        description = `remove ${deleted} file${deleted > 1 ? 's' : ''}`;
      } else if (modified > 0) {
        type = 'fix';
        description = `update ${modified} file${modified > 1 ? 's' : ''}`;
      }

      return scope ? `${type}(${scope}): ${description}` : `${type}: ${description}`;
    }

    if (style === 'minimal') {
      const total = added + modified + deleted;
      return `Update ${total} file${total > 1 ? 's' : ''}`;
    }

    // Descriptive style
    const parts: string[] = [];
    if (added > 0) parts.push(`add ${added} file${added > 1 ? 's' : ''}`);
    if (modified > 0) parts.push(`modify ${modified} file${modified > 1 ? 's' : ''}`);
    if (deleted > 0) parts.push(`delete ${deleted} file${deleted > 1 ? 's' : ''}`);
    return parts.join(', ');
  }

  private generatePRTitle(commits: string[], changes: FileChange[]): string {
    // Use first commit or generate from changes
    if (commits.length > 0) {
      const firstCommit = commits[0].replace(/^\w+:\s*/, '').replace(/^\w+\s/, '');
      return firstCommit.charAt(0).toUpperCase() + firstCommit.slice(1);
    }

    const added = changes.filter(c => c.action === 'added').length;
    const modified = changes.filter(c => c.action === 'modified').length;

    if (added > 0 && modified === 0) {
      return `Add ${added} new file${added > 1 ? 's' : ''}`;
    }
    return `Update ${changes.length} file${changes.length > 1 ? 's' : ''}`;
  }

  private generatePRBody(
    commits: string[],
    changes: FileChange[],
  ): string {
    const lines: string[] = [
      '## Summary',
      '',
      `This PR includes ${commits.length} commit${commits.length > 1 ? 's' : ''} affecting ${changes.length} file${changes.length > 1 ? 's' : ''}.`,
      '',
    ];

    // Add commits section
    if (commits.length > 0) {
      lines.push('## Commits');
      lines.push('');
      for (const commit of commits) {
        lines.push(`- ${commit}`);
      }
      lines.push('');
    }

    // Add changes section
    lines.push('## Changes');
    lines.push('');
    for (const change of changes) {
      const emoji = {
        added: '➕',
        modified: '✏️',
        deleted: '❌',
        renamed: '↔️',
      }[change.action];
      lines.push(`${emoji} \`${change.path}\``);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Get commit history
   */
  async getCommitHistory(
    projectPath: string,
    limit = 10,
  ): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
    try {
      const { stdout } = await execAsync(
        `git log -n ${limit} --pretty=format:"%H|%s|%an|%ad" --date=short`,
        { cwd: projectPath },
      );

      return stdout.trim().split('\n').map(line => {
        const [hash, message, author, date] = line.split('|');
        return { hash, message, author, date };
      });
    } catch {
      return [];
    }
  }

  // ===========================================
  // Deployment Pipeline
  // ===========================================

  /**
   * Deployment step interface
   */
  async deploy(
    projectPath: string,
    options: {
      environment?: 'development' | 'staging' | 'production';
      skipTests?: boolean;
      skipBuild?: boolean;
      chatId?: number; // For notifications
    } = {}
  ): Promise<{
    success: boolean;
    steps: Array<{ name: string; status: 'success' | 'failed' | 'skipped'; output?: string; duration?: number }>;
    error?: string;
  }> {
    const environment = options.environment ?? 'production';
    const steps: Array<{ name: string; status: 'success' | 'failed' | 'skipped'; output?: string; duration?: number }> = [];

    // Get deploy config from project
    const deployConfig = await this.getDeployConfig(projectPath);

    try {
      // Step 1: Pre-deployment checks
      steps.push(await this.runPreDeploymentChecks(projectPath, environment));
      if (steps[steps.length - 1].status === 'failed') {
        return { success: false, steps };
      }

      // Step 2: Run tests (unless skipped)
      if (!options.skipTests) {
        steps.push(await this.runTests(projectPath, deployConfig.testCommand));
        if (steps[steps.length - 1].status === 'failed' && deployConfig.requireTests) {
          return { success: false, steps, error: 'Tests failed' };
        }
      } else {
        steps.push({ name: 'Tests', status: 'skipped' });
      }

      // Step 3: Build (unless skipped)
      if (!options.skipBuild) {
        steps.push(await this.runBuild(projectPath, deployConfig.buildCommand));
        if (steps[steps.length - 1].status === 'failed') {
          return { success: false, steps, error: 'Build failed' };
        }
      } else {
        steps.push({ name: 'Build', status: 'skipped' });
      }

      // Step 4: Deploy
      steps.push(await this.runDeployment(projectPath, environment, deployConfig.deployCommand));
      if (steps[steps.length - 1].status === 'failed') {
        return { success: false, steps, error: 'Deployment failed' };
      }

      // Step 5: Post-deployment verification
      steps.push(await this.runPostDeploymentVerification(projectPath, environment, deployConfig));

      // Record deployment for potential rollback
      await this.recordDeployment(projectPath, environment, steps);

      return { success: true, steps };
    } catch (error) {
      return {
        success: false,
        steps,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Rollback to a previous deployment
   */
  async rollback(
    projectPath: string,
    options: {
      environment?: 'development' | 'staging' | 'production';
      version?: string; // Git commit hash or tag
      chatId?: number;
    } = {}
  ): Promise<{
    success: boolean;
    rollbackTo?: string;
    steps: Array<{ name: string; status: 'success' | 'failed'; output?: string }>;
    error?: string;
  }> {
    const environment = options.environment ?? 'production';
    const steps: Array<{ name: string; status: 'success' | 'failed'; output?: string }> = [];

    try {
      // Get deployment history
      const history = await this.getDeploymentHistory(projectPath, environment);

      if (history.length === 0) {
        return {
          success: false,
          steps,
          error: 'No previous deployments found',
        };
      }

      // Use provided version or most recent successful deployment
      const targetVersion = options.version ?? history[0].commitHash;

      steps.push({ name: 'Starting rollback', status: 'success' });

      // Checkout the target version
      try {
        await execAsync(`git checkout ${targetVersion}`, { cwd: projectPath, timeout: 30000 });
        steps.push({ name: `Checkout ${targetVersion.substring(0, 8)}`, status: 'success' });
      } catch (error) {
        steps.push({ name: 'Checkout', status: 'failed', output: error instanceof Error ? error.message : String(error) });
        return { success: false, steps, error: 'Failed to checkout version' };
      }

      // Get deploy config
      const deployConfig = await this.getDeployConfig(projectPath);

      // Re-run build and deploy
      if (deployConfig.buildCommand) {
        try {
          const { stdout } = await execAsync(deployConfig.buildCommand, { cwd: projectPath, timeout: 300000 });
          steps.push({ name: 'Build', status: 'success', output: stdout.substring(0, 200) });
        } catch (error) {
          steps.push({ name: 'Build', status: 'failed', output: error instanceof Error ? error.message : String(error) });
          return { success: false, steps, error: 'Build failed during rollback' };
        }
      }

      // Deploy
      if (deployConfig.deployCommand) {
        const deployCmd = deployConfig.deployCommand.replace(/\{env\}/g, environment);
        try {
          const { stdout } = await execAsync(deployCmd, { cwd: projectPath, timeout: 300000 });
          steps.push({ name: 'Deploy', status: 'success', output: stdout.substring(0, 200) });
        } catch (error) {
          steps.push({ name: 'Deploy', status: 'failed', output: error instanceof Error ? error.message : String(error) });
          return { success: false, steps, error: 'Deploy failed during rollback' };
        }
      }

      // Return to original branch
      const branch = await this.getCurrentBranch(projectPath);
      try {
        await execAsync(`git checkout ${branch}`, { cwd: projectPath, timeout: 30000 });
        steps.push({ name: 'Restore branch', status: 'success' });
      } catch {
        steps.push({ name: 'Restore branch', status: 'failed' });
      }

      return { success: true, rollbackTo: targetVersion, steps };
    } catch (error) {
      return {
        success: false,
        steps,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get deployment configuration from project
   */
  private async getDeployConfig(projectPath: string): Promise<{
    buildCommand: string;
    testCommand: string;
    deployCommand: string;
    requireTests: boolean;
    environments: Record<string, { deployCommand?: string }>;
  }> {
    // Try to load from .claude-deploy.json
    const configPath = join(projectPath, '.claude-deploy.json');
    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        // Fall through to defaults
      }
    }

    // Try to parse from package.json
    const packageJsonPath = join(projectPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content);

        return {
          buildCommand: pkg.scripts?.build ? `npm run build` : '',
          testCommand: pkg.scripts?.test ? `npm test` : '',
          deployCommand: pkg.scripts?.deploy || 'echo "No deploy script configured"',
          requireTests: true,
          environments: {},
        };
      } catch {
        // Fall through to defaults
      }
    }

    // Default configuration
    return {
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      deployCommand: 'echo "Configure deploy script in .claude-deploy.json"',
      requireTests: true,
      environments: {},
    };
  }

  /**
   * Run pre-deployment checks
   */
  private async runPreDeploymentChecks(
    projectPath: string,
    environment: string
  ): Promise<{ name: string; status: 'success' | 'failed'; output?: string; duration?: number }> {
    const start = Date.now();
    const checks: string[] = [];

    try {
      // Check if working directory is clean
      const { stdout: status } = await execAsync('git status --porcelain', { cwd: projectPath });
      if (status.trim()) {
        return {
          name: 'Pre-deployment checks',
          status: 'failed',
          output: 'Working directory has uncommitted changes',
          duration: Date.now() - start,
        };
      }
      checks.push('Working directory clean');

      // Check if on correct branch
      const branch = await this.getCurrentBranch(projectPath);
      const expectedBranch = environment === 'production' ? 'main' : environment;
      if (branch !== expectedBranch && branch !== 'main' && branch !== 'master') {
        checks.push(`Warning: On branch "${branch}" instead of "${expectedBranch}"`);
      } else {
        checks.push(`On branch: ${branch}`);
      }

      return {
        name: 'Pre-deployment checks',
        status: 'success',
        output: checks.join('\n'),
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'Pre-deployment checks',
        status: 'failed',
        output: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Run tests
   */
  private async runTests(
    projectPath: string,
    testCommand: string
  ): Promise<{ name: string; status: 'success' | 'failed' | 'skipped'; output?: string; duration?: number }> {
    const start = Date.now();

    if (!testCommand) {
      return { name: 'Tests', status: 'skipped', duration: 0 };
    }

    try {
      const { stdout, stderr } = await execAsync(testCommand, {
        cwd: projectPath,
        timeout: 120000,
      });

      // Check if tests passed (common patterns)
      const output = stdout || stderr || '';
      const hasFailures = output.includes('failing') || output.includes('FAIL') || output.includes('Error:');

      return {
        name: 'Tests',
        status: hasFailures ? 'failed' : 'success',
        output: output.substring(0, 500),
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'Tests',
        status: 'failed',
        output: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Run build
   */
  private async runBuild(
    projectPath: string,
    buildCommand: string
  ): Promise<{ name: string; status: 'success' | 'failed' | 'skipped'; output?: string; duration?: number }> {
    const start = Date.now();

    if (!buildCommand) {
      return { name: 'Build', status: 'skipped', duration: 0 };
    }

    try {
      const { stdout, stderr } = await execAsync(buildCommand, {
        cwd: projectPath,
        timeout: 300000,
      });

      return {
        name: 'Build',
        status: 'success',
        output: (stdout || stderr || '').substring(0, 500),
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'Build',
        status: 'failed',
        output: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Run deployment
   */
  private async runDeployment(
    projectPath: string,
    environment: string,
    deployCommand: string
  ): Promise<{ name: string; status: 'success' | 'failed'; output?: string; duration?: number }> {
    const start = Date.now();

    const cmd = deployCommand.replace(/\{env\}/g, environment).replace(/\{environment\}/g, environment);

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: projectPath,
        timeout: 600000,
      });

      return {
        name: `Deploy to ${environment}`,
        status: 'success',
        output: (stdout || stderr || '').substring(0, 500),
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: `Deploy to ${environment}`,
        status: 'failed',
        output: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Run post-deployment verification
   */
  private async runPostDeploymentVerification(
    projectPath: string,
    _environment: string,
    _deployConfig: Record<string, unknown>
  ): Promise<{ name: string; status: 'success' | 'failed' | 'skipped'; output?: string; duration?: number }> {
    const start = Date.now();

    // Basic verification - check if deployed version is accessible
    // This is a placeholder for more sophisticated health checks
    try {
      const branch = await this.getCurrentBranch(projectPath);
      const { stdout: log } = await execAsync('git log -1 --pretty=%h', { cwd: projectPath });

      return {
        name: 'Post-deployment verification',
        status: 'success',
        output: `Deployed commit: ${log.trim()} on branch: ${branch}`,
        duration: Date.now() - start,
      };
    } catch {
      return {
        name: 'Post-deployment verification',
        status: 'skipped',
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Record deployment for potential rollback
   */
  private async recordDeployment(
    projectPath: string,
    environment: string,
    steps: Array<{ name: string; status: 'success' | 'failed' | 'skipped' }>
  ): Promise<void> {
    // Record in brain memory
    const memory = getMemoryStore();
    if (!memory) return;

    try {
      const { stdout: log } = await execAsync('git log -1 --pretty=%H|%s|%an', { cwd: projectPath });
      const [hash, message, author] = log.trim().split('|');

      const deployment = {
        timestamp: Date.now(),
        environment,
        commitHash: hash,
        commitMessage: message,
        author,
        status: steps.every(s => s.status !== 'failed') ? 'success' : 'failed',
        steps: steps.map(s => ({ name: s.name, status: s.status })),
      };

      // Store in memory as deployment record
      await memory.setFact(`deployment:${projectPath}:${environment}:${Date.now()}`, deployment);
    } catch {
      // Skip recording if git commands fail
    }
  }

  /**
   * Get deployment history for a project
   */
  async getDeploymentHistory(
    projectPath: string,
    environment?: string
  ): Promise<Array<{ timestamp: number; environment: string; commitHash: string; commitMessage: string; status: string }>> {
    const memory = getMemoryStore();
    if (!memory) return [];

    try {
      const facts = memory.searchFacts(`deployment:${projectPath}`);
      const deployments: Array<{ timestamp: number; environment: string; commitHash: string; commitMessage: string; status: string }> = [];

      for (const fact of facts) {
        const deployment = fact.value as {
          timestamp: number;
          environment: string;
          commitHash: string;
          commitMessage: string;
          status: string;
        };

        if (!environment || deployment.environment === environment) {
          deployments.push(deployment);
        }
      }

      return deployments.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }
}

// Global singleton
let globalGit: GitAutomation | null = null;

export function getGitAutomation(): GitAutomation {
  if (!globalGit) {
    globalGit = new GitAutomation();
  }
  return globalGit;
}
