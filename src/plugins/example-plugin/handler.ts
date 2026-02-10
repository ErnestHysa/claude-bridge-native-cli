import type { PluginContext } from '../../brain/plugins/plugin-manager.js';

export default function examplePlugin(input: unknown, context: PluginContext): unknown {
  return {
    ok: true,
    received: input ?? null,
    timestamp: context.now,
  };
}
