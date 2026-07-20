import type { CreateRoomOptions, MeetingTokenOptions, VideoPort, VideoRoom } from './port.js';

interface FakeRoom extends VideoRoom {
  consultationId: string;
  scheduledEnd: Date;
  maxParticipants: number;
  ended: boolean;
  tokens: Array<MeetingTokenOptions & { token: string }>;
}

/**
 * In-memory video provider for dev and tests: deterministic ids derived from
 * the consultation id, room registry inspectable via `rooms`.
 */
export class FakeVideo implements VideoPort {
  readonly rooms = new Map<string, FakeRoom>();

  createRoom(consultationId: string, opts: CreateRoomOptions): Promise<VideoRoom> {
    const roomId = `fake-room-${consultationId}`;
    const room: FakeRoom = {
      roomId,
      roomUrl: `https://fake.daily.local/${roomId}`,
      consultationId,
      scheduledEnd: opts.scheduledEnd,
      maxParticipants: opts.maxParticipants ?? 2,
      ended: false,
      tokens: [],
    };
    this.rooms.set(roomId, room);
    return Promise.resolve({ roomId: room.roomId, roomUrl: room.roomUrl });
  }

  createMeetingToken(roomId: string, opts: MeetingTokenOptions): Promise<string> {
    const room = this.rooms.get(roomId);
    if (!room || room.ended) return Promise.reject(new Error(`fake video: no active room ${roomId}`));
    const token = `fake-token-${roomId}-${opts.role}-${opts.userId}`;
    room.tokens.push({ ...opts, token });
    return Promise.resolve(token);
  }

  endRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room) room.ended = true; // idempotent
    return Promise.resolve();
  }
}
