/**
 * Context Indexer - Maintains project context awareness
 *
 * Scans and indexes project structure for instant agentic awareness:
 * - File tree fingerprint
 * - Exports, imports, dependencies
 * - Functions, classes, types
 * - Watches for changes and updates incrementally
 *
 * Usage:
 * ```ts
 * const indexer = getContextIndexer();
 * await indexer.indexProject('/path/to/project');
 *
 * // Get context for a query
 * const context = await indexer.getContext('authentication');
 *
 * // Get file info
 * const fileInfo = indexer.getFileInfo('src/auth/login.ts');
 * ```
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { getMemoryStore } from '../memory/memory-store.js';

// File extensions to index
const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h',
]);

// Directories to skip
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target',
  '__pycache__', '.venv', 'venv', 'env',
  'coverage', '.next', '.nuxt',
  'brain', '.vscode', '.idea',
]);

// Maximum scan depth to prevent infinite loops
const MAX_SCAN_DEPTH = 50;

// File patterns to skip
const SKIP_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.d\.ts$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

export interface FileIndex {
  path: string;
  relativePath: string;
  size: number;
  modified: number;
  language: string;
  hash: string; // Simple hash for change detection
  exports?: string[];
  imports?: string[];
  classes?: string[];
  functions?: string[];
  types?: string[];
  lineCount: number;
}

export interface ProjectFingerprint {
  projectPath: string;
  projectName: string;
  indexedAt: number;
  files: Map<string, FileIndex>;
  fileCount: number;
  totalLines: number;
  languages: Record<string, number>; // language -> file count
  structure: {
    directories: string[];
    entryPoints: string[];
    configFiles: string[];
    testFiles: string[];
  };
  dependencies: {
    imports: Map<string, Set<string>>; // file -> imported modules
    exportedBy: Map<string, Set<string>>; // symbol -> files that export it
    importedBy: Map<string, Set<string>>; // file -> files that import it
  };
}

/**
 * Parse code for symbols (exports, imports, classes, functions, types)
 */
class CodeParser {
  /**
   * Detect language from extension
   */
  detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript-tsx',
      '.js': 'javascript',
      '.jsx': 'javascript-jsx',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
      '.rs': 'rust',
      '.go': 'go',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.json': 'json',
      '.md': 'markdown',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Parse TypeScript/JavaScript for symbols
   */
  parseTSJS(content: string, _filePath: string): Partial<FileIndex> {
    const result: Partial<FileIndex> = {
      exports: [],
      imports: [],
      classes: [],
      functions: [],
      types: [],
    };

    const lines = content.split('\n');
    const lineCount = lines.length;

    // Extract symbols using regex patterns
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip comments and empty lines
      if (line.startsWith('//') || line.startsWith('*') || line === '' || line.startsWith('/*')) {
        continue;
      }

      // Exports
      const exportMatch = line.match(/export\s+(?:(?:async\s+)?function|const|let|var|class)\s+(\w+)/);
      if (exportMatch) {
        result.exports!.push(exportMatch[1]);
      }
      // Only add default if not already added
      if (line.match(/export\s+default/) && !result.exports!.includes('default')) {
        result.exports!.push('default');
      }
      const exportNamedMatch = line.match(/export\s*\{\s*([^}]+)\s*\}/);
      if (exportNamedMatch) {
        const names = exportNamedMatch[1].split(',').map(n => n.trim().split('as')[0].trim());
        for (const name of names) {
          if (name && !result.exports!.includes(name)) {
            result.exports!.push(name);
          }
        }
      }

      // Imports
      const importMatch = line.match(/import\s+(?:(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)\s+from\s+)?['"]([^'"]+)['"]/);
      if (importMatch) {
        result.imports!.push(importMatch[1]);
      }
      const dynamicImportMatch = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      if (dynamicImportMatch) {
        result.imports!.push(dynamicImportMatch[1]);
      }

      // Classes
      const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
      if (classMatch) {
        result.classes!.push(classMatch[1]);
      }

