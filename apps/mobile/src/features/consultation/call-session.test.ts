import type { LoadedDaily, VideoCall } from '../../services/video/daily-boundary';
import { callReleased, startCallSession, type CallListeners } from './call-session';

/** Let every pending promise chain settle (macrotask, not a fixed microtask count). */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface FakeCall extends VideoCall {
  emit: (event: string, payload: unknown) => void;
  log: string[];
  finishLeave: () => void;
}

function fakeCall(name: string, log: string[]): FakeCall {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  // Deferred: leave() stays pending until finishLeave(), whichever comes first.
  let finishLeave: () => void = () => undefined;
  const left = new Promise<unknown>((resolve) => {
    finishLeave = () => resolve(undefined);
  });
  return {
    log,
    join: jest.fn(async () => {
      log.push(`${name}.join`);
    }),
    leave: jest.fn(() => {
      log.push(`${name}.leave`);
      return left;
    }),
    destroy: jest.fn(async () => {
      log.push(`${name}.destroy`);
    }),
    setLocalAudio: jest.fn(),
    setLocalVideo: jest.fn(),
    cycleCamera: jest.fn(async () => undefined),
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    emit: (event: string, payload: unknown) => (handlers.get(event) ?? []).forEach((handler) => handler(payload)),
    finishLeave: () => finishLeave(),
  } as unknown as FakeCall;
}

function listeners(overrides: Partial<CallListeners> = {}): () => CallListeners {
  return () => ({
    onLoaded: jest.fn(),
    onLoadFailed: jest.fn(),
    onLocal: jest.fn(),
    onRemote: jest.fn(),
    onQuality: jest.fn(),
    onFailure: jest.fn(),
    ...overrides,
  });
}

const loaderFor = (calls: FakeCall[]) => {
  let index = 0;
  return async (): Promise<LoadedDaily> =>
    ({ createCall: () => calls[index++]!, MediaView: () => null }) as unknown as LoadedDaily;
};

describe('call session', () => {
  it('a rejoin waits until the previous call has LEFT and been DESTROYED', async () => {
    const log: string[] = [];
    const a = fakeCall('A', log);
    const b = fakeCall('B', log);
    const load = loaderFor([a, b]);

    const first = startCallSession({ load, roomUrl: 'r', token: 't1', listeners: listeners() });
    await flush();
    expect(log).toEqual(['A.join']);

    first.stop(); // patient taps End
    const second = startCallSession({ load, roomUrl: 'r', token: 't2', listeners: listeners() });
    await flush();
    expect(log).toEqual(['A.join', 'A.leave']); // B must not exist yet

    a.finishLeave();
    await flush();
    expect(log).toEqual(['A.join', 'A.leave', 'A.destroy', 'B.join']);
    second.stop();
    b.finishLeave();
    await callReleased();
  });

  it('listener identity changes never touch the call (no re-join on re-render)', async () => {
    const log: string[] = [];
    const call = fakeCall('A', log);
    let current = listeners();
    const session = startCallSession({ load: loaderFor([call]), roomUrl: 'r', token: 't', listeners: () => current() });
    await flush();
    for (let i = 0; i < 5; i++) current = listeners(); // five parent re-renders
    const onQuality = jest.fn();
    current = listeners({ onQuality });
    call.emit('network-quality-change', { threshold: 'low' });
    expect(onQuality).toHaveBeenCalledWith(true); // newest listener is used
    expect(log).toEqual(['A.join']); // joined once, never left
    session.stop();
    call.finishLeave();
    await callReleased();
  });

  it('shows a doctor already in the room, clears them on leave, and shows their rejoin', async () => {
    const call = fakeCall('A', []);
    const onRemote = jest.fn();
    const onLocal = jest.fn();
    const session = startCallSession({
      load: loaderFor([call]),
      roomUrl: 'r',
      token: 't',
      listeners: listeners({ onRemote, onLocal }),
    });
    await flush();

    call.emit('joined-meeting', {
      participants: { local: { session_id: 'me', local: true }, d1: { session_id: 'd1', local: false } },
    });
    expect(onLocal).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'me' }));
    expect(onRemote).toHaveBeenLastCalledWith(expect.objectContaining({ session_id: 'd1' }));

    call.emit('participant-left', { participant: { session_id: 'd1', local: false } });
    expect(onRemote).toHaveBeenLastCalledWith(null);

    call.emit('participant-joined', { participant: { session_id: 'd2', local: false } });
    expect(onRemote).toHaveBeenLastCalledWith(expect.objectContaining({ session_id: 'd2' }));

    // A stale left event for the OLD session must not blank the new one.
    onRemote.mockClear();
    call.emit('participant-left', { participant: { session_id: 'd1', local: false } });
    expect(onRemote).not.toHaveBeenCalled();
    session.stop();
    call.finishLeave();
    await callReleased();
  });

  it('a join failure reports the classified Daily error', async () => {
    const call = fakeCall('A', []);
    (call.join as jest.Mock).mockRejectedValueOnce({ errorMsg: 'exp-token' });
    const onFailure = jest.fn();
    startCallSession({ load: loaderFor([call]), roomUrl: 'r', token: 't', listeners: listeners({ onFailure }) });
    await flush();
    expect(onFailure).toHaveBeenCalledWith({ kind: 'failed', detail: 'exp-token' });
  });

  it('stopping before the SDK loads never creates a call', async () => {
    const createCall = jest.fn();
    const session = startCallSession({
      load: async () => ({ createCall, MediaView: () => null }) as unknown as LoadedDaily,
      roomUrl: 'r',
      token: 't',
      listeners: listeners(),
    });
    session.stop();
    await flush();
    expect(createCall).not.toHaveBeenCalled();
  });
});
