/**
 * Git Automation - Smart git operations
 *
 * Provides intelligent git features:
 * - Smart commit message generation
 * - PR description creation
 * - Branch naming
 * - CI/CD status monitoring
 * - Conflict detection
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getBrain } from '../brain-manager.js';
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
}

// Global singleton
let globalGit: GitAutomation | null = null;

export function getGitAutomation(): GitAutomation {
  if (!globalGit) {
    globalGit = new GitAutomation();
  }
  return globalGit;
}
