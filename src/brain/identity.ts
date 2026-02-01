/**
 * Identity Manager - Manage agent identity and user preferences
 *
 * Handles loading/saving identity from JSON files in brain/identity/
 */

import { readFile, writeFile, rename, mkdirSync, existsSync, appendFile } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentIdentity, AgentPersonality, UserPreferences } from './types.js';

// Promisified versions for better async handling
const writeFileAsync = (path: string, data: string): Promise<void> =>
  new Promise((resolve, reject) => {
    writeFile(path, data, 'utf-8', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

const readFileAsync = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    readFile(path, 'utf-8', (err, data) => {
      if (err) reject(err);
      else resolve(data as string);
    });
  });

const renameAsync = (oldPath: string, newPath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    rename(oldPath, newPath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);
const BRAIN_DIR = join(PROJECT_ROOT, 'brain');
const IDENTITY_DIR = join(BRAIN_DIR, 'identity');

// File paths
const PROFILE_PATH = join(IDENTITY_DIR, 'profile.json');
const PERSONALITY_PATH = join(IDENTITY_DIR, 'personality.json');
const PREFERENCES_PATH = join(IDENTITY_DIR, 'preferences.json');
const SETUP_COMPLETE_PATH = join(IDENTITY_DIR, '.setup-complete');

// Default values
const DEFAULT_IDENTITY: AgentIdentity = {
  name: 'ClaudeBridge',
  emoji: '🔷',
  version: '1.0.0',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const DEFAULT_PERSONALITY: AgentPersonality = {
  communication: {
    style: 'concise',
    tone: 'professional',
    useEmojis: false,
    codeBlocks: true,
  },
  coding: {
    languages: ['TypeScript', 'JavaScript', 'Python', 'Rust'],
    preferredLibraries: {
      typescript: ['zod', 'typescript-eslint'],
      web: ['hono', 'react'],
      testing: ['vitest', 'playwright'],
    },
    conventions: {
      quoteStyle: 'double',
      semicolons: true,
      trailingCommas: true,
      spacing: 2,
    },
  },
  behavior: {
    autoConfirm: {
      reads: true,
      singleFileEdits: true,
      tests: true,
    },
    requireApproval: {
      deletes: true,
      massChanges: true,
      deployments: true,
    },
    proactive: {
      suggestImprovements: true,
      reportErrors: true,
      offerAlternatives: true,
    },
  },
};

const DEFAULT_PREFERENCES: UserPreferences = {
  user: {
    name: 'Developer',
    timezone: 'UTC',
    workingHours: {
      start: 9,
      end: 18,
      timezone: 'UTC',
    },
  },
  notifications: {
    enabled: true,
    quietHours: {
      start: 22,
      end: 8,
    },
    priorityLevels: {
      error: 'immediate',
      warning: 'digest',
      info: 'digest',
      success: 'digest',
    },
  },
  git: {
    defaultBranch: 'main',
    autoPush: false,
    signCommits: false,
    commitMessageStyle: 'conventional',
  },
  projects: {
    defaultBase: 'C:\\Users\\ErnestHome\\DEVPROJECTS',
    autoDetect: true,
    watchForChanges: true,
  },
};

/**
 * Identity Manager - handles identity and preferences
 */
export class IdentityManager {
  private identity: AgentIdentity;
  private personality: AgentPersonality;
  private preferences: UserPreferences;
  private loaded = false;

  constructor() {
    this.identity = { ...DEFAULT_IDENTITY };
    this.personality = JSON.parse(JSON.stringify(DEFAULT_PERSONALITY));
    this.preferences = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
  }

  /**
   * Check if setup has been completed
   */
  isSetupComplete(): boolean {
    return existsSync(SETUP_COMPLETE_PATH);
  }

  /**
   * Mark setup as complete
   */
  async markSetupComplete(): Promise<void> {
    ensureDirectories();
    await new Promise<void>((resolve, reject) => {
      appendFile(SETUP_COMPLETE_PATH, `${Date.now()}\n`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Load identity from files
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    ensureDirectories();

    // Load profile
    if (existsSync(PROFILE_PATH)) {
      try {
        const content = await readFileAsync(PROFILE_PATH);
        this.identity = JSON.parse(content);
      } catch {
        // Use default if file corrupted
      }
    }

    // Load personality
    if (existsSync(PERSONALITY_PATH)) {
      try {
        const content = await readFileAsync(PERSONALITY_PATH);
        this.personality = { ...DEFAULT_PERSONALITY, ...JSON.parse(content) };
      } catch {
        // Use default if file corrupted
      }
    }

    // Load preferences
    if (existsSync(PREFERENCES_PATH)) {
      try {
        const content = await readFileAsync(PREFERENCES_PATH);
        this.preferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(content) };
      } catch {
        // Use default if file corrupted
      }
    }

    this.loaded = true;
  }

  /**
   * Save identity to files atomically
   * Uses temporary files to prevent partial failure corruption
   */
  async save(): Promise<void> {
    ensureDirectories();

    // Create temporary file paths
    const profileTmp = PROFILE_PATH + '.tmp';
    const personalityTmp = PERSONALITY_PATH + '.tmp';
    const preferencesTmp = PREFERENCES_PATH + '.tmp';

    // Write to temporary files first
    await writeFileAsync(profileTmp, JSON.stringify(this.identity, null, 2));
    await writeFileAsync(personalityTmp, JSON.stringify(this.personality, null, 2));
    await writeFileAsync(preferencesTmp, JSON.stringify(this.preferences, null, 2));

    // Atomic rename - only executes if all temp files were written successfully
    // On POSIX systems, rename is atomic
    await Promise.all([
      renameAsync(profileTmp, PROFILE_PATH),
      renameAsync(personalityTmp, PERSONALITY_PATH),
      renameAsync(preferencesTmp, PREFERENCES_PATH),
    ]);
  }

  /**
   * Update identity
   */
  async updateIdentity(updates: Partial<AgentIdentity>): Promise<void> {
    this.identity = { ...this.identity, ...updates, updatedAt: Date.now() };
    await this.save();
  }

  /**
   * Update personality
   */
  async updatePersonality(updates: Partial<AgentPersonality>): Promise<void> {
    this.personality = deepMerge(this.personality, updates);
    await this.save();
  }

  /**
   * Update preferences
   */
  async updatePreferences(updates: Partial<UserPreferences>): Promise<void> {
    this.preferences = deepMerge(this.preferences, updates);
    await this.save();
  }

  // ===========================================
  // Getters
  // ===========================================

  getIdentity(): AgentIdentity {
    return this.identity;
  }

  getPersonality(): AgentPersonality {
    return this.personality;
  }

  getPreferences(): UserPreferences {
    return this.preferences;
  }

  getName(): string {
    return this.identity.name;
  }

  getEmoji(): string {
    return this.identity.emoji;
  }

  getUserName(): string {
    return this.preferences.user.name;
  }

  getTimezone(): string {
    return this.preferences.user.timezone;
  }
}

/**
 * Deep merge utility
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      (result as any)[key] = deepMerge(targetValue, sourceValue);
    } else {
      (result as any)[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Ensure identity directories exist
 */
function ensureDirectories(): void {
  if (!existsSync(IDENTITY_DIR)) {
    mkdirSync(IDENTITY_DIR, { recursive: true });
  }
}

// Global singleton
let globalIdentity: IdentityManager | null = null;

export function getIdentityManager(): IdentityManager {
  if (!globalIdentity) {
    globalIdentity = new IdentityManager();
  }
  return globalIdentity;
}
