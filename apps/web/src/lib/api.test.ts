import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setAccessToken } from './api';

const ok = (): Response =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('api request headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('sends content-type: application/json only when there is a body', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('acc');

    // Body-less POST (ws ticket): the API answers an empty application/json body with 400.
    await api.post('/api/v1/ws/ticket');
    await api.post('/api/v1/consultations/x/abort', { reason: 'r' });

    const headersOf = (call: number) =>
      (fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headersOf(0)['content-type']).toBeUndefined();
    expect(headersOf(0)['x-daktari-client']).toBe('web');
    expect(headersOf(0)['authorization']).toBe('Bearer acc');
    expect(headersOf(1)['content-type']).toBe('application/json');
  });
});
