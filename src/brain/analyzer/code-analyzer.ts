/**
 * Code Analyzer Service - Comprehensive code analysis
 *
 * Provides:
 * - Cyclomatic complexity scoring
 * - Security vulnerability scanning
 * - Code duplication detection
 * - Dependency analysis
 * - Actionable insights
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getContextIndexer } from '../context/context-indexer.js';

const execAsync = promisify(exec);

// Analysis result interfaces
export interface ComplexityResult {
  file: string;
  complexity: number;
  functions: Array<{ name: string; complexity: number; line: number }>;
  averageComplexity: number;
  rating: 'low' | 'medium' | 'high' | 'very-high';
}

export interface SecurityResult {
  file: string;
  issues: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    line?: number;
    message: string;
    rule?: string;
  }>;
  score: number; // 0-100, higher is better
}

export interface DuplicationResult {
  duplicates: Array<{
    fragment1: { file: string; startLine: number; endLine: number };
    fragment2: { file: string; startLine: number; endLine: number };
    lines: number;
    similarity: number;
  }>;
  totalDuplicateLines: number;
  duplicationPercentage: number;
}

export interface DependencyResult {
  dependencies: Array<{
    name: string;
    version: string;
    type: 'prod' | 'dev';
    vulnerabilities?: number;
    outdated?: boolean;
  }>;
  dependencyCount: number;
  hasPackageLock: boolean;
}

export interface CodeAnalysisReport {
  projectPath: string;
  timestamp: number;
  complexity: ComplexityResult[];
  security: SecurityResult[];
  duplication: DuplicationResult;
  dependencies: DependencyResult;
  summary: {
    totalFiles: number;
    highComplexityFiles: number;
    securityIssues: number;
    criticalSecurityIssues: number;
    duplicationRate: number;
  };
  recommendations: string[];
}

/**
 * Code Analyzer class
 */
export class CodeAnalyzer {
  /**
   * Analyze a project comprehensively
   */
  async analyzeProject(projectPath: string): Promise<CodeAnalysisReport> {
    const timestamp = Date.now();

    // Run all analyses in parallel where possible
    const [complexity, security, duplication, dependencies] = await Promise.all([
      this.analyzeComplexity(projectPath),
      this.analyzeSecurity(projectPath),
      this.analyzeDuplication(projectPath),
      this.analyzeDependencies(projectPath),
    ]);

    // Generate summary
    const summary = {
      totalFiles: complexity.length,
      highComplexityFiles: complexity.filter(c => c.rating === 'high' || c.rating === 'very-high').length,
      securityIssues: security.reduce((sum, s) => sum + s.issues.length, 0),
      criticalSecurityIssues: security.reduce((sum, s) => sum + s.issues.filter(i => i.severity === 'critical').length, 0),
      duplicationRate: duplication.duplicationPercentage,
    };

    // Generate recommendations
    const recommendations = this.generateRecommendations(complexity, security, duplication, dependencies);

    return {
      projectPath,
      timestamp,
      complexity,
      security,
      duplication,
      dependencies,
      summary,
      recommendations,
    };
  }

