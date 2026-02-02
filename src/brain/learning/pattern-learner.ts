/**
 * Pattern Learner - Automatic pattern learning from codebase
 *
 * Analyzes code to automatically detect and learn:
 * - Naming conventions
 * - Preferred libraries and frameworks
 * - Code structure preferences
 * - Common workflows and patterns
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getContextIndexer } from '../context/context-indexer.js';
import { getMemoryStore } from '../memory/memory-store.js';

// Pattern interfaces
export interface NamingConvention {
  type: 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case' | 'UPPER_CASE';
  confidence: number;
  examples: string[];
}

export interface LibraryUsage {
  name: string;
  importCount: number;
  usageCount: number;
  lastUsed: number;
}

export interface CodeStructure {
  filePattern: string;
  description: string;
  confidence: number;
}

export interface WorkflowPattern {
  name: string;
  description: string;
  steps: string[];
  confidence: number;
}

export interface LearnedPatterns {
  projectPath: string;
  namingConventions: Map<string, NamingConvention>;
  libraries: Map<string, LibraryUsage>;
  structures: CodeStructure[];
  workflows: WorkflowPattern[];
  lastAnalyzed: number;
}

/**
 * Pattern Learner class
 */
export class PatternLearner {
  private memory = getMemoryStore();

  /**
   * Analyze a project and learn its patterns
   */
  async learnPatterns(projectPath: string): Promise<LearnedPatterns> {
    const patterns: LearnedPatterns = {
      projectPath,
      namingConventions: new Map(),
      libraries: new Map(),
      structures: [],
      workflows: [],
      lastAnalyzed: Date.now(),
    };

    // Get project fingerprint
    const indexer = getContextIndexer();
    const fingerprint = await indexer.indexProject(projectPath);

    // Analyze each file for patterns
    const fileContents = new Map<string, string>();

    for (const [filePath] of fingerprint.files.entries()) {
      const fullPath = join(projectPath, filePath);

      if (!existsSync(fullPath)) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');
        fileContents.set(filePath, content);

        // Learn from this file
        await this.analyzeFile(content, filePath, patterns);
      } catch {
        // Skip files that can't be read
      }
    }

    // Learn from project structure
    await this.analyzeProjectStructure(fingerprint, patterns);

    // Learn workflows from common patterns
    await this.learnWorkflows(fileContents, patterns);

    // Save learned patterns to memory
    await this.savePatterns(projectPath, patterns);

