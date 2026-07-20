/**
 * Consultation WebSocket client. Auth is a short-lived single-use ticket:
 * POST /ws/ticket → open ws(...)?ticket=… → join the consultation channel.
 * Reconnects with exponential backoff + jitter (1s→30s cap), a FRESH ticket
 * per attempt (tickets are single-use), and gives up after 5 tries with a
 * UI-visible 'failed' state. 25s heartbeat ping; clean teardown kills the
 * socket and every timer.
 *
 * Everything time/network/socket-related is injectable so jest drives it with
 * fake timers + a fake WebSocket + a fake ticket fetch (no real sockets).
 */
import { parseInboundFrame, type InboundFrame } from './ws-frames';

export const MAX_RECONNECT_ATTEMPTS = 5;
export const HEARTBEAT_MS = 25_000;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'failed' | 'closed';

/** Backoff base (pre-jitter): 1s, 2s, 4s, 8s, 16s, capped at 30s. attempt≥1. */
export function backoffBaseDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}

/** Full-jitter: a random point in [0, base]. `random` returns [0,1). */
export function backoffDelay(attempt: number, random: () => number): number {
  return Math.round(backoffBaseDelay(attempt) * random());
}

/** The minimal WebSocket surface the client depends on (RN/DOM compatible). */
export interface MinimalSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
}

export type SocketFactory = (url: string) => MinimalSocket;

export interface ConsultationSocketConfig {
  consultationId: string;
  /** Base ws URL, e.g. ws://192.168.1.20:4000 (no path). */
  wsBaseUrl: string;
  /** Fetches a fresh single-use ticket. Called once per connect attempt. */
  fetchTicket: () => Promise<string>;
  socketFactory: SocketFactory;
  onEvent: (frame: InboundFrame) => void;
  onStateChange: (state: SocketState) => void;
  /** Injectable jitter (defaults to Math.random). */
  random?: () => number;
}

export class ConsultationSocket {
  private socket: MinimalSocket | null = null;
  private attempt = 0;
  private state: SocketState = 'closed';
  private stopped = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Frames that failed Zod validation — surfaced for diagnostics/tests. */
  droppedFrames = 0;
  private readonly random: () => number;

  constructor(private readonly config: ConsultationSocketConfig) {
    this.random = config.random ?? Math.random;
  }

  getState(): SocketState {
    return this.state;
  }

  start(): void {
    this.stopped = false;
    this.attempt = 0;
    void this.connect();
  }

  /** Clean teardown: no zombie socket, no lingering timers. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.socket !== null) {
      const socket = this.socket;
      // Detach handlers first so a close event can't trigger a reconnect.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, 'client teardown');
      this.socket = null;
    }
    this.setState('closed');
  }

  /** Send a chat message frame (fire-and-forget; caller tracks optimism). */
  sendChat(body: string): boolean {
    if (this.socket === null || this.state !== 'open') return false;
    this.socket.send(
      JSON.stringify({ type: 'chat.message', consultationId: this.config.consultationId, body }),
    );
    return true;
  }

  private setState(state: SocketState): void {
    if (this.state === state) return;
    this.state = state;
    this.config.onStateChange(state);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let ticket: string;
    try {
      ticket = await this.config.fetchTicket(); // fresh, single-use, per attempt
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const url = `${this.config.wsBaseUrl}/ws?ticket=${encodeURIComponent(ticket)}`;
    const socket = this.config.socketFactory(url);
    this.socket = socket;

    socket.onopen = (): void => {
      this.attempt = 0; // reset backoff on a good connection
      this.setState('open');
      socket.send(
        JSON.stringify({ type: 'join', consultationId: this.config.consultationId }),
      );
      this.startHeartbeat();
    };
    socket.onmessage = (event): void => {
      const frame = parseInboundFrame(typeof event.data === 'string' ? event.data : '');
      if (frame === null) {
        this.droppedFrames += 1; // garbage in → dropped + counted, never a crash
        return;
      }
      this.config.onEvent(frame);
    };
    socket.onerror = (): void => {
      // A close event follows; reconnect logic lives there.
    };
    socket.onclose = (): void => {
      this.stopHeartbeat();
      this.socket = null;
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.attempt += 1;
    if (this.attempt > MAX_RECONNECT_ATTEMPTS) {
      this.setState('failed'); // UI-visible give-up
      return;
    }
    this.setState('reconnecting');
    const delay = backoffDelay(this.attempt, this.random);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== null && this.state === 'open') {
        this.socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/** http(s) API base → ws(s) base. */
export function deriveWsBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/^http/, 'ws');
}
