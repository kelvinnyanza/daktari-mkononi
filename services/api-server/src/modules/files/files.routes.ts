import type { FastifyPluginAsync } from 'fastify';
import { env } from '@daktari/config';
import { verifySignedFileToken, verifySignedUploadToken, type StoragePort } from '@daktari/storage';
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
  storage: Pick<StoragePort, 'put'> | null = null,
): FastifyPluginAsync {
  return async (app) => {
    /**
     * Local stand-in for S3's presigned POST: POST /api/v1/files/upload/:token
     * (multipart, the file as part "file"). The token is the authorization and
     * carries the policy — exact content type, size cap, expiry — enforced
     * here exactly as S3 enforces its POST policy. Exists only with local
     * storage; with S3 the client posts to the bucket and this answers 404.
     */
    app.post<{ Params: { token: string } }>('/upload/:token', async (request, reply) => {
      const policy = verifySignedUploadToken(request.params.token, env.FILE_SIGNING_SECRET, now());
      if (!policy || localFiles === null || storage === null) {
        return reply.code(404).send({
          error: {
            code: 'UPLOAD_URL_INVALID',
            message: { sw: 'Kiungo cha kupakia si sahihi au kimeisha muda', en: 'Upload link is invalid or has expired' },
            requestId: request.id,
          },
        });
      }
      const reject = (code: string, sw: string, en: string): ReturnType<typeof reply.send> =>
        reply.code(400).send({ error: { code, message: { sw, en }, requestId: request.id } });
      let part;
      try {
        part = await request.file({ limits: { fileSize: policy.maxBytes, files: 1 } });
      } catch {
        return reject('UPLOAD_BODY_INVALID', 'Tuma faili kama multipart/form-data', 'Send the file as multipart/form-data');
      }
      if (!part) return reject('UPLOAD_BODY_INVALID', 'Hakuna faili', 'No file in the request');
      if (part.mimetype !== policy.contentType) {
        return reject('CONTENT_TYPE_MISMATCH', 'Aina ya faili si ile iliyoombwa', `Content type must be ${policy.contentType}`);
      }
      let data: Buffer;
      try {
        data = await part.toBuffer();
      } catch {
        return reject('FILE_TOO_LARGE', 'Faili ni kubwa mno', `File exceeds ${policy.maxBytes} bytes`);
      }
      if (data.length === 0) return reject('EMPTY_FILE', 'Faili ni tupu', 'File is empty');
      await storage.put(policy.key, data, policy.contentType);
      return reply.code(204).send();
    });

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