    return patterns;
  }

  /**
   * Analyze a single file for patterns
   */
  private async analyzeFile(
    content: string,
    filePath: string,
    patterns: LearnedPatterns
  ): Promise<void> {
    // Detect naming conventions
    this.detectNamingConventions(content, filePath, patterns);

    // Detect library usage
    this.detectLibraries(content, filePath, patterns);

    // Detect code structures
    this.detectCodeStructures(content, filePath, patterns);
  }

  /**
   * Detect naming conventions in code
   */
  private detectNamingConventions(
    content: string,
    _filePath: string,
    patterns: LearnedPatterns
  ): void {
    const conventions: Map<string, { type: NamingConvention['type']; count: number }> = new Map();

    // Variable naming patterns
    const variablePatterns = [
      { pattern: /(?:const|let|var)\s+([a-z][a-zA-Z0-9]*)\s*=/g, type: 'camelCase' as const },
      { pattern: /(?:const|let|var)\s+([a-z][a-z0-9_]*)\s*=/g, type: 'snake_case' as const },
      { pattern: /(?:const|let|var)\s+([A-Z][a-zA-Z0-9]*)\s*=/g, type: 'PascalCase' as const },
      { pattern: /(?:const|let|var)\s+([A-Z0-9_]*)\s*=/g, type: 'UPPER_CASE' as const },
    ];

    // Function naming patterns
    const functionPatterns = [
      { pattern: /function\s+([a-z][a-zA-Z0-9]*)/g, type: 'camelCase' as const },
      { pattern: /function\s+([A-Z][a-zA-Z0-9]*)/g, type: 'PascalCase' as const },
      { pattern: /([a-z][a-z0-9_]*)\s*\(/g, type: 'snake_case' as const },
    ];

    // Class naming
    const classPatterns = [
      { pattern: /class\s+([A-Z][a-zA-Z0-9]*)/g, type: 'PascalCase' as const },
    ];

    const allPatterns = [
      ...variablePatterns.map(p => ({ ...p, category: 'variable' })),
      ...functionPatterns.map(p => ({ ...p, category: 'function' })),
      ...classPatterns.map(p => ({ ...p, category: 'class' })),
    ];

    for (const { pattern, type, category } of allPatterns) {
      while (pattern.exec(content) !== null) {
        const key = `${category}:${type}`;

        if (!conventions.has(key)) {
          conventions.set(key, { type, count: 0 });
        }
        conventions.get(key)!.count++;
      }
    }

    // Determine dominant conventions
    for (const [key, { type, count }] of conventions) {
      const [category] = key.split(':');
      const conventionKey = `${category}:default`;

      if (!patterns.namingConventions.has(conventionKey)) {
        patterns.namingConventions.set(conventionKey, {
          type,
          confidence: 0,
          examples: [],
        });
      }

      const existing = patterns.namingConventions.get(conventionKey)!;
      if (count > existing.confidence) {
        existing.confidence = count;
      }
    }
  }

  /**
   * Detect library usage
   */
  private detectLibraries(
    content: string,
    _filePath: string,
    patterns: LearnedPatterns
  ): void {
    // Detect import statements
    const importPatterns = [
      // ES6 imports
      /import\s+.*?\s+from\s+['"]([^/'"'].*?)['"]/g,
      /import\s+['"]([^/'"'].*?)['"]/g,
      // Require statements
      /require\s*\(\s*['"]([^/'"'].*?)['"]\s*\)/g,
    ];

    for (const pattern of importPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const libName = match[1];

        if (!patterns.libraries.has(libName)) {
          patterns.libraries.set(libName, {
            name: libName,
            importCount: 0,
            usageCount: 0,
            lastUsed: Date.now(),
          });
        }

        const lib = patterns.libraries.get(libName)!;
        lib.importCount++;
        lib.lastUsed = Date.now();
      }
    }

    // Count usage of common libraries in code
    for (const [libName, lib] of patterns.libraries) {
      const usagePattern = new RegExp(`\\b${libName}\\b`, 'g');
      const matches = content.match(usagePattern);
      if (matches) {
        lib.usageCount += matches.length;
      }
    }
  }

  /**
   * Detect code structures
   */
  private detectCodeStructures(
    content: string,
    filePath: string,
    patterns: LearnedPatterns
  ): void {
    const structures: CodeStructure[] = [];

    // Detect common patterns
    if (content.includes('class ') && content.includes('extends')) {
      structures.push({
        filePattern: filePath.includes('/test/') || filePath.includes('/spec/') ? 'test-class' : 'class-with-inheritance',
        description: 'Classes using inheritance',
        confidence: 0.8,
      });
    }

    if (content.includes('interface ') || content.includes('type ')) {
      structures.push({
        filePattern: 'typescript-types',
        description: 'TypeScript type definitions',
        confidence: 0.9,
      });
    }

    if (content.includes('describe(') || content.includes('it(')) {
      structures.push({
        filePattern: 'test-framework',
        description: 'Test framework (Jest/Mocha style)',
        confidence: 0.95,
      });
    }

    if (content.includes('useState') || content.includes('useEffect')) {
      structures.push({
        filePattern: 'react-hooks',
        description: 'React functional components',
        confidence: 0.9,
      });
    }

    if (content.includes('@Component') || content.includes('@Input')) {
      structures.push({
        filePattern: 'angular-decorators',
        description: 'Angular components',
        confidence: 0.9,
      });
    }

    if (content.includes('async ') || content.includes('await ')) {
      structures.push({
        filePattern: 'async-await',
        description: 'Async/await pattern',
        confidence: 0.7,
      });
    }

    if (content.includes('.map(') || content.includes('.filter(') || content.includes('.reduce(')) {
      structures.push({
        filePattern: 'functional-array',
        description: 'Functional array methods',
        confidence: 0.6,
      });
    }

    patterns.structures.push(...structures);
  }

  /**
   * Analyze project-level structure
   */
  private async analyzeProjectStructure(
    fingerprint: { structure: { directories: string[]; entryPoints: string[] } },
    patterns: LearnedPatterns
  ): Promise<void> {
    // Detect project type from directories
    const dirs = fingerprint.structure.directories;

    if (dirs.includes('src/components') || dirs.includes('src/app')) {
      patterns.structures.push({
        filePattern: 'component-architecture',
        description: 'Component-based architecture',
        confidence: 0.8,
      });
    }

    if (dirs.includes('src/lib') || dirs.includes('src/utils')) {
      patterns.structures.push({
        filePattern: 'lib-utils-separation',
        description: 'Library utilities separation',
        confidence: 0.7,
      });
    }

    if (dirs.includes('src/hooks') || dirs.includes('src/composables')) {
      patterns.structures.push({
        filePattern: 'hooks-pattern',
        description: 'Custom hooks pattern',
        confidence: 0.85,
      });
    }

    if (dirs.includes('__tests__') || dirs.includes('test') || dirs.includes('tests')) {
      patterns.structures.push({
        filePattern: 'test-directory',
        description: 'Dedicated test directory',
        confidence: 0.9,
      });
    }

    if (dirs.includes('api') || dirs.includes('routes')) {
      patterns.structures.push({
        filePattern: 'api-routes',
        description: 'API/routes directory',
        confidence: 0.8,
      });
    }
  }

  /**
   * Learn common workflows from code patterns
   */
  private async learnWorkflows(
    fileContents: Map<string, string>,
    patterns: LearnedPatterns
  ): Promise<void> {
    // Detect common workflows by analyzing function sequences

    // Error handling pattern
    let tryCatchCount = 0;
    let tryFinallyCount = 0;
    for (const content of fileContents.values()) {
      tryCatchCount += (content.match(/try\s*{/g) || []).length;
      tryFinallyCount += (content.match(/finally\s*{/g) || []).length;
    }

    if (tryCatchCount > 5) {
      patterns.workflows.push({
        name: 'error-handling',
        description: 'Try-catch error handling',
        steps: ['try block', 'catch block', 'error handling'],
        confidence: Math.min(tryCatchCount / fileContents.size, 1),
      });
    }

    // API call pattern
    let fetchCount = 0;
    let axiosCount = 0;
    for (const content of fileContents.values()) {
      fetchCount += (content.match(/fetch\s*\(/g) || []).length;
      axiosCount += (content.match(/axios\./g) || []).length;
    }

    if (fetchCount > 0 || axiosCount > 0) {
      patterns.workflows.push({
        name: 'api-calls',
        description: 'HTTP API calls',
        steps: ['request', 'response handling', 'error handling'],
        confidence: Math.min((fetchCount + axiosCount) / fileContents.size, 1),
      });
    }

    // Database pattern
    let dbPatterns = 0;
    for (const content of fileContents.values()) {
      dbPatterns += (content.match(/\.(find|create|update|delete|save|query)/g) || []).length;
      dbPatterns += (content.match(/SELECT|INSERT|UPDATE|DELETE/gi) || []).length;
    }

    if (dbPatterns > 5) {
      patterns.workflows.push({
        name: 'database-operations',
        description: 'Database CRUD operations',
        steps: ['connect', 'query', 'process results', 'close'],
        confidence: Math.min(dbPatterns / 50, 1),
      });
    }

    // Event handling pattern
    let eventHandlerCount = 0;
    for (const content of fileContents.values()) {
      eventHandlerCount += (content.match(/addEventListener|on[A-Z]/g) || []).length;
    }

    if (eventHandlerCount > 5) {
      patterns.workflows.push({
        name: 'event-handling',
        description: 'Event-driven architecture',
        steps: ['register handler', 'event occurs', 'handle event'],
        confidence: Math.min(eventHandlerCount / 20, 1),
      });
    }
  }

  /**
   * Save learned patterns to memory
   */
  private async savePatterns(projectPath: string, patterns: LearnedPatterns): Promise<void> {
    // Add individual patterns to memory (id is generated by addPattern)
    for (const [key, convention] of patterns.namingConventions) {
      await this.memory.addPattern(projectPath, {
        name: `naming-${key}`,
        description: `Naming convention: ${convention.type} (confidence: ${convention.confidence})`,
        category: 'naming-convention',
        examples: convention.examples,
      });
    }

    for (const library of patterns.libraries.values()) {
      await this.memory.addPattern(projectPath, {
        name: `library-${library.name}`,
        description: `Library: ${library.name} (imported ${library.importCount} times)`,
        category: 'library',
        examples: [],
      });
    }

    for (const structure of patterns.structures) {
      await this.memory.addPattern(projectPath, {
        name: `structure-${structure.filePattern}`,
        description: `Structure: ${structure.description}`,
        category: 'code-structure',
        examples: [],
      });
    }

    // Store timestamp of last analysis
    await this.memory.setFact(`pattern-analysis:${projectPath}:lastAnalyzed`, patterns.lastAnalyzed);
  }

  /**
   * Get learned patterns for a project
   * Reconstructs LearnedPatterns from individually stored patterns
   */
  async getPatterns(projectPath: string): Promise<LearnedPatterns | null> {
    const projectMemory = await this.memory.getProjectMemory(projectPath);

    if (!projectMemory) {
      return null;
    }

    const namingConventions = new Map<string, NamingConvention>();
    const libraries = new Map<string, LibraryUsage>();
    const structures: CodeStructure[] = [];
    const workflows: WorkflowPattern[] = [];

    // Reconstruct patterns from stored patterns
    for (const pattern of projectMemory.patterns) {
      if (pattern.category === 'naming-convention') {
        const match = pattern.name.match(/^naming-(.+):(.+)$/);
        if (match) {
          const category = match[1];
          const typeStr = match[2];
          // Parse confidence from description
          const confidenceMatch = pattern.description.match(/confidence: ([\d.]+)/);
          const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0;

          namingConventions.set(category, {
            type: typeStr as NamingConvention['type'],
            confidence,
            examples: pattern.examples,
          });
        }
      } else if (pattern.category === 'library') {
        const match = pattern.name.match(/^library-(.+)$/);
        if (match) {
          const libName = match[1];
          // Parse import count from description
          const importMatch = pattern.description.match(/imported (\d+) times/);
          const importCount = importMatch ? parseInt(importMatch[1], 10) : 0;

          libraries.set(libName, {
            name: libName,
            importCount,
            usageCount: 0,
            lastUsed: Date.now(),
          });
        }
      } else if (pattern.category === 'code-structure') {
        structures.push({
          filePattern: pattern.name.replace(/^structure-/, ''),
          description: pattern.description,
          confidence: 0.8,
        });
      }
    }

    // Get last analyzed timestamp
    const lastAnalyzed = await this.memory.getFact(`pattern-analysis:${projectPath}:lastAnalyzed`) as number ?? Date.now();

    return {
      projectPath,
      namingConventions,
      libraries,
      structures,
      workflows,
      lastAnalyzed,
    };
  }

  /**
   * Get naming convention suggestion for a given context
   */
  async getNamingSuggestion(projectPath: string, context: 'variable' | 'function' | 'class'): Promise<string> {
    const patterns = await this.getPatterns(projectPath);
    if (!patterns) return 'camelCase';

    // Find most common convention for this context
    const contextPrefix = `${context}:`;
    let bestMatch = 'camelCase';
    let highestScore = 0;

    for (const [key, convention] of patterns.namingConventions) {
      if (key.startsWith(contextPrefix)) {
        if (convention.confidence > highestScore) {
          highestScore = convention.confidence;
          bestMatch = convention.type;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Get preferred libraries for a project
   */
  async getPreferredLibraries(projectPath: string): Promise<string[]> {
    const patterns = await this.getPatterns(projectPath);
    if (!patterns) return [];

    return Array.from(patterns.libraries.values())
      .sort((a, b) => b.importCount - a.importCount)
      .slice(0, 10)
      .map(l => l.name);
  }

  /**
   * Get code structure recommendations
   */
  async getStructureRecommendations(projectPath: string): Promise<CodeStructure[]> {
    const patterns = await this.getPatterns(projectPath);
    if (!patterns) return [];

    return patterns.structures
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  }

  /**
   * Generate code suggestion based on learned patterns
   */
  async generateCodeSuggestion(
    projectPath: string,
    _task: string
  ): Promise<string> {
    const patterns = await this.getPatterns(projectPath);
    if (!patterns) {
      return `// No learned patterns available for this project`;
    }

    const suggestions: string[] = [];

    // Suggest naming convention
    const namingConvention = await this.getNamingSuggestion(projectPath, 'function');
    suggestions.push(`// Use ${namingConvention} for function names`);

    // Suggest libraries
    const topLibs = Array.from(patterns.libraries.values())
      .sort((a, b) => b.importCount - a.importCount)
      .slice(0, 3);

    if (topLibs.length > 0) {
      suggestions.push(`// Available libraries: ${topLibs.map(l => l.name).join(', ')}`);
    }

    // Suggest structure
    const topStructures = patterns.structures
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 2);

    if (topStructures.length > 0) {
      suggestions.push(`// Project structure: ${topStructures.map(s => s.description).join(', ')}`);
    }

    return suggestions.join('\n');
  }
}

// Global singleton
let globalPatternLearner: PatternLearner | null = null;

export function getPatternLearner(): PatternLearner {
  if (!globalPatternLearner) {
    globalPatternLearner = new PatternLearner();
  }
  return globalPatternLearner;
}

export function resetPatternLearner(): void {
  globalPatternLearner = null;
}
