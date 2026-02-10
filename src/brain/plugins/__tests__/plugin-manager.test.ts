import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPluginManager, resetPluginManager } from '../plugin-manager.js';

const pluginsRoot = join(process.cwd(), 'plugins');

async function ensurePlugin(name: string, manifest: Record<string, unknown>, handler: string): Promise<void> {
  const dir = join(pluginsRoot, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await writeFile(join(dir, 'handler.js'), handler, 'utf-8');
}

afterEach(async () => {
  await rm(pluginsRoot, { recursive: true, force: true });
  resetPluginManager();
});

describe('PluginManager', () => {
  it('loads valid plugin and executes it', async () => {
    await ensurePlugin(
      'ok-plugin',
      {
        name: 'ok-plugin',
        version: '1.0.0',
        entry: './handler.js',
      },
      'export default function(input){ return { ok: true, input }; }',
    );

    const manager = getPluginManager();
    await manager.initialize();

    const list = manager.listPlugins();
    expect(list.find((p) => p.name === 'ok-plugin')).toBeTruthy();

    const result = await manager.runPlugin('ok-plugin', { hello: 'world' });
    expect(result).toEqual({ ok: true, input: { hello: 'world' } });
  });

  it('skips invalid manifest and blocks path traversal entries', async () => {
    await ensurePlugin(
      'bad-manifest',
      {
        version: '1.0.0',
        entry: './handler.js',
      },
      'export default function(){ return { ok: true }; }',
    );

    await ensurePlugin(
      'traversal',
      {
        name: 'traversal',
        version: '1.0.0',
        entry: '../outside.js',
      },
      'export default function(){ return { bad: true }; }',
    );

    const manager = getPluginManager();
    await manager.initialize();

    const names = manager.listPlugins().map((p) => p.name);
    expect(names).not.toContain('traversal');
    expect(names).not.toContain('bad-manifest');
  });
});
