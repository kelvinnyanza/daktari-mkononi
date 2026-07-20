import { describe, expect, it } from 'vitest';
import { chatReducer, initialChatState, type ChatState } from './chat-reducer';

const SELF = 'doctor-user';
const PATIENT = 'patient-user';

describe('chatReducer — messages', () => {
  it('replaces state with loaded history and marks our own messages', () => {
    const state = chatReducer(initialChatState, {
      type: 'HISTORY_LOADED',
      selfUserId: SELF,
      messages: [
        { id: 'm1', senderUserId: PATIENT, body: 'Habari daktari', sentAt: '2026-07-20T08:00:00.000Z' },
        { id: 'm2', senderUserId: SELF, body: 'Karibu', sentAt: '2026-07-20T08:01:00.000Z' },
      ],
    });

    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]?.mine).toBe(false);
    expect(state.entries[1]?.mine).toBe(true);
    expect(state.entries.every((entry) => entry.status === 'confirmed')).toBe(true);
  });

  it('renders an outbound message optimistically as pending', () => {
    const state = chatReducer(initialChatState, {
      type: 'OPTIMISTIC_SEND',
      key: 'local-1',
      body: 'Umeanza dawa?',
      selfUserId: SELF,
      sentAt: '2026-07-20T08:02:00.000Z',
    });

    expect(state.entries[0]).toMatchObject({
      key: 'local-1',
      serverId: null,
      status: 'pending',
      mine: true,
    });
  });

  it('reconciles the echo of our own send instead of duplicating it', () => {
    const sent = chatReducer(initialChatState, {
      type: 'OPTIMISTIC_SEND',
      key: 'local-1',
      body: 'Umeanza dawa?',
      selfUserId: SELF,
      sentAt: '2026-07-20T08:02:00.000Z',
    });

    const echoed = chatReducer(sent, {
      type: 'INBOUND_MESSAGE',
      messageId: 'm9',
      senderUserId: SELF,
      body: 'Umeanza dawa?',
      sentAt: '2026-07-20T08:02:01.000Z',
      selfUserId: SELF,
    });

    expect(echoed.entries).toHaveLength(1);
    expect(echoed.entries[0]).toMatchObject({ serverId: 'm9', status: 'confirmed' });
  });

  it('ignores a redelivered frame for a message it already has', () => {
    const first = chatReducer(initialChatState, {
      type: 'INBOUND_MESSAGE',
      messageId: 'm1',
      senderUserId: PATIENT,
      body: 'Nina homa',
      sentAt: '2026-07-20T08:03:00.000Z',
      selfUserId: SELF,
    });
    const again = chatReducer(first, {
      type: 'INBOUND_MESSAGE',
      messageId: 'm1',
      senderUserId: PATIENT,
      body: 'Nina homa',
      sentAt: '2026-07-20T08:03:00.000Z',
      selfUserId: SELF,
    });

    expect(again).toBe(first);
    expect(again.entries).toHaveLength(1);
  });

  it('marks a send that never left the socket as failed', () => {
    const sent = chatReducer(initialChatState, {
      type: 'OPTIMISTIC_SEND',
      key: 'local-1',
      body: 'Hujambo',
      selfUserId: SELF,
      sentAt: '2026-07-20T08:04:00.000Z',
    });
    const failed = chatReducer(sent, { type: 'SEND_FAILED', key: 'local-1' });
    expect(failed.entries[0]?.status).toBe('failed');
  });
});

describe('chatReducer — presence', () => {
  const connected: ChatState = { ...initialChatState, connection: 'connected' };

  it('tracks the patient joining and leaving', () => {
    const joined = chatReducer(connected, {
      type: 'PEER_JOINED',
      userId: PATIENT,
      selfUserId: SELF,
    });
    expect(joined.peers).toEqual([PATIENT]);

    const left = chatReducer(joined, { type: 'PEER_LEFT', userId: PATIENT });
    expect(left.peers).toEqual([]);
  });

  it('never counts ourselves as a peer', () => {
    const state = chatReducer(connected, { type: 'PEER_JOINED', userId: SELF, selfUserId: SELF });
    expect(state.peers).toEqual([]);
  });

  it('is idempotent for a repeated join', () => {
    const once = chatReducer(connected, {
      type: 'PEER_JOINED',
      userId: PATIENT,
      selfUserId: SELF,
    });
    const twice = chatReducer(once, { type: 'PEER_JOINED', userId: PATIENT, selfUserId: SELF });
    expect(twice.peers).toEqual([PATIENT]);
  });

  it('clears presence when the socket drops', () => {
    // A dead socket cannot know the patient is still there — showing a stale
    // "patient is online" would mislead the doctor into waiting.
    const joined = chatReducer(connected, {
      type: 'PEER_JOINED',
      userId: PATIENT,
      selfUserId: SELF,
    });
    const dropped = chatReducer(joined, { type: 'CONNECTION', state: 'disconnected' });

    expect(dropped.connection).toBe('disconnected');
    expect(dropped.peers).toEqual([]);
  });

  it('keeps the transcript across a reconnect', () => {
    const withMessage = chatReducer(connected, {
      type: 'INBOUND_MESSAGE',
      messageId: 'm1',
      senderUserId: PATIENT,
      body: 'Nina kizunguzungu',
      sentAt: '2026-07-20T08:05:00.000Z',
      selfUserId: SELF,
    });
    const dropped = chatReducer(withMessage, { type: 'CONNECTION', state: 'disconnected' });
    expect(dropped.entries).toHaveLength(1);
  });
});