      // Functions (standalone, not methods)
      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        result.functions!.push(funcMatch[1]);
      }
      const arrowFuncMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/);
      if (arrowFuncMatch) {
        result.functions!.push(arrowFuncMatch[1]);
      }

      // Types/Interfaces
      const typeMatch = line.match(/(?:export\s+)?(?:type|interface)\s+(\w+)/);
      if (typeMatch) {
        result.types!.push(typeMatch[1]);
      }

      // Enums
      const enumMatch = line.match(/(?:export\s+)?enum\s+(\w+)/);
      if (enumMatch) {
        result.types!.push(enumMatch[1]);
      }
    }

    return { ...result, lineCount };
  }

  /**
   * Parse Python for symbols
   */
  parsePython(content: string): Partial<FileIndex> {
    const result: Partial<FileIndex> = {
      exports: [],
      imports: [],
      classes: [],
      functions: [],
      types: [],
    };

    const lines = content.split('\n');
    let lineCount = 0;

    for (const line of lines) {
      lineCount++;
      const trimmed = line.trim();

      if (trimmed.startsWith('#') || trimmed === '') {
        continue;
      }

      // Imports
      const importMatch = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
      if (importMatch) {
        if (importMatch[1]) {
          result.imports!.push(importMatch[1]);
        }
        const modules = importMatch[2].split(',').map(m => m.trim().split('as')[0].trim());
        result.imports!.push(...modules);
      }

      // Classes
      const classMatch = trimmed.match(/^class\s+(\w+)/);
      if (classMatch) {
        result.classes!.push(classMatch[1]);
      }

      // Functions (def)
      const funcMatch = trimmed.match(/^def\s+(\w+)/);
      if (funcMatch) {
        result.functions!.push(funcMatch[1]);
      }

      // Type aliases (Python 3.12+)
      const typeMatch = trimmed.match(/^type\s+(\w+)\s*=/);
      if (typeMatch) {
        result.types!.push(typeMatch[1]);
      }
    }

    return { ...result, lineCount };
  }

  /**
   * Parse file based on language
   */
  parseFile(filePath: string, content: string): Partial<FileIndex> {
    const language = this.detectLanguage(filePath);

    if (language.startsWith('typescript') || language.startsWith('javascript')) {
      return { ...this.parseTSJS(content, filePath), language };
    }

    if (language === 'python') {
      return { ...this.parsePython(content), language };
    }

    // For other languages, just return basic info
    return {
      language,
      lineCount: content.split('\n').length,
    };
  }
}

/**
 * Context Indexer - Maintains project context
 */
export class ContextIndexer {
  private memory = getMemoryStore();
  private parser = new CodeParser();

  private projects = new Map<string, ProjectFingerprint>();
  private watchers = new Map<string, () => void>();
  private indexing = new Set<string>();

  /**
   * Index a project for context awareness
   */
  async indexProject(projectPath: string): Promise<ProjectFingerprint> {
    const normalizedPath = projectPath.replace(/\\/g, '/');

    if (this.indexing.has(normalizedPath)) {
      // Return a promise that resolves when current indexing completes
      // For now, return existing fingerprint or wait
      const existing = this.projects.get(normalizedPath);
      if (existing) return existing;
      // If no existing but indexing in progress, this is a race condition
      // Fall through to let it index again (will be deduped by indexing set)
    }

    this.indexing.add(normalizedPath);

    try {
      const projectName = basename(projectPath);
      const files = new Map<string, FileIndex>();

      let totalLines = 0;
      const languages: Record<string, number> = {};
      const structure = {
        directories: [] as string[],
        entryPoints: [] as string[],
        configFiles: [] as string[],
        testFiles: [] as string[],
      };

      const dependencies = {
        imports: new Map<string, Set<string>>(),
        exportedBy: new Map<string, Set<string>>(),
        importedBy: new Map<string, Set<string>>(),
      };

      // Scan all files
      await this.scanDirectory(projectPath, projectPath, files, structure, dependencies);

      // Aggregate stats
      for (const file of files.values()) {
        totalLines += file.lineCount;
        languages[file.language] = (languages[file.language] || 0) + 1;

        // Track entry points
        if (this.isEntryPoint(file)) {
          structure.entryPoints.push(file.relativePath);
        }

        // Track test files
        if (this.isTestFile(file)) {
          structure.testFiles.push(file.relativePath);
        }

        // Track config files
        if (this.isConfigFile(file)) {
          structure.configFiles.push(file.relativePath);
        }
      }

      const fingerprint: ProjectFingerprint = {
        projectPath: normalizedPath,
        projectName,
        indexedAt: Date.now(),
        files,
        fileCount: files.size,
        totalLines,
        languages,
        structure,
        dependencies,
      };

      this.projects.set(normalizedPath, fingerprint);

      // Save stats to memory
      const techStack = Object.keys(languages).filter(l => l !== 'unknown' && l !== 'json' && l !== 'markdown');
      await this.memory.updateProjectContext(projectPath, {
        techStack,
      });

      // Start watching for changes
      this.watchProject(projectPath);

      return fingerprint;
    } finally {
      this.indexing.delete(normalizedPath);
    }
  }

