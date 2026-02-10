/**
 * Response Formatter for Telegram
 *
 * Formats Claude CLI responses for Telegram with Markdown rendering,
 * message chunking, and intelligent summarization.
 */

import type {
  FormattedResponse,
  ResponseChunk,
  SummarizeOptions,
} from './types.js';

/**
 * Telegram message length limit
 */
const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Telegram Markdown V2 special characters that need escaping
 */
const MARKDOWN_SPECIAL_CHARS = [
  '_',
  '*',
  '[',
  ']',
  '(',
  ')',
  '~',
  '`',
  '>',
  '#',
  '+',
  '-',
  '=',
  '|',
  '{',
  '}',
  '.',
  '!',
];

/**
 * Default summarization options
 */
const DEFAULT_SUMMARIZE_OPTIONS: SummarizeOptions = {
  maxLines: 50,
  maxMatches: 20,
  preserveStructure: true,
  addTruncationNotice: true,
};

/**
 * Response Formatter class
 */
export class ResponseFormatter {
  private parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' | null;

  constructor(parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' | null = 'Markdown') {
    this.parseMode = parseMode;
  }

  /**
   * Format a response for Telegram
   */
  formatResponse(
    content: string,
    options: {
      parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' | null;
      disableWebPagePreview?: boolean;
      summarize?: boolean | SummarizeOptions;
    } = {}
  ): FormattedResponse {
    const {
      parseMode = this.parseMode,
      disableWebPagePreview = true,
      summarize = false,
    } = options;

    let formattedContent = content;

    // Apply summarization if requested
    if (summarize) {
      const summarizeOptions = typeof summarize === 'boolean'
        ? DEFAULT_SUMMARIZE_OPTIONS
        : { ...DEFAULT_SUMMARIZE_OPTIONS, ...summarize };
      formattedContent = this.summarizeContent(formattedContent, summarizeOptions);
    }

    // Apply markdown formatting
    if (parseMode === 'Markdown' || parseMode === 'MarkdownV2') {
      formattedContent = this.formatMarkdown(formattedContent, parseMode);
    }

    // Chunk if necessary
    const chunks = this.chunkMessage(formattedContent);

    return {
      text: chunks[0].content,
      parseMode,
      disableWebPagePreview,
    };
  }

  /**
   * Format content with Markdown
   */
  private formatMarkdown(content: string, mode: 'Markdown' | 'MarkdownV2'): string {
    let formatted = content;

    // Detect and format code blocks
    formatted = this.formatCodeBlocks(formatted, mode);

    // Format inline code
    formatted = this.formatInlineCode(formatted, mode);

    // Format bold text (for emphasis)
    if (mode === 'Markdown') {
      // Simple markdown - less strict
      formatted = this.formatBoldSimple(formatted);
    } else {
      // MarkdownV2 - need to escape
      formatted = this.escapeMarkdownV2(formatted);
      formatted = this.formatBoldV2(formatted);
    }

    return formatted;
  }

