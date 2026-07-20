/**
 * Inbound WebSocket frame schemas. EVERY frame from the server is Zod-parsed;
 * anything that fails validation is dropped and counted, never crashing the
 * handler. Mirrors the server broadcast shapes (services/api-server ws.routes).
 */
import { z } from 'zod';

export const participantJoinedFrame = z.object({
  type: z.literal('participant.joined'),
  consultationId: z.string(),
  userId: z.string(),
});

export const participantLeftFrame = z.object({
  type: z.literal('participant.left'),
  consultationId: z.string(),
  userId: z.string(),
});

export const consultationStatusFrame = z.object({
  type: z.literal('consultation.status'),
  consultationId: z.string(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'ABANDONED']),
});

export const chatMessageFrame = z.object({
  type: z.literal('chat.message'),
  consultationId: z.string(),
  messageId: z.string(),
  senderUserId: z.string(),
  body: z.string(),
  sentAt: z.string(),
});

/** Server acks a join with { type: 'joined', consultationId }. */
export const joinedFrame = z.object({
  type: z.literal('joined'),
  consultationId: z.string(),
});

/** Server error frames, e.g. NOT_A_PARTICIPANT / JOIN_FIRST / INVALID_FRAME. */
export const errorFrame = z.object({
  type: z.literal('error'),
  code: z.string(),
  consultationId: z.string().optional(),
});

export const inboundFrameSchema = z.discriminatedUnion('type', [
  participantJoinedFrame,
  participantLeftFrame,
  consultationStatusFrame,
  chatMessageFrame,
  joinedFrame,
  errorFrame,
]);

export type InboundFrame = z.infer<typeof inboundFrameSchema>;
export type ChatMessageFrame = z.infer<typeof chatMessageFrame>;
export type ConsultationStatusFrame = z.infer<typeof consultationStatusFrame>;

/** Parse one raw text frame; null when it is not a recognized/valid frame. */
export function parseInboundFrame(raw: string): InboundFrame | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = inboundFrameSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
