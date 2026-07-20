/**
 * Broadcast port for real-time events. Single-instance today (InMemoryPubSub);
 * Redis pub/sub drops in behind the same interface at Phase 11 — see CLAUDE.md
 * for the documented limitation.
 */
export type PubSubHandler = (event: unknown) => void;

export interface PubSubPort {
  publish(channel: string, event: unknown): void;
  /** Returns an unsubscribe function. */
  subscribe(channel: string, handler: PubSubHandler): () => void;
}

export class InMemoryPubSub implements PubSubPort {
  private readonly channels = new Map<string, Set<PubSubHandler>>();

  publish(channel: string, event: unknown): void {
    for (const handler of this.channels.get(channel) ?? []) {
      try {
        handler(event);
      } catch {
        // One bad subscriber must not break the broadcast.
      }
    }
  }

  subscribe(channel: string, handler: PubSubHandler): () => void {
    const handlers = this.channels.get(channel) ?? new Set<PubSubHandler>();
    handlers.add(handler);
    this.channels.set(channel, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.channels.delete(channel);
    };
  }
}
