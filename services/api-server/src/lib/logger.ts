import type { FastifyServerOptions } from 'fastify';

/**
 * Keys whose values must never reach log output. Matches the PDPA guidance in
 * CLAUDE.md: phone numbers, credentials, OTP codes, tokens, and one-time
 * tickets (WS auth) are sensitive.
 */
const SENSITIVE_KEY = /phone|password|otp|token|authorization|secret|pepper|ticket/i;
const MAX_DEPTH = 8;

/**
 * Strip the query string from a URL before it is logged. Query strings carry
 * credentials by design in some flows (ws tickets, signed download tokens),
 * so the log path never sees them — the path alone is enough for debugging.
 */
export function maskQueryString(url: string): string {
  const cut = url.indexOf('?');
  return cut === -1 ? url : `${url.slice(0, cut)}?[REDACTED]`;
}

/**
 * Deep-copy `value` with every sensitive key redacted. Cycle- and depth-safe.
 * Errors and non-plain objects pass through untouched (pino serializes them).
 */
export function deepRedact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Error) {
    return value;
  }
  if (depth >= MAX_DEPTH || seen.has(value)) {
    return '[TRUNCATED]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item, depth + 1, seen));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    // Class instances (streams, sockets, …): leave for pino's serializers.
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : deepRedact(entry, depth + 1, seen);
  }
  return out;
}

interface SerializableRequest {
  method?: string;
  url?: string;
  ip?: string;
  socket?: unknown;
  hostname?: string;
}

/** Pino options with field-name-based deep redaction plus fixed header paths. */
export function buildLoggerOptions(
  level: string,
): Exclude<NonNullable<FastifyServerOptions['logger']>, boolean> {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      // Replaces pino's default req serializer: identical shape, but the
      // query string never reaches the log (ws tickets, signed file tokens).
      req(request: SerializableRequest): Record<string, unknown> {
        return {
          method: request.method,
          url: maskQueryString(request.url ?? ''),
          hostname: request.hostname,
          remoteAddress: request.ip,
          remotePort: (request.socket as { remotePort?: number } | undefined)?.remotePort,
        };
      },
    },
    formatters: {
      log(object: Record<string, unknown>): Record<string, unknown> {
        return deepRedact(object) as Record<string, unknown>;
      },
    },
  };
}
