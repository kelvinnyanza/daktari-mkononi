import {
  ConsultationSocket,
  backoffBaseDelay,
  backoffDelay,
  deriveWsBaseUrl,
  HEARTBEAT_MS,
  MAX_RECONNECT_ATTEMPTS,
  type MinimalSocket,
} from './ws';
import { parseInboundFrame } from './ws-frames';

/** A controllable fake WebSocket. */
class FakeSocket implements MinimalSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  // Test helpers
  open(): void {
    this.onopen?.();
  }
  message(data: string): void {
    this.onmessage?.({ data });
  }
  serverClose(): void {
    this.onclose?.();
  }
}

describe('backoff schedule', () => {
  it('is exponential 1s→30s capped', () => {
    expect(backoffBaseDelay(1)).toBe(1_000);
    expect(backoffBaseDelay(2)).toBe(2_000);
    expect(backoffBaseDelay(3)).toBe(4_000);
    expect(backoffBaseDelay(4)).toBe(8_000);
    expect(backoffBaseDelay(5)).toBe(16_000);
    expect(backoffBaseDelay(6)).toBe(30_000); // capped
    expect(backoffBaseDelay(10)).toBe(30_000);
  });

  it('full-jitter keeps delays within [0, base]', () => {
    expect(backoffDelay(3, () => 0)).toBe(0);
    expect(backoffDelay(3, () => 1)).toBe(4_000);
    expect(backoffDelay(3, () => 0.5)).toBe(2_000);
  });
});

describe('deriveWsBaseUrl', () => {
  it('maps http→ws and https→wss', () => {
    expect(deriveWsBaseUrl('http://192.168.1.20:4000')).toBe('ws://192.168.1.20:4000');
    expect(deriveWsBaseUrl('https://api.daktari.co.tz')).toBe('wss://api.daktari.co.tz');
  });
});

describe('parseInboundFrame', () => {
  it('accepts valid frames and drops garbage', () => {
    expect(parseInboundFrame('{"type":"joined","consultationId":"c1"}')?.type).toBe('joined');
    const chat = parseInboundFrame(
      JSON.stringify({
        type: 'chat.message',
        consultationId: 'c1',
        messageId: 'm1',
        senderUserId: 'u1',
        body: 'hi',
        sentAt: '2026-07-20T09:00:00Z',
      }),
    );
    expect(chat?.type).toBe('chat.message');

    expect(parseInboundFrame('not json')).toBeNull();
    expect(parseInboundFrame('{"type":"unknown"}')).toBeNull();
    expect(parseInboundFrame('{"type":"chat.message"}')).toBeNull(); // missing fields
  });
});

describe('ConsultationSocket', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function makeSocket(overrides: Partial<Parameters<typeof buildSocket>[0]> = {}) {
    return buildSocket(overrides);
  }

  it('fetches a ticket, opens, and sends a join frame on open', async () => {
    const sockets: FakeSocket[] = [];
    let ticketCalls = 0;
    const socket = makeSocket({
      fetchTicket: async () => `ticket-${(ticketCalls += 1)}`,
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    socket.client.start();
    await flush();

    expect(ticketCalls).toBe(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toContain('/ws?ticket=ticket-1');

    sockets[0]!.open();
    expect(socket.states).toContain('open');
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: 'join', consultationId: 'c1' });
  });

  it('uses a FRESH ticket per reconnect attempt and backs off, giving up after 5', async () => {
    const sockets: FakeSocket[] = [];
    const tickets: string[] = [];
    let n = 0;
    const socket = makeSocket({
      random: () => 1, // deterministic: full base delay
      fetchTicket: async () => {
        const ticket = `ticket-${(n += 1)}`;
        tickets.push(ticket);
        return ticket;
      },
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    socket.client.start();
    await flush();
    // First connection fails (server closes immediately).
    sockets[0]!.serverClose();

    // Walk the backoff: 1s, 2s, 4s, 8s, 16s → 5 reconnect attempts.
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000]) {
      jest.advanceTimersByTime(delay);
      await flush();
      sockets[sockets.length - 1]!.serverClose();
    }

    // 1 initial + 5 reconnects = 6 tickets, all distinct (single-use).
    expect(tickets).toHaveLength(6);
    expect(new Set(tickets).size).toBe(6);
    expect(socket.client.getState()).toBe('failed'); // UI-visible give-up
    expect(socket.states.filter((s) => s === 'failed')).toHaveLength(1);
    expect(MAX_RECONNECT_ATTEMPTS).toBe(5);
  });

  it('a good reconnection resets the backoff counter', async () => {
    const sockets: FakeSocket[] = [];
    const socket = makeSocket({
      random: () => 1,
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    socket.client.start();
    await flush();
    sockets[0]!.serverClose(); // drop #1
    jest.advanceTimersByTime(1_000); // reconnect after 1s (attempt 1)
    await flush();
    sockets[1]!.open(); // recovers → attempt reset
    sockets[1]!.serverClose(); // drop again
    jest.advanceTimersByTime(1_000); // back to a 1s delay, not 2s
    await flush();
    expect(sockets).toHaveLength(3);
  });

  it('heartbeat pings every 25s while open', async () => {
    const sockets: FakeSocket[] = [];
    const socket = makeSocket({
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    socket.client.start();
    await flush();
    sockets[0]!.open();
    sockets[0]!.sent.length = 0; // drop the join frame

    jest.advanceTimersByTime(HEARTBEAT_MS);
    jest.advanceTimersByTime(HEARTBEAT_MS);
    const pings = sockets[0]!.sent.filter((raw) => JSON.parse(raw).type === 'ping');
    expect(pings).toHaveLength(2);
  });

  it('drops unparseable inbound frames and counts them, never crashing', async () => {
    const sockets: FakeSocket[] = [];
    const events: string[] = [];
    const socket = makeSocket({
      onEvent: (frame) => events.push(frame.type),
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    socket.client.start();
    await flush();
    sockets[0]!.open();

    sockets[0]!.message('garbage{');
    sockets[0]!.message('{"type":"nope"}');
    sockets[0]!.message('{"type":"joined","consultationId":"c1"}');

    expect(socket.client.droppedFrames).toBe(2);
    expect(events).toEqual(['joined']);
  });

  it('teardown kills the socket and all timers — no zombie reconnect', async () => {
    const sockets: FakeSocket[] = [];
    const socket = makeSocket({
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    socket.client.start();
    await flush();
    sockets[0]!.open();

    socket.client.stop();
    expect(sockets[0]!.closed).toBe(true);
    expect(socket.client.getState()).toBe('closed');

    // No pending timers → no reconnect, no heartbeat after teardown.
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(sockets).toHaveLength(1); // never reconnected
  });
});

// ── Test harness ─────────────────────────────────────────────────────────────

function buildSocket(overrides: {
  fetchTicket?: () => Promise<string>;
  socketFactory?: (url: string) => MinimalSocket;
  onEvent?: (frame: ReturnType<typeof parseInboundFrame> & object) => void;
  random?: () => number;
}) {
  const states: string[] = [];
  const client = new ConsultationSocket({
    consultationId: 'c1',
    wsBaseUrl: 'ws://localhost:4000',
    fetchTicket: overrides.fetchTicket ?? (async () => 'ticket-x'),
    socketFactory: overrides.socketFactory ?? ((url) => new FakeSocket(url)),
    onEvent: overrides.onEvent ?? (() => undefined),
    onStateChange: (state) => states.push(state),
    ...(overrides.random !== undefined ? { random: overrides.random } : {}),
  });
  return { client, states };
}

/** Let queued microtasks (the async connect/fetchTicket) settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
