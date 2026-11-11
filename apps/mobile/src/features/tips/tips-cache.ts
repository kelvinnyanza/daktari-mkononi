/**
 * Offline cache for health tips (public content, never PHI): the last good
 * response per request + its ETag, kept in memory and mirrored to one JSON
 * file in the app's cache directory so tips survive a restart without a
 * network. Small and bounded (MAX_ENTRIES); a corrupt file is ignored.
 *
 * Web preview: expo-file-system has no file API on web — the cache stays
 * in memory there (every failure here is swallowed by design).
 */
import { File, Paths } from 'expo-file-system';

export interface CachedResponse<T> {
  etag: string | null;
  body: T;
  savedAt: number;
}

export interface CacheStore {
  read(): string | null;
  write(text: string): void;
}

const MAX_ENTRIES = 24;

function fileStore(): CacheStore {
  return {
    read: () => {
      try {
        const file = new File(Paths.cache, 'health-tips-cache.json');
        return file.exists ? file.textSync() : null;
      } catch {
        return null;
      }
    },
    write: (text) => {
      try {
        const file = new File(Paths.cache, 'health-tips-cache.json');
        file.write(text);
      } catch {
        // best effort — the in-memory copy still serves this session
      }
    },
  };
}

export class TipsCache {
  private entries = new Map<string, CachedResponse<unknown>>();
  private loaded = false;

  constructor(private readonly store: CacheStore = fileStore()) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const text = this.store.read();
    if (text === null) return;
    try {
      const parsed = JSON.parse(text) as Record<string, CachedResponse<unknown>>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'object' && value !== null && 'body' in value) this.entries.set(key, value);
      }
    } catch {
      // corrupt cache file → start empty
    }
  }

  get<T>(key: string): CachedResponse<T> | undefined {
    this.load();
    return this.entries.get(key) as CachedResponse<T> | undefined;
  }

  /** Every cached body (offline lookups, e.g. a tip opened from a cached list). */
  bodies(): unknown[] {
    this.load();
    return [...this.entries.values()].map((entry) => entry.body);
  }

  set<T>(key: string, value: CachedResponse<T>): void {
    this.load();
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.store.write(JSON.stringify(Object.fromEntries(this.entries)));
  }
}

export const tipsCache = new TipsCache();
