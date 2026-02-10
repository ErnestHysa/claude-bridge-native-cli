/**
 * Setup Wizard - First-run setup experience
 *
 * Guides the user through setting up their brain profile
 * Each user/chat gets their own setup state
 */

import { writeFile, readFileSync, existsSync, mkdirSync, unlink } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { AgentIdentity, AgentPersonality, UserPreferences } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);
const BRAIN_DIR = join(PROJECT_ROOT, 'brain');
const SETUP_DIR = join(BRAIN_DIR, 'setup');

export type SetupStep =
  | 'welcome'
  | 'name'
  | 'timezone'
  | 'languages'
  | 'style'
  | 'git'
  | 'inactiveHours'
  | 'complete';

export interface SetupState {
  step: SetupStep;
  data: {
    userName?: string;
    timezone?: string;
    languages?: string[];
    codeStyle?: 'concise' | 'verbose' | 'terse';
    tone?: 'professional' | 'casual' | 'friendly';
    gitBranch?: string;
    commitStyle?: 'conventional' | 'descriptive' | 'minimal';
    projectsBase?: string;
    inactiveHoursStart?: string;
    inactiveHoursEnd?: string;
    inactiveHoursEnabled?: boolean;
  };
}

/**
 * Setup Wizard - handles first-run configuration (per-instance, not singleton)
 */
export class SetupWizard {
  private state: SetupState = {
    step: 'welcome',
    data: {},
  };
  private chatId: number | null = null;

  constructor(chatId?: number) {
    if (chatId !== undefined) {
      this.chatId = chatId;
      this.loadState();
    }
  }

  /**
   * Check if setup is needed
   */
  isSetupNeeded(): boolean {
    return this.state.step !== 'complete';
  }

  /**
   * Get current setup step
   */
  getCurrentStep(): SetupStep {
    return this.state.step;
  }

  /**
   * Get the message for current step
   */
  getCurrentStepMessage(): string {
    switch (this.state.step) {
      case 'welcome':
        return `🧠 <b>Setup Wizard</b>

Welcome to <b>Claude Bridge Native CLI</b>!

Let's set up your brain profile. This will help me work better with you.

I'll ask you a few questions. You can skip any question by typing "skip".

<b>Step 1 of 7</b>

What should I call you? (Your name or nickname)`;

      case 'name':
        return `🧠 <b>Setup Wizard</b>

Great to meet you! ${this.formatData('userName')}

<b>Step 2 of 7</b>

What's your timezone? (Examples: UTC, America/New_York, Europe/London)
Type "skip" to use UTC.`;

      case 'timezone':
        return `🧠 <b>Setup Wizard</b>

Perfect! ${this.formatData('timezone')}

<b>Step 3 of 7</b>

What programming languages do you use most?
You can list them like: TypeScript, Python, Rust
Or type "skip" for defaults.`;

      case 'languages':
        return `🧠 <b>Setup Wizard</b>

Got it! ${this.formatData('languages')}

<b>Step 4 of 7</b>

How should I communicate with you?
• <b>concise</b> - Brief, to the point
• <b>verbose</b> - Detailed explanations
• <b>terse</b> - Ultra-short, just the essentials

Type your choice or "skip" for concise.`;

      case 'style':
        return `🧠 <b>Setup Wizard</b>

Nice! ${this.formatData('codeStyle')}

<b>Step 5 of 7</b>

What's your default git branch? (Usually "main" or "master")
Type "skip" for "main".`;

      case 'git':
        return `🧠 <b>Setup Wizard</b>

Great! ${this.formatData('gitBranch')}

<b>Step 6 of 7</b>

🤖 <b>Autonomous Mode</b>

During which hours should I work autonomously on your projects?
I'll be fully active during these hours without needing your input.

Format: HH:MM-HH:MM (24-hour format)
Examples:
• 03:00-11:00 (works while you sleep)
• 22:00-06:00 (night owl mode)

Type "skip" to disable autonomous mode.`;

      case 'inactiveHours':
        return `🧠 <b>Setup Wizard</b>

Autonomous hours set! ${this.formatInactiveHours()}

<b>Step 7 of 7</b>

What's your projects base directory?
Type the path or "skip" for default.

Windows example: C:\\Users\\YourName\\Projects
Linux/Mac example: /home/yourname/projects`;

      case 'complete':
        return `🧠 <b>Setup Wizard</b>

✅ Setup complete!

Here's your profile:

<b>Name:</b> ${this.state.data.userName || 'Developer'}
<b>Timezone:</b> ${this.state.data.timezone || 'UTC'}
<b>Languages:</b> ${(this.state.data.languages || ['TypeScript']).join(', ')}
<b>Style:</b> ${this.state.data.codeStyle || 'concise'}
<b>Git Branch:</b> ${this.state.data.gitBranch || 'main'}
<b>Autonomous Hours:</b> ${this.formatInactiveHours() || 'Disabled'}
<b>Projects:</b> ${this.state.data.projectsBase || 'Default'}

You can always update these with:
/profile - Update your profile
/inactivehours - Change autonomous hours
/autonomous on/off - Toggle autonomous mode

Ready to code? Send a message or type /help!`;

      default:
        return 'Something went wrong. Type /start to begin again.';
    }
  }