  /**
   * Scan directory recursively
   */
  private async scanDirectory(
    rootPath: string,
    currentPath: string,
    files: Map<string, FileIndex>,
    structure: Pick<ProjectFingerprint['structure'], 'directories'>,
    dependencies: ProjectFingerprint['dependencies'],
    depth = 0,
  ): Promise<void> {
    // Prevent infinite loops with max depth
    if (depth > MAX_SCAN_DEPTH) {
      console.warn(`[ContextIndexer] Max depth exceeded: ${currentPath}`);
      return;
    }

    try {
      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (SKIP_DIRECTORIES.has(entry.name)) {
            continue;
          }
          structure.directories.push(relativePath);
          await this.scanDirectory(rootPath, fullPath, files, structure, dependencies, depth + 1);
          continue;
        }

        if (!this.shouldIndexFile(fullPath, relativePath)) {
          continue;
        }

        // Index the file
        const fileIndex = await this.indexFile(rootPath, fullPath);
        if (fileIndex) {
          files.set(relativePath, fileIndex);

          // Track dependencies
          if (fileIndex.imports) {
            for (const imp of fileIndex.imports) {
              if (!dependencies.imports.has(relativePath)) {
                dependencies.imports.set(relativePath, new Set());
              }
              dependencies.imports.get(relativePath)!.add(imp);
            }
          }

          if (fileIndex.exports) {
            for (const exp of fileIndex.exports) {
              if (!dependencies.exportedBy.has(exp)) {
                dependencies.exportedBy.set(exp, new Set());
              }
              dependencies.exportedBy.get(exp)!.add(relativePath);
            }
          }
        }
      }
    } catch (err) {
      // Directory access error, skip with logging
      console.warn(`[ContextIndexer] Skipping directory: ${currentPath}`, err);
    }
  }

  /**
   * Index a single file
   */
  private async indexFile(projectPath: string, filePath: string): Promise<FileIndex | null> {
    try {
      const stats = await stat(filePath);
      const content = await readFile(filePath, 'utf-8');
      const relativePath = relative(projectPath, filePath).replace(/\\/g, '/');

      // Simple hash for change detection
      const hash = this.simpleHash(content);

      const parsed = this.parser.parseFile(filePath, content);

      return {
        path: filePath,
        relativePath,
        size: stats.size,
        modified: stats.mtimeMs,
        hash,
        lineCount: parsed.lineCount || 0,
        language: parsed.language || 'unknown',
        exports: parsed.exports,
        imports: parsed.imports,
        classes: parsed.classes,
        functions: parsed.functions,
        types: parsed.types,
      };
    } catch (err) {
      // File read/parse error, skip with logging
      console.warn(`[ContextIndexer] Skipping file: ${filePath}`, err);
      return null;
    }
  }

  /**
   * Check if file should be indexed
   */
  private shouldIndexFile(fullPath: string, relativePath: string): boolean {
    const ext = extname(fullPath).toLowerCase();

    if (!INDEXABLE_EXTENSIONS.has(ext)) {
      return false;
    }

    for (const pattern of SKIP_PATTERNS) {
      if (pattern.test(relativePath)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if file is an entry point
   */
  private isEntryPoint(file: FileIndex): boolean {
    const entryPoints = [
      'index.ts', 'index.js', 'index.tsx', 'index.jsx',
      'main.ts', 'main.js',
      'app.ts', 'app.js', 'App.tsx', 'App.jsx',
      'server.ts', 'server.js',
      'cli.ts', 'cli.js',
    ];
    const filename = basename(file.relativePath);
    return entryPoints.includes(filename);
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(file: FileIndex): boolean {
    return file.relativePath.includes('.test.') ||
           file.relativePath.includes('.spec.') ||
           file.relativePath.includes('/__tests__/') ||
           file.relativePath.includes('/test/') ||
           file.relativePath.includes('/tests/');
  }

  /**
   * Check if file is a config file
   */
  private isConfigFile(file: FileIndex): boolean {
    const configFiles = [
      'package.json', 'tsconfig.json', 'jsconfig.json',
      'vite.config.', 'webpack.config.', 'rollup.config.',
      'tailwind.config.', 'postcss.config.',
      '.eslintrc', 'eslint.config.',
      'pyproject.toml', 'setup.py', 'requirements.txt',
      'Cargo.toml', 'go.mod',
    ];
    return configFiles.some(cf => file.relativePath.includes(cf));
  }

  /**
   * Simple hash for content
   */
  private simpleHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < Math.min(content.length, 1000); i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get context for a query (search indexed files)
   */
  getContext(projectPath: string, query: string): {
    files: FileIndex[];
    symbols: string[];
    summary: string;
  } {
    const normalizedPath = projectPath.replace(/\\/g, '/');
    const fingerprint = this.projects.get(normalizedPath);

    if (!fingerprint) {
      return { files: [], symbols: [], summary: 'Project not indexed' };
    }

    const queryLower = query.toLowerCase();
    const matchingFiles: FileIndex[] = [];
    const symbols = new Set<string>();

    for (const file of fingerprint.files.values()) {
      // Check filename match
      if (file.relativePath.toLowerCase().includes(queryLower)) {
        matchingFiles.push(file);
      }

      // Check symbols
      for (const type of ['exports', 'classes', 'functions', 'types'] as const) {
        for (const symbol of file[type] || []) {
          if (symbol.toLowerCase().includes(queryLower)) {
            matchingFiles.push(file);
            symbols.add(`${type.slice(0, -1)}:${symbol}`);
          }
        }
      }
    }

    const summary = `Found ${matchingFiles.length} file(s), ${symbols.size} symbol(s) in "${fingerprint.projectName}"`;

    return {
      files: Array.from(new Set(matchingFiles)),
      symbols: Array.from(symbols),
      summary,
    };
  }

  /**
   * Get file info
   */
  getFileInfo(projectPath: string, relativePath: string): FileIndex | undefined {
    const normalizedPath = projectPath.replace(/\\/g, '/');
    const fingerprint = this.projects.get(normalizedPath);
    return fingerprint?.files.get(relativePath);
  }

  /**
   * Get project fingerprint
   */
  getFingerprint(projectPath: string): ProjectFingerprint | undefined {
    const normalizedPath = projectPath.replace(/\\/g, '/');
    return this.projects.get(normalizedPath);
  }

  /**
   * Watch project for changes
   */
  private watchProject(projectPath: string): void {
    const normalizedPath = projectPath.replace(/\\/g, '/');

    if (this.watchers.has(normalizedPath)) {
      return;
    }

    // Debounced re-index
    let timeout: NodeJS.Timeout | null = null;

    const reindex = async () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(async () => {
        await this.indexProject(projectPath);
        console.log(`[ContextIndexer] Re-indexed: ${projectPath}`);
      }, 1000);
    };

    try {
      const watcher = fsWatch(projectPath, { recursive: true }, (_event, filename) => {
        if (filename && this.shouldIndexFile(join(projectPath, filename), filename)) {
          reindex();
        }
      });

      this.watchers.set(normalizedPath, () => watcher.close());
    } catch (err) {
      // Watch not supported or failed, log and continue
      console.warn(`[ContextIndexer] Watch failed for ${projectPath}:`, err);
    }
  }

  /**
   * Stop watching a project
   */
  unwatchProject(projectPath: string): void {
    const normalizedPath = projectPath.replace(/\\/g, '/');
    const stop = this.watchers.get(normalizedPath);
    if (stop) {
      stop();
      this.watchers.delete(normalizedPath);
    }
  }

  /**
   * Get all indexed projects
   */
  getIndexedProjects(): string[] {
    return Array.from(this.projects.keys());
  }
}

// Global singleton
let globalIndexer: ContextIndexer | null = null;

export function getContextIndexer(): ContextIndexer {
  if (!globalIndexer) {
    globalIndexer = new ContextIndexer();
  }
  return globalIndexer;
}
