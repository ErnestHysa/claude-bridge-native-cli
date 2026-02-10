/**
 * Automation markdown parser.
 */

export interface AutomationFrontmatter {
  [key: string]: string | number | boolean | string[] | undefined;
  'automation-id'?: string;
  schedule?: string;
  timezone?: string;
  status?: string;
  'created-by'?: string;
  'created-at'?: string;
  'chat-id'?: number;
  'project-paths'?: string[];
  action?: string;
  'max-concurrent-tasks'?: number;
  'max-runs-per-day'?: number;
  'max-task-duration-minutes'?: number;
}

export interface ParsedAutomationFile {
  frontmatter: AutomationFrontmatter;
  body: string;
}

export function parseAutomationMarkdown(content: string): ParsedAutomationFile {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content.trim() };
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content.trim() };
  }

  const frontmatterBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();

  const frontmatter = parseFrontmatter(frontmatterBlock);

  return { frontmatter, body };
}

export function extractSection(body: string, heading: string): string | null {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im');
  const match = pattern.exec(body);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = body.slice(start).trimStart();
  const nextHeading = rest.match(/^##\s+/m);
  if (!nextHeading) {
    return rest.trim();
  }

  return rest.slice(0, nextHeading.index).trim();
}

function parseFrontmatter(block: string): AutomationFrontmatter {
  const lines = block.split(/\r?\n/);
  const data: AutomationFrontmatter = {};
  let currentListKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('- ') && currentListKey) {
      const value = line.slice(2).trim();
      const list = (data[currentListKey] as string[] | undefined) ?? [];
      list.push(stripQuotes(value));
      data[currentListKey] = list;
      continue;
    }

    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, valueRaw] = match;
    currentListKey = null;

    if (!valueRaw) {
      data[key] = [];
      currentListKey = key;
      continue;
    }

    const value = stripQuotes(valueRaw.trim());
    data[key] = parseScalar(value);
  }

  return data;
}

function parseScalar(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;

  const numberValue = Number(value);
  if (!Number.isNaN(numberValue) && value !== '') {
    return numberValue;
  }

  return value;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
