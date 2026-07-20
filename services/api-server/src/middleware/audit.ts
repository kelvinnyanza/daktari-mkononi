import type { FastifyInstance } from 'fastify';
import type { AuditLogPort } from '../lib/ports.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * PDPA audit trail: every authenticated mutating request, plus any route
 * flagged `config.audit = 'phi-read'`, appends an AuditLog row. Runs in
 * onResponse (after the reply is sent) and swallows its own failures — the
 * audit write must never block or fail the response.
 */
export function registerAuditHook(app: FastifyInstance, auditLogs: AuditLogPort): void {
  app.addHook('onResponse', (request, reply, done) => {
    const auth = request.auth;
    const phiRead = request.routeOptions.config.audit === 'phi-read';
    if (auth !== null && (MUTATING.has(request.method) || phiRead)) {
      void auditLogs
        .append({
          actorUserId: auth.userId,
          action: `${request.method} ${request.routeOptions.url ?? request.url}`,
          resourceType: phiRead && !MUTATING.has(request.method) ? 'PHI_READ' : 'HTTP_MUTATION',
          resourceId: null,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          metadata: { statusCode: reply.statusCode, requestId: request.id },
        })
        .catch((error: unknown) => {
          request.log.warn({ err: error }, 'audit log write failed');
        });
    }
    done();
  });
}
