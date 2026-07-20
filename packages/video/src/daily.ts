import { z } from 'zod';
import {
  VideoNotConfiguredError,
  type CreateRoomOptions,
  type MeetingTokenOptions,
  type VideoPort,
  type VideoRoom,
} from './port.js';

const ROOM_GRACE_SECONDS = 2 * 60 * 60; // rooms expire 2h after scheduled end

const roomResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
});

const tokenResponseSchema = z.object({ token: z.string().min(1) });

export interface DailyCoVideoOptions {
  apiKey: string | undefined;
  /** Override for tests; defaults to the real API. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Daily.co REST implementation (rooms + meeting tokens).
 * Rooms are private (token-gated), capped at 2 participants, and expire
 * 2 hours after the scheduled consultation end.
 */
export class DailyCoVideo implements VideoPort {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DailyCoVideoOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.daily.co/v1';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    if (this.apiKey === undefined || this.apiKey === '') {
      throw new VideoNotConfiguredError('DAILY_CO_API_KEY is not set');
    }
    return {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };
  }

  private async request<T>(schema: z.ZodType<T>, path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Daily.co ${init.method ?? 'GET'} ${path} failed (${response.status}): ${body}`);
    }
    return schema.parse(await response.json());
  }

  async createRoom(consultationId: string, opts: CreateRoomOptions): Promise<VideoRoom> {
    const room = await this.request(roomResponseSchema, '/rooms', {
      method: 'POST',
      body: JSON.stringify({
        name: `consult-${consultationId}`,
        privacy: 'private', // join requires a meeting token
        properties: {
          max_participants: opts.maxParticipants ?? 2,
          exp: Math.floor(opts.scheduledEnd.getTime() / 1000) + ROOM_GRACE_SECONDS,
          eject_at_room_exp: true,
          enable_screenshare: false,
          enable_recording: false, // recording is Phase 5 consent-gate only
        },
      }),
    });
    return { roomId: room.name, roomUrl: room.url };
  }

  async createMeetingToken(roomId: string, opts: MeetingTokenOptions): Promise<string> {
    const response = await this.request(tokenResponseSchema, '/meeting-tokens', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          room_name: roomId,
          user_id: opts.userId,
          is_owner: opts.role === 'doctor',
          exp: Math.floor(Date.now() / 1000) + opts.ttlSeconds,
        },
      }),
    });
    return response.token;
  }

  async endRoom(roomId: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/rooms/${encodeURIComponent(roomId)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    // Idempotent: deleting an already-deleted room is fine.
    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => '');
      throw new Error(`Daily.co DELETE /rooms/${roomId} failed (${response.status}): ${body}`);
    }
  }
}
