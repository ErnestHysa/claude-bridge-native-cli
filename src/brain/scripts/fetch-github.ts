/**
 * Fetch GitHub Activity
 *
 * Uses gh CLI to fetch recent repository activity.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface GitHubRepo {
  name: string;
  updatedAt: string;
  primaryLanguage: string | null;
  description: string | null;
}

export interface GitHubActivity {
  repos: GitHubRepo[];
  totalCount: number;
}

/**
 * Parse gh CLI JSON output
 */
function parseRepos(output: string): GitHubRepo[] {
  try {
    const data = JSON.parse(output);
    return data.map((repo: any) => ({
      name: repo.name,
      updatedAt: repo.updatedAt,
      primaryLanguage: repo.primaryLanguage?.name || null,
      description: repo.description || null,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch GitHub activity using gh CLI
 */
export async function fetchGitHubActivity(limit: number = 10): Promise<GitHubActivity | null> {
  try {
    // Check if gh is installed
    await execAsync('gh --version', { timeout: 5000 });

    // Fetch repos
    const { stdout } = await execAsync(
      `gh repo list --limit ${limit} --json name,updatedAt,primaryLanguage,description`,
      { timeout: 15000 }
    );

    const repos = parseRepos(stdout);

    return {
      repos,
      totalCount: repos.length,
    };
  } catch (error) {
    console.error('Failed to fetch GitHub activity:', error);
    return null;
  }
}

/**
 * Format GitHub activity for Telegram message
 */
export function formatGitHubMessage(activity: GitHubActivity): string {
  if (activity.repos.length === 0) {
    return '💻 GitHub Activity\n\nNo recent activity found.';
  }

  const now = new Date();
  const repos = activity.repos
    .map((repo) => {
      const updated = new Date(repo.updatedAt);
      const diffMs = now.getTime() - updated.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);

      let timeAgo: string;
      if (diffHours < 1) {
        timeAgo = 'Just now';
      } else if (diffHours < 24) {
        timeAgo = `${diffHours}h ago`;
      } else {
        timeAgo = `${diffDays}d ago`;
      }

      const lang = repo.primaryLanguage ? ` \`${repo.primaryLanguage}\`` : '';
      const desc = repo.description ? `\n   ${repo.description}` : '';

      return `• <b>${repo.name}</b>${lang} - ${timeAgo}${desc}`;
    })
    .join('\n\n');

  return `💻 GitHub Activity (last ${activity.totalCount} updates)\n\n${repos}`;
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const limit = parseInt(process.argv[2]) || 10;
  const activity = await fetchGitHubActivity(limit);

  if (!activity) {
    console.error('Failed to fetch GitHub activity');
    console.error('Make sure gh CLI is installed and authenticated: gh auth login');
    process.exit(1);
  }

  console.log(formatGitHubMessage(activity));
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
