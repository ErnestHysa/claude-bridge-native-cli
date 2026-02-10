/**
 * Plugin Manager - load and execute plugins
 *
 * Plugins live in /plugins with a manifest.json and handler.ts/js entry.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger } from '../../utils.js';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  entry: string;
  capabilities?: string[];
}

function isValidManifest(manifest: unknown): manifest is PluginManifest {
  if (!manifest || typeof manifest !== 'object') return false;
  const data = manifest as Partial<PluginManifest>;
  return (
    typeof data.name === 'string' && data.name.trim().length > 0 &&
    typeof data.version === 'string' && data.version.trim().length > 0 &&
    typeof data.entry === 'string' && data.entry.trim().length > 0
  );
}

export interface PluginContext {
  now: number;
  logger: Logger;
}

export type PluginHandler = (input: unknown, context: PluginContext) => Promise<unknown> | unknown;

interface LoadedPlugin {
  manifest: PluginManifest;
  handler: PluginHandler;
  path: string;
}

let pluginManagerInstance: PluginManager | null = null;

export class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();
  private logger = new Logger('info');

  async initialize(): Promise<void> {
    await this.loadPlugins();
  }

  async loadPlugins(): Promise<void> {
    this.plugins.clear();
    const pluginDirs = await this.resolvePluginDirs();

    for (const dir of pluginDirs) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginPath = join(dir, entry.name);
        const manifestPath = join(pluginPath, 'manifest.json');
        if (!existsSync(manifestPath)) continue;

        try {
          const rawManifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
          if (!isValidManifest(rawManifest)) {
            this.logger.warn('Plugin manifest is invalid and was skipped', {
              pluginPath,
              manifestPath,
            });
            continue;
          }

          const manifest = rawManifest;

          if (this.plugins.has(manifest.name)) {
            this.logger.warn(`Duplicate plugin name detected: ${manifest.name}. Skipping duplicate.`, {
              pluginPath,
            });
            continue;
          }
          const handlerPath = await this.resolveHandlerPath(pluginPath, manifest.entry);
          const handlerModule = await import(pathToFileURL(handlerPath).toString());
          const handler = handlerModule.default as PluginHandler | undefined;

          if (!handler) {
            this.logger.warn(`Plugin ${manifest.name} has no default export handler`, {
              pluginPath,
            });
            continue;
          }

          this.plugins.set(manifest.name, {
            manifest,
            handler,
            path: pluginPath,
          });
        } catch (error) {
          this.logger.error(`Failed to load plugin at ${pluginPath}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  listPlugins(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((plugin) => plugin.manifest);
  }

  async runPlugin(name: string, input: unknown): Promise<unknown> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    const context: PluginContext = {
      now: Date.now(),
      logger: this.logger,
    };

    return await plugin.handler(input, context);
  }

  private async resolvePluginDirs(): Promise<string[]> {
    const root = resolve(process.cwd());
    const distPlugins = join(root, 'dist', 'plugins');
    const srcPlugins = join(root, 'src', 'plugins');
    const rootPlugins = join(root, 'plugins');

    return [distPlugins, srcPlugins, rootPlugins].filter((dir) => existsSync(dir));
  }

  private async resolveHandlerPath(pluginPath: string, entry: string): Promise<string> {
    const resolved = resolve(pluginPath, entry);
    const pluginRoot = resolve(pluginPath);

    const isInsidePluginRoot = (path: string) => {
      const normalized = resolve(path);
      return normalized === pluginRoot || normalized.startsWith(`${pluginRoot}/`) || normalized.startsWith(`${pluginRoot}\\`);
    };

    if (!isInsidePluginRoot(resolved)) {
      throw new Error(`Plugin entry resolves outside plugin directory: ${entry}`);
    }

    if (existsSync(resolved)) {
      return resolved;
    }

    const candidates = [
      resolved.replace(/\.js$/, '.ts'),
      resolved.replace(/\.js$/, '.mjs'),
      resolved.replace(/\.js$/, '.cjs'),
    ];

    for (const candidate of candidates) {
      if (!isInsidePluginRoot(candidate)) {
        continue;
      }
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Plugin entry not found: ${entry}`);
  }
}

export function getPluginManager(): PluginManager {
  if (!pluginManagerInstance) {
    pluginManagerInstance = new PluginManager();
  }
  return pluginManagerInstance;
}

export function resetPluginManager(): void {
  pluginManagerInstance = null;
}