  /**
   * Process user input for current step
   */
  processInput(input: string): { nextState: SetupStep; message?: string; error?: string } {
    const trimmed = input.trim();

    switch (this.state.step) {
      case 'welcome':
        this.state.data.userName = trimmed.toLowerCase() === 'skip' ? 'Developer' : trimmed;
        this.state.step = 'name';
        this.saveState();
        return { nextState: 'name' };

      case 'name':
        this.state.data.timezone = trimmed.toLowerCase() === 'skip' ? 'UTC' : trimmed;
        this.state.step = 'timezone';
        this.saveState();
        return { nextState: 'timezone' };

      case 'timezone':
        if (trimmed.toLowerCase() !== 'skip') {
          this.state.data.languages = trimmed.split(',').map(l => l.trim()).filter(Boolean);
        }
        this.state.step = 'languages';
        this.saveState();
        return { nextState: 'languages' };

      case 'languages':
        const validStyles = ['concise', 'verbose', 'terse'];
        if (validStyles.includes(trimmed.toLowerCase())) {
          this.state.data.codeStyle = trimmed.toLowerCase() as 'concise' | 'verbose' | 'terse';
        } else {
          this.state.data.codeStyle = 'concise';
        }
        this.state.step = 'style';
        this.saveState();
        return { nextState: 'style' };

      case 'style':
        this.state.data.gitBranch = trimmed.toLowerCase() === 'skip' ? 'main' : trimmed;
        this.state.step = 'git';
        this.saveState();
        return { nextState: 'git' };

      case 'git':
        this.state.step = 'inactiveHours';
        this.saveState();
        return { nextState: 'inactiveHours' };

      case 'inactiveHours':
        return this.processInactiveHoursInput(trimmed);

      case 'complete':
        return { nextState: 'complete', message: 'Setup already complete!' };

      default:
        // Reset to welcome if state is invalid
        this.state = { step: 'welcome', data: {} };
        this.saveState();
        return { nextState: 'welcome', error: 'Invalid state. Restarting...' };
    }
  }

  /**
   * Get the final identity/profile from setup
   */
  getProfile(): {
    identity: Partial<AgentIdentity>;
    personality: Partial<AgentPersonality>;
    preferences: Partial<UserPreferences>;
  } {
    const languages = this.state.data.languages || ['TypeScript', 'JavaScript', 'Python'];
    const codeStyle = this.state.data.codeStyle || 'concise';

    return {
      identity: {
        name: this.state.data.userName || 'Developer',
        emoji: '🧠',
      },
      personality: {
        communication: {
          style: codeStyle,
          tone: 'professional',
          useEmojis: false,
          codeBlocks: true,
        },
        coding: {
          languages,
          preferredLibraries: {},
          conventions: {
            quoteStyle: 'double',
            semicolons: true,
            trailingCommas: true,
            spacing: 2,
          },
        },
      },
      preferences: {
        user: {
          name: this.state.data.userName || 'Developer',
          timezone: this.state.data.timezone || 'UTC',
          workingHours: {
            start: 9,
            end: 18,
            timezone: this.state.data.timezone || 'UTC',
          },
          inactiveHours: this.state.data.inactiveHoursEnabled
            ? {
                start: this.state.data.inactiveHoursStart || '03:00',
                end: this.state.data.inactiveHoursEnd || '11:00',
                enabled: true,
              }
            : {
                start: '03:00',
                end: '11:00',
                enabled: false,
              },
        },
        git: {
          defaultBranch: this.state.data.gitBranch || 'main',
          autoPush: false,
          signCommits: false,
          commitMessageStyle: 'conventional',
        },
        projects: {
          defaultBase: this.state.data.projectsBase || '',
          autoDetect: true,
          watchForChanges: true,
        },
      },
    };
  }

  /**
   * Reset setup state
   */
  reset(): void {
    this.state = {
      step: 'welcome',
      data: {},
    };
    this.saveState();
  }

  /**
   * Set the chat ID for this wizard
   */
  setChatId(chatId: number): void {
    this.chatId = chatId;
    this.loadState();
  }