  /**
   * Analyze code complexity using cyclomatic complexity
   */
  async analyzeComplexity(projectPath: string): Promise<ComplexityResult[]> {
    const results: ComplexityResult[] = [];

    // Get project fingerprint
    const indexer = getContextIndexer();
    const fingerprint = await indexer.indexProject(projectPath);

    for (const [filePath] of fingerprint.files.entries()) {
      const fullPath = join(projectPath, filePath);

      // Skip non-source files
      if (!this.isSourceFile(filePath)) {
        continue;
      }

      try {
        const content = await readFile(fullPath, 'utf-8');
        const functions = this.extractFunctions(content, filePath);
        const complexityScores = functions.map(fn => ({
          name: fn.name,
          complexity: this.calculateComplexity(fn.content),
          line: fn.line,
        }));

        const avgComplexity = complexityScores.length > 0
          ? complexityScores.reduce((sum, fn) => sum + fn.complexity, 0) / complexityScores.length
          : 0;

        results.push({
          file: filePath,
          complexity: avgComplexity,
          functions: complexityScores,
          averageComplexity: avgComplexity,
          rating: this.getComplexityRating(avgComplexity),
        });
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * Analyze security vulnerabilities
   */
  async analyzeSecurity(projectPath: string): Promise<SecurityResult[]> {
    const results: SecurityResult[] = [];

    // Get project fingerprint
    const indexer = getContextIndexer();
    const fingerprint = await indexer.indexProject(projectPath);

    for (const [filePath] of fingerprint.files.entries()) {
      if (!this.isSourceFile(filePath)) {
        continue;
      }

      const fullPath = join(projectPath, filePath);
      try {
        const content = await readFile(fullPath, 'utf-8');
        const issues = this.scanForSecurityIssues(content, filePath);

        if (issues.length > 0) {
          const score = Math.max(0, 100 - (issues.length * 10) - issues.filter(i => i.severity === 'critical').length * 30);
          results.push({
            file: filePath,
            issues,
            score,
          });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * Analyze code duplication
   */
  async analyzeDuplication(projectPath: string): Promise<DuplicationResult> {
    const indexer = getContextIndexer();
    const fingerprint = await indexer.indexProject(projectPath);

    // Collect all source file contents
    const fileContents: Map<string, { lines: string[]; content: string }> = new Map();

    for (const [filePath] of fingerprint.files.entries()) {
      if (!this.isSourceFile(filePath)) {
        continue;
      }

      const fullPath = join(projectPath, filePath);
      try {
        const content = await readFile(fullPath, 'utf-8');
        fileContents.set(filePath, {
          lines: content.split('\n'),
          content,
        });
      } catch {
        // Skip files that can't be read
      }
    }

    // Find duplicates using token-based comparison
    const duplicates: Array<{
      fragment1: { file: string; startLine: number; endLine: number };
      fragment2: { file: string; startLine: number; endLine: number };
      lines: number;
      similarity: number;
    }> = [];

    const files = Array.from(fileContents.entries());
    const MIN_FRAGMENT_SIZE = 6;
    const SIMILARITY_THRESHOLD = 0.85;

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const [file1, data1] = files[i];
        const [file2, data2] = files[j];

        // Find similar fragments
        const fragments = this.findSimilarFragments(
          file1,
          data1.lines,
          file2,
          data2.lines,
          MIN_FRAGMENT_SIZE,
          SIMILARITY_THRESHOLD
        );

        duplicates.push(...fragments);
      }
    }

    // Calculate duplication metrics
    const totalLines = Array.from(fileContents.values())
      .reduce((sum, data) => sum + data.lines.length, 0);

    const duplicateLineSet = new Set<string>();
    for (const dup of duplicates) {
      for (let line = dup.fragment1.startLine; line <= dup.fragment1.endLine; line++) {
        duplicateLineSet.add(`${dup.fragment1.file}:${line}`);
      }
    }

    return {
      duplicates: duplicates.slice(0, 50), // Limit results
      totalDuplicateLines: duplicateLineSet.size,
      duplicationPercentage: totalLines > 0 ? (duplicateLineSet.size / totalLines) * 100 : 0,
    };
  }

  /**
   * Analyze dependencies
   */
  async analyzeDependencies(projectPath: string): Promise<DependencyResult> {
    const packageJsonPath = join(projectPath, 'package.json');
    const packageLockPath = join(projectPath, 'package-lock.json');
    const yarnLockPath = join(projectPath, 'yarn.lock');

    if (!existsSync(packageJsonPath)) {
      return {
        dependencies: [],
        dependencyCount: 0,
        hasPackageLock: existsSync(packageLockPath) || existsSync(yarnLockPath),
      };
    }

    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      const dependencies: Array<{
        name: string;
        version: string;
        type: 'prod' | 'dev';
        vulnerabilities?: number;
        outdated?: boolean;
      }> = [];

      // Process prod dependencies
      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          dependencies.push({
            name,
            version: version as string,
            type: 'prod',
          });
        }
      }

      // Process dev dependencies
      if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
          dependencies.push({
            name,
            version: version as string,
            type: 'dev',
          });
        }
      }

      // Check for vulnerabilities using npm audit
      try {
        const { stdout } = await execAsync('npm audit --json', {
          cwd: projectPath,
          timeout: 30000,
        });

        const auditResult = JSON.parse(stdout);
        const vulns = auditResult.vulnerabilities || {};

        for (const dep of dependencies) {
          if (vulns[dep.name]) {
            const vulnData = vulns[dep.name];
            dep.vulnerabilities = vulnData?.via?.length || Object.keys(vulnData || {}).length;
          }
        }
      } catch {
        // npm audit failed, continue without vulnerability data
      }

      return {
        dependencies,
        dependencyCount: dependencies.length,
        hasPackageLock: existsSync(packageLockPath) || existsSync(yarnLockPath),
      };
    } catch {
      return {
        dependencies: [],
        dependencyCount: 0,
        hasPackageLock: false,
      };
    }
  }