  /**
   * Format code blocks with syntax highlighting hints
   */
  private formatCodeBlocks(content: string, mode: 'Markdown' | 'MarkdownV2'): string {
    // Detect code blocks (```language ... ```)
    return content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      // Remove any existing special characters from language
      const cleanLang = lang.replace(/[*_`[\]()~>#+-=|{}.!]/g, '');

      if (mode === 'MarkdownV2') {
        // In V2, we need to escape the content but preserve structure
        const escapedCode = this.escapeForCodeBlock(code);
        return '```' + cleanLang + '\n' + escapedCode + '\n```';
      }
      return match;
    });
  }

  /**
   * Format inline code
   */
  private formatInlineCode(content: string, mode: 'Markdown' | 'MarkdownV2'): string {
    // Already handled by code block formatter, this is for inline code
    if (mode === 'MarkdownV2') {
      // Find inline code that's not in code blocks
      const lines = content.split('\n');
      const inCodeBlock = (index: number) => {
        let inBlock = false;
        for (let i = 0; i < index; i++) {
          if (lines[i].startsWith('```')) inBlock = !inBlock;
        }
        return inBlock;
      };

      return content.split('\n').map((line, i) => {
        if (inCodeBlock(i)) return line;
        // Escape content within inline code, preserve backticks
        return line.replace(/`([^`]+)`/g, (_match, code) => {
          return '`' + this.escapeForInlineCode(code) + '`';
        });
      }).join('\n');
    }
    return content;
  }

  /**
   * Format bold text in simple Markdown
   */
  private formatBoldSimple(content: string): string {
    // Convert **text** to *text* for Telegram's Markdown
    return content.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  }

  /**
   * Format bold text in MarkdownV2
   */
  private formatBoldV2(content: string): string {
    // Already escaped, just need to ensure * format
    return content;
  }

  /**
   * Escape special characters for MarkdownV2
   */
  private escapeMarkdownV2(content: string): string {
    // Don't escape if already in code block (detection is simplified)
    const lines = content.split('\n');
    let inCodeBlock = false;

    return lines.map(line => {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      if (inCodeBlock) return line;

      // Escape special characters
      return line.split('').map(char => {
        if (MARKDOWN_SPECIAL_CHARS.includes(char)) {
          return '\\' + char;
        }
        return char;
      }).join('');
    }).join('\n');
  }

  /**
   * Escape content for code blocks (minimal escaping)
   */
  private escapeForCodeBlock(content: string): string {
    // In code blocks, only ` and \ need escaping
    return content
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`');
  }

  /**
   * Escape content for inline code
   */
  private escapeForInlineCode(content: string): string {
    // In inline code, escape \ and `
    return content
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`');
  }

  /**
   * Chunk message into parts that fit within Telegram limits
   */
  chunkMessage(content: string, limit: number = TELEGRAM_MESSAGE_LIMIT): ResponseChunk[] {
    const chunks: ResponseChunk[] = [];

    if (content.length <= limit) {
      return [{
        content,
        index: 0,
        total: 1,
      }];
    }

    // Split by lines first to avoid breaking code blocks
    const lines = content.split('\n');
    let currentChunk = '';
    let chunkIndex = 0;

    for (const line of lines) {
      const testChunk = currentChunk + (currentChunk ? '\n' : '') + line;

      if (testChunk.length > limit) {
        // Current chunk would be too large
        if (currentChunk) {
          chunks.push({
            content: currentChunk,
            index: chunkIndex++,
            total: -1, // Will update at end
          });
        }

        // If single line is too long, split it
        if (line.length > limit) {
          const lineChunks = this.splitLongLine(line, limit);
          for (let i = 0; i < lineChunks.length - 1; i++) {
            chunks.push({
              content: lineChunks[i],
              index: chunkIndex++,
              total: -1,
            });
          }
          currentChunk = lineChunks[lineChunks.length - 1];
        } else {
          currentChunk = line;
        }
      } else {
        currentChunk = testChunk;
      }
    }

    // Add final chunk
    if (currentChunk) {
      chunks.push({
        content: currentChunk,
        index: chunkIndex,
        total: -1,
      });
    }

    // Update total count
    const total = chunks.length;
    return chunks.map(chunk => ({ ...chunk, total }));
  }

  /**
   * Split a long line into chunks
   */
  private splitLongLine(line: string, limit: number): string[] {
    const chunks: string[] = [];
    let remaining = line;

    while (remaining.length > limit) {
      // Try to find a good break point
      const breakPoint = this.findBreakPoint(remaining.slice(0, limit));
      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint);
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Find a good break point in text
   */
  private findBreakPoint(text: string): number {
    // Prefer breaking at sentence boundaries
    const sentenceEnds = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    for (const end of sentenceEnds) {
      const index = text.lastIndexOf(end);
      if (index > text.length * 0.7) { // Only if in last 30%
        return index + 2;
      }
    }

    // Try word boundaries
    const spaceIndex = text.lastIndexOf(' ');
    if (spaceIndex > text.length * 0.8) { // Only if in last 20%
      return spaceIndex + 1;
    }

    // Fall back to character limit
    return Math.floor(text.length * 0.95);
  }

  /**
   * Summarize long content
   */
  summarizeContent(content: string, options: SummarizeOptions = DEFAULT_SUMMARIZE_OPTIONS): string {
    const {
      maxLines,
      maxMatches,
      addTruncationNotice,
    } = { ...DEFAULT_SUMMARIZE_OPTIONS, ...options };

    const lines = content.split('\n');

    // Truncate line-based content
    if (lines.length > (maxLines || 50)) {
      const truncated = lines.slice(0, maxLines || 50).join('\n');
      const notice = addTruncationNotice
        ? `\n\n_... (${lines.length - (maxLines || 50)} more lines)_`
        : '';
      return truncated + notice;
    }

    // Truncate match-based content (grep results)
    const matchCount = this.countMatches(content);
    if (maxMatches && matchCount > maxMatches) {
      const summarized = this.truncateMatches(content, maxMatches);
      const notice = addTruncationNotice
        ? `\n\n_... (${matchCount - maxMatches} more matches)_`
        : '';
      return summarized + notice;
    }

    return content;
  }

  /**
   * Count matches in grep-style output
   */
  private countMatches(content: string): number {
    // Count lines that look like file:line:content (grep output)
    const lines = content.split('\n');
    return lines.filter(line =>
      line.match(/^.+:\d+:/) || line.includes('Results:')
    ).length;
  }

  /**
   * Truncate matches to specified count
   */
  private truncateMatches(content: string, maxMatches: number): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let matchCount = 0;

    for (const line of lines) {
      // Keep non-match lines
      if (!line.match(/^.+:\d+:/)) {
        result.push(line);
        continue;
      }

      // Truncate match lines
      if (matchCount < maxMatches) {
        result.push(line);
        matchCount++;
      } else {
        break;
      }
    }

    return result.join('\n');
  }

  /**
   * Format file read output
   */
  formatFileRead(
    filePath: string,
    content: string,
    totalLines: number,
    options: SummarizeOptions = {}
  ): string {
    const lines = content.split('\n');
    const isTruncated = options.maxLines && lines.length > options.maxLines;

    let formatted = `📄 *${this.sanitizePath(filePath)}*\n\n`;

    if (isTruncated) {
      formatted += '_(Showing first ' + options.maxLines + ' lines)_\n\n';
    }

    formatted += '```\n' + content + '\n```';

    if (isTruncated && options.addTruncationNotice) {
      formatted += '\n\n_' + (totalLines - lines.length) + ' more lines_';
    }

    return formatted;
  }

  /**
   * Format search results
   */
  formatSearchResults(
    searchTerm: string,
    results: Array<{ file: string; line: number; content: string }>,
    totalMatches: number,
    options: SummarizeOptions = {}
  ): string {
    const maxResults = options.maxMatches || 20;
    const shown = Math.min(results.length, maxResults);
    const isTruncated = totalMatches > maxResults;

    let formatted = `🔍 *Search: "${searchTerm}"*\n\n`;

    if (shown > 0) {
      formatted += '*Found ' + totalMatches + ' matches*_\n\n';

      for (let i = 0; i < shown; i++) {
        const result = results[i];
        formatted +=
          '`' + this.sanitizePath(result.file) + ':' + result.line + '`\n' +
          '    ' + this.escapeInline(result.content) + '\n\n';
      }
    } else {
      formatted += '_No matches found_';
    }

    if (isTruncated && options.addTruncationNotice) {
      formatted += '\n\n_(' + (totalMatches - shown) + ' more matches)_';
    }

    return formatted;
  }

  /**
   * Format diff output
   */
  formatDiff(diff: string): string {
    const lines = diff.split('\n');
    let formatted = '📝 *Diff*\n\n';

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        formatted += '+' + this.escapeInline(line.slice(1)) + '\n';
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        formatted += '-' + this.escapeInline(line.slice(1)) + '\n';
      } else if (line.startsWith('@@')) {
        formatted += '_' + line + '_\n';
      } else {
        formatted += line + '\n';
      }
    }

    return formatted;
  }

  /**
   * Format error message
   */
  formatError(error: string): string {
    return '❌ *Error*\n\n' + this.escapeInline(error);
  }

  /**
   * Format success message
   */
  formatSuccess(message: string): string {
    return '✅ ' + this.escapeInline(message);
  }

  /**
   * Format info message
   */
  formatInfo(message: string): string {
    return 'ℹ️ ' + this.escapeInline(message);
  }

  /**
   * Format warning message
   */
  formatWarning(message: string): string {
    return '⚠️ ' + this.escapeInline(message);
  }

  /**
   * Sanitize file path for display
   */
  private sanitizePath(path: string): string {
    // Remove sensitive parts of path
    const parts = path.split(/[/\\]/);
    if (parts.length > 3) {
      return '.../' + parts.slice(-3).join('/');
    }
    return path;
  }

  /**
   * Escape inline text (preserve formatting but remove special chars)
   */
  private escapeInline(text: string): string {
    // Just remove characters that could break formatting
    return text
      .replace(/[*_`[\]]/g, '')
      .trim();
  }

  /**
   * Set parse mode
   */
  setParseMode(mode: 'Markdown' | 'MarkdownV2' | 'HTML' | null): void {
    this.parseMode = mode;
  }

  /**
   * Get current parse mode
   */
  getParseMode(): 'Markdown' | 'MarkdownV2' | 'HTML' | null {
    return this.parseMode;
  }
}

/**
 * Default singleton instance
 */
let defaultFormatter: ResponseFormatter | null = null;

export function getResponseFormatter(parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' | null): ResponseFormatter {
  if (!defaultFormatter) {
    defaultFormatter = new ResponseFormatter(parseMode);
  } else if (parseMode !== undefined) {
    defaultFormatter.setParseMode(parseMode);
  }
  return defaultFormatter;
}
