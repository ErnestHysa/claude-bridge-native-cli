/**
 * Feature Workflow - Complete feature implementation automation
 *
 * The Feature Workflow manages the end-to-end process of implementing features:
 * - Parse feature specifications
 * - Break down into implementation tasks
 * - Generate code for each task
 * - Create/update tests
 * - Update documentation
 * - Create pull requests
 *
 * Workflow stages:
 * 1. Specification: Parse and validate feature requirements
 * 2. Planning: Break down into tasks
 * 3. Implementation: Execute tasks with agent orchestration
 * 4. Testing: Generate and run tests
 * 5. Review: Code review and validation
 * 6. Documentation: Update docs
 * 7. PR: Create pull request
 */

import { getIntentionEngine } from '../intention/intention-engine.js';
import { getOrchestrator } from '../agents/agent-orchestrator.js';
import { getMemoryStore } from '../memory/memory-store.js';
import { getGitAutomation } from '../git/git-automation.js';
import { getTestWatcher } from '../tests/test-watcher.js';
import { getCodeAnalyzer } from '../analyzer/code-analyzer.js';

// ============================================
// Types
// ============================================

/**
 * Feature workflow stage
 */
export type WorkflowStage =
  | 'specification'    // Parse and validate requirements
  | 'planning'          // Break down into tasks
  | 'implementation'    // Execute tasks
  | 'testing'          // Generate and run tests
  | 'review'           // Code review
  | 'documentation'    // Update docs
  | 'pr'               // Create PR
  | 'completed';       // Feature complete

/**
 * Feature status
 */
export type FeatureStatus = 'draft' | 'active' | 'paused' | 'completed' | 'failed';

/**
 * Feature specification
 */
export interface FeatureSpec {
  id: string;
  name: string;
  description: string;
  requirements: string[];
  acceptanceCriteria: string[];
  files: string[];              // Files to modify/create
  dependencies: string[];       // Other features this depends on
  priority: 'low' | 'medium' | 'high' | 'urgent';
  complexity: 'simple' | 'moderate' | 'complex';
  projectPath: string;
  chatId: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Implementation task
 */
export interface ImplementationTask {
  id: string;
  featureId: string;
  title: string;
  description: string;
  agentType: 'scout' | 'builder' | 'tester' | 'reviewer';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];       // Task IDs that must complete first
  result?: {
    success: boolean;
    output?: string;
    changes?: string[];
    error?: string;
  };
  startedAt?: number;
  completedAt?: number;
}

/**
 * Feature workflow
 */
export interface FeatureWorkflow {
  id: string;
  feature: FeatureSpec;
  currentStage: WorkflowStage;
  tasks: ImplementationTask[];
  status: FeatureStatus;
  progress: number;             // 0-100
  branch: string;
  pullRequest?: {
    url: string;
    number: number;
  };
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}

/**
 * Workflow execution options
 */
export interface WorkflowOptions {
  autoImplement: boolean;       // Auto-execute implementation
  autoTest: boolean;            // Auto-generate and run tests
  autoReview: boolean;          // Auto-code review
  autoPR: boolean;              // Auto-create PR
  requireApproval: boolean;     // Require approval before each stage
}

// ============================================
// Configuration
// ============================================

const WORKFLOW_CONFIG = {
  // Default options
  defaultOptions: {
    autoImplement: false,
    autoTest: true,
    autoReview: true,
    autoPR: false,
    requireApproval: true,
  } as WorkflowOptions,

  // Stage timeout (ms) - 30 minutes
  stageTimeout: 30 * 60 * 1000,

  // Maximum concurrent tasks
  maxConcurrentTasks: 3,
};

// ============================================
// Feature Workflow Class
// ============================================

export class FeatureWorkflowManager {
  private memory = getMemoryStore();
  private workflows = new Map<string, FeatureWorkflow>();
  private active = false;
  private runningWorkflows = new Set<string>();

  /**
   * Start the workflow manager
   */
  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;
    await this.loadWorkflows();

