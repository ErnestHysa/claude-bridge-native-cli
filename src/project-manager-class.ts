/**
 * Project Manager Class - Wrapper for project functions
 */

import { existsSync } from "node:fs";
import type { Project, ProjectDetectionResult } from "./types.js";
import {
  addProjectByPath,
  findProjectByName,
  autoScanProjects,
} from "./project-manager.js";

/**
 * Project Manager class
 */
export class ProjectManager {
  private projects: Project[] = [];
  private basePath: string;
  private autoScanInterval: NodeJS.Timeout | null = null;
  private autoScanIntervalMs: number;

  constructor(basePath: string, autoScanIntervalMs = 300_000) {
    this.basePath = basePath;
    this.autoScanIntervalMs = autoScanIntervalMs;
    this.initialScan();
  }

  /**
   * Initial scan on construction
   */
  private initialScan(): void {
    if (existsSync(this.basePath)) {
      const result = autoScanProjects({ projectsBase: this.basePath });
      this.projects = result.projects;
    }
  }

  /**
   * Start auto-scanning
   */
  public startAutoScan(): void {
    if (this.autoScanInterval) {
      clearInterval(this.autoScanInterval);
    }

    this.autoScanInterval = setInterval(() => {
      this.rescan();
    }, this.autoScanIntervalMs);
  }

  /**
   * Stop auto-scanning
   */
  public stopAutoScan(): void {
    if (this.autoScanInterval) {
      clearInterval(this.autoScanInterval);
      this.autoScanInterval = null;
    }
  }

  /**
   * Get all projects
   */
  public getProjects(): Project[] {
    return [...this.projects];
  }

  /**
   * Get a project by name
   */
  public getProject(name: string): Project | null {
    return findProjectByName(this.projects, name);
  }

  /**
   * Add a project by path
   */
  public addProject(path: string): Project | null {
    const project = addProjectByPath(this.basePath, path);
    if (project && !this.findProjectInArray(project.name)) {
      this.projects.push(project);
      this.projects.sort((a, b) => a.name.localeCompare(b.name));
    }
    return project;
  }

  /**
   * Remove a project by name
   */
  public removeProject(name: string): boolean {
    const index = this.projects.findIndex((p) => p.name === name);
    if (index !== -1) {
      this.projects.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Rescan for projects
   */
  public rescan(): ProjectDetectionResult {
    const result = autoScanProjects({ projectsBase: this.basePath });
    this.projects = result.projects;
    return result;
  }

  /**
   * Find project in array
   */
  private findProjectInArray(name: string): Project | undefined {
    return this.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * Update session count for a project (called by SessionManager)
   */
  public updateSessionCount(projectName: string, count: number): void {
    const project = this.findProjectInArray(projectName);
    if (project) {
      project.sessionCount = count;
    }
  }
}
