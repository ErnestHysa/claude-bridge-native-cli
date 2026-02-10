import { describe, it, expect } from 'vitest';
import { parseClaudeOutput } from '../claude-spawner.js';

describe('parseClaudeOutput', () => {
  it('extracts file edits from common action markers', () => {
    const output = [
      'Modified: src/index.ts',
      'Created src/new-file.ts',
      'Deleted: src/old-file.ts',
    ].join('\n');

    const parsed = parseClaudeOutput(output);

    expect(parsed.edits).toEqual([
      { action: 'modify', path: 'src/index.ts' },
      { action: 'create', path: 'src/new-file.ts' },
      { action: 'delete', path: 'src/old-file.ts' },
    ]);
  });

  it('collects error-like lines as errors', () => {
    const output = [
      'Build started',
      'ERROR: unable to run test suite',
      'failed to update dependencies',
    ].join('\n');

    const parsed = parseClaudeOutput(output);
    expect(parsed.errors).toEqual([
      'ERROR: unable to run test suite',
      'failed to update dependencies',
    ]);
  });
});