  /**
   * Load existing state from file (if chatId is set)
   * Also supports loading from parameter for backward compatibility
   */
  loadState(state?: SetupState): void {
    if (state) {
      // Load from parameter (backward compatibility)
      this.state = state;
      return;
    }

    // Load from file if chatId is set
    if (this.chatId !== null) {
      const statePath = this.getStatePath();
      if (existsSync(statePath)) {
        try {
          const content = readFileSync(statePath, 'utf-8');
          this.state = JSON.parse(content);
        } catch {
          // File corrupted, start fresh
          this.state = { step: 'welcome', data: {} };
        }
      }
    }
  }

  /**
   * Get current state
   */
  getState(): SetupState {
    return this.state;
  }

  /**
   * Mark setup as complete and clean up state file
   */
  markComplete(): void {
    this.state.step = 'complete';
    this.deleteStateFile();
  }

  /**
   * Save state to file (if chatId is set)
   */
  private saveState(): void {
    if (this.chatId === null) return;

    // Ensure directory exists
    if (!existsSync(SETUP_DIR)) {
      mkdirSync(SETUP_DIR, { recursive: true });
    }

    const statePath = this.getStatePath();
    writeFile(statePath, JSON.stringify(this.state, null, 2), 'utf-8', (err) => {
      if (err) console.error(`Failed to save setup state for chat ${this.chatId}:`, err);
    });
  }

  /**
   * Delete state file
   */
  private deleteStateFile(): void {
    if (this.chatId === null) return;

    const statePath = this.getStatePath();
    if (existsSync(statePath)) {
      unlink(statePath, (err: Error | null) => {
        if (err) console.error(`Failed to delete setup state for chat ${this.chatId}:`, err);
      });
    }
  }

  /**
   * Get the state file path for this chat
   */
  private getStatePath(): string {
    return join(SETUP_DIR, `${this.chatId}.json`);
  }

  /**
   * Format inactive hours for display
   */
  private formatInactiveHours(): string {
    if (!this.state.data.inactiveHoursEnabled) {
      return '<b>Disabled</b>';
    }

    const start = this.state.data.inactiveHoursStart || '--:--';
    const end = this.state.data.inactiveHoursEnd || '--:--';

    return `<b>${start} - ${end}</b>`;
  }

  /**
   * Process inactive hours input
   */
  private processInactiveHoursInput(input: string): { nextState: SetupStep; message?: string; error?: string } {
    const trimmed = input.toLowerCase().trim();

    if (trimmed === 'skip') {
      // Skip inactive hours setup (disable autonomous mode)
      this.state.data.inactiveHoursEnabled = false;
      this.state.step = 'complete';
      this.saveState();
      return { nextState: 'complete' };
    }

    // Parse time window format: HH:MM-HH:MM
    const match = trimmed.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);

    if (!match) {
      return {
        nextState: 'inactiveHours',
        error: 'Invalid format. Please use HH:MM-HHMM format (24-hour).\nExample: 03:00-11:00'
      };
    }

    const [, startHour, startMin, endHour, endMin] = match;

    // Validate hours and minutes
    const startH = parseInt(startHour);
    const startM = parseInt(startMin);
    const endH = parseInt(endHour);
    const endM = parseInt(endMin);

    if (startH < 0 || startH > 23 || startM < 0 || startM > 59 ||
        endH < 0 || endH > 23 || endM < 0 || endM > 59) {
      return {
        nextState: 'inactiveHours',
        error: 'Invalid time. Hours: 00-23, Minutes: 00-59'
      };
    }

    // Store the inactive hours
    this.state.data.inactiveHoursStart = `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`;
    this.state.data.inactiveHoursEnd = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
    this.state.data.inactiveHoursEnabled = true;

    this.state.step = 'complete';
    this.saveState();
    return { nextState: 'complete' };
  }

  // ===========================================
  // Helpers
  // ===========================================

  private formatData(key: keyof SetupState['data']): string {
    const value = this.state.data[key];
    if (!value) return '';

    switch (key) {
      case 'userName':
        return `Hello <b>${value}</b>!`;
      case 'timezone':
        return `Timezone: <b>${value}</b>`;
      case 'languages':
        return `Languages: <b>${Array(value).join(', ')}</b>`;
      case 'codeStyle':
        return `Style: <b>${value}</b>`;
      case 'gitBranch':
        return `Git branch: <b>${value}</b>`;
      default:
        return '';
    }
  }
}

// No global singleton - each chat gets its own instance
export function createSetupWizard(chatId?: number): SetupWizard {
  return new SetupWizard(chatId);
}
