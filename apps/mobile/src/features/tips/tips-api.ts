/**
 * Health tips from the public API with conditional GET: the stored ETag goes
 * out as If-None-Match, a 304 reuses the cached copy (nothing re-downloaded),
 * and when the network fails the cached copy is served with `offline: true`
 * so the UI can show "Hakuna mtandao".
 *
 * Dev builds ask for drafts too (`preview=drafts`, badged "RASIMU"); the
 * server ignores that flag in production, and release builds never send it.
 */
import type { HealthTipCategory, PublicHealthTip } from '@daktari/schemas';
import { API_BASE_URL } from '../../services/config';
import { tipsCache, type TipsCache } from './tips-cache';

export interface TipsPage {
  items: PublicHealthTip[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Fetched<T> {
  data: T;
  /** Served from the device cache because the network failed. */
  offline: boolean;
}

export class TipsUnavailableError extends Error {
  constructor() {
    super('health tips unavailable (offline, nothing cached)');
    this.name = 'TipsUnavailableError';
  }
}

const PREVIEW_DRAFTS = __DEV__;

export function tipsListPath(params: { category?: HealthTipCategory | null; q?: string; page?: number; pageSize?: number }): string {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.category != null) query.set('category', params.category);
  if (params.q !== undefined && params.q.trim().length >= 2) query.set('q', params.q.trim());
  if (PREVIEW_DRAFTS) query.set('preview', 'drafts');
  return `/api/v1/health-tips?${query.toString()}`;
}

export function tipDetailPath(slug: string): string {
  return `/api/v1/health-tips/${encodeURIComponent(slug)}${PREVIEW_DRAFTS ? '?preview=drafts' : ''}`;
}

/** Absolute URL for an API-relative path (tip images). */
export function apiUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_BASE_URL}${path}`;
}

export async function fetchCached<T>(
  path: string,
  deps: { fetch: typeof fetch; cache: TipsCache } = { fetch: globalThis.fetch.bind(globalThis), cache: tipsCache },
): Promise<Fetched<T>> {
  const cached = deps.cache.get<T>(path);
  let response: Response;
  try {
    response = await deps.fetch(apiUrl(path), {
      headers: {
        accept: 'application/json',
        ...(cached?.etag != null ? { 'if-none-match': cached.etag } : {}),
      },
    });
  } catch {
    if (cached !== undefined) return { data: cached.body, offline: true };
    throw new TipsUnavailableError();
  }
  if (response.status === 304 && cached !== undefined) {
    return { data: cached.body, offline: false };
  }
  if (!response.ok) {
    if (response.status >= 500 && cached !== undefined) return { data: cached.body, offline: true };
    throw new Error(`health tips: HTTP ${response.status}`);
  }
  const body = (await response.json()) as T;
  deps.cache.set(path, { etag: response.headers.get('etag'), body, savedAt: Date.now() });
  return { data: body, offline: false };
}
