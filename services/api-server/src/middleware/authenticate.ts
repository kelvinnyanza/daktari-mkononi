import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { hasPermission, verifyAccessToken, type Permission } from '@daktari/auth';
import { forbidden, msg, unauthorized } from '../lib/errors.js';
import type { SessionRepoPort } from '../lib/ports.js';

const SESSION_INVALID = msg('Kikao si halali — ingia tena', 'Invalid session — sign in again');

/**
 * Bearer token → verify (typed TokenErrors bubble to the error handler) →
 * confirm the session is live → attach { userId, role, sessionId }.
 */
export function makeAuthenticate(
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): preHandlerAsyncHookHandler {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw unauthorized('TOKEN_MISSING', msg('Unahitaji kuingia kwanza', 'Authentication required'));
    }
    const payload = await verifyAccessToken(header.slice('Bearer '.length));
    const session = await sessions.findById(payload.sessionId);
    if (!session || session.revokedAt !== null || session.expiresAt <= now()) {
      throw unauthorized('SESSION_REVOKED', SESSION_INVALID);
    }
    request.auth = { userId: payload.sub, role: payload.role, sessionId: payload.sessionId };
  };
}

/** Route guard: requires authenticate to have run first. */
export function authorize(permission: Permission): preHandlerAsyncHookHandler {
  return async function authorizeHook(request: FastifyRequest): Promise<void> {
    if (request.auth === null) {
      throw unauthorized('TOKEN_MISSING', msg('Unahitaji kuingia kwanza', 'Authentication required'));
    }
    if (!hasPermission(request.auth.role, permission)) {
      throw forbidden(msg('Huna ruhusa ya kufanya kitendo hiki', 'You are not allowed to perform this action'));
    }
  };
}
