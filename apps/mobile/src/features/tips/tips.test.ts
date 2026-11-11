import { dailySet, eatDayNumber } from './rotation';
import { fetchCached, TipsUnavailableError } from './tips-api';
import { TipsCache, type CacheStore } from './tips-cache';

jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: {} }));

function memoryStore(): CacheStore & { text: string | null } {
  return {
    text: null,
    read() {
      return this.text;
    },
    write(text: string) {
      this.text = text;
    },
  };
}

function response(status: number, body: unknown, etag?: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? (etag ?? null) : null) },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('ETag cache', () => {
  it('stores the body + ETag, sends If-None-Match, and reuses the cache on 304', async () => {
    const cache = new TipsCache(memoryStore());
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(response(200, { items: [1] }, 'W/"a"'))
      .mockResolvedValueOnce(response(304, null));
    const first = await fetchCached<{ items: number[] }>('/api/v1/health-tips?page=1', { fetch, cache });
    expect(first).toEqual({ data: { items: [1] }, offline: false });
    const second = await fetchCached<{ items: number[] }>('/api/v1/health-tips?page=1', { fetch, cache });
    expect(second).toEqual({ data: { items: [1] }, offline: false });
    expect(fetch.mock.calls[1][1].headers['if-none-match']).toBe('W/"a"');
  });

  it('offline: serves the cached copy marked offline; nothing cached → TipsUnavailableError', async () => {
    const store = memoryStore();
    const cache = new TipsCache(store);
    await fetchCached('/x', { fetch: jest.fn().mockResolvedValue(response(200, { ok: 1 }, 'W/"b"')), cache });
    // A fresh cache instance reads what the previous session persisted.
    const reopened = new TipsCache(store);
    const offline = await fetchCached('/x', { fetch: jest.fn().mockRejectedValue(new TypeError('network')), cache: reopened });
    expect(offline).toEqual({ data: { ok: 1 }, offline: true });
    await expect(
      fetchCached('/never', { fetch: jest.fn().mockRejectedValue(new TypeError('network')), cache: reopened }),
    ).rejects.toBeInstanceOf(TipsUnavailableError);
  });

  it('ignores a corrupt cache file', async () => {
    const store = memoryStore();
    store.text = '{not json';
    const cache = new TipsCache(store);
    expect(cache.get('/x')).toBeUndefined();
  });
});

describe('daily rotation', () => {
  const tips = Array.from({ length: 40 }, (_, i) => `t${i}`);
  const day = (d: number) => new Date(d * 24 * 60 * 60 * 1000);

  it('shows 10: the 3 top tips always, the rest rotating each day', () => {
    const today = dailySet(tips, day(100));
    const tomorrow = dailySet(tips, day(101));
    expect(today).toHaveLength(10);
    expect(today.slice(0, 3)).toEqual(['t0', 't1', 't2']);
    expect(tomorrow.slice(0, 3)).toEqual(['t0', 't1', 't2']);
    expect(today.slice(3)).not.toEqual(tomorrow.slice(3));
    expect(new Set(today).size).toBe(10);
  });

  it('short lists are shown whole', () => {
    expect(dailySet(['a', 'b'], day(5))).toEqual(['a', 'b']);
  });

  it('days follow the EAT calendar (UTC+3)', () => {
    expect(eatDayNumber(new Date('2026-11-10T20:59:00Z'))).toBe(eatDayNumber(new Date('2026-11-10T00:00:00Z')));
    expect(eatDayNumber(new Date('2026-11-10T21:00:00Z'))).toBe(eatDayNumber(new Date('2026-11-10T00:00:00Z')) + 1);
  });
});
