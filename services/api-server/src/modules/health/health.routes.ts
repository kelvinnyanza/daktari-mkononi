import type { FastifyPluginAsync } from 'fastify';
import type { HealthChecks } from '../../lib/ports.js';

type CheckState = 'ok' | 'error' | 'skipped';

async function run(check: (() => Promise<void>) | null): Promise<CheckState> {
  if (check === null) return 'skipped';
  try {
    await check();
    return 'ok';
  } catch {
    return 'error';
  }
}

export function buildHealthRoutes(health: HealthChecks): FastifyPluginAsync {
  return async (app) => {
    // Liveness: process is up and the event loop responds.
    app.get('/health', async () => ({ status: 'ok' }));

    // Readiness: dependencies answer. 503 keeps the pod out of rotation.
    app.get('/health/ready', async (_request, reply) => {
      const [database, redis] = await Promise.all([run(health.db), run(health.redis)]);
      const ready = database !== 'error' && redis !== 'error';
      return reply.code(ready ? 200 : 503).send({
        status: ready ? 'ready' : 'not_ready',
        checks: { database, redis },
      });
    });
  };
}
