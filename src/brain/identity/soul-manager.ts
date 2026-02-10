/**
 * Soul.md Identity System
 *
 * Manages soul.md files that define agent and user identities.
 * Soul.md files are self-evolving and can be updated through learning.
 */

import { Logger } from '../../utils.js';
import type {
  SoulMetadata,
  SoulContent,
  SoulIdentity,
  SoulPersonality,
  SoulConstraints,
  SoulLearning,
} from '../nl/types.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const logger = new Logger('info');

/**
 * Default soul.md directories
 */
const GLOBAL_SOUL_DIR = 'src/brain/identity';
const AGENTS_SOUL_DIR = 'src/brain/identity/agents';
const USER_SOUL_DIR = 'src/brain/identity/users';

/**
 * Default agent soul.md content
 */
const DEFAULT_AGENT_SOUL = `---
identity: claude-bridge
version: 1.0.0
last-updated: 2026-02-10
type: agent
---

# Agent Identity

## Name
Claude Bridge Assistant

## Purpose
AI assistant that bridges Telegram chat to Claude Code CLI, enabling natural language interaction with development tools.

## Personality
Professional but friendly. Focuses on clarity, efficiency, and helpfulness. Uses technical terminology appropriately but explains complex concepts when needed.

## Capabilities
- Natural language understanding for development tasks
- Code analysis and refactoring
- Git operations and version control
- Test execution and debugging
- File operations (read, edit, create)
- Dependency management
- Documentation generation
- Autonomous task execution

## Constraints
- Requires approval for destructive operations (delete, git reset, etc.)
- Ask for clarification on ambiguous requests
- Respect user's permission level settings
- Operate within configured project paths

## Learning
Remembers:
- User's preferred tools and workflows
- Common file patterns and project structures
- Previous decisions and their outcomes
- User's coding conventions and preferences
- Frequently used commands and aliases

Evolves: true
`;

/**
 * Soul Manager class
 */
export class SoulManager {
  private souls: Map<string, SoulContent>;
  private globalSoul: SoulContent | null;
  private storageEnabled: boolean;

  constructor(storageEnabled: boolean = true) {
    this.souls = new Map();
    this.globalSoul = null;
    this.storageEnabled = storageEnabled;

    if (this.storageEnabled) {
      this.ensureDirectories();
      this.loadAllSouls();
    }
  }

  /**
   * Get soul by name or ID
   */
  getSoul(name: string): SoulContent | null {
    return this.souls.get(name) || null;
  }

  /**
   * Get global soul
   */
  getGlobalSoul(): SoulContent | null {
    return this.globalSoul;
  }

  /**
   * Set global soul
   */
  setGlobalSoul(soul: SoulContent): void {
    this.globalSoul = soul;
    this.saveSoul('soul', soul);
  }

  /**
   * Parse soul.md content
   */
  parseSoul(markdown: string): SoulContent | null {
    try {
      // Extract frontmatter
      const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
      let metadata: SoulMetadata = {};

      if (frontmatterMatch) {
        metadata = this.parseFrontmatter(frontmatterMatch[1]);
      }

      // Parse content sections
      const content = markdown.replace(/^---\n[\s\S]*?\n---\n*/, '');
      const sections = this.parseSections(content);

      return {
        metadata,
        identity: sections.identity || this.createDefaultIdentity(),
        personality: sections.personality,
        capabilities: sections.capabilities,
        constraints: sections.constraints,
        learning: sections.learning,
      };
    } catch (error) {
      logger.error(`Failed to parse soul.md: ${error}`);
      return null;
    }
  }