    console.log('[FeatureWorkflow] Started');
  }

  /**
   * Stop the workflow manager
   */
  stop(): void {
    this.active = false;
    this.runningWorkflows.clear();
    console.log('[FeatureWorkflow] Stopped');
  }

  /**
   * Create a new feature from specification
   */
  async createFeature(spec: {
    name: string;
    description: string;
    requirements: string[];
    acceptanceCriteria: string[];
    projectPath: string;
    chatId: number;
    priority?: FeatureSpec['priority'];
    complexity?: FeatureSpec['complexity'];
  }): Promise<FeatureWorkflow> {
    const featureId = this.generateFeatureId();
    const workflowId = this.generateWorkflowId();

    const feature: FeatureSpec = {
      id: featureId,
      name: spec.name,
      description: spec.description,
      requirements: spec.requirements,
      acceptanceCriteria: spec.acceptanceCriteria,
      files: [],
      dependencies: [],
      priority: spec.priority || 'medium',
      complexity: spec.complexity || 'moderate',
      projectPath: spec.projectPath,
      chatId: spec.chatId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Analyze which files need to be modified
    const analyzer = getCodeAnalyzer();
    const complexityResults = await analyzer.analyzeComplexity(spec.projectPath);
    feature.files = complexityResults.map(r => r.file).slice(0, 10); // Top 10 files

    // Create the workflow
    const workflow: FeatureWorkflow = {
      id: workflowId,
      feature,
      currentStage: 'specification',
      tasks: [],
      status: 'draft',
      progress: 0,
      branch: `feature/${this.sanitizeName(spec.name)}-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Plan the implementation tasks
    const tasks = await this.planTasks(workflow);
    workflow.tasks = tasks;

    // Store the workflow
    this.workflows.set(workflowId, workflow);
    await this.storeWorkflow(workflow);

    // Create intention for the feature
    await this.createFeatureIntention(workflow);

    return workflow;
  }

  /**
   * Plan implementation tasks for a feature
   */
  private async planTasks(workflow: FeatureWorkflow): Promise<ImplementationTask[]> {
    const tasks: ImplementationTask[] = [];
    const { feature } = workflow;

    // Task 1: Analyze current codebase
    tasks.push({
      id: this.generateTaskId(),
      featureId: feature.id,
      title: 'Analyze current codebase',
      description: `Understand the existing code structure for implementing: ${feature.name}`,
      agentType: 'scout',
      status: 'pending',
      dependencies: [],
    });

    // Task 2: Implement core functionality
    tasks.push({
      id: this.generateTaskId(),
      featureId: feature.id,
      title: 'Implement core functionality',
      description: `Implement the main feature: ${feature.description}`,
      agentType: 'builder',
      status: 'pending',
      dependencies: [tasks[0].id],
    });

    // Task 3: Generate tests
    tasks.push({
      id: this.generateTaskId(),
      featureId: feature.id,
      title: 'Generate tests',
      description: `Create tests for the new feature based on acceptance criteria`,
      agentType: 'tester',
      status: 'pending',
      dependencies: [tasks[1].id],
    });

    // Task 4: Code review
    tasks.push({
      id: this.generateTaskId(),
      featureId: feature.id,
      title: 'Review implementation',
      description: `Review the implemented code for quality and correctness`,
      agentType: 'reviewer',
      status: 'pending',
      dependencies: [tasks[2].id],
    });

    return tasks;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    options: Partial<WorkflowOptions> = {}
  ): Promise<FeatureWorkflow | null> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;

    if (this.runningWorkflows.has(workflowId)) {
      return workflow; // Already running
    }

    this.runningWorkflows.add(workflowId);
    workflow.status = 'active';
    await this.storeWorkflow(workflow);

    const opts = { ...WORKFLOW_CONFIG.defaultOptions, ...options };

    try {
      // Stage 1: Specification
      await this.runStage(workflow, 'specification', opts);

      // Stage 2: Planning
      await this.runStage(workflow, 'planning', opts);

      // Stage 3: Implementation
      await this.runStage(workflow, 'implementation', opts);

      // Stage 4: Testing
      await this.runStage(workflow, 'testing', opts);

      // Stage 5: Review
      await this.runStage(workflow, 'review', opts);

      // Stage 6: Documentation
      await this.runStage(workflow, 'documentation', opts);

      // Stage 7: PR (if enabled)
      if (opts.autoPR) {
        await this.runStage(workflow, 'pr', opts);
      } else {
        workflow.currentStage = 'completed';
        workflow.status = 'completed';
        workflow.completedAt = Date.now();
      }

      workflow.progress = 100;
      await this.storeWorkflow(workflow);

      return workflow;

    } catch (error) {
      workflow.status = 'failed';
      workflow.error = error instanceof Error ? error.message : String(error);
      await this.storeWorkflow(workflow);
      return workflow;
    } finally {
      this.runningWorkflows.delete(workflowId);
    }
  }

  /**
   * Run a single workflow stage
   */
  private async runStage(
    workflow: FeatureWorkflow,
    stage: WorkflowStage,
    options: WorkflowOptions
  ): Promise<void> {
    workflow.currentStage = stage;
    await this.storeWorkflow(workflow);

    switch (stage) {
      case 'specification':
        await this.runSpecificationStage(workflow, options);
        break;
      case 'planning':
        await this.runPlanningStage(workflow, options);
        break;
      case 'implementation':
        await this.runImplementationStage(workflow, options);
        break;
      case 'testing':
        await this.runTestingStage(workflow, options);
        break;
      case 'review':
        await this.runReviewStage(workflow, options);
        break;
      case 'documentation':
        await this.runDocumentationStage(workflow, options);
        break;
      case 'pr':
        await this.runPRStage(workflow, options);
        break;
    }

    // Update progress
    this.updateProgress(workflow);
  }

  /**
   * Run specification stage
   */
  private async runSpecificationStage(_workflow: FeatureWorkflow, _options: WorkflowOptions): Promise<void> {
    // Specification is validated at creation time
    // This stage can be used for additional validation if needed
  }

  /**
   * Run planning stage
   */
  private async runPlanningStage(_workflow: FeatureWorkflow, _options: WorkflowOptions): Promise<void> {
    // Tasks are already planned during creation
    // This stage can be used for dynamic re-planning if needed
  }

  /**
   * Run implementation stage
   */
  private async runImplementationStage(workflow: FeatureWorkflow, options: WorkflowOptions): Promise<void> {
    if (!options.autoImplement) {
      // Create intention for manual implementation
      await this.createStageIntention(workflow, 'implementation');
      return;
    }

    const orchestrator = getOrchestrator();

    // Execute tasks in dependency order
    const tasksToRun = this.getRunnableTasks(workflow.tasks);

    for (const task of tasksToRun.slice(0, WORKFLOW_CONFIG.maxConcurrentTasks)) {
      task.status = 'in_progress';
      task.startedAt = Date.now();
      await this.storeWorkflow(workflow);

      try {
        const result = await orchestrator.executeAutonomousTask({
          intentionId: workflow.feature.id,
          decisionId: `workflow-${workflow.id}`,
          chatId: workflow.feature.chatId,
          projectPath: workflow.feature.projectPath,
          description: task.title,
          type: 'implement',
          agentType: task.agentType,
          transparent: true,
        });

        task.result = {
          success: result.success,
          output: result.result ? String(result.result) : undefined,
          changes: result.changes?.map(c => c.path || c.type) || [],
          error: result.error,
        };
        task.status = result.success ? 'completed' : 'failed';
        task.completedAt = Date.now();

      } catch (error) {
        task.result = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
        task.status = 'failed';
        task.completedAt = Date.now();
      }

      await this.storeWorkflow(workflow);
    }
  }

  /**
   * Run testing stage
   */
  private async runTestingStage(workflow: FeatureWorkflow, options: WorkflowOptions): Promise<void> {
    if (!options.autoTest) {
      await this.createStageIntention(workflow, 'testing');
      return;
    }

    const testWatcher = getTestWatcher();
    const result = await testWatcher.runTests(workflow.feature.projectPath);

    if (result.failed > 0) {
      workflow.error = `${result.failed} test(s) failed`;
      await this.storeWorkflow(workflow);
    }
  }

  /**
   * Run review stage
   */
  private async runReviewStage(workflow: FeatureWorkflow, options: WorkflowOptions): Promise<void> {
    if (!options.autoReview) {
      await this.createStageIntention(workflow, 'review');
      return;
    }

    const analyzer = getCodeAnalyzer();
    const results = await analyzer.analyzeComplexity(workflow.feature.projectPath);

    // Check if any new complexity issues were introduced
    const highComplexity = results.filter(r => r.rating === 'high' || r.rating === 'very-high');
    if (highComplexity.length > 0) {
      workflow.error = `High complexity detected in ${highComplexity.length} file(s)`;
      await this.storeWorkflow(workflow);
    }
  }

  /**
   * Run documentation stage
   */
  private async runDocumentationStage(_workflow: FeatureWorkflow, _options: WorkflowOptions): Promise<void> {
    // Documentation updates would be handled here
    // For now, this is a placeholder
  }

  /**
   * Run PR stage
   */
  private async runPRStage(workflow: FeatureWorkflow, _options: WorkflowOptions): Promise<void> {
    const git = getGitAutomation();

    // Create PR
    const prResult = await git.createPR(
      workflow.feature.projectPath,
      workflow.branch,
      'main',
      false  // Not a draft
    );

    if (prResult.success && prResult.url) {
      workflow.pullRequest = {
        url: prResult.url,
        number: 0,  // Would need to parse from URL if needed
      };
    }

    await this.storeWorkflow(workflow);
  }

  /**
   * Get tasks that are ready to run (dependencies satisfied)
   */
  private getRunnableTasks(tasks: ImplementationTask[]): ImplementationTask[] {
    return tasks.filter(task => {
      if (task.status !== 'pending') return false;

      // Check if all dependencies are completed
      return task.dependencies.every(depId => {
        const depTask = tasks.find(t => t.id === depId);
        return depTask?.status === 'completed';
      });
    });
  }

  /**
   * Update workflow progress
   */
  private updateProgress(workflow: FeatureWorkflow): void {
    const totalTasks = workflow.tasks.length;
    const completedTasks = workflow.tasks.filter(t => t.status === 'completed').length;

    if (totalTasks > 0) {
      workflow.progress = Math.round((completedTasks / totalTasks) * 100);
    }
  }

  /**
   * Create intention for a new feature
   */
  private async createFeatureIntention(workflow: FeatureWorkflow): Promise<void> {
    const intentionEngine = getIntentionEngine();

    await intentionEngine.processTrigger({
      type: 'user_request',
      projectPath: workflow.feature.projectPath,
      chatId: workflow.feature.chatId,
      data: {
        workflowId: workflow.id,
        featureName: workflow.feature.name,
        featureId: workflow.feature.id,
        description: workflow.feature.description,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Create intention for a workflow stage
   */
  private async createStageIntention(workflow: FeatureWorkflow, stage: WorkflowStage): Promise<void> {
    const intentionEngine = getIntentionEngine();

    await intentionEngine.processTrigger({
      type: 'user_request',
      projectPath: workflow.feature.projectPath,
      chatId: workflow.feature.chatId,
      data: {
        workflowId: workflow.id,
        stage,
        featureName: workflow.feature.name,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(id: string): FeatureWorkflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get workflows by filter
   */
  getWorkflows(filter: {
    chatId?: number;
    projectPath?: string;
    status?: FeatureStatus;
  } = {}): FeatureWorkflow[] {
    let results = Array.from(this.workflows.values());

    if (filter.chatId !== undefined) {
      results = results.filter(w => w.feature.chatId === filter.chatId);
    }

    if (filter.projectPath) {
      results = results.filter(w => w.feature.projectPath === filter.projectPath);
    }

    if (filter.status) {
      results = results.filter(w => w.status === filter.status);
    }

    return results;
  }

  /**
   * Pause a workflow
   */
  async pauseWorkflow(workflowId: string): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || workflow.status !== 'active') return false;

    workflow.status = 'paused';
    await this.storeWorkflow(workflow);
    return true;
  }

  /**
   * Resume a paused workflow
   */
  async resumeWorkflow(workflowId: string, options: Partial<WorkflowOptions> = {}): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || workflow.status !== 'paused') return false;

    return (await this.executeWorkflow(workflowId, options)) !== null;
  }

  /**
   * Store workflow in memory
   */
  private async storeWorkflow(workflow: FeatureWorkflow): Promise<void> {
    workflow.updatedAt = Date.now();
    await this.memory.setFact(`workflow:${workflow.id}`, workflow);
  }

  /**
   * Load workflows from memory
   */
  private async loadWorkflows(): Promise<void> {
    // Workflows are loaded on demand
  }

  /**
   * Sanitize a name for use in branch names
   */
  private sanitizeName(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  /**
   * Generate a unique feature ID
   */
  private generateFeatureId(): string {
    return `feature-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate a unique workflow ID
   */
  private generateWorkflowId(): string {
    return `workflow-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<FeatureStatus, number>;
    active: number;
    running: number;
  } {
    const all = Array.from(this.workflows.values());

    const byStatus: Record<FeatureStatus, number> = {
      draft: 0,
      active: 0,
      paused: 0,
      completed: 0,
      failed: 0,
    };

    for (const workflow of all) {
      byStatus[workflow.status]++;
    }

    return {
      total: all.length,
      byStatus,
      active: all.filter(w => w.status === 'active').length,
      running: this.runningWorkflows.size,
    };
  }
}

// ============================================
// Global Singleton
// ============================================

let globalFeatureWorkflow: FeatureWorkflowManager | null = null;

export function getFeatureWorkflow(): FeatureWorkflowManager {
  if (!globalFeatureWorkflow) {
    globalFeatureWorkflow = new FeatureWorkflowManager();
  }
  return globalFeatureWorkflow;
}

export function resetFeatureWorkflow(): void {
  if (globalFeatureWorkflow) {
    globalFeatureWorkflow.stop();
  }
  globalFeatureWorkflow = null;
}
