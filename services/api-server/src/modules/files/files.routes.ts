import type { FastifyPluginAsync } from 'fastify';
import { env } from '@daktari/config';
import { verifySignedFileToken } from '@daktari/storage';
import type { LocalFileReader } from '../../lib/ports.js';

/**
 * Signed-URL downloads for LocalDiskStorage: GET /api/v1/files/:token.
 * The token itself is the authorization (HMAC-signed, expiring) — no session
 * required, mirroring how an S3 presigned URL behaves. 404 for anything
 * invalid: expired, tampered, or unknown; existence is never revealed.
 */
export function buildFilesRoutes(
  localFiles: LocalFileReader,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Params: { token: string } }>('/:token', async (request, reply) => {
      const payload = verifySignedFileToken(request.params.token, env.FILE_SIGNING_SECRET, now());
      if (!payload || localFiles === null) {
        return reply.code(404).send({
          error: {
            code: 'FILE_NOT_FOUND',
            message: { sw: 'Faili halipatikani au kiungo kimeisha muda', en: 'File not found or the link has expired' },
            requestId: request.id,
          },
        });
      }
      let data: Buffer;
      try {
        data = await localFiles(payload.key);
      } catch {
        return reply.code(404).send({
          error: {
            code: 'FILE_NOT_FOUND',
            message: { sw: 'Faili halipatikani au kiungo kimeisha muda', en: 'File not found or the link has expired' },
            requestId: request.id,
          },
        });
      }
      return reply
        .header('content-type', payload.contentType)
        .header('cache-control', 'private, no-store')
        .header('content-disposition', 'attachment')
        .send(data);
    });
  };
}
