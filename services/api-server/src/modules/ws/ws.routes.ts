import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { wsClientFrameSchema } from '@daktari/schemas';
import type { PubSubPort } from '../../lib/pubsub.js';
import type { SessionRepoPort } from '../../lib/ports.js';
import { makeAuthenticate } from '../../middleware/authenticate.js';
import { consultationChannel, type ConsultationService } from '../consultations/consultation.service.js';
import type { WsTicketStore } from './ticket-store.js';

/**
 * Ticket issuance: the client exchanges its Bearer token for a 30-second
 * single-use ticket over HTTPS, then opens ws://…/ws?ticket=… — the JWT
 * itself never appears in a query string.
 */
export function buildWsTicketRoutes(
  tickets: WsTicketStore,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    app.post('/ticket', { preHandler: [authenticate] }, async (request) => {
      const auth = request.auth!;
      return tickets.issue(auth.userId, auth.role);
    });
  };
}

interface WsServerFrame {
  type: string;
  [key: string]: unknown;
}

/**
 * WebSocket gateway (/ws?ticket=…). One channel per consultation; join is
 * allowed only for that consultation's patient/doctor. Events delivered:
 * participant.joined / participant.left / consultation.status / chat.message.
 * Broadcast goes through PubSubPort — single-instance today (InMemoryPubSub),
 * Redis pub/sub drops in at Phase 11.
 */
export function buildWsGateway(
  consultations: ConsultationService,
  tickets: WsTicketStore,
  pubsub: PubSubPort,
): FastifyPluginAsync {
  return async (app) => {
    app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
      const { ticket } = request.query as { ticket?: string };
      const identity = ticket === undefined ? null : tickets.redeem(ticket);
      if (identity === null) {
        socket.close(4401, 'invalid, expired, or already-used ticket');
        return;
      }
      const { userId } = identity;
      const subscriptions = new Map<string, () => void>();

      const send = (frame: WsServerFrame): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
      };

      const handleFrame = async (raw: string): Promise<void> => {
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          send({ type: 'error', code: 'INVALID_FRAME' });
          return;
        }
        const parsed = wsClientFrameSchema.safeParse(json);
        if (!parsed.success) {
          send({ type: 'error', code: 'INVALID_FRAME' });
          return;
        }
        const frame = parsed.data;

        if (frame.type === 'join') {
          if (subscriptions.has(frame.consultationId)) {
            send({ type: 'joined', consultationId: frame.consultationId });
            return;
          }
          const allowed = await consultations.isParticipant(userId, frame.consultationId);
          if (!allowed) {
            send({ type: 'error', code: 'NOT_A_PARTICIPANT', consultationId: frame.consultationId });
            return;
          }
          const channel = consultationChannel(frame.consultationId);
          const unsubscribe = pubsub.subscribe(channel, (event) => {
            send(event as WsServerFrame);
          });
          subscriptions.set(frame.consultationId, unsubscribe);
          pubsub.publish(channel, {
            type: 'participant.joined',
            consultationId: frame.consultationId,
            userId,
          });
          send({ type: 'joined', consultationId: frame.consultationId });
          return;
        }

        // chat.message — persisted (encrypted at rest) then broadcast.
        if (!subscriptions.has(frame.consultationId)) {
          send({ type: 'error', code: 'JOIN_FIRST', consultationId: frame.consultationId });
          return;
        }
        try {
          await consultations.postMessage(userId, frame.consultationId, frame.body);
        } catch (error) {
          send({
            type: 'error',
            code: (error as { code?: string }).code ?? 'MESSAGE_REJECTED',
            consultationId: frame.consultationId,
          });
        }
      };

      socket.on('message', (raw: Buffer) => {
        void handleFrame(raw.toString('utf8')).catch(() => {
          send({ type: 'error', code: 'INTERNAL' });
        });
      });

      socket.on('close', () => {
        for (const [consultationId, unsubscribe] of subscriptions) {
          unsubscribe();
          pubsub.publish(consultationChannel(consultationId), {
            type: 'participant.left',
            consultationId,
            userId,
          });
        }
        subscriptions.clear();
      });
    });
  };
}
