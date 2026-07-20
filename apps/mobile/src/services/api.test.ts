/**
 * Single-flight refresh: N parallel 401s → exactly ONE refresh call → all N
 * retried once. Token storage rules: access token memory-only, refresh token
 * SecureStore-only.
 */
import { ApiError, adoptTokenPair, apiRequest, clearTokens, getAccessToken, onSessionExpired } from './api';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  };
});

const secureStore = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const tokenExpired = () =>
  jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: { sw: 'x', en: 'x' } } });

const flushMacrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('api client', () => {
  beforeEach(async () => {
    await clearTokens();
    secureStore.__store.clear();
    jest.restoreAllMocks();
  });

  it('never persists the access token; refresh token lives only in SecureStore', async () => {
    await adoptTokenPair({ accessToken: 'acc-1', refreshToken: 'ref-1' });
    expect(getAccessToken()).toBe('acc-1');
    // The ONLY SecureStore entry is the refresh token key.
    expect([...secureStore.__store.keys()]).toEqual(['daktari.refreshToken']);
    expect(secureStore.__store.get('daktari.refreshToken')).toBe('ref-1');
    // Nothing anywhere contains the access token.
    expect([...secureStore.__store.values()].some((value) => value.includes('acc-1'))).toBe(false);
  });

  it('N parallel 401s → exactly one refresh call → all N retried and resolved', async () => {
    await adoptTokenPair({ accessToken: 'stale', refreshToken: 'ref-1' });

    let refreshCalls = 0;
    let dataCalls = 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1;
        await flushMacrotasks(); // let the whole burst pile onto the flight
        return jsonResponse(200, { accessToken: 'fresh', refreshToken: 'ref-2' });
      }
      dataCalls += 1;
      const authorization = (init?.headers as Record<string, string>).authorization;
      return authorization === 'Bearer fresh'
        ? jsonResponse(200, { ok: true, n: dataCalls })
        : tokenExpired();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => apiRequest<{ ok: boolean }>('/api/v1/patients/me/profile')),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(refreshCalls).toBe(1); // single flight
    expect(dataCalls).toBe(10); // 5 initial 401s + 5 retries
    // Rotated refresh token was stored.
    expect(secureStore.__store.get('daktari.refreshToken')).toBe('ref-2');
    expect(getAccessToken()).toBe('fresh');
  });

  it('SESSION_REVOKED clears auth and fires the session-expired listeners', async () => {
    await adoptTokenPair({ accessToken: 'acc', refreshToken: 'ref' });
    const expired = jest.fn();
    const unsubscribe = onSessionExpired(expired);

    global.fetch = jest.fn(async () =>
      jsonResponse(401, { error: { code: 'SESSION_REVOKED', message: { sw: 'x', en: 'x' } } }),
    ) as unknown as typeof fetch;

    await expect(apiRequest('/api/v1/patients/me/profile')).rejects.toMatchObject({
      code: 'SESSION_REVOKED',
    });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    expect(secureStore.__store.has('daktari.refreshToken')).toBe(false);
    unsubscribe();
  });

  it('failed refresh (revoked family) also clears auth and redirects', async () => {
    await adoptTokenPair({ accessToken: 'stale', refreshToken: 'dead-ref' });
    const expired = jest.fn();
    const unsubscribe = onSessionExpired(expired);

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/refresh')) {
        return jsonResponse(401, { error: { code: 'SESSION_REVOKED' } });
      }
      return tokenExpired();
    }) as unknown as typeof fetch;

    await expect(apiRequest('/api/v1/appointments/me')).rejects.toMatchObject({
      code: 'SESSION_REVOKED',
    });
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('parses the bilingual envelope into a typed ApiError', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(409, {
        error: {
          code: 'CANCELLATION_WINDOW_PASSED',
          message: { sw: 'Miadi…', en: 'Appointments…' },
          requestId: 'req-1',
        },
      }),
    ) as unknown as typeof fetch;

    const error = await apiRequest('/api/v1/appointments/x/cancel', { method: 'POST' }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('CANCELLATION_WINDOW_PASSED');
    expect((error as ApiError).userMessage?.sw).toBe('Miadi…');
    expect((error as ApiError).requestId).toBe('req-1');
  });
});
