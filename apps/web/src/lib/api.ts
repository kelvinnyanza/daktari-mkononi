/**
 * Browser API client for the portal.
 *
 * WHY DIRECT CLIENT FETCH (not a Next.js server proxy):
 *  1. The platform's token strategy is "access token in memory, refresh token
 *     in an httpOnly cookie scoped to /api/v1/auth/refresh". A server proxy
 *     cannot hold a per-user in-memory access token across requests without
 *     inventing a server-side session store — which is exactly the stateful
 *     surface (and extra secret at rest) the strategy avoids.
 *  2. The API already owns every authorization and audit decision. Proxying
 *     would duplicate that boundary in a second process with no added check.
 *  3. CORS is already configured for exactly one origin (`APP_URL`) with
 *     `credentials: true`, and `SameSite=Strict` still applies because
 *     app.daktari.co.tz and api.daktari.co.tz are the same *site* (SameSite is
 *     registrable-domain based; ports and subdomains do not split a site).
 *     The same holds for localhost:3000 → localhost:4000 in development.
 *  Cost accepted: the API URL is public and every page is a client component
 *  below the auth gate. For an internal operational console, that is fine —
 *  there is no SEO or first-paint-from-server requirement.
 *
 * Token handling mirrors the mobile client (single-flight refresh, one retry)
 * with the refresh token replaced by the cookie the browser attaches itself.
 */
import { API_BASE_URL } from './config';

export interface BilingualMessage {
  sw: string;
  en: string;
}

/** Typed error parsed from the server's bilingual envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly userMessage: BilingualMessage | undefined,
    readonly requestId: string | undefined,
    readonly details?: unknown,
  ) {
    super(userMessage?.en ?? code);
    this.name = 'ApiError';
  }
}

/** Network-level failure (server down, DNS, offline). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network request failed', { cause });
    this.name = 'NetworkError';
  }
}

// ── In-memory access token ───────────────────────────────────────────────────
// Never localStorage/sessionStorage: any XSS could read those. A reload loses
// the token and the app silently re-refreshes from the httpOnly cookie.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// ── Session-expired notification (the auth provider redirects to /login) ─────
type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

export function onSessionExpired(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function failSession(): never {
  accessToken = null;
  for (const listener of sessionListeners) listener();
  throw new ApiError(401, 'SESSION_REVOKED', undefined, undefined);
}

// ── Single-flight refresh ────────────────────────────────────────────────────
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchange the httpOnly refresh cookie for a new access token. No body is
 * sent — the browser attaches the cookie because the request goes to
 * /api/v1/auth/refresh, the only path the cookie is scoped to.
 */
export async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // the cookie IS the credential
        // Required: /refresh rejects a cookie without this header (CSRF).
        headers: { 'x-daktari-client': 'web' },
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Let the NEXT expiry start a fresh flight; the current burst already
      // holds this promise.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

// ── Request core ─────────────────────────────────────────────────────────────
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (login, refresh). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // Sent on EVERY request, not just /login: it selects the cookie strategy
    // on login, and /refresh rejects a cookie-authenticated call without it
    // (the second CSRF layer — see CLAUDE.md).
    'x-daktari-client': 'web',
  };
  if (!options.anonymous && accessToken !== null) {
    headers['authorization'] = `Bearer ${accessToken}`;
  }
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    throw new NetworkError(error);
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message: BilingualMessage | undefined;
  let requestId: string | undefined;
  let details: unknown;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: BilingualMessage; requestId?: string; details?: unknown };
    };
    code = body.error?.code ?? code;
    message = body.error?.message;
    requestId = body.error?.requestId;
    details = body.error?.details;
  } catch {
    // Non-JSON body (proxy error page) — keep status + UNKNOWN.
  }
  return new ApiError(response.status, code, message, requestId, details);
}

/**
 * JSON request. On 401 TOKEN_EXPIRED/TOKEN_MISSING: single-flight refresh then
 * exactly ONE retry. On SESSION_REVOKED (or a failed refresh) the session
 * listeners fire and the caller is bounced to /login.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options);

  if (response.status === 401 && !options.anonymous) {
    const error = await parseError(response.clone());
    if (error.code === 'SESSION_REVOKED') {
      failSession();
    }
    if (error.code === 'TOKEN_EXPIRED' || error.code === 'TOKEN_MISSING') {
      const refreshed = await refreshAccessToken();
      if (!refreshed) failSession();
      response = await rawRequest(path, options); // exactly one retry
      if (response.status === 401) failSession();
    }
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Convenience wrappers so screens read as intent, not plumbing. */
export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    apiRequest<T>(path, signal !== undefined ? { signal } : {}),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'POST', ...(body !== undefined ? { body } : {}) }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'PATCH', ...(body !== undefined ? { body } : {}) }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(path, { method: 'PUT', ...(body !== undefined ? { body } : {}) }),
  delete: <T>(path: string): Promise<T> => apiRequest<T>(path, { method: 'DELETE' }),
};
