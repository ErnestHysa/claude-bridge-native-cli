/**
 * Subagent Templates - Load specialized agent templates
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATE_DIR = join(process.cwd(), 'src', 'brain', 'agents', 'templates');

export interface AgentTemplate {
  filename: string;
  content: string;
}

export async function listAgentTemplates(): Promise<string[]> {
  if (!existsSync(TEMPLATE_DIR)) {
    return [];
  }

  const files = await readdir(TEMPLATE_DIR);
  return files.filter(file => file.endsWith('.md'));
}

export async function loadAgentTemplate(name: string): Promise<AgentTemplate | null> {
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const path = join(TEMPLATE_DIR, filename);

  if (!existsSync(path)) {
    return null;
  }

  const content = await readFile(path, 'utf-8');
  return { filename, content };
}
