import type { FastifyPluginAsync } from 'fastify';
import { env } from '@daktari/config';
import { azamPayWebhookSchema, verifyAzamPayWebhookSignature } from '@daktari/payments';
import type { AuditLogPort } from '../../lib/ports.js';
import type { PaymentService } from './payment.service.js';

/**
 * POST /webhooks/azampay — deliberately NO authentication middleware.
 * Trust comes from the HMAC signature over the RAW body, verified before any
 * parsing side effects. The handler is idempotent end-to-end: replays and
 * duplicate deliveries of a terminal event are 200 no-ops, and unknown
 * references answer 200 (audited) so the provider is never taught to retry.
 */
export function buildAzamPayWebhookRoutes(
  service: PaymentService,
  auditLogs: AuditLogPort,
): FastifyPluginAsync {
  return async (app) => {
    // Scoped raw-body parser: signature verification needs the exact bytes.
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => done(null, body),
    );

    app.post('/', async (request, reply) => {
      const rawBody = typeof request.body === 'string' ? request.body : '';
      const signature = request.headers['x-azampay-signature'];

      // (1) Signature FIRST — before any parsing side effects.
      const valid = verifyAzamPayWebhookSignature(
        rawBody,
        typeof signature === 'string' ? signature : undefined,
        env.AZAMPAY_WEBHOOK_SECRET,
      );
      if (!valid) {
        await auditLogs.append({
          actorUserId: null,
          action: 'WEBHOOK_SIGNATURE_INVALID',
          resourceType: 'Payment',
          resourceId: null,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
        return reply.code(401).send({ error: { code: 'INVALID_SIGNATURE' } });
      }

      // (2) Zod-validate the body — provider payloads are never trusted.
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return reply.code(400).send({ error: { code: 'MALFORMED_BODY' } });
      }
      const parsed = azamPayWebhookSchema.safeParse(json);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'INVALID_BODY' } });
      }

      // (3) Idempotent processing; (4) always 200 for known-shape events —
      // duplicates and unknown references are no-ops, never provider retries.
      const result = await service.handleWebhook(parsed.data);
      return reply.code(200).send({ received: true, outcome: result.outcome });
    });
  };
}