  /**
   * Parse YAML frontmatter
   */
  private parseFrontmatter(yaml: string): SoulMetadata {
    const metadata: SoulMetadata = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+(?:-\w+)*):\s*(.+)$/);
      if (match) {
        const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const value = match[2].trim();

        (metadata as any)[key] = value;
      }
    }

    return metadata;
  }

  /**
   * Parse content sections
   */
  private parseSections(content: string): {
    identity?: SoulIdentity;
    personality?: SoulPersonality;
    capabilities?: string[];
    constraints?: SoulConstraints;
    learning?: SoulLearning;
  } {
    const sections: any = {};

    // Split by ## headers
    const parts = content.split(/\n##\s+/);

    for (const part of parts) {
      if (!part.trim()) continue;

      const lines = part.split('\n');
      const header = lines[0].toLowerCase().replace(/\s+/g, '_');
      const body = lines.slice(1).join('\n').trim();

      switch (header) {
        case 'name':
        case 'agent_identity':
          sections.identity = sections.identity || {};
          if (header === 'name') {
            sections.identity.name = body;
          }
          break;

        case 'purpose':
          sections.identity = sections.identity || {};
          sections.identity.purpose = body;
          break;

        case 'personality':
          sections.personality = this.parsePersonalitySection(body);
          break;

        case 'capabilities':
          sections.capabilities = this.parseListSection(body);
          break;

        case 'constraints':
          sections.constraints = this.parseConstraintsSection(body);
          break;

        case 'learning':
          sections.learning = this.parseLearningSection(body);
          break;
      }
    }

    return sections;
  }

  /**
   * Parse personality section
   */
  private parsePersonalitySection(content: string): SoulPersonality {
    const personality: SoulPersonality = {
      style: 'professional',
    };

    const lines = content.split('\n');
    for (const line of lines) {
      const lower = line.toLowerCase().trim();
      if (lower.includes('friendly')) personality.style = 'friendly';
      else if (lower.includes('technical')) personality.style = 'technical';
      else if (lower.includes('custom')) personality.style = 'custom';
    }

    return personality;
  }

  /**
   * Parse list section (markdown list items)
   */
  private parseListSection(content: string): string[] {
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.replace(/^-\s*/, ''));
  }

  /**
   * Parse constraints section
   */
  private parseConstraintsSection(content: string): SoulConstraints | undefined {
    const constraints: SoulConstraints = {};

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-')) {
        const content = trimmed.replace(/^-\s*/, '');
        if (content.toLowerCase().includes('api budget') || content.toLowerCase().includes('cost')) {
          const match = content.match(/\$?(\d+(?:\.\d+)?)/);
          if (match) {
            constraints.apiBudget = constraints.apiBudget || {};
            constraints.apiBudget.daily = parseFloat(match[1]);
          }
        } else if (content.toLowerCase().includes('max') && content.toLowerCase().includes('task')) {
          const match = content.match(/(\d+)/);
          if (match) {
            constraints.maxConcurrentTasks = parseInt(match[1], 10);
          }
        }
      }
    }

    return Object.keys(constraints).length > 0 ? constraints : undefined;
  }

  /**
   * Parse learning section
   */
  private parseLearningSection(content: string): SoulLearning | undefined {
    const learning: SoulLearning = {
      remembers: [],
      evolves: false,
    };

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-')) {
        const item = trimmed.replace(/^-\s*/, '');
        learning.remembers?.push(item);
      } else if (trimmed.toLowerCase().includes('evolves')) {
        learning.evolves = true;
      }
    }

    return learning.remembers && learning.remembers.length > 0 ? learning : undefined;
  }

  /**
   * Create default identity
   */
  private createDefaultIdentity(): SoulIdentity {
    return {
      name: 'Claude Bridge Assistant',
      purpose: 'AI development assistant',
      emoji: '🤖',
    };
  }

  /**
   * Generate soul.md from content
   */
  generateSoulMd(content: SoulContent): string {
    let md = '---\n';

    // Frontmatter
    if (content.metadata.identity) {
      md += `identity: ${content.metadata.identity}\n`;
    }
    if (content.metadata.version) {
      md += `version: ${content.metadata.version}\n`;
    }
    if (content.metadata['last-updated']) {
      md += `last-updated: ${content.metadata['last-updated']}\n`;
    }
    if (content.metadata.type) {
      md += `type: ${content.metadata.type}\n`;
    }

    md += '---\n\n';

    // Identity
    md += '# Agent Identity\n\n';
    if (content.identity.name) {
      md += `## Name\n${content.identity.name}\n\n`;
    }
    if (content.identity.purpose) {
      md += `## Purpose\n${content.identity.purpose}\n\n`;
    }
    if (content.identity.role) {
      md += `## Role\n${content.identity.role}\n\n`;
    }
    if (content.identity.emoji) {
      md += `## Emoji\n${content.identity.emoji}\n\n`;
    }

    // Personality
    if (content.personality) {
      md += '## Personality\n';
      if (content.personality.style) {
        md += `${content.personality.style}\n`;
      }
      if (content.personality.communication) {
        if (content.personality.communication.tone) {
          md += `Tone: ${content.personality.communication.tone}\n`;
        }
        if (content.personality.communication.verbosity !== undefined) {
          md += `Verbosity: ${content.personality.communication.verbosity}\n`;
        }
      }
      md += '\n';
    }

    // Capabilities
    if (content.capabilities && content.capabilities.length > 0) {
      md += '## Capabilities\n';
      for (const capability of content.capabilities) {
        md += `- ${capability}\n`;
      }
      md += '\n';
    }

    // Constraints
    if (content.constraints) {
      md += '## Constraints\n';
      if (content.constraints.timeWindows && content.constraints.timeWindows.length > 0) {
        md += 'Operating hours:\n';
        for (const window of content.constraints.timeWindows) {
          md += `- ${window.start} - ${window.end}\n`;
        }
      }
      if (content.constraints.apiBudget) {
        md += `API Budget: `;
        if (content.constraints.apiBudget.daily) {
          md += `$${content.constraints.apiBudget.daily}/day `;
        }
        if (content.constraints.apiBudget.monthly) {
          md += `$${content.constraints.apiBudget.monthly}/month `;
        }
        md += '\n';
      }
      if (content.constraints.maxConcurrentTasks) {
        md += `Max concurrent tasks: ${content.constraints.maxConcurrentTasks}\n`;
      }
      if (content.constraints.requireApprovalFor && content.constraints.requireApprovalFor.length > 0) {
        md += 'Requires approval for:\n';
        for (const item of content.constraints.requireApprovalFor) {
          md += `- ${item}\n`;
        }
      }
      md += '\n';
    }

    // Learning
    if (content.learning) {
      md += '## Learning\n';
      if (content.learning.remembers && content.learning.remembers.length > 0) {
        md += 'Remembers:\n';
        for (const item of content.learning.remembers) {
          md += `- ${item}\n`;
        }
      }
      if (content.learning.evolves !== undefined) {
        md += `Evolves: ${content.learning.evolves}\n`;
      }
      md += '\n';
    }

    return md;
  }

  /**
   * Load soul from file
   */
  loadSoul(filePath: string): SoulContent | null {
    try {
      if (!existsSync(filePath)) return null;

      const content = readFileSync(filePath, 'utf-8');
      return this.parseSoul(content);
    } catch (error) {
      logger.error(`Failed to load soul from ${filePath}: ${error}`);
      return null;
    }
  }

  /**
   * Save soul to file
   */
  saveSoul(name: string, soul: SoulContent): void {
    if (!this.storageEnabled) return;

    try {
      const filePath = this.getSoulFilePath(name);
      const markdown = this.generateSoulMd(soul);

      // Ensure directory exists
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(filePath, markdown, 'utf-8');

      // Update cache
      this.souls.set(name, soul);

      logger.debug(`Saved soul: ${name}`);
    } catch (error) {
      logger.error(`Failed to save soul ${name}: ${error}`);
    }
  }

  /**
   * Update soul with new information
   */
  updateSoul(name: string, updates: Partial<SoulContent>): void {
    const existing = this.getSoul(name) || this.createDefaultSoul();

    const updated: SoulContent = {
      metadata: { ...existing.metadata, ...updates.metadata },
      identity: { ...existing.identity, ...updates.identity },
      personality: { ...existing.personality, ...updates.personality },
      capabilities: updates.capabilities || existing.capabilities,
      constraints: { ...existing.constraints, ...updates.constraints },
      learning: { ...existing.learning, ...updates.learning },
    };

    // Update timestamp
    updated.metadata['last-updated'] = new Date().toISOString().split('T')[0];

    this.saveSoul(name, updated);
  }

  /**
   * Learn and evolve soul based on interactions
   */
  evolveSoul(name: string, learnings: {
    newPattern?: string;
    newPreference?: string;
    newCapability?: string;
    successfulInteraction?: string;
  }): void {
    const soul = this.getSoul(name);
    if (!soul || !soul.learning?.evolves) {
      return;
    }

    const updates: Partial<SoulContent> = {
      learning: { ...soul.learning },
    };

    // Add new patterns to remember
    if (learnings.newPattern && soul.learning.remembers) {
      updates.learning!.remembers = [
        ...soul.learning.remembers,
        learnings.newPattern,
      ];
    }

    // Add new preferences
    if (learnings.newPreference && soul.learning.remembers) {
      updates.learning!.remembers = [
        ...soul.learning.remembers,
        `Prefers: ${learnings.newPreference}`,
      ];
    }

    // Add new capabilities
    if (learnings.newCapability) {
      updates.capabilities = [
        ...(soul.capabilities || []),
        learnings.newCapability,
      ];
    }

    this.updateSoul(name, updates);
  }

  /**
   * Get soul file path
   */
  private getSoulFilePath(name: string): string {
    if (name === 'soul' || name === 'global') {
      return join(GLOBAL_SOUL_DIR, 'soul.md');
    }
    return join(AGENTS_SOUL_DIR, `${name}.md`);
  }

  /**
   * Create default soul
   */
  private createDefaultSoul(): SoulContent {
    return this.parseSoul(DEFAULT_AGENT_SOUL) || {
      metadata: {
        identity: 'claude-bridge',
        version: '1.0.0',
        type: 'agent',
      },
      identity: this.createDefaultIdentity(),
    };
  }

  /**
   * Ensure directories exist
   */
  private ensureDirectories(): void {
    const dirs = [GLOBAL_SOUL_DIR, AGENTS_SOUL_DIR, USER_SOUL_DIR];

    for (const dir of dirs) {
      try {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
          logger.debug(`Created soul directory: ${dir}`);
        }
      } catch (error) {
        logger.error(`Failed to create directory ${dir}: ${error}`);
      }
    }
  }

  /**
   * Load all souls on startup
   */
  private loadAllSouls(): void {
    // Load global soul
    const globalSoulPath = join(GLOBAL_SOUL_DIR, 'soul.md');
    if (existsSync(globalSoulPath)) {
      this.globalSoul = this.loadSoul(globalSoulPath);
      if (this.globalSoul) {
        this.souls.set('soul', this.globalSoul);
      }
    } else {
      // Create default soul
      this.globalSoul = this.parseSoul(DEFAULT_AGENT_SOUL)!;
      this.saveSoul('soul', this.globalSoul);
    }

    // Load agent souls
    // (Would scan agents directory for .md files)
  }

  /**
   * Get all soul names
   */
  getSoulNames(): string[] {
    return Array.from(this.souls.keys());
  }

  /**
   * Validate soul content
   */
  validateSoul(soul: SoulContent): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!soul.identity?.name) {
      errors.push('Missing required field: identity.name');
    }

    // Check constraints validity
    if (soul.constraints?.apiBudget) {
      const budget = soul.constraints.apiBudget;
      if (budget.daily && budget.daily < 0) {
        errors.push('API budget daily must be non-negative');
      }
      if (budget.monthly && budget.monthly < 0) {
        errors.push('API budget monthly must be non-negative');
      }
    }

    // Check time windows
    if (soul.constraints?.timeWindows) {
      for (const window of soul.constraints.timeWindows) {
        const startMatch = window.start.match(/^(\d{1,2}):(\d{2})$/);
        const endMatch = window.end.match(/^(\d{1,2}):(\d{2})$/);

        if (!startMatch || !endMatch) {
          errors.push(`Invalid time window format: ${window.start} - ${window.end}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Default singleton instance
 */
let defaultSoulManager: SoulManager | null = null;

export function getSoulManager(storageEnabled?: boolean): SoulManager {
  if (!defaultSoulManager) {
    defaultSoulManager = new SoulManager(storageEnabled);
  }
  return defaultSoulManager;
}

export function resetSoulManager(): void {
  defaultSoulManager = null;
}
