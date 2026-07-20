import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { env } from '@daktari/config';
import { TokenError } from '@daktari/auth';

/** Swahili-first user-facing message envelope. */
export interface BilingualMessage {
  sw: string;
  en: string;
}

export function msg(sw: string, en: string): BilingualMessage {
  return { sw, en };
}

/** Operational error carrying an HTTP status, machine code, and bilingual text. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly userMessage: BilingualMessage,
    readonly details?: unknown,
  ) {
    super(userMessage.en);
    this.name = 'ApiError';
  }
}

export const unauthorized = (code: string, message: BilingualMessage): ApiError =>
  new ApiError(401, code, message);

export const forbidden = (message: BilingualMessage): ApiError =>
  new ApiError(403, 'PERMISSION_DENIED', message);

interface ErrorBody {
  error: {
    code: string;
    message: BilingualMessage;
    requestId: string;
    details?: unknown;
  };
}

function body(
  request: FastifyRequest,
  code: string,
  message: BilingualMessage,
  details?: unknown,
): ErrorBody {
  return {
    error: {
      code,
      message,
      requestId: request.id,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

const MESSAGES = {
  validation: msg('Taarifa ulizotuma si sahihi', 'The submitted data is invalid'),
  tokenExpired: msg('Muda wa kikao umeisha — ingia tena', 'Your session token has expired — please sign in again'),
  tokenInvalid: msg('Kikao si halali', 'Invalid session token'),
  rateLimited: msg('Maombi mengi mno — jaribu tena baadaye', 'Too many requests — try again later'),
  notFound: msg('Huduma haipatikani', 'Resource not found'),
  internal: msg('Hitilafu imetokea upande wetu — jaribu tena', 'Something went wrong on our side — please try again'),
};

/**
 * Central error mapper. Order matters: specific domain errors first, then
 * framework errors, then the 500 catch-all (generic message in production,
 * requestId always present so users can quote it to support).
 */
export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    void reply.code(400).send(body(request, 'VALIDATION_ERROR', MESSAGES.validation, details));
    return;
  }

  if (error instanceof TokenError) {
    if (error.code === 'EXPIRED') {
      void reply.code(401).send(body(request, 'TOKEN_EXPIRED', MESSAGES.tokenExpired));
      return;
    }
    void reply.code(401).send(body(request, 'TOKEN_INVALID', MESSAGES.tokenInvalid));
    return;
  }

  if (error instanceof ApiError) {
    void reply
      .code(error.statusCode)
      .send(body(request, error.code, error.userMessage, error.details));
    return;
  }

  const statusCode = 'statusCode' in error ? error.statusCode : undefined;

  if (statusCode === 429) {
    void reply.code(429).send(body(request, 'RATE_LIMITED', MESSAGES.rateLimited));
    return;
  }

  // Other client-side framework errors (bad content-type, malformed JSON, …)
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    void reply.code(statusCode).send(body(request, 'BAD_REQUEST', MESSAGES.validation));
    return;
  }

  request.log.error({ err: error }, 'unhandled error');
  const internal =
    env.NODE_ENV === 'production'
      ? MESSAGES.internal
      : msg(`${MESSAGES.internal.sw}: ${error.message}`, `${MESSAGES.internal.en}: ${error.message}`);
  void reply.code(500).send(body(request, 'INTERNAL_ERROR', internal));
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  void reply.code(404).send(body(request, 'NOT_FOUND', MESSAGES.notFound));
}

export { MESSAGES };