  // ===========================================
  // Helper Methods
  // ===========================================

  private isSourceFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cs', '.php'];
    return sourceExtensions.includes(ext);
  }

  private extractFunctions(content: string, _filePath: string): Array<{ name: string; content: string; line: number }> {
    const functions: Array<{ name: string; content: string; line: number }> = [];

    // Simple pattern-based extraction (works for JS/TS)
    const patterns = [
      /function\s+(\w+)/g,
      /const\s+(\w+)\s*=\s*(?:async\s+)?\(.*\)\s*=>/g,
      /(\w+)\s*\([^)]*\)\s*{/g, // Method style
      /export\s+(?:const|function)\s+(\w+)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        const startPos = match.index;
        const line = content.substring(0, startPos).split('\n').length;

        // Extract function body (simplified)
        let braceCount = 0;
        let foundBrace = false;
        let endPos = startPos;

        for (let i = startPos; i < content.length; i++) {
          if (content[i] === '{') {
            braceCount++;
            foundBrace = true;
          } else if (content[i] === '}') {
            braceCount--;
            if (foundBrace && braceCount === 0) {
              endPos = i + 1;
              break;
            }
          }
        }

        functions.push({
          name,
          content: content.substring(startPos, endPos),
          line,
        });
      }
    }

    return functions;
  }

  private calculateComplexity(functionContent: string): number {
    // Cyclomatic complexity: count decision points
    const decisionKeywords = [
      /\bif\b/g,
      /\belse\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bswitch\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\&&/g,
      /\|\|/g,
      /\?/g,
    ];

    let complexity = 1; // Base complexity

    for (const pattern of decisionKeywords) {
      const matches = functionContent.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  private getComplexityRating(complexity: number): 'low' | 'medium' | 'high' | 'very-high' {
    if (complexity <= 5) return 'low';
    if (complexity <= 10) return 'medium';
    if (complexity <= 20) return 'high';
    return 'very-high';
  }

  private scanForSecurityIssues(content: string, _filePath: string): Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    line?: number;
    message: string;
    rule?: string;
  }> {
    const issues: Array<{
      type: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      line?: number;
      message: string;
      rule?: string;
    }> = [];

    const lines = content.split('\n');

    // Security patterns to check
    const patterns: Array<{ pattern: RegExp; type: string; severity: 'low' | 'medium' | 'high' | 'critical'; message: string; rule?: string }> = [
      // Critical issues
      { pattern: /eval\s*\(/, type: 'code-injection', severity: 'critical', message: 'Use of eval() allows arbitrary code execution', rule: 'no-eval' },
      { pattern: /innerHTML\s*=/, type: 'xss', severity: 'high', message: 'Direct innerHTML assignment can lead to XSS', rule: 'no-inner-html' },
      { pattern: /document\.write\s*\(/, type: 'xss', severity: 'high', message: 'document.write() can lead to XSS', rule: 'no-document-write' },
      { pattern: /dangerouslySetInnerHTML/, type: 'xss', severity: 'high', message: 'dangerouslySetInnerHTML can lead to XSS', rule: 'react-dangerously-set-inner-html' },

      // High severity issues
      { pattern: /\.exec\s*\(\s*\$\{/, type: 'code-injection', severity: 'high', message: 'Dynamic code execution with template literals', rule: 'no-dynamic-injection' },
      { pattern: /new\s+Function\s*\(/, type: 'code-injection', severity: 'high', message: 'Function constructor allows arbitrary code execution', rule: 'no-new-func' },
      { pattern: /setTimeout\s*\(\s*["']|setInterval\s*\(\s*["']/, type: 'code-injection', severity: 'medium', message: 'setTimeout/setInterval with string can execute code', rule: 'no-implied-eval' },

      // Medium severity issues
      { pattern: /console\.(log|debug|info)/, type: 'information-leak', severity: 'low', message: 'Console logging can leak sensitive information', rule: 'no-console' },
      { pattern: /process\.env\./, type: 'env-config', severity: 'low', message: 'Environment variable usage', rule: 'no-process-env' },

      // Sensitive data patterns
      { pattern: /password\s*[:=]/i, type: 'sensitive-data', severity: 'medium', message: 'Possible hardcoded password', rule: 'no-hardcoded-passwords' },
      { pattern: /api[_-]?key\s*[:=]/i, type: 'sensitive-data', severity: 'high', message: 'Possible hardcoded API key', rule: 'no-hardcoded-secrets' },
      { pattern: /secret\s*[:=]/i, type: 'sensitive-data', severity: 'high', message: 'Possible hardcoded secret', rule: 'no-hardcoded-secrets' },
      { pattern: /token\s*[:=]/i, type: 'sensitive-data', severity: 'medium', message: 'Possible hardcoded token', rule: 'no-hardcoded-secrets' },

      // Weak crypto
      { pattern: /md5\s*\(/i, type: 'weak-crypto', severity: 'medium', message: 'MD5 is a weak hash algorithm', rule: 'no-md5' },
      { pattern: /sha1\s*\(/i, type: 'weak-crypto', severity: 'medium', message: 'SHA1 is a weak hash algorithm', rule: 'no-sha1' },

      // SQL injection patterns
      { pattern: /query\s*\+\s*["']|["']\s*\+\s*query/i, type: 'sql-injection', severity: 'critical', message: 'Possible SQL injection via string concatenation', rule: 'no-sql-injection' },

      // Path traversal
      { pattern: /path\s*\+\s*\$\{|path\s*\+=.*req/i, type: 'path-traversal', severity: 'high', message: 'Possible path traversal vulnerability', rule: 'no-path-traversal' },
    ];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      for (const { pattern, type, severity, message, rule } of patterns) {
        if (pattern.test(line)) {
          issues.push({
            type,
            severity,
            line: lineNum + 1,
            message: `${message} at line ${lineNum + 1}`,
            rule,
          });
        }
      }
    }

    return issues;
  }

  private findSimilarFragments(
    file1: string,
    lines1: string[],
    file2: string,
    lines2: string[],
    minSize: number,
    threshold: number
  ): Array<{
    fragment1: { file: string; startLine: number; endLine: number };
    fragment2: { file: string; startLine: number; endLine: number };
    lines: number;
    similarity: number;
  }> {
    const fragments: Array<{
      fragment1: { file: string; startLine: number; endLine: number };
      fragment2: { file: string; startLine: number; endLine: number };
      lines: number;
      similarity: number;
    }> = [];

    // Skip files that are the same (self-duplication is handled elsewhere)
    if (file1 === file2) {
      return fragments;
    }

    // Normalize lines for comparison (remove whitespace, lowercase)
    const normalize = (line: string) => line.trim().toLowerCase().replace(/\s+/g, ' ');

    const normalized1 = lines1.map(normalize);
    const normalized2 = lines2.map(normalize);

    // Find matching fragments using sliding window
    for (let i = 0; i <= normalized1.length - minSize; i++) {
      for (let j = 0; j <= normalized2.length - minSize; j++) {
        // Check for starting match
        if (normalized1[i] !== normalized2[j] || normalized1[i].length < 5) {
          continue;
        }

        // Expand fragment to find maximum matching size
        let matchSize = 1;
        let matchCount = 0;
        let totalLines = 0;

        while (
          i + matchSize < normalized1.length &&
          j + matchSize < normalized2.length &&
          matchSize < 50 // Max fragment size to prevent false positives
        ) {
          totalLines++;
          if (normalized1[i + matchSize] === normalized2[j + matchSize] && normalized1[i + matchSize].length > 3) {
            matchCount++;
          }
          matchSize++;
        }

        const similarity = matchCount / totalLines;

        if (matchSize >= minSize && similarity >= threshold) {
          fragments.push({
            fragment1: { file: file1, startLine: i + 1, endLine: i + matchSize },
            fragment2: { file: file2, startLine: j + 1, endLine: j + matchSize },
            lines: matchSize,
            similarity,
          });
        }
      }
    }

    return fragments;
  }

  private generateRecommendations(
    complexity: ComplexityResult[],
    security: SecurityResult[],
    duplication: DuplicationResult,
    dependencies: DependencyResult
  ): string[] {
    const recommendations: string[] = [];

    // Complexity recommendations
    const highComplexity = complexity.filter(c => c.rating === 'high' || c.rating === 'very-high');
    if (highComplexity.length > 0) {
      recommendations.push(`Refactor ${highComplexity.length} file(s) with high complexity. Consider breaking down large functions into smaller, more manageable ones.`);
    }

    // Security recommendations
    const criticalIssues = security.reduce((sum, s) => sum + s.issues.filter(i => i.severity === 'critical').length, 0);
    if (criticalIssues > 0) {
      recommendations.push(`Address ${criticalIssues} critical security issue(s) immediately, focusing on code injection and XSS vulnerabilities.`);
    }

    const highIssues = security.reduce((sum, s) => sum + s.issues.filter(i => i.severity === 'high').length, 0);
    if (highIssues > 0) {
      recommendations.push(`Review ${highIssues} high-severity security issue(s), particularly hardcoded secrets and weak cryptography.`);
    }

    // Duplication recommendations
    if (duplication.duplicationPercentage > 10) {
      recommendations.push(`Reduce code duplication (${duplication.duplicationPercentage.toFixed(1)}% of codebase). Extract common logic into shared utilities or modules.`);
    }

    // Dependency recommendations
    const vulnerableDeps = dependencies.dependencies.filter(d => (d.vulnerabilities || 0) > 0);
    if (vulnerableDeps.length > 0) {
      recommendations.push(`Update ${vulnerableDeps.length} dependenc(y/ies) with known vulnerabilities: ${vulnerableDeps.map(d => d.name).join(', ')}`);
    }

    if (!dependencies.hasPackageLock) {
      recommendations.push('Lock dependency versions using package-lock.json or yarn.lock to ensure reproducible builds.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Great job! No major issues found. Continue following best practices.');
    }

    return recommendations;
  }
}

// Global singleton
let globalCodeAnalyzer: CodeAnalyzer | null = null;

export function getCodeAnalyzer(): CodeAnalyzer {
  if (!globalCodeAnalyzer) {
    globalCodeAnalyzer = new CodeAnalyzer();
  }
  return globalCodeAnalyzer;
}

export function resetCodeAnalyzer(): void {
  globalCodeAnalyzer = null;
}
