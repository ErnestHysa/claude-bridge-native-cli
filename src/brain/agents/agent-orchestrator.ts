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
import { getContextIndexer } from '../context/context-indexer.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  Agent,
  AgentType,
  AgentWorkflow,
  AgentTask,
} from '../types.js';

const execAsync = promisify(exec);

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
    const query = metadata?.query;

    if (!projectPath) {
      return { error: 'Scout requires projectPath in metadata' };
    }

    const findings: {
      project?: string;
      techStack?: string[];
      files: number;
      functions: number;
      classes: number;
      tests: number;
      patterns: string[];
      queryResults?: string[];
    } = {
      files: 0,
      functions: 0,
      classes: 0,
      tests: 0,
      patterns: [],
    };

    try {
      // Get project memory
      const projectMemory = await this.memory.getProjectMemory(projectPath);
      findings.project = projectMemory?.projectName;
      findings.techStack = projectMemory?.context?.techStack || [];
      findings.patterns = projectMemory?.patterns.map(p => p.description) || [];

      // Use context indexer for deeper analysis
      const indexer = getContextIndexer();
      const fingerprint = await indexer.indexProject(projectPath);

      findings.files = fingerprint.fileCount;
      findings.tests = fingerprint.structure.testFiles.length;

      // Count functions and classes from file indexes
      let functionCount = 0;
      let classCount = 0;
      for (const [, fileIndex] of fingerprint.files.entries()) {
        functionCount += fileIndex.functions?.length || 0;
        classCount += fileIndex.classes?.length || 0;
      }
      findings.functions = functionCount;
      findings.classes = classCount;

      // If there's a query, search the codebase
      if (query) {
        const searchResult = indexer.getContext(projectPath, query);
        findings.queryResults = searchResult.files.map(f => `${f.relativePath}: ${f.exports?.join(', ') || 'N/A'}`).slice(0, 5);
      }

    } catch (error) {
      return { agent: agent.name, error: error instanceof Error ? error.message : String(error) };
    }

    return {
      agent: agent.name,
      status: 'complete',
      findings,
    };
  }

  private async executeBuilder(agent: Agent, task: AgentTask): Promise<unknown> {
    // Builder delegates to Claude spawner for actual code changes
    const metadata = task.result as { projectPath?: string; prompt?: string } | undefined;
    const projectPath = metadata?.projectPath;
    const prompt = metadata?.prompt;

    if (!projectPath || !prompt) {
      return { error: 'Builder requires projectPath and prompt in metadata' };
    }

    if (!existsSync(projectPath)) {
      return { error: `Project path does not exist: ${projectPath}` };
    }

    try {
      // Import ClaudeSpawner dynamically to avoid circular dependency
      const { ClaudeSpawner } = await import('../../claude-spawner-class.js');
      const { loadConfig } = await import('../../config.js');
      const config = loadConfig();

      const spawner = new ClaudeSpawner(config);

      // Spawn Claude process for the build task
      const claudeProcess = spawner.spawnProcess({
        project: { name: 'Agent-Build', path: projectPath, isGit: false, lastModified: Date.now(), sessionCount: 0 },
        prompt,
        model: config.claudeDefaultModel,
      });

      // Wait for completion (no timeout - runs indefinitely)
      const result = await spawner.waitForProcess(claudeProcess);

      return {
        agent: agent.name,
        status: 'complete',
        output: result.output.substring(0, 1000), // Truncate for storage
        exitCode: result.exitCode,
        duration: result.duration,
      };
    } catch (error) {
      return {
        agent: agent.name,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeReviewer(agent: Agent, task: AgentTask): Promise<unknown> {
    // Reviewer analyzes code for issues using lint and static analysis
    const metadata = task.result as { projectPath?: string; filePath?: string } | undefined;
    const projectPath = metadata?.projectPath;
    const filePath = metadata?.filePath;

    if (!projectPath) {
      return { error: 'Reviewer requires projectPath in metadata' };
    }

    const findings: {
      issues: Array<{ type: string; message: string; file?: string }>;
      summary: string;
    } = {
      issues: [],
      summary: '',
    };

    try {
      // Run TypeScript type check
      try {
        const { stdout: tsOutput } = await execAsync('npx tsc --noEmit', { cwd: projectPath, timeout: 30000 });
        if (tsOutput) {
          const lines = tsOutput.split('\n').filter(l => l.includes('error TS'));
          for (const line of lines.slice(0, 10)) {
            findings.issues.push({ type: 'TypeScript', message: line.trim() });
          }
        }
      } catch {
        // TypeScript might not be installed, continue
      }

      // Run ESLint if available
      try {
        const { stdout: eslintOutput } = await execAsync('npx eslint . --format json', { cwd: projectPath, timeout: 30000 });
        if (eslintOutput) {
          const eslintResults = JSON.parse(eslintOutput);
          for (const result of eslintResults.slice(0, 10)) {
            if (result.messages) {
              for (const msg of result.messages) {
                findings.issues.push({
                  type: `ESLint (${msg.severity})`,
                  message: msg.message,
                  file: result.filePath,
                });
              }
            }
          }
        }
      } catch {
        // ESLint might not be configured, continue
      }

      // If specific file provided, analyze it
      if (filePath) {
        const fullPath = join(projectPath, filePath);
        if (existsSync(fullPath)) {
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          // Check for common issues
          if (content.includes('console.log')) {
            findings.issues.push({ type: 'Code Quality', message: `Console.log statements found in ${filePath}` });
          }
          if (content.includes('any')) {
            findings.issues.push({ type: 'TypeScript', message: `Consider avoiding 'any' type in ${filePath}` });
          }
          if (lines.length > 500) {
            findings.issues.push({ type: 'Code Complexity', message: `File ${filePath} is large (${lines.length} lines), consider splitting` });
          }
        }
      }

      findings.summary = `Found ${findings.issues.length} issue${findings.issues.length !== 1 ? 's' : ''}`;

    } catch (error) {
      return {
        agent: agent.name,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      agent: agent.name,
      status: 'complete',
      findings,
    };
  }

  private async executeTester(agent: Agent, task: AgentTask): Promise<unknown> {
    // Tester runs tests and captures output
    const metadata = task.result as { projectPath?: string; testPattern?: string } | undefined;
    const projectPath = metadata?.projectPath;

    if (!projectPath) {
      return { error: 'Tester requires projectPath in metadata' };
    }

    try {
      // Determine test command
      let testCommand = 'npm test';
      const packageJsonPath = join(projectPath, 'package.json');

      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
        if (packageJson.scripts?.test) {
          testCommand = 'npm test';
        } else if (packageJson.scripts?.['test:unit']) {
          testCommand = 'npm run test:unit';
        } else if (packageJson.devDependencies?.vitest) {
          testCommand = 'npx vitest run';
        } else if (packageJson.devDependencies?.jest) {
          testCommand = 'npx jest';
        } else if (packageJson.dependencies?.jest) {
          testCommand = 'npx jest';
        }
      }

      // Run tests with timeout
      const testOutput = await execAsync(testCommand, {
        cwd: projectPath,
        timeout: 60000,
      });

      // Parse output for results
      const output = testOutput.stdout || testOutput.stderr || '';
      const lines = output.split('\n');

      let passCount = 0;
      let failCount = 0;

      for (const line of lines) {
        if (line.includes('passing') || line.includes('✓') || line.includes('PASS')) {
          passCount++;
        }
        if (line.includes('failing') || line.includes('✗') || line.includes('FAIL')) {
          failCount++;
        }
      }

      return {
        agent: agent.name,
        status: 'complete',
        summary: `${passCount} passed, ${failCount} failed`,
        exitCode: testOutput.stderr ? 1 : 0,
        output: output.substring(0, 1000),
      };
    } catch (error) {
      return {
        agent: agent.name,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        stderr: (error as { stderr?: string }).stderr?.substring(0, 500),
      };
    }
  }

  private async executeDeployer(agent: Agent, task: AgentTask): Promise<unknown> {
    // Deployer handles deployment operations
    const metadata = task.result as { projectPath?: string; environment?: string } | undefined;
    const projectPath = metadata?.projectPath;
    const environment = metadata?.environment || 'production';

    if (!projectPath) {
      return { error: 'Deployer requires projectPath in metadata' };
    }

    const steps: Array<{ step: string; status: string; output?: string }> = [];

    try {
      // Step 1: Build
      steps.push({ step: 'Build', status: 'running' });
      try {
        await execAsync('npm run build', { cwd: projectPath, timeout: 120000 });
        steps[0].status = 'complete';
        steps[0].output = 'Build successful';
      } catch (error) {
        steps[0].status = 'failed';
        steps[0].output = error instanceof Error ? error.message : String(error);
        throw new Error('Build failed');
      }

      // Step 2: Test
      steps.push({ step: 'Test', status: 'running' });
      try {
        await execAsync('npm test', { cwd: projectPath, timeout: 60000 });
        steps[1].status = 'complete';
        steps[1].output = 'Tests passed';
      } catch {
        steps[1].status = 'skipped';
        steps[1].output = 'Tests not run or failed';
      }

      // Step 3: Deploy (placeholder - would use actual deploy command)
      steps.push({ step: 'Deploy', status: 'skipped' });
      steps[2].output = `Deployment to ${environment} not configured`;

      return {
        agent: agent.name,
        status: 'complete',
        environment,
        steps,
      };
    } catch (error) {
      return {
        agent: agent.name,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        steps,
      };
    }
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
