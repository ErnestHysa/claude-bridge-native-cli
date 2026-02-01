/**
 * Project Manager - Scans and manages available projects
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { Project, ProjectDetectionResult } from "./types.js";

/**
 * Check if a directory is a Git repository
 */
function isGitRepo(dirPath: string): boolean {
  return existsSync(join(dirPath, ".git"));
}

/**
 * Get the current Git branch of a repository
 */
function getGitBranch(dirPath: string): string | undefined {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dirPath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get current Git status for a repository
 */
function getGitStatus(dirPath: string): 'active' | 'idle' | 'error' {
  try {
    const status = execSync("git status --porcelain", {
      cwd: dirPath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    return status.length > 0 ? "active" : "idle";
  } catch {
    return "error";
  }
}

/**
 * Scan a directory for projects
 */
export function scanProjects(basePath: string): Project[] {
  const projects: Project[] = [];

  if (!existsSync(basePath)) {
    return projects;
  }

  const entries = readdirSync(basePath, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files
    if (entry.name.startsWith(".")) continue;

    const fullPath = join(basePath, entry.name);

    // Only process directories
    if (entry.isDirectory()) {
      const project = detectProject(fullPath);
      if (project) {
        projects.push(project);
      }

      // Don't recurse deeply - only one level
      // You can enable recursion if needed
    }
  }

  // Sort by name
  projects.sort((a, b) => a.name.localeCompare(b.name));

  return projects;
}

/**
 * Detect if a directory is a project
 */
function detectProject(dirPath: string): Project | null {
  try {
    const stats = statSync(dirPath);
    if (!stats.isDirectory()) return null;

    const name = dirPath.split("\\").pop() || dirPath.split("/").pop() || dirPath;

    // Check if it's a Git repo
    const isGit = isGitRepo(dirPath);

    // If not a Git repo, check for common project indicators
    if (!isGit) {
      // Could still be a project if it has package.json, src/, etc.
      const hasPackageJson = existsSync(join(dirPath, "package.json"));
      const hasSrcDir = existsSync(join(dirPath, "src"));
      if (!hasPackageJson && !hasSrcDir) {
        return null;
      }
    }

    // Get last modified time
    const lastModified = stats.mtimeMs;

    // Get branch and status for Git repos
    const branch = isGit ? getGitBranch(dirPath) : undefined;
    const status = isGit ? getGitStatus(dirPath) : undefined;

    return {
      name,
      path: dirPath,
      isGit,
      lastModified,
      sessionCount: 0, // Will be managed by SessionManager
      branch,
      status,
    };
  } catch {
    return null;
  }
}

/**
 * Add a project by path
 */
export function addProjectByPath(basePath: string, projectPath: string): Project | null {
  const fullPath = resolve(basePath, projectPath);
  const normalizedPath = normalize(fullPath);

  // Check if path exists
  if (!existsSync(normalizedPath)) {
    return null;
  }

  return detectProject(normalizedPath);
}

/**
 * Validate a project path exists and is accessible
 */
export function validateProjectPath(projectPath: string): { valid: boolean; error?: string } {
  try {
    const normalized = normalize(projectPath);
    if (!existsSync(normalized)) {
      return { valid: false, error: "Path does not exist" };
    }
    const stats = statSync(normalized);
    if (!stats.isDirectory()) {
      return { valid: false, error: "Path is not a directory" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid path" };
  }
}

/**
 * Get a formatted project description for Telegram display
 */
export function formatProjectForTelegram(project: Project): string {
  const gitStatus = project.isGit
    ? `${project.status === "active" ? "🔴" : "🟢"} ${project.branch || "main"}`
    : "📦";

  const modified = project.lastModified
    ? `• Modified ${formatRelativeTime(project.lastModified)}`
    : "";

  return `<b>${project.name}</b>\n${gitStatus} ${modified}`;
}

/**
 * Format relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Find project by name
 */
export function findProjectByName(projects: Project[], name: string): Project | null {
  const normalizedName = name.toLowerCase();
  return projects.find((p) => p.name.toLowerCase() === normalizedName) || null;
}

/**
 * Auto-scan projects base directory
 */
export function autoScanProjects(config: { projectsBase: string }): ProjectDetectionResult {
  const projects = scanProjects(config.projectsBase);

  return {
    projects,
    scannedAt: Date.now(),
    scanPath: config.projectsBase,
  };
}
