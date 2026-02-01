/**
 * Agent Orchestrator - Coordinate multiple specialized agents
 *
 * Manages a team of specialized agents that can work together
 * on complex tasks. Each agent has specific capabilities.
 *
 * Agents:
 * - Scout: Explores codebase, finds patterns, understands architecture
 * - Builder: Writes code, implements features, makes modifications
 * - Reviewer: Reviews code for bugs, security, style issues
 * - Tester: Writes tests, runs test suites, analyzes coverage
 * - Deployer: Handles deployments, CI/CD operations
 */

import { getMemoryStore } from '../memory/memory-store.js';
import type {
  Agent,
  AgentType,
  AgentWorkflow,
  AgentTask,
} from '../types.js';

/**
 * Agent Orchestrator - coordinates multiple agents
 */
export class AgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private memory = getMemoryStore();

  constructor() {
    this.initializeDefaultAgents();
  }

  // ===========================================
  // Agent Management
  // ===========================================

  /**
   * Initialize default specialized agents
   */
  private initializeDefaultAgents(): void {
    const defaultAgents: Omit<Agent, 'id' | 'createdAt'>[] = [
      {
        name: 'Scout',
        type: 'scout',
        status: 'idle',
        capabilities: [
          'explore_codebase',
          'find_patterns',
          'analyze_architecture',
          'locate_functions',
          'trace_dependencies',
          'summarize_files',
        ],
      },
      {
        name: 'Builder',
        type: 'builder',
        status: 'idle',
        capabilities: [
          'write_code',
          'implement_feature',
          'refactor_code',
          'fix_bug',
          'add_type_annotations',
          'create_file',
        ],
      },
      {
        name: 'Reviewer',
        type: 'reviewer',
        status: 'idle',
        capabilities: [
          'review_code',
          'find_bugs',
          'security_audit',
          'style_check',
          'performance_analysis',
          'best_practices_check',
        ],
      },
      {
        name: 'Tester',
        type: 'tester',
        status: 'idle',
        capabilities: [
          'write_tests',
          'run_tests',
          'analyze_coverage',
          'generate_test_data',
          'mock_dependencies',
        ],
      },
      {
        name: 'Deployer',
        type: 'deployer',
        status: 'idle',
        capabilities: [
          'deploy',
          'rollback',
          'check_ci_status',
          'generate_changelog',
          'tag_release',
        ],
      },
    ];

    for (const agent of defaultAgents) {
      this.registerAgent(agent);
    }
  }

  /**
   * Register a new agent
   */
  registerAgent(agent: Omit<Agent, 'id' | 'createdAt'>): Agent {
    const newAgent: Agent = {
      ...agent,
      id: this.generateAgentId(),
      createdAt: Date.now(),
    };
    this.agents.set(newAgent.id, newAgent);
    return newAgent;
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: AgentType): Agent[] {
    return Array.from(this.agents.values()).filter(a => a.type === type);
  }

  /**
   * Get all agents
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get an available agent of a specific type
   */
  getAvailableAgent(type: AgentType): Agent | undefined {
    return this.getAgentsByType(type).find(a => a.status === 'idle');
  }

  // ===========================================
  // Workflow Orchestration
  // ===========================================

  /**
   * Create and execute a workflow with multiple agents
   */
  async orchestrate(
    workflow: Omit<AgentWorkflow, 'id' | 'createdAt' | 'status'>,
  ): Promise<AgentWorkflow> {
    const newWorkflow: AgentWorkflow = {
      ...workflow,
      id: this.generateWorkflowId(),
      status: 'pending',
      createdAt: Date.now(),
    };

    // Execute the workflow
    await this.executeWorkflow(newWorkflow);

    return newWorkflow;
  }

  /**
   * Execute a workflow by running agent tasks in dependency order
   */
  private async executeWorkflow(workflow: AgentWorkflow): Promise<void> {
    workflow.status = 'running';
    workflow.startedAt = Date.now();

    try {
      // Build dependency graph
      const completed = new Set<string>();
      const results = new Map<string, unknown>();

      // Execute tasks in dependency order
      let remainingAttempts = workflow.tasks.length;
      let lastPass = false;

      while (!lastPass && remainingAttempts > 0) {
        lastPass = true;

        for (const task of workflow.tasks) {
          if (completed.has(task.taskId)) continue;

          // Check if all dependencies are met
          const depsMet = task.dependencies.every(dep => completed.has(dep));

          if (depsMet) {
            lastPass = false;
            task.status = 'running';
            task.startedAt = Date.now();

            try {
              // Execute the agent task
              const result = await this.executeAgentTask(task);
              task.status = 'completed';
              task.completedAt = Date.now();
              task.result = result;
              results.set(task.taskId, result);
              completed.add(task.taskId);
            } catch (error) {
              task.status = 'failed';
              task.completedAt = Date.now();
              task.result = { error: error instanceof Error ? error.message : String(error) };
              throw error;
            }
          }
        }

        remainingAttempts--;
      }

      workflow.status = 'completed';
      workflow.completedAt = Date.now();
    } catch (error) {
      workflow.status = 'failed';
      workflow.completedAt = Date.now();
    }
  }

  /**
   * Execute a single agent task
   */
  private async executeAgentTask(agentTask: AgentTask): Promise<unknown> {
    const agent = this.getAgent(agentTask.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentTask.agentId}`);
    }

    // Update agent status
    agent.status = 'busy';
    agent.currentTask = agentTask.taskId;

    try {
      // Execute based on agent type
      switch (agent.type) {
        case 'scout':
          return await this.executeScout(agent, agentTask);
        case 'builder':
          return await this.executeBuilder(agent, agentTask);
        case 'reviewer':
          return await this.executeReviewer(agent, agentTask);
        case 'tester':
          return await this.executeTester(agent, agentTask);
        case 'deployer':
          return await this.executeDeployer(agent, agentTask);
        default:
          throw new Error(`Unknown agent type: ${agent.type}`);
      }
    } finally {
      agent.status = 'idle';
      agent.currentTask = undefined;
    }
  }

  // ===========================================
  // Agent Executors
  // ===========================================

  private async executeScout(agent: Agent, task: AgentTask): Promise<unknown> {
    // Scout explores the codebase and returns findings
    const metadata = task.result as { projectPath?: string; query?: string } | undefined;
    const projectPath = metadata?.projectPath;

    if (!projectPath) {
      return { error: 'Scout requires projectPath in metadata' };
    }

    // Get project memory
    const projectMemory = await this.memory.getProjectMemory(projectPath);

    return {
      agent: agent.name,
      findings: {
        project: projectMemory?.projectName,
        techStack: projectMemory?.context?.techStack,
        decisions: projectMemory?.decisions.length || 0,
        patterns: projectMemory?.patterns.length || 0,
      },
    };
  }

  private async executeBuilder(agent: Agent, _task: AgentTask): Promise<unknown> {
    // Builder writes code
    return {
      agent: agent.name,
      status: 'code_written',
      // Actual implementation would delegate to Claude
    };
  }

  private async executeReviewer(agent: Agent, _task: AgentTask): Promise<unknown> {
    // Reviewer analyzes code for issues
    return {
      agent: agent.name,
      status: 'reviewed',
      issues: [],
      // Actual implementation would run analysis
    };
  }

  private async executeTester(agent: Agent, _task: AgentTask): Promise<unknown> {
    // Tester runs and writes tests
    return {
      agent: agent.name,
      status: 'tested',
      // Actual implementation would run tests
    };
  }

  private async executeDeployer(agent: Agent, _task: AgentTask): Promise<unknown> {
    // Deployer handles deployments
    return {
      agent: agent.name,
      status: 'deployed',
      // Actual implementation would handle deployment
    };
  }

  // ===========================================
  // Helper Methods
  // ===========================================

  /**
   * Create a workflow from a simple description
   */
  createWorkflowFromDescription(
    description: string,
    _chatId: number,
    _projectPath?: string,
  ): Omit<AgentWorkflow, 'id' | 'createdAt'> {
    const tasks: AgentTask[] = [];

    // Analyze description and create appropriate workflow
    const lowerDesc = description.toLowerCase();

    if (lowerDesc.includes('fix') || lowerDesc.includes('bug')) {
      // Bug fix workflow: Scout -> Builder -> Tester
      const scout = this.getAvailableAgent('scout');
      const builder = this.getAvailableAgent('builder');
      const tester = this.getAvailableAgent('tester');

      if (scout && builder && tester) {
        tasks.push(
          {
            agentId: scout.id,
            taskId: this.generateTaskId(),
            dependencies: [],
            status: 'pending',
          },
          {
            agentId: builder.id,
            taskId: this.generateTaskId(),
            dependencies: [tasks[0].taskId],
            status: 'pending',
          },
          {
            agentId: tester.id,
            taskId: this.generateTaskId(),
            dependencies: [tasks[1].taskId],
            status: 'pending',
          },
        );
      }
    } else if (lowerDesc.includes('review')) {
      // Review workflow: Scout -> Reviewer
      const scout = this.getAvailableAgent('scout');
      const reviewer = this.getAvailableAgent('reviewer');

      if (scout && reviewer) {
        tasks.push(
          {
            agentId: scout.id,
            taskId: this.generateTaskId(),
            dependencies: [],
            status: 'pending',
          },
          {
            agentId: reviewer.id,
            taskId: this.generateTaskId(),
            dependencies: [tasks[0].taskId],
            status: 'pending',
          },
        );
      }
    } else {
      // Default workflow: Scout -> Builder -> Reviewer -> Tester
      const scout = this.getAvailableAgent('scout');
      const builder = this.getAvailableAgent('builder');
      const reviewer = this.getAvailableAgent('reviewer');
      const tester = this.getAvailableAgent('tester');

      if (scout && builder) {
        tasks.push({
          agentId: scout.id,
          taskId: this.generateTaskId(),
          dependencies: [],
          status: 'pending',
        });
        const builderTask: AgentTask = {
          agentId: builder.id,
          taskId: this.generateTaskId(),
          dependencies: [tasks[0].taskId],
          status: 'pending',
        };
        tasks.push(builderTask);

        if (reviewer) {
          const reviewerTask: AgentTask = {
            agentId: reviewer.id,
            taskId: this.generateTaskId(),
            dependencies: [builderTask.taskId],
            status: 'pending',
          };
          tasks.push(reviewerTask);

          if (tester) {
            tasks.push({
              agentId: tester.id,
              taskId: this.generateTaskId(),
              dependencies: [reviewerTask.taskId],
              status: 'pending',
            });
          }
        }
      }
    }

    return {
      name: `Workflow: ${description.substring(0, 50)}`,
      description,
      tasks,
      status: 'pending' as const,
    };
  }

  private generateAgentId(): string {
    return `agent-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateWorkflowId(): string {
    return `workflow-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateTaskId(): string {
    return `agent-task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Global singleton
let globalOrchestrator: AgentOrchestrator | null = null;

export function getOrchestrator(): AgentOrchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new AgentOrchestrator();
  }
  return globalOrchestrator;
}
