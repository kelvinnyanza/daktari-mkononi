import { randomBytes } from 'node:crypto';
import type { Role } from '@daktari/auth';

export const TICKET_TTL_MS = 30_000;

interface TicketRecord {
  userId: string;
  role: Role;
  expiresAt: number;
  used: boolean;
}

/**
 * Short-lived one-time tickets for WebSocket authentication. The client
 * exchanges its Bearer token for a 30-second single-use ticket over HTTPS
 * (POST /api/v1/ws/ticket) and opens ws://…/ws?ticket=… — the JWT itself is
 * never put in a query string (query strings land in logs and proxies).
 *
 * In-memory by design: tickets are instance-local and sub-minute, so they
 * need no shared store even when Redis pub/sub arrives (a client always
 * redeems its ticket against the instance that issued it via sticky LB —
 * revisit alongside the Phase 11 multi-instance work).
 */
export class WsTicketStore {
  private readonly tickets = new Map<string, TicketRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  issue(userId: string, role: Role): { ticket: string; expiresInSeconds: number } {
    this.sweep();
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, {
      userId,
      role,
      expiresAt: this.now().getTime() + TICKET_TTL_MS,
      used: false,
    });
    return { ticket, expiresInSeconds: TICKET_TTL_MS / 1000 };
  }

  /**
   * Single use: the first redemption wins; expired, unknown, or replayed
   * tickets all return null (indistinguishable to the caller).
   */
  redeem(ticket: string): { userId: string; role: Role } | null {
    const record = this.tickets.get(ticket);
    if (!record || record.used || record.expiresAt <= this.now().getTime()) return null;
    record.used = true;
    return { userId: record.userId, role: record.role };
  }

  /** Drop expired/used tickets so the map cannot grow unbounded. */
  private sweep(): void {
    const cutoff = this.now().getTime();
    for (const [key, record] of this.tickets) {
      if (record.used || record.expiresAt <= cutoff) this.tickets.delete(key);
    }
  }
}
