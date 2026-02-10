/**
 * Content Summarizer
 *
 * Intelligently summarizes long outputs for Telegram display
 */

import type { SummarizeOptions } from './types.js';

/**
 * Default summarization options
 */
const DEFAULT_OPTIONS: SummarizeOptions = {
  maxLines: 50,
  maxMatches: 20,
  preserveStructure: true,
  addTruncationNotice: true,
};

/**
 * Summarizer class
 */
export class Summarizer {
  private defaultOptions: SummarizeOptions;

  constructor(defaultOptions: Partial<SummarizeOptions> = {}) {
    this.defaultOptions = { ...DEFAULT_OPTIONS, ...defaultOptions };
  }

  /**
   * Summarize content based on type
   */
  summarize(
    content: string,
    type: 'file' | 'search' | 'diff' | 'log' | 'generic',
    options?: Partial<SummarizeOptions>
  ): { content: string; wasTruncated: boolean; originalLength: number } {
    const opts = { ...this.defaultOptions, ...options };
    const originalLength = content.length;

    let summarized: string;
    let wasTruncated = false;

    switch (type) {
      case 'file':
        summarized = this.summarizeFile(content, opts);
        break;
      case 'search':
        summarized = this.summarizeSearch(content, opts);
        break;
      case 'diff':
        summarized = this.summarizeDiff(content, opts);
        break;
      case 'log':
        summarized = this.summarizeLog(content, opts);
        break;
      default:
        summarized = this.summarizeGeneric(content, opts);
    }

    wasTruncated = summarized.length < originalLength;

    return {
      content: summarized,
      wasTruncated,
      originalLength,
    };
  }

  /**
   * Summarize file content
   */
  private summarizeFile(content: string, options: SummarizeOptions): string {
    const lines = content.split('\n');
    const maxLines = options.maxLines || 50;

    if (lines.length <= maxLines) {
      return content;
    }

    // Keep header and footer for context
    const headerLines = Math.floor(maxLines * 0.7);
    const footerLines = Math.floor(maxLines * 0.3);

    const header = lines.slice(0, headerLines).join('\n');
    const footer = lines.slice(-footerLines).join('\n');

    let result = header;

    if (options.addTruncationNotice) {
      result += `\n\n[... ${lines.length - maxLines} lines omitted ...]\n\n`;
    } else {
      result += '\n\n...\n\n';
    }

    result += footer;

    return result;
  }

