/** Video-room provider port — implemented by FakeVideo (dev/tests) and DailyCoVideo. */

export interface CreateRoomOptions {
  /**
   * UTC instant the room dies (participants are ejected). The caller counts
   * it from when the consultation ACTUALLY starts — never from the scheduled
   * slot — so a late start or a restart never gets an already-dead room.
   */
  expiresAt: Date;
  /** Hard cap on participants (doctor + patient). */
  maxParticipants?: number;
}

export interface VideoRoom {
  roomId: string;
  roomUrl: string;
}

export interface MeetingTokenOptions {
  userId: string;
  role: 'doctor' | 'patient';
  /** Token lifetime in seconds. */
  ttlSeconds: number;
}

export interface VideoPort {
  /** Create a private (token-gated) room for a consultation. */
  createRoom(consultationId: string, opts: CreateRoomOptions): Promise<VideoRoom>;
  /** Mint a participant-scoped meeting token for a room. */
  createMeetingToken(roomId: string, opts: MeetingTokenOptions): Promise<string>;
  /** Tear the room down (consultation completed/aborted). Idempotent. */
  endRoom(roomId: string): Promise<void>;
}

export class VideoNotConfiguredError extends Error {
  readonly code = 'VIDEO_NOT_CONFIGURED';

  constructor(detail: string) {
    super(`video provider is not configured: ${detail}`);
    this.name = 'VideoNotConfiguredError';
  }
}
