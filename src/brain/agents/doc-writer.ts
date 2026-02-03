/**
 * DocWriter Agent - Automated documentation generation and maintenance
 *
 * Features:
 * - Generate README.md from code analysis
 * - Generate API documentation
 * - Write/update inline code comments
 * - Create markdown documentation from code structure
 * - Explain code functionality
 * - Maintain documentation sync with code changes
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { getBrain } from '../brain-manager.js';

const execAsync = promisify(exec);

// ============================================
// Types
// ============================================

export interface DocGenerationOptions {
  includeTypes?: boolean;
  includeExamples?: boolean;
  includeExports?: boolean;
  format?: 'markdown' | 'html' | 'json';
  outputFile?: string;
  updateExisting?: boolean;
  commentStyle?: 'jsdoc' | 'plaintext' | 'detailed';
}

export interface CodeFile {
  path: string;
  type: string;
  exports: string[];
  imports: string[];
  classes: string[];
  functions: string[];
  lines: number;
  hasComments: boolean;
}

export interface DocumentationTemplate {
  name: string;
  description: string;
  sections: DocSection[];
}

export interface DocSection {
  title: string;
  content: string;
  order: number;
  required?: boolean;
}

export interface GeneratedDoc {
  content: string;
  files: string[];
  metadata: {
    generatedAt: number;
    sourceFiles: string[];
    docType: string;
  };
}

export interface CommentInsertion {
  filePath: string;
  line: number;
  comment: string;
  type: 'function' | 'class' | 'variable' | 'module';
}

// ============================================
// DocWriter Agent Class
// ============================================

export class DocWriterAgent {
  private brain = getBrain();
  private docsDir: string;

  constructor() {
    this.docsDir = join(this.brain.getBrainDir(), 'docs');
  }

  /**
   * Initialize the DocWriter agent
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.docsDir)) {
      await mkdir(this.docsDir, { recursive: true });
    }
    console.log('[DocWriter] Initialized');
  }

  /**
   * Generate README.md for a project
   */
  async generateREADME(projectPath: string, options: DocGenerationOptions = {}): Promise<GeneratedDoc> {
    const analysis = await this.analyzeProject(projectPath);
    const packageJson = await this.readPackageJson(projectPath);

    let readme = `# ${packageJson?.name || basename(projectPath)}\n\n`;

    // Description
    if (packageJson?.description) {
      readme += `${packageJson.description}\n\n`;
    }

    // Badge section
    readme += this.generateBadges(projectPath, packageJson);

    // Table of Contents
    readme += this.generateTableOfContents(analysis);

    // Installation
    readme += this.generateInstallationSection(projectPath, packageJson);

    // Usage
    readme += this.generateUsageSection(projectPath, analysis);

    // Project Structure
    if (analysis.files.length > 0) {
      readme += this.generateStructureSection(analysis);
    }

    // API Documentation (if requested)
    if (options.includeTypes || options.includeExports) {
      readme += this.generateAPIDocumentation(analysis, options);
    }

    // Examples (if requested)
    if (options.includeExamples) {
      readme += this.generateExamplesSection(projectPath);
    }

    // Contributing
    readme += this.generateContributingSection();

    // License
    if (packageJson?.license) {
      readme += `\n## License\n\n${packageJson.license === 'MIT' ? 'MIT' : packageJson.license}\n`;
    }

    // Write to file if specified
    const outputPath = options.outputFile || join(projectPath, 'README.md');
    await writeFile(outputPath, readme);

    return {
      content: readme,
      files: [outputPath],
      metadata: {
        generatedAt: Date.now(),
        sourceFiles: analysis.files.map((f: CodeFile) => f.path),
        docType: 'README',
      },
    };
  }

  /**
   * Generate API documentation for a project
   */
  async generateAPIDocs(projectPath: string, options: DocGenerationOptions = {}): Promise<GeneratedDoc> {
    const analysis = await this.analyzeProject(projectPath);
    const docsDir = join(projectPath, 'docs');

    if (!existsSync(docsDir)) {
      await mkdir(docsDir, { recursive: true });
    }

    let apiDocs = `# API Documentation\n\n`;
    apiDocs += `Generated: ${new Date().toISOString()}\n\n`;

    // Group by file type
    const byType = this.groupByType(analysis.files);

    for (const [type, files] of Object.entries(byType)) {
      apiDocs += `## ${type.toUpperCase()} Files\n\n`;

      for (const file of files) {
        apiDocs += await this.generateFileDocumentation(file, options);
        apiDocs += '\n';
      }
    }

    const outputPath = options.outputFile || join(docsDir, 'API.md');
    await writeFile(outputPath, apiDocs);

    return {
      content: apiDocs,
      files: [outputPath],
      metadata: {
        generatedAt: Date.now(),
        sourceFiles: analysis.files.map((f: CodeFile) => f.path),
        docType: 'API',
      },
    };
  }

  /**
   * Add inline comments to a file
   */
  async addInlineComments(filePath: string, style: 'jsdoc' | 'plaintext' | 'detailed' = 'jsdoc'): Promise<CommentInsertion[]> {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const insertions: CommentInsertion[] = [];

    // Detect language
    const lang = this.detectLanguage(filePath);

    // Parse for functions, classes, exports
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for function declarations
      const funcMatch = trimmed.match(/^(async\s+)?function\s+(\w+)/);
      if (funcMatch && !this.hasPrecedingComment(lines, i)) {
        const comment = this.generateFunctionComment(funcMatch[2], line, style, lang);
        insertions.push({
          filePath,
          line: i + 1,
          comment,
          type: 'function',
        });
      }

      // Check for class declarations
      const classMatch = trimmed.match(/^class\s+(\w+)/);
      if (classMatch && !this.hasPrecedingComment(lines, i)) {
        const comment = this.generateClassComment(classMatch[1], style, lang);
        insertions.push({
          filePath,
          line: i + 1,
          comment,
          type: 'class',
        });
      }

      // Check for export const/let/var
      const exportMatch = trimmed.match(/^export\s+(const|let|var)\s+(\w+)/);
      if (exportMatch && !this.hasPrecedingComment(lines, i)) {
        const comment = this.generateVariableComment(exportMatch[2], line, style, lang);
        insertions.push({
          filePath,
          line: i + 1,
          comment,
          type: 'variable',
        });
      }

      // Check for interface declarations (TypeScript)
      const interfaceMatch = trimmed.match(/^interface\s+(\w+)/);
      if (interfaceMatch && !this.hasPrecedingComment(lines, i)) {
        const comment = this.generateInterfaceComment(interfaceMatch[1], style, lang);
        insertions.push({
          filePath,
          line: i + 1,
          comment,
          type: 'class', // Treat interface similar to class
        });
      }
    }

    // Apply insertions (in reverse order to maintain line numbers)
    let modifiedContent = content;
    let offset = 0;

    for (const insertion of insertions.reverse()) {
      const insertIndex = insertion.line - 1 + offset;
      const indent = lines[insertIndex].match(/^(\s*)/)?.[1] || '';
      modifiedContent =
        modifiedContent.slice(0, insertIndex * (insertion.line - 1 + offset)) +
        indent + insertion.comment + '\n' +
        modifiedContent.slice(insertIndex * (insertion.line - 1 + offset));
      offset += 1;
    }

    if (insertions.length > 0) {
      await writeFile(filePath, modifiedContent);
    }

    return insertions;
  }

  /**
   * Explain a code snippet
   */
  async explainCode(code: string, language?: string): Promise<string> {
    const detectedLang = language || this.detectLanguageFromString(code);
    let explanation = `# Code Explanation\n\n`;

    // Analyze code structure
    const lines = code.split('\n');

    explanation += `**Language:** ${detectedLang}\n`;
    explanation += `**Lines:** ${lines.length}\n\n`;

    // Identify patterns
    const patterns = this.identifyPatterns(code, detectedLang);

    if (patterns.functions.length > 0) {
      explanation += `## Functions (${patterns.functions.length})\n\n`;
      for (const fn of patterns.functions) {
        explanation += `- \`${fn}\`\n`;
      }
      explanation += '\n';
    }

    if (patterns.classes.length > 0) {
      explanation += `## Classes (${patterns.classes.length})\n\n`;
      for (const cls of patterns.classes) {
        explanation += `- \`${cls}\`\n`;
      }
      explanation += '\n';
    }

    if (patterns.imports.length > 0) {
      explanation += `## Imports (${patterns.imports.length})\n\n`;
      for (const imp of patterns.imports) {
        explanation += `- ${imp}\n`;
      }
      explanation += '\n';
    }

    // Generate high-level summary
    explanation += `## Summary\n\n`;
    explanation += this.generateCodeSummary(code, patterns);

    return explanation;
  }

  /**
   * Analyze a project structure
   */
  async analyzeProject(projectPath: string): Promise<{ files: CodeFile[]; stats: any }> {
    const { stdout } = await execAsync(
      `find "${projectPath}" -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/build/*"`,
      { timeout: 30000 }
    ).catch(() => ({ stdout: '' }));

    const filePaths = stdout.trim().split('\n').filter(Boolean);
    const files: CodeFile[] = [];

    for (const path of filePaths) {
      const file = await this.analyzeFile(path);
      if (file) {
        files.push(file);
      }
    }

    const stats = {
      totalFiles: files.length,
      totalLines: files.reduce((sum, f) => sum + f.lines, 0),
      byType: this.groupByType(files),
      commentedFiles: files.filter((f: CodeFile) => f.hasComments).length,
    };

    return { files, stats };
  }

  /**
   * Analyze a single file
   */
  async analyzeFile(filePath: string): Promise<CodeFile | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const ext = extname(filePath);

      const exports: string[] = [];
      const imports: string[] = [];
      const classes: string[] = [];
      const functions: string[] = [];

      const lines = content.split('\n');

      for (const line of lines) {
        // Extract exports
        const exportMatch = line.match(/export\s+(?:(?:const|let|var|function|class)\s+)?(\w+)/);
        if (exportMatch) exports.push(exportMatch[1]);

        // Extract imports
        const importMatch = line.match(/import\s+.*?from\s+['"]([^'"]+)['"]/);
        if (importMatch) imports.push(importMatch[1]);

        // Extract classes
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) classes.push(classMatch[1]);

        // Extract functions
        const funcMatch = line.match(/(?:^|\s)(?:async\s+)?function\s+(\w+)/);
        if (funcMatch) functions.push(funcMatch[1]);
      }

      // Check for comments
      const hasComments = content.includes('//') || content.includes('/**') || content.includes('/*');

      return {
        path: filePath,
        type: ext.replace('.', ''),
        exports,
        imports,
        classes,
        functions,
        lines: lines.length,
        hasComments,
      };
    } catch {
      return null;
    }
  }

  /**
   * Sync documentation with code changes
   */
  async syncDocumentation(projectPath: string): Promise<{ updated: string[]; errors: string[] }> {
    const updated: string[] = [];
    const errors: string[] = [];

    try {
      // Check if README needs update
      const readmePath = join(projectPath, 'README.md');
      if (existsSync(readmePath)) {
        await this.generateREADME(projectPath, { outputFile: readmePath, updateExisting: true });
        updated.push(readmePath);
      }

      // Check if API docs need update
      const apiDocsPath = join(projectPath, 'docs', 'API.md');
      if (existsSync(apiDocsPath)) {
        await this.generateAPIDocs(projectPath, { outputFile: apiDocsPath, updateExisting: true });
        updated.push(apiDocsPath);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    return { updated, errors };
  }

  // ===========================================
  // Private Helper Methods
  // ===========================================

  private async readPackageJson(projectPath: string): Promise<any> {
    const packagePath = join(projectPath, 'package.json');
    if (!existsSync(packagePath)) return null;

    try {
      const content = await readFile(packagePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private generateBadges(_projectPath: string, packageJson: any): string {
    let badges = '\n';

    if (packageJson?.version) {
      badges += `![version](https://img.shields.io/badge/version-${packageJson.version}-blue.svg)\n`;
    }

    if (packageJson?.license) {
      badges += `![license](https://img.shields.io/badge/license-${packageJson.license}-green.svg)\n`;
    }

    badges += `![typescript](https://img.shields.io/badge/TypeScript-5.x-blue)\n`;
    badges += `![node](https://img.shields.io/badge/node-%3E%3D18.x-green.svg)\n`;

    badges += '\n';
    return badges;
  }

  private generateTableOfContents(analysis: any): string {
    let toc = `## Table of Contents\n\n`;
    toc += `- [Installation](#installation)\n`;
    toc += `- [Usage](#usage)\n`;

    if (analysis.files.length > 0) {
      toc += `- [Project Structure](#project-structure)\n`;
    }

    toc += `- [API Documentation](#api-documentation)\n`;
    toc += `- [Contributing](#contributing)\n`;
    toc += `- [License](#license)\n\n`;

    return toc;
  }

  private generateInstallationSection(projectPath: string, _packageJson: any): string {
    let section = `## Installation\n\n`;

    if (existsSync(join(projectPath, 'package.json'))) {
      section += `\`\`\`bash\nnpm install\n\`\`\`\n\n`;
    }

    return section;
  }

  private generateUsageSection(projectPath: string, _analysis: any): string {
    let section = `## Usage\n\n`;

    // Look for common entry points
    const possibleEntries = ['index.ts', 'index.js', 'main.ts', 'main.js', 'cli.ts', 'cli.js'];

    for (const entry of possibleEntries) {
      const entryPath = join(projectPath, 'src', entry);
      if (existsSync(entryPath)) {
        section += `\`\`\`typescript\n// Import from ${entry}\nimport { ... } from './${entry.replace('.ts', '').replace('.js', '')}';\n\`\`\`\n\n`;
        break;
      }
    }

    return section;
  }

  private generateStructureSection(analysis: any): string {
    let section = `## Project Structure\n\n`;

    section += `\`\`\`\n`;
    for (const file of analysis.files.slice(0, 20)) {
      const relativePath = file.path.replace(process.cwd(), '').replace(/^\//, '');
      section += `${relativePath}\n`;
    }
    if (analysis.files.length > 20) {
      section += `... and ${analysis.files.length - 20} more files\n`;
    }
    section += `\`\`\`\n\n`;

    return section;
  }

  private generateAPIDocumentation(analysis: any, _options: DocGenerationOptions): string {
    let docs = `## API Documentation\n\n`;

    for (const file of analysis.files.slice(0, 10)) {
      if (file.exports.length > 0 || file.classes.length > 0 || file.functions.length > 0) {
        docs += `### ${basename(file.path)}\n\n`;

        if (file.exports.length > 0) {
          docs += `**Exports:** \`${file.exports.join('`, `')}\`\n\n`;
        }

        if (file.classes.length > 0) {
          docs += `**Classes:** \`${file.classes.join('`, `')}\`\n\n`;
        }

        if (file.functions.length > 0) {
          docs += `**Functions:** \`${file.functions.join('`, `')}\`\n\n`;
        }
      }
    }

    return docs;
  }

  private generateExamplesSection(projectPath: string): string {
    let section = `## Examples\n\n`;

    // Look for examples directory
    const examplesDir = join(projectPath, 'examples');
    if (existsSync(examplesDir)) {
      section += `See the [examples](./examples) directory for usage examples.\n\n`;
    }

    return section;
  }

  private generateContributingSection(): string {
    return `## Contributing\n\nContributions are welcome! Please feel free to submit a Pull Request.\n\n`;
  }

  private async generateFileDocumentation(file: CodeFile, _options: DocGenerationOptions): Promise<string> {
    let doc = `### ${basename(file.path)}\n\n`;
    doc += `**Type:** ${file.type}\n`;
    doc += `**Lines:** ${file.lines}\n\n`;

    if (file.exports.length > 0) {
      doc += `#### Exports\n\n`;
      for (const exp of file.exports) {
        doc += `- \`${exp}\`\n`;
      }
      doc += '\n';
    }

    if (file.classes.length > 0) {
      doc += `#### Classes\n\n`;
      for (const cls of file.classes) {
        doc += `- \`${cls}\`\n`;
      }
      doc += '\n';
    }

    if (file.functions.length > 0) {
      doc += `#### Functions\n\n`;
      for (const fn of file.functions) {
        doc += `- \`${fn}\`\n`;
      }
      doc += '\n';
    }

    return doc;
  }

  private groupByType(files: CodeFile[]): Record<string, CodeFile[]> {
    const grouped: Record<string, CodeFile[]> = {};

    for (const file of files) {
      if (!grouped[file.type]) {
        grouped[file.type] = [];
      }
      grouped[file.type].push(file);
    }

    return grouped;
  }

  private detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
    };

    return langMap[ext] || 'plaintext';
  }

  private detectLanguageFromString(code: string): string {
    if (code.includes('interface ') || code.includes(': ')) return 'typescript';
    if (code.includes('def ') || code.includes('import ')) return 'python';
    if (code.includes('func ') || code.includes('package ')) return 'go';
    if (code.includes('impl ') || code.includes('fn ')) return 'rust';
    return 'javascript';
  }

  private hasPrecedingComment(lines: string[], index: number, lookBack = 3): boolean {
    for (let i = Math.max(0, index - lookBack); i < index; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/**') || trimmed.startsWith('*')) {
        return true;
      }
      if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
        return false;
      }
    }
    return false;
  }

  private generateFunctionComment(name: string, _line: string, style: string, _lang: string): string {
    if (style === 'jsdoc') {
      return `/**\n   * ${name} - TODO: Add description\n   */`;
    }
    return `// ${name}: TODO: Add description`;
  }

  private generateClassComment(name: string, style: string, _lang: string): string {
    if (style === 'jsdoc') {
      return `/**\n   * ${name} class\n   * TODO: Add description\n   */`;
    }
    return `// ${name} class - TODO: Add description`;
  }

  private generateVariableComment(name: string, _line: string, style: string, _lang: string): string {
    if (style === 'jsdoc') {
      return `/**\n   * ${name}\n   * TODO: Add description\n   */`;
    }
    return `// ${name}: TODO: Add description`;
  }

  private generateInterfaceComment(name: string, style: string, _lang: string): string {
    if (style === 'jsdoc') {
      return `/**\n   * ${name} interface\n   * TODO: Add description\n   */`;
    }
    return `// ${name} interface - TODO: Add description`;
  }

  private identifyPatterns(code: string, _lang: string): {
    functions: string[];
    classes: string[];
    imports: string[];
    exports: string[];
  } {
    const functions: string[] = [];
    const classes: string[] = [];
    const imports: string[] = [];
    const exports: string[] = [];

    const lines = code.split('\n');
    for (const line of lines) {
      const fnMatch = line.match(/(?:function|const)\s+(\w+)\s*(?:=|\()/);
      if (fnMatch) functions.push(fnMatch[1]);

      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) classes.push(classMatch[1]);

      const importMatch = line.match(/import\s+.*from\s+['"]([^'"]+)['"]/);
      if (importMatch) imports.push(importMatch[1]);

      const exportMatch = line.match(/export\s+(?:const|function|class)\s+(\w+)/);
      if (exportMatch) exports.push(exportMatch[1]);
    }

    return { functions, classes, imports, exports };
  }

  private generateCodeSummary(_code: string, patterns: any): string {
    let summary = '';

    const parts: string[] = [];
    if (patterns.functions.length > 0) {
      parts.push(`defines ${patterns.functions.length} function${patterns.functions.length > 1 ? 's' : ''}`);
    }
    if (patterns.classes.length > 0) {
      parts.push(`defines ${patterns.classes.length} class${patterns.classes.length > 1 ? 'es' : ''}`);
    }
    if (patterns.imports.length > 0) {
      parts.push(`imports from ${patterns.imports.length} module${patterns.imports.length > 1 ? 's' : ''}`);
    }

    if (parts.length > 0) {
      summary += `This code ${parts.join(' and ')}. `;
    }

    return summary || 'This code appears to be a module or script.';
  }
}

// ============================================
// Global Singleton
// ============================================

let globalDocWriter: DocWriterAgent | null = null;

export function getDocWriter(): DocWriterAgent {
  if (!globalDocWriter) {
    globalDocWriter = new DocWriterAgent();
  }
  return globalDocWriter;
}

export function resetDocWriter(): void {
  globalDocWriter = null;
}
