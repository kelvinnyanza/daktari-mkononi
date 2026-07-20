import { chatReducer, initialChatState, type ChatState } from './chat-reducer';

const SELF = 'patient-1';

describe('chat reducer', () => {
  it('loads history marking own messages', () => {
    const state = chatReducer(initialChatState, {
      type: 'HISTORY_LOADED',
      selfUserId: SELF,
      messages: [
        { id: 'm1', senderUserId: 'doctor-1', body: 'Karibu', sentAt: '2026-07-20T09:00:00Z' },
        { id: 'm2', senderUserId: SELF, body: 'Asante', sentAt: '2026-07-20T09:01:00Z' },
      ],
    });
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]!.mine).toBe(false);
    expect(state.entries[1]!.mine).toBe(true);
    expect(state.entries.every((entry) => entry.status === 'confirmed')).toBe(true);
  });

  it('optimistic send → confirmed when the WS echoes it back (no duplicate)', () => {
    let state: ChatState = initialChatState;
    state = chatReducer(state, {
      type: 'OPTIMISTIC_SEND',
      key: 'tmp-1',
      body: 'Nina homa',
      selfUserId: SELF,
      sentAt: '2026-07-20T09:02:00Z',
    });
    expect(state.entries[0]!.status).toBe('pending');
    expect(state.entries[0]!.serverId).toBeNull();

    // The server broadcasts our own message back with a real id.
    state = chatReducer(state, {
      type: 'INBOUND_MESSAGE',
      messageId: 'm-real',
      senderUserId: SELF,
      body: 'Nina homa',
      sentAt: '2026-07-20T09:02:01Z',
      selfUserId: SELF,
    });
    expect(state.entries).toHaveLength(1); // reconciled, not duplicated
    expect(state.entries[0]!.status).toBe('confirmed');
    expect(state.entries[0]!.serverId).toBe('m-real');
  });

  it('optimistic send → failed on send error, kept visible', () => {
    let state: ChatState = initialChatState;
    state = chatReducer(state, {
      type: 'OPTIMISTIC_SEND',
      key: 'tmp-2',
      body: 'test',
      selfUserId: SELF,
      sentAt: '2026-07-20T09:03:00Z',
    });
    state = chatReducer(state, { type: 'SEND_FAILED', key: 'tmp-2' });
    expect(state.entries[0]!.status).toBe('failed');
    expect(state.entries[0]!.body).toBe('test');
  });

  it('inbound message from the doctor appends a confirmed bubble', () => {
    const state = chatReducer(initialChatState, {
      type: 'INBOUND_MESSAGE',
      messageId: 'm-doc',
      senderUserId: 'doctor-1',
      body: 'Pole sana',
      sentAt: '2026-07-20T09:04:00Z',
      selfUserId: SELF,
    });
    expect(state.entries[0]!.mine).toBe(false);
    expect(state.entries[0]!.status).toBe('confirmed');
  });

  it('is idempotent: a duplicate inbound id is ignored', () => {
    let state = chatReducer(initialChatState, {
      type: 'INBOUND_MESSAGE',
      messageId: 'm-dup',
      senderUserId: 'doctor-1',
      body: 'once',
      sentAt: '2026-07-20T09:05:00Z',
      selfUserId: SELF,
    });
    state = chatReducer(state, {
      type: 'INBOUND_MESSAGE',
      messageId: 'm-dup',
      senderUserId: 'doctor-1',
      body: 'once',
      sentAt: '2026-07-20T09:05:00Z',
      selfUserId: SELF,
    });
    expect(state.entries).toHaveLength(1);
  });
});
