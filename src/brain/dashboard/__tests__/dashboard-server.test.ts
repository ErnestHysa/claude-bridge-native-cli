import { afterEach, describe, expect, it } from 'vitest';
import { DashboardServer } from '../dashboard-server.js';

let dashboard: DashboardServer | null = null;

afterEach(() => {
  dashboard?.stop();
  dashboard = null;
});

describe('DashboardServer', () => {
  it('serves health endpoint', async () => {
    dashboard = new DashboardServer({ port: 0 });
    dashboard.start();

    let port: number | null = null;
    for (let i = 0; i < 20; i++) {
      port = dashboard.getPort();
      if (port) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(port).toBeTruthy();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const json = await response.json() as { ok: boolean };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
  });
});
