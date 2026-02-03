/**
 * Types for the Brain memory and agentic systems
 */

// ===========================================
// Identity Types
// ===========================================

export interface AgentIdentity {
  name: string;
  emoji: string;
  version: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentPersonality {
  communication: {
    style: 'concise' | 'verbose' | 'terse';
    tone: 'professional' | 'casual' | 'friendly';
    useEmojis: boolean;
    codeBlocks: boolean;
  };
  coding: {
    languages: string[];
    preferredLibraries: Record<string, string[]>;
    conventions: {
      quoteStyle: 'single' | 'double';
      semicolons: boolean;
      trailingCommas: boolean;
      spacing: number;
    };
  };
  behavior: {
    autoConfirm: {
      reads: boolean;
      singleFileEdits: boolean;
      tests: boolean;
    };
    requireApproval: {
      deletes: boolean;
      massChanges: boolean;
      deployments: boolean;
    };
    proactive: {
      suggestImprovements: boolean;
      reportErrors: boolean;
      offerAlternatives: boolean;
    };
  };
}

export interface UserPreferences {
  user: {
    name: string;
    timezone: string;
    location?: string; // For weather briefing (e.g., "Kos,Greece")
    workingHours: {
      start: number;
      end: number;
      timezone: string;
    };
    inactiveHours?: InactiveHours; // When autonomous mode is active
  };
  notifications: {
    enabled: boolean;
    quietHours: {
      start: number;
      end: number;
    };
    priorityLevels: Record<string, 'immediate' | 'digest' | 'mute'>;
  };
  git: {
    defaultBranch: string;
    autoPush: boolean;
    signCommits: boolean;
    commitMessageStyle: 'conventional' | 'descriptive' | 'minimal';
  };
  projects: {
    defaultBase: string;
    autoDetect: boolean;
    watchForChanges: boolean;
  };
}

// ===========================================
// Memory Types
// ===========================================

export interface MemoryEntry {
  id: string;
  type: 'conversation' | 'decision' | 'pattern' | 'fact' | 'preference';
  key: string;
  value: unknown;
  timestamp: number;
  project?: string;
  tags?: string[];
  importance?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ConversationMemory {
  id: string;
  chatId: number;
  messages: ConversationMessage[];
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMemory {
  projectId: string; // Path-based hash
  projectName: string;
  path: string;
  context: {
    description?: string;
    techStack?: string[];
    architecture?: string;
    conventions?: string[];
  };
  decisions: Decision[];
  patterns: Pattern[];
  lastUpdated: number;
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  madeAt: number;
  rationale: string;
  alternatives?: string[];
}

export interface Pattern {
  id: string;
  name: string;
  description: string;
  examples: string[];
  category: string;
}

// ===========================================
// Task Types
// ===========================================

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId?: string;
  chatId: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: unknown;
  metadata?: Record<string, unknown>;
}

export type TaskType =
  | 'claude_query'
  | 'code_refactor'
  | 'test_run'
  | 'git_commit'
  | 'git_pr'
  | 'deploy'
  | 'scan'
  | 'custom';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskSchedule {
  id: string;
  cronExpression: string;
  task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  runCount?: number;
}

// ===========================================
// Agent Types
// ===========================================

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: 'idle' | 'busy' | 'offline';
  currentTask?: string;
  capabilities: string[];
  createdAt: number;
}

export type AgentType =
  | 'orchestrator'
  | 'scout'
  | 'builder'
  | 'reviewer'
  | 'tester'
  | 'deployer'
  | 'custom';

export interface AgentTask {
  agentId: string;
  taskId: string;
  dependencies: string[]; // Other agent task IDs
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentWorkflow {
  id: string;
  name: string;
  description: string;
  tasks: AgentTask[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ===========================================
// Heartbeat / Metrics Types
// ===========================================

export interface HeartbeatEntry {
  timestamp: number;
  type: 'startup' | 'shutdown' | 'task_start' | 'task_complete' | 'error';
  details?: Record<string, unknown>;
}

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  tasksCompleted: number;
  tasksFailed: number;
  claudeQueries: number;
  linesOfCodeChanged: number;
  filesModified: number;
  activeProjects: string[];
  uptimeMs: number;
}

// ===========================================
// Git Automation Types
// ===========================================

export interface SmartCommitOptions {
  autoStage?: boolean;
  conventionalCommits?: boolean;
  generateMessage?: boolean;
  push?: boolean;
}

export interface PRDraft {
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  changes: FileChange[];
}

export interface FileChange {
  path: string;
  action: 'added' | 'modified' | 'deleted' | 'renamed';
  diff?: string;
}

// ===========================================
// Error Types
// ===========================================

export class BrainError extends Error {
  code: string;
  context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'BrainError';
    this.code = code;
    this.context = context;
  }
}

// Re-export conversation message from main types
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

// ===========================================
// Autonomous / Activity Types
// ===========================================

/**
 * User activity state for autonomous mode control
 */
export type UserActivityState = 'ACTIVE' | 'INACTIVE' | 'AWAY';

/**
 * Inactive hours time window for autonomous mode
 * Format: HH:MM-HH:MM (e.g., "03:00-11:00")
 */
export interface InactiveHours {
  start: string; // HH:MM format (24-hour)
  end: string;   // HH:MM format (24-hour)
  enabled: boolean;
}

/**
 * User activity data stored in memory
 */
export interface UserActivityData {
  chatId: number;
  state: UserActivityState;
  inactiveHours: InactiveHours;
  lastActivity: number; // timestamp of last user message
  autonomousEnabled: boolean; // manual override from /autonomous command
  stateSince: number; // when current state started
}

/**
 * Time window for checking activity
 */
export interface TimeWindow {
  startMinutes: number; // minutes from midnight (0-1439)
  endMinutes: number;   // minutes from midnight (0-1439)
}

/**
 * Autonomous mode type
 */
export type AutonomousMode = 'inactive_autonomous' | 'active_command' | 'away_pending';