  /**
   * Summarize search results
   */
  private summarizeSearch(content: string, options: SummarizeOptions): string {
    const lines = content.split('\n');
    const maxMatches = options.maxMatches || 20;

    // Find all match lines (contain "Results:" or look like file:line:content)
    const matchLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Results:') || lines[i].match(/^.+:\d+:/)) {
        matchLines.push(i);
      }
    }

    if (matchLines.length <= maxMatches) {
      return content;
    }

    // Keep some header lines
    const headerEnd = Math.max(...matchLines.slice(0, maxMatches));
    let result = lines.slice(0, headerEnd + 1).join('\n');

    if (options.addTruncationNotice) {
      result += `\n\n[... ${matchLines.length - maxMatches} more matches ...]`;
    }

    return result;
  }

  /**
   * Summarize diff content
   */
  private summarizeDiff(content: string, options: SummarizeOptions): string {
    const lines = content.split('\n');
    const hunks: Array<{ start: number; end: number; added: number; removed: number }> = [];
    let currentHunk: { start: number; added: number; removed: number } | null = null;

    // Parse hunks
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('@@')) {
        if (currentHunk) {
          hunks.push({
            start: currentHunk.start,
            end: i - 1,
            added: currentHunk.added,
            removed: currentHunk.removed,
          });
        }
        currentHunk = { start: i, added: 0, removed: 0 };
      } else if (currentHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) currentHunk.added++;
        else if (line.startsWith('-') && !line.startsWith('---')) currentHunk.removed++;
      }
    }

    if (currentHunk) {
      hunks.push({
        start: currentHunk.start,
        end: lines.length - 1,
        added: currentHunk.added,
        removed: currentHunk.removed,
      });
    }

    // Keep most significant hunks
    const maxHunks = options.maxLines || 10;
    if (hunks.length <= maxHunks) {
      return content;
    }

    // Sort by impact (added + removed)
    const sortedHunks = [...hunks].sort((a, b) =>
      (b.added + b.removed) - (a.added + a.removed)
    );

    const topHunks = sortedHunks.slice(0, maxHunks).sort((a, b) => a.start - b.start);

    // Reconstruct diff with top hunks
    let result = lines.slice(0, topHunks[0].start).join('\n');

    for (const hunk of topHunks) {
      result += '\n' + lines.slice(hunk.start, hunk.end + 1).join('\n');
    }

    if (options.addTruncationNotice) {
      result += `\n\n[... ${hunks.length - maxHunks} hunks omitted ...]`;
    }

    return result;
  }

  /**
   * Summarize log content
   */
  private summarizeLog(content: string, options: SummarizeOptions): string {
    const lines = content.split('\n');
    const maxLines = options.maxLines || 50;

    if (lines.length <= maxLines) {
      return content;
    }

    // Keep first part and last part
    const firstPartSize = Math.floor(maxLines * 0.6);
    const lastPartSize = maxLines - firstPartSize;

    const firstPart = lines.slice(0, firstPartSize).join('\n');
    const lastPart = lines.slice(-lastPartSize).join('\n');

    let result = firstPart;

    if (options.addTruncationNotice) {
      result += `\n\n[... ${lines.length - maxLines} log lines omitted ...]\n\n`;
    }

    result += lastPart;

    return result;
  }

  /**
   * Generic summarization
   */
  private summarizeGeneric(content: string, options: SummarizeOptions): string {
    const lines = content.split('\n');
    const maxLines = options.maxLines || 50;

    if (lines.length <= maxLines) {
      return content;
    }

    const summarized = lines.slice(0, maxLines).join('\n');

    if (options.addTruncationNotice) {
      return summarized + `\n\n[... ${lines.length - maxLines} more lines ...]`;
    }

    return summarized + '\n...';
  }

  /**
   * Estimate line count from content
   */
  estimateLineCount(content: string): number {
    return content.split('\n').length;
  }

  /**
   * Estimate character count from content
   */
  estimateCharCount(content: string): number {
    return content.length;
  }

  /**
   * Detect content type
   */
  detectContentType(content: string): 'file' | 'search' | 'diff' | 'log' | 'generic' {
    const lines = content.split('\n');

    // Check for diff markers
    if (content.includes('diff --git') ||
        content.includes('@@') ||
        lines.some(l => l.startsWith('+') || l.startsWith('-'))) {
      return 'diff';
    }

    // Check for search results
    if (content.includes('Results:') ||
        lines.filter(l => l.match(/^.+:\d+:/)).length > lines.length * 0.3) {
      return 'search';
    }

    // Check for log format
    if (lines.filter(l => l.match(/^\d{4}-\d{2}-\d{2}/) ||
                           l.match(/^\[\w+\]/) ||
                           l.match(/^\w+ \+?\d+:/)).length > lines.length * 0.5) {
      return 'log';
    }

    // Check for file content (likely has indentation, function definitions, etc.)
    if (lines.filter(l => l.match(/^\s*(function|const|let|var|class|import|export)/)).length > 0) {
      return 'file';
    }

    return 'generic';
  }

  /**
   * Auto-summarize based on content detection
   */
  autoSummarize(
    content: string,
    options?: Partial<SummarizeOptions>
  ): { content: string; wasTruncated: boolean; type: string; originalLength: number } {
    const type = this.detectContentType(content);
    const result = this.summarize(content, type, options);

    return {
      ...result,
      type,
    };
  }
}

/**
 * Default singleton instance
 */
let defaultSummarizer: Summarizer | null = null;

export function getSummarizer(options?: Partial<SummarizeOptions>): Summarizer {
  if (!defaultSummarizer) {
    defaultSummarizer = new Summarizer(options);
  }
  return defaultSummarizer;
}
