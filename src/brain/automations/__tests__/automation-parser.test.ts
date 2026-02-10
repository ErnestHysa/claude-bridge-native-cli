import { describe, expect, it } from 'vitest';
import { extractSection, parseAutomationMarkdown } from '../automation-parser.js';

describe('parseAutomationMarkdown', () => {
  it('parses frontmatter including scalar values and lists', () => {
    const content = `---
automation-id: night-bug-fixer
schedule: "0 2 * * *"
timezone: "UTC"
chat-id: 12345
project-paths:
  - /workspace/project-a
  - /workspace/project-b
max-runs-per-day: 2
status: active
---

# Night Bug Fixer

## Task
Run test and fix nightly failures.
`;

    const parsed = parseAutomationMarkdown(content);
    expect(parsed.frontmatter['automation-id']).toBe('night-bug-fixer');
    expect(parsed.frontmatter.schedule).toBe('0 2 * * *');
    expect(parsed.frontmatter['chat-id']).toBe(12345);
    expect(parsed.frontmatter['project-paths']).toEqual(['/workspace/project-a', '/workspace/project-b']);
    expect(parsed.frontmatter['max-runs-per-day']).toBe(2);
    expect(parsed.body).toContain('## Task');
  });

  it('returns empty frontmatter when markdown has no valid frontmatter block', () => {
    const parsed = parseAutomationMarkdown('# plain markdown without frontmatter');
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe('# plain markdown without frontmatter');
  });
});

describe('extractSection', () => {
  const body = `# Example\n\n## Task\nFirst section content\n\n## Constraints\nSecond section content\n`;

  it('extracts section body by heading', () => {
    expect(extractSection(body, 'Task')).toBe('First section content');
    expect(extractSection(body, 'Constraints')).toBe('Second section content');
  });

  it('returns null for missing section', () => {
    expect(extractSection(body, 'Missing')).toBeNull();
  });
});
