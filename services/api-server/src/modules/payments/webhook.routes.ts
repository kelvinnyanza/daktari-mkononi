import type { FastifyPluginAsync } from 'fastify';
import {
  azamPayCallbackSchema,
  azamPayDisbursementCallbackSchema,
  type AzamPayDisbursementCallbackBody,
  type MobileMoneyPort,
} from '@daktari/payments';
import type { AuditLogPort } from '../../lib/ports.js';
import type { PaymentService } from './payment.service.js';

/**
 * POST /webhooks/azampay — deliberately NO authentication middleware: trust
 * comes from AzamPay's RSA signature AND from confirming with AzamPay itself.
 *
 * Checkout callbacks (AzamPay CallbackRequest: utilityref,
 * transactionstatus, …, signature) are signature-checked against the
 * configured public key (env, never fetched); a PRESENT-but-invalid signature
 * is refused 401 (audited). Every accepted callback is then checked with a
 * best-effort status query (see PaymentService.handleCheckoutCallback) —
 * unsigned callbacks never apply on their own.
 *
 * Disbursement callbacks (payouts, refunds) carry no documented signature, so
 * their bodies are never trusted; they only trigger a status query.
 *
 * Idempotent end-to-end: replays are 200 no-ops; unknown references answer
 * 200 (audited) so the provider is never taught to retry.
 */
export function buildAzamPayWebhookRoutes(
  service: PaymentService,
  mobileMoney: MobileMoneyPort,
  auditLogs: AuditLogPort,
  onDisbursementCallback: (body: AzamPayDisbursementCallbackBody) => Promise<string>,
): FastifyPluginAsync {
  return async (app) => {
    // Scoped parser: a malformed body is OUR 400, not Fastify's generic error.
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => done(null, body),
    );

    app.post('/', async (request, reply) => {
      const rawBody = typeof request.body === 'string' ? request.body : '';
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return reply.code(400).send({ error: { code: 'MALFORMED_BODY' } });
      }

      const checkout = azamPayCallbackSchema.safeParse(json);
      if (checkout.success) {
        const body = checkout.data;
        const signature = await mobileMoney.verifyCallbackSignature({
          utilityref: body.utilityref,
          externalreference: body.externalreference ?? '',
          transactionstatus: body.transactionstatus,
          operator: body.operator ?? '',
          signature: body.signature,
        });
        if (signature === 'invalid') {
          await auditLogs.append({
            actorUserId: null,
            action: 'WEBHOOK_SIGNATURE_INVALID',
            resourceType: 'Payment',
            resourceId: null,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] ?? null,
            metadata: { utilityref: body.utilityref },
          });
          return reply.code(401).send({ error: { code: 'INVALID_SIGNATURE' } });
        }
        const result = await service.handleCheckoutCallback(body, signature);
        return reply.code(200).send({ received: true, outcome: result.outcome });
      }

      const disbursement = azamPayDisbursementCallbackSchema.safeParse(json);
      if (disbursement.success) {
        const outcome = await onDisbursementCallback(disbursement.data);
        return reply.code(200).send({ received: true, outcome });
      }

      return reply.code(400).send({ error: { code: 'INVALID_BODY' } });
    });
  };
}
