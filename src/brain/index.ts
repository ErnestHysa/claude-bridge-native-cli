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

// Vector Store
export { VectorStore, getVectorStore, resetVectorStore, EmbeddingGenerator } from './memory/vector-store.js';

// Context Indexer
export { ContextIndexer, getContextIndexer } from './context/context-indexer.js';
export type { FileIndex, ProjectFingerprint } from './context/context-indexer.js';

// Task Queue
export { TaskQueue, getTaskQueue } from './tasks/task-queue.js';

// Agent Orchestrator
export { AgentOrchestrator, getOrchestrator } from './agents/agent-orchestrator.js';

// DocWriter Agent
export { DocWriterAgent, getDocWriter, resetDocWriter } from './agents/doc-writer.js';
export type { DocGenerationOptions, CodeFile, DocumentationTemplate, DocSection, GeneratedDoc, CommentInsertion } from './agents/doc-writer.js';

// Git Automation
export { GitAutomation, getGitAutomation } from './git/git-automation.js';

// CI/CD Monitor
export { CIMonitor, getCIMonitor } from './cicd/index.js';
export type { CIProvider, BuildStatus, CIBuild, CIConfig, CIProject } from './cicd/index.js';

// Conversation Indexer
export { ConversationIndexer, getConversationIndexer } from './conversations/index.js';
export type { ConversationMessage, SearchQuery, SearchResult } from './conversations/index.js';

// Scheduler
export { startScheduledJobs, loadSelfReviewContext, getSelfReviewStatus } from './scheduler.js';

// Test Watcher
export { TestWatcher, getTestWatcher, resetTestWatcher } from './tests/test-watcher.js';
export type { TestResult, CoverageData, WatchSession } from './tests/test-watcher.js';

// Notification Router
export { NotificationRouter, getNotificationRouter, resetNotificationRouter } from './notifications/notification-router.js';
export type { Notification, NotificationType, NotificationPriority, NotificationPreferences } from './notifications/notification-router.js';

// Code Analyzer
export { CodeAnalyzer, getCodeAnalyzer, resetCodeAnalyzer } from './analyzer/code-analyzer.js';
export type { CodeAnalysisReport, ComplexityResult, SecurityResult, DuplicationResult, DependencyResult } from './analyzer/code-analyzer.js';

// Pattern Learner
export { PatternLearner, getPatternLearner, resetPatternLearner } from './learning/pattern-learner.js';
export type { LearnedPatterns, NamingConvention, LibraryUsage, CodeStructure, WorkflowPattern } from './learning/pattern-learner.js';

// Outcome Tracker
export { OutcomeTracker, getOutcomeTracker, resetOutcomeTracker } from './learning/outcome-tracker.js';
export type { ActionOutcome, LearningInsight, LearningReport, LearningMetric, OutcomeType } from './learning/outcome-tracker.js';

// Intention Engine
export { IntentionEngine, getIntentionEngine, resetIntentionEngine } from './intention/intention-engine.js';
export type { Intention, IntentionType, IntentionSource, IntentionPriority, Trigger, IntentionFilter, Evidence } from './intention/intention-engine.js';

// Decision Maker
export { DecisionMaker, getDecisionMaker, resetDecisionMaker, PermissionLevel } from './decision/decision-maker.js';
export type { Decision, ActionStep, Risk, UserDecisionPreferences, DecisionContext, RiskLevel } from './decision/decision-maker.js';

// Context Tracker
export { ContextTracker, getContextTracker, resetContextTracker } from './context-tracker/context-tracker.js';
export type { ProjectContext, Trend, Severity, CommitInfo, TestRunInfo, Opportunity, Blocker } from './context-tracker/context-tracker.js';

// Goal System
export { GoalSystem, getGoalSystem, resetGoalSystem } from './goals/goal-system.js';
export type { Goal, GoalType, GoalStatus, GoalStrategy, GoalTarget, GoalPermissions, GoalTask, GoalProgress } from './goals/goal-system.js';

// Types
export * from './types.js';

// Self-healing
export { TestHealer, getTestHealer, resetTestHealer } from './self-healing/test-healer.js';
export type { TestFailure, HealingAttempt, HealingOutcome, HealingStrategy, FailureSeverity } from './self-healing/test-healer.js';

// Dependency Management
export { DependencyManager, getDependencyManager, resetDependencyManager } from './dependency/dependency-manager.js';
export type { Dependency, DependencyUpdate, Vulnerability, DependencyHealth, UpdatePolicy, UpdateType, DependencySource, VulnerabilitySeverity } from './dependency/dependency-manager.js';

// Refactoring Agent
export { RefactoringAgent, getRefactoringAgent, resetRefactoringAgent } from './refactoring/refactoring-agent.js';
export type { RefactoringOpportunity, RefactoringResult, RefactoringPolicy, RefactoringType, RefactoringComplexity, RefactoringRisk } from './refactoring/refactoring-agent.js';

// Feature Workflow
export { FeatureWorkflowManager, getFeatureWorkflow, resetFeatureWorkflow } from './feature/feature-workflow.js';
export type { FeatureSpec, FeatureWorkflow, ImplementationTask, WorkflowStage, FeatureStatus, WorkflowOptions } from './feature/feature-workflow.js';

// Morning Briefing
export { MorningBriefing, getMorningBriefing, resetMorningBriefing } from './briefing/morning-briefing.js';
export type { BriefingReport, BriefingContent, BriefingSchedule, BriefingSection, BriefingPriority } from './briefing/morning-briefing.js';

// Transparency Tracker
export { TransparencyTracker, getTransparencyTracker, resetTransparencyTracker } from './transparency/transparency-tracker.js';
export type { ActionLog, TransparencyReport, ApprovalRecord, ActionStatus, ActionCategory } from './transparency/transparency-tracker.js';

// Permission Manager
export { PermissionManager, getPermissionManager, resetPermissionManager } from './permission/permission-manager.js';
export type { PermissionCheck, PermissionGrant, PermissionRestriction, PermissionConfig, PermissionRequest } from './permission/permission-manager.js';

// Rollback Manager
export { RollbackManager, getRollbackManager, resetRollbackManager } from './rollback/rollback-manager.js';
export type { RollbackPoint, RollbackResult, RollbackOptions, RollbackPointType, FileChange, ActionSnapshot } from './rollback/rollback-manager.js';

// Opportunity Detector
export { OpportunityDetector, getOpportunityDetector, resetOpportunityDetector } from './opportunity/opportunity-detector.js';
export type { ImprovementOpportunity, OpportunityType, OpportunityPriority, OpportunityStatus, DetectionResult, DetectionOptions, ScanSchedule } from './opportunity/opportunity-detector.js';

// Approval Workflow
export { ApprovalWorkflow, getApprovalWorkflow, resetApprovalWorkflow } from './approval/approval-workflow.js';
export type { ApprovalRequest, ApprovalDecision, ApprovalBatch, ApprovalPolicy, ApprovalStats, ApprovalStatus } from './approval/approval-workflow.js';

// User Feedback
export { UserFeedbackManager, getUserFeedbackManager, resetUserFeedbackManager } from './feedback/user-feedback.js';
export type { UserFeedback, FeedbackRating, FeedbackType, FeedbackCategory, FeedbackSummary, FeedbackTrend, FeedbackPrompt } from './feedback/user-feedback.js';
