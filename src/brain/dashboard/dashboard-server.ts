/**
 * Dashboard Server - lightweight monitoring UI
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse } from 'node:url';
import { getBrain } from '../brain-manager.js';
import { getTaskQueue } from '../tasks/task-queue.js';
import { getOrchestrator } from '../agents/agent-orchestrator.js';
import { getMetricsTracker } from '../metrics/index.js';
import { getPluginManager } from '../plugins/plugin-manager.js';

interface DashboardConfig {
  port: number;
}

let dashboardInstance: DashboardServer | null = null;

export class DashboardServer {
  private server = createServer(this.handleRequest.bind(this));
  private config: DashboardConfig;
  private started = false;
  private activePort: number | null = null;

  constructor(config?: Partial<DashboardConfig>) {
    const port = Number.parseInt(process.env.DASHBOARD_PORT ?? '', 10);
    this.config = {
      port: Number.isNaN(port) ? 3333 : port,
      ...config,
    };
  }

  start(): void {
    if (this.started) return;

    this.server.on('error', (error) => {
      console.error('[DashboardServer] Failed to start or runtime error', error);
    });

    this.server.listen(this.config.port, () => {
      this.started = true;
      const address = this.server.address();
      if (address && typeof address === 'object') {
        this.activePort = address.port;
      } else {
        this.activePort = this.config.port;
      }
    });
  }

  stop(): void {
    if (!this.started) return;
    this.server.close(() => {
      this.started = false;
      this.activePort = null;
    });
  }

  isStarted(): boolean {
    return this.started;
  }

  getPort(): number | null {
    return this.activePort;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = parse(req.url ?? '/', true);

    if (url.pathname === '/api/health') {
      return this.respondJson(res, { ok: true, timestamp: Date.now() });
    }

    if (url.pathname === '/api/status') {
      const status = await this.getStatusSnapshot();
      return this.respondJson(res, status);
    }

    if (url.pathname === '/') {
      return this.respondHtml(res, this.renderHtml());
    }

    res.statusCode = 404;
    res.end('Not found');
  }

  private async getStatusSnapshot() {
    const brain = getBrain();
    const metrics = await getMetricsTracker().getTodayMetrics();
    const taskQueue = getTaskQueue();
    const orchestrator = getOrchestrator();
    const plugins = getPluginManager().listPlugins();

    return {
      timestamp: Date.now(),
      identity: brain.getIdentity(),
      preferences: brain.getPreferences(),
      metrics,
      tasks: {
        queued: taskQueue.getQueueLength(),
        active: taskQueue.getActiveTaskCount(),
      },
      agents: {
        active: orchestrator.getActiveAgentCount(),
        running: orchestrator.getActiveAgents().map(agent => ({
          id: agent.id,
          name: agent.name,
          status: agent.status,
        })),
      },
      plugins,
    };
  }

  private renderHtml(): string {
    return `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Claude Bridge Dashboard</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; }
            pre { background: #111; color: #eee; padding: 16px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <h1>Claude Bridge Dashboard</h1>
          <p>Use <code>/api/status</code> for JSON status.</p>
          <pre id="status">Loading...</pre>
          <script>
            async function loadStatus() {
              const res = await fetch('/api/status');
              const data = await res.json();
              document.getElementById('status').textContent = JSON.stringify(data, null, 2);
            }
            loadStatus();
            setInterval(loadStatus, 5000);
          </script>
        </body>
      </html>
    `;
  }

  private respondJson(res: ServerResponse, body: unknown): void {
    const json = JSON.stringify(body);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(json);
  }

  private respondHtml(res: ServerResponse, body: string): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body);
  }
}

export function getDashboardServer(): DashboardServer {
  if (!dashboardInstance) {
    dashboardInstance = new DashboardServer();
  }
  return dashboardInstance;
}

export function resetDashboardServer(): void {
  dashboardInstance = null;
}
