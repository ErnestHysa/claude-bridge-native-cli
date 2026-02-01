/**
 * Brain System - Main exports
 *
 * The brain provides persistent memory, task management, agent coordination,
 * and git automation for the Claude Bridge bot.
 *
 * Usage:
 * ```ts
 * import { getBrain, getMemoryStore, getTaskQueue, getOrchestrator, getGitAutomation } from './brain/index.js';
 *
 * // Initialize
 * await getBrain().initialize();
 *
 * // Use memory
 * const memory = getMemoryStore();
 * await memory.setFact('key', value);
 *
 * // Use task queue
 * const queue = getTaskQueue();
 * await queue.addTask({ ... });
 *
 * // Use agents
 * const orchestrator = getOrchestrator();
 * await orchestrator.orchestrate({ ... });
 *
 * // Use git automation
 * const git = getGitAutomation();
 * await git.smartCommit(projectPath);
 * ```
 */

// Brain Manager
export { BrainManager, getBrain, resetBrain } from './brain-manager.js';

// Identity Manager
export { IdentityManager, getIdentityManager } from './identity.js';

// Setup Wizard
export { SetupWizard, createSetupWizard } from './setup-wizard.js';
export type { SetupStep, SetupState } from './setup-wizard.js';

// Memory Store
export { MemoryStore, getMemoryStore } from './memory/memory-store.js';

// Context Indexer
export { ContextIndexer, getContextIndexer } from './context/context-indexer.js';
export type { FileIndex, ProjectFingerprint } from './context/context-indexer.js';

// Task Queue
export { TaskQueue, getTaskQueue } from './tasks/task-queue.js';

// Agent Orchestrator
export { AgentOrchestrator, getOrchestrator } from './agents/agent-orchestrator.js';

// Git Automation
export { GitAutomation, getGitAutomation } from './git/git-automation.js';

// Types
export * from './types.js';
