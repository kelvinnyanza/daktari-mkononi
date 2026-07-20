/**
 * Clock-injected sliding-window rate limiter for per-user limits that the
 * HTTP-layer limiter cannot express (it runs before authentication).
 * In-memory ⇒ single-instance, same documented limitation as InMemoryPubSub;
 * a Redis-backed implementation slots in behind the same shape at Phase 11.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Record a hit for `key` if under `limit` within the trailing `windowMs`.
   * Returns true when allowed (and recorded), false when the limit is hit.
   */
  tryAcquire(key: string, limit: number, windowMs: number): boolean {
    const cutoff = this.now().getTime() - windowMs;
    const entries = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (entries.length >= limit) {
      this.hits.set(key, entries);
      return false;
    }
    entries.push(this.now().getTime());
    this.hits.set(key, entries);
    return true;
  }
}
