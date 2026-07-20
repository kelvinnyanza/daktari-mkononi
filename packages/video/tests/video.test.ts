import { describe, expect, it, vi } from 'vitest';
import { FakeVideo } from '../src/fake.js';
import { DailyCoVideo } from '../src/daily.js';
import { VideoNotConfiguredError } from '../src/port.js';

const SCHEDULED_END = new Date('2026-07-20T07:00:00.000Z');

describe('FakeVideo', () => {
  it('creates deterministic rooms and role-scoped tokens', async () => {
    const video = new FakeVideo();
    const room = await video.createRoom('consult-1', { scheduledEnd: SCHEDULED_END });
    expect(room.roomId).toBe('fake-room-consult-1');

    const doctorToken = await video.createMeetingToken(room.roomId, {
      userId: 'u-doc',
      role: 'doctor',
      ttlSeconds: 300,
    });
    const patientToken = await video.createMeetingToken(room.roomId, {
      userId: 'u-pat',
      role: 'patient',
      ttlSeconds: 300,
    });
    expect(doctorToken).not.toBe(patientToken);

    await video.endRoom(room.roomId);
    await video.endRoom(room.roomId); // idempotent
    await expect(
      video.createMeetingToken(room.roomId, { userId: 'x', role: 'patient', ttlSeconds: 60 }),
    ).rejects.toThrow(/no active room/);
  });
});

describe('DailyCoVideo', () => {
  it('throws VIDEO_NOT_CONFIGURED without an API key', async () => {
    const video = new DailyCoVideo({ apiKey: undefined });
    await expect(video.createRoom('c1', { scheduledEnd: SCHEDULED_END })).rejects.toBeInstanceOf(
      VideoNotConfiguredError,
    );
    await expect(
      video.createMeetingToken('r1', { userId: 'u', role: 'doctor', ttlSeconds: 60 }),
    ).rejects.toMatchObject({ code: 'VIDEO_NOT_CONFIGURED' });
    await expect(video.endRoom('r1')).rejects.toMatchObject({ code: 'VIDEO_NOT_CONFIGURED' });
  });

  it('creates private, 2-participant rooms expiring 2h after scheduled end', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(url)).toBe('https://api.daily.co/v1/rooms');
      const body = JSON.parse(String(init?.body)) as {
        privacy: string;
        properties: { max_participants: number; exp: number; enable_recording: boolean };
      };
      expect(body.privacy).toBe('private');
      expect(body.properties.max_participants).toBe(2);
      expect(body.properties.exp).toBe(
        Math.floor(SCHEDULED_END.getTime() / 1000) + 2 * 60 * 60,
      );
      expect(body.properties.enable_recording).toBe(false);
      return new Response(
        JSON.stringify({ id: 'uuid-1', name: 'consult-c1', url: 'https://x.daily.co/consult-c1' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const video = new DailyCoVideo({ apiKey: 'test-key', fetchImpl: fetchImpl as typeof fetch });

    const room = await video.createRoom('c1', { scheduledEnd: SCHEDULED_END });
    expect(room).toEqual({ roomId: 'consult-c1', roomUrl: 'https://x.daily.co/consult-c1' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('mints owner tokens for doctors and treats 404 room deletion as success', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url).endsWith('/meeting-tokens')) {
        const body = JSON.parse(String(init?.body)) as {
          properties: { room_name: string; is_owner: boolean };
        };
        expect(body.properties.room_name).toBe('consult-c1');
        expect(body.properties.is_owner).toBe(true);
        return new Response(JSON.stringify({ token: 'jwt-token' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    const video = new DailyCoVideo({ apiKey: 'test-key', fetchImpl: fetchImpl as typeof fetch });

    const token = await video.createMeetingToken('consult-c1', {
      userId: 'u-doc',
      role: 'doctor',
      ttlSeconds: 600,
    });
    expect(token).toBe('jwt-token');

    await expect(video.endRoom('consult-c1')).resolves.toBeUndefined(); // 404 → idempotent ok
  });
});
