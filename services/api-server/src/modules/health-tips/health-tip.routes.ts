import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  createHealthTipSchema,
  idSchema,
  listAdminTipsQuerySchema,
  listPublicTipsQuerySchema,
  updateHealthTipSchema,
} from '@daktari/schemas';
import type { StoragePort } from '@daktari/storage';
import { z } from 'zod';
import { authorize, authorizeAny, makeAuthenticate } from '../../middleware/authenticate.js';
import type { LocalFileReader, SessionRepoPort } from '../../lib/ports.js';
import type { Actor, HealthTipService } from './health-tip.service.js';

const idParams = z.object({ id: idSchema });
const slugParams = z.object({ slug: z.string().trim().min(3).max(80).regex(/^[a-z0-9-]+$/) });
const previewQuery = z.object({ preview: z.literal('drafts').optional() });
const uploadUrlBody = z.object({
  fileName: z.string().trim().min(3).max(200),
  contentType: z.string().trim().min(3).max(100),
  size: z.number().int().positive(),
});
const completeUploadBody = z.object({ key: z.string().trim().min(10).max(200), fileName: z.string().trim().min(3).max(200) });

/**
 * Conditional GET: the ETag is a hash of the exact JSON the client would
 * receive, so it changes whenever the content does — including a tip
 * entering or leaving its publish window. A matching If-None-Match gets an
 * empty 304: the app re-downloads only when something changed.
 */
function sendWithEtag(request: FastifyRequest, reply: FastifyReply, payload: unknown): FastifyReply {
  const body = JSON.stringify(payload);
  const etag = `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
  reply.header('etag', etag).header('cache-control', 'no-cache').header('vary', 'Accept-Encoding');
  const match = request.headers['if-none-match'];
  if (match !== undefined && match.split(',').some((tag) => tag.trim() === etag)) {
    return reply.code(304).send();
  }
  return reply.type('application/json; charset=utf-8').send(body);
}

/** Public, unauthenticated patient-app routes — mounted at /api/v1/health-tips. */
export function buildPublicHealthTipRoutes(
  service: HealthTipService,
  storage: StoragePort,
  localFiles: LocalFileReader,
): FastifyPluginAsync {
  return async (app) => {
    app.get('/', async (request, reply) => {
      const query = listPublicTipsQuerySchema.parse(request.query);
      return sendWithEtag(request, reply, await service.listPublic(query));
    });

    app.get('/:slug', async (request, reply) => {
      const { slug } = slugParams.parse(request.params);
      const { preview } = previewQuery.parse(request.query);
      return sendWithEtag(request, reply, await service.getPublic(slug, preview));
    });

    // Versioned URL (?v=) → long cache: a new image gets a new URL.
    app.get('/:id/image', async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const { key } = await service.publicImage(id);
      reply.header('cache-control', 'public, max-age=604800');
      if (localFiles === null) return reply.redirect(await storage.getSignedUrl(key, 3600));
      const stat = await storage.stat(key);
      return reply.type(stat?.contentType ?? 'application/octet-stream').send(await localFiles(key));
    });
  };
}

/** Editor / reviewer routes — mounted at /api/v1/admin/health-tips. */
export function buildAdminHealthTipRoutes(
  service: HealthTipService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);
  const actorOf = (request: FastifyRequest): Actor => ({ userId: request.auth!.userId, role: request.auth!.role });
  const canRead = [authenticate, authorizeAny(['content:manage', 'content:review'])];
  const canManage = [authenticate, authorize('content:manage')];

  return async (app) => {
    app.get('/', { preHandler: canRead }, async (request) =>
      service.listAdmin(listAdminTipsQuerySchema.parse(request.query)),
    );

    app.get('/:id', { preHandler: canRead }, async (request) => {
      const { id } = idParams.parse(request.params);
      return service.getAdmin(id);
    });

    app.post('/', { preHandler: canManage }, async (request, reply) => {
      const input = createHealthTipSchema.parse(request.body);
      return reply.code(201).send(await service.create(actorOf(request), input));
    });

    app.patch('/:id', { preHandler: canManage }, async (request) => {
      const { id } = idParams.parse(request.params);
      return service.update(actorOf(request), id, updateHealthTipSchema.parse(request.body));
    });

    app.post('/:id/review', { preHandler: [authenticate, authorize('content:review')] }, async (request) => {
      const { id } = idParams.parse(request.params);
      return service.review(actorOf(request), id);
    });

    for (const action of ['publish', 'archive', 'restore'] as const) {
      app.post(`/:id/${action}`, { preHandler: canManage }, async (request) => {
        const { id } = idParams.parse(request.params);
        return service[action](actorOf(request), id);
      });
    }

    app.post('/:id/image/upload-url', { preHandler: canManage }, async (request) => {
      const { id } = idParams.parse(request.params);
      return service.createImageUpload(actorOf(request), id, uploadUrlBody.parse(request.body));
    });

    app.post('/:id/image/complete', { preHandler: canManage }, async (request) => {
      const { id } = idParams.parse(request.params);
      return service.completeImageUpload(actorOf(request), id, completeUploadBody.parse(request.body));
    });

    app.delete('/:id/image', { preHandler: canManage }, async (request) => {
      const { id } = idParams.parse(request.params);
      return service.removeImage(actorOf(request), id);
    });
  };
}
