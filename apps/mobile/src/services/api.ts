/**
 * Fetch-based API client with the platform's token strategy:
 *  - access token IN MEMORY ONLY (this module's closure — never persisted)
 *  - refresh token solely in expo-secure-store (WHEN_UNLOCKED_THIS_DEVICE_ONLY)
 *  - 401 TOKEN_EXPIRED → single-flight refresh: concurrent requests await ONE
 *    refresh call, then each retries exactly once
 *  - SESSION_REVOKED or refresh failure → clear auth + notify (hard redirect)
 */
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from './config';

const REFRESH_TOKEN_KEY = 'daktari.refreshToken';
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

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

/** Network-level failure (airplane mode, DNS, timeouts). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network request failed', { cause });
    this.name = 'NetworkError';
  }
}

// ── In-memory access token (never persisted anywhere) ────────────────────────
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// ── Refresh token (SecureStore only) ─────────────────────────────────────────
export async function storeRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, SECURE_OPTIONS);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

// ── Session-expired notification (root layout subscribes → redirect) ─────────
type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

export function onSessionExpired(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

async function failSession(): Promise<never> {
  await clearTokens();
  for (const listener of sessionListeners) listener();
  throw new ApiError(401, 'SESSION_REVOKED', undefined, undefined);
}

// ── Single-flight refresh ────────────────────────────────────────────────────
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  // Concurrent callers share ONE refresh network call.
  refreshInFlight ??= (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (refreshToken === null) return false;
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { accessToken: string; refreshToken: string };
      accessToken = body.accessToken;
      await storeRefreshToken(body.refreshToken); // rotation: always the newest
      return true;
    } catch {
      return false;
    } finally {
      // Allow the NEXT expiry to start a fresh flight; everyone in the
      // current burst already holds this promise.
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
  /** Skip the Authorization header (auth endpoints). */
  anonymous?: boolean;
  requestId?: string;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!options.anonymous && accessToken !== null) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  if (options.requestId !== undefined) {
    headers['x-request-id'] = options.requestId; // passthrough for tracing
  }
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
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
    // Non-JSON error body — keep the status + UNKNOWN code.
  }
  return new ApiError(response.status, code, message, requestId, details);
}

/**
 * JSON request against the API. On 401 TOKEN_EXPIRED: single-flight refresh
 * then ONE retry. On SESSION_REVOKED (or failed refresh): auth cleared and
 * the session-expired listeners fire (root layout redirects to login).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options);

  if (response.status === 401 && !options.anonymous) {
    const error = await parseError(response.clone());
    if (error.code === 'SESSION_REVOKED') {
      return failSession();
    }
    if (error.code === 'TOKEN_EXPIRED' || error.code === 'TOKEN_MISSING') {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        return failSession();
      }
      response = await rawRequest(path, options); // exactly one retry
      if (response.status === 401) {
        return failSession();
      }
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

/** Login/refresh bootstrap: store both tokens with the platform strategy. */
export async function adoptTokenPair(pair: { accessToken: string; refreshToken: string }): Promise<void> {
  accessToken = pair.accessToken;
  await storeRefreshToken(pair.refreshToken);
}
