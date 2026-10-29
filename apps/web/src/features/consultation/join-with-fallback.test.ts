import { describe, expect, it, vi } from 'vitest';
import { isCameraUnavailable, joinWithCameraFallback, type CallFrame } from './join-with-fallback';

const ROOM = { url: 'https://x.daily.co/r', token: 't' };
const camInUse = {
  action: 'camera-error',
  errorMsg: { errorMsg: 'NotReadableError: Could not start video source', audioOk: true, videoOk: false },
  error: { type: 'cam-in-use', msg: 'Could not start video source' },
};

/** Fake frame: `join` behaviour scripted per test; records calls. */
function fakeFrame(join: (frame: FakeFrame, options: unknown) => Promise<unknown>) {
  const frame: FakeFrame = {
    handlers: [],
    joinedWith: [],
    destroyed: false,
    videoOn: true,
    join: (options) => {
      frame.joinedWith.push(options);
      return join(frame, options);
    },
    on: (_event, handler) => frame.handlers.push(handler),
    setLocalVideo: (enabled) => {
      frame.videoOn = enabled;
    },
    destroy: vi.fn(async () => {
      frame.destroyed = true;
    }),
    emit: (event) => frame.handlers.forEach((h) => h(event)),
  };
  return frame;
}
interface FakeFrame extends CallFrame {
  handlers: Array<(event: unknown) => void>;
  joinedWith: unknown[];
  destroyed: boolean;
  videoOn: boolean;
  emit: (event: unknown) => void;
}

describe('isCameraUnavailable', () => {
  it('recognises Daily camera-error types that audio-only survives', () => {
    expect(isCameraUnavailable(camInUse)).toBe(true);
    expect(isCameraUnavailable({ error: { type: 'not-found' } })).toBe(true);
    expect(isCameraUnavailable({ error: { type: 'mic-in-use' } })).toBe(false);
    expect(isCameraUnavailable({ errorMsg: 'Devices Error (Cam In Use): NotReadableError: Could not start video source' })).toBe(true);
    expect(isCameraUnavailable({ errorMsg: 'account-missing-payment-method' })).toBe(false);
    expect(isCameraUnavailable(undefined)).toBe(false);
  });
});

describe('joinWithCameraFallback', () => {
  it('a healthy camera joins once, with video', async () => {
    const frames: FakeFrame[] = [];
    const result = await joinWithCameraFallback(
      () => { const f = fakeFrame(async () => 'ok'); frames.push(f); return f; },
      ROOM,
      () => undefined,
    );
    expect(frames).toHaveLength(1);
    expect(result.cameraOff).toBe(false);
  });

  it('cam-in-use while joining (join stalls): destroys the frame FIRST, then joins audio-only', async () => {
    const frames: FakeFrame[] = [];
    const order: string[] = [];
    const result = await joinWithCameraFallback(
      () => {
        const index = frames.length;
        const f = fakeFrame((frame) => {
          if (index === 0) {
            frame.emit(camInUse);
            return new Promise(() => undefined); // Prebuilt stalls on its device error screen
          }
          order.push(`join#${index}`);
          return Promise.resolve('ok');
        });
        f.destroy = vi.fn(async () => { order.push(`destroy#${index}`); f.destroyed = true; });
        frames.push(f);
        return f;
      },
      ROOM,
      () => undefined,
    );
    expect(result.cameraOff).toBe(true);
    expect(order).toEqual(['destroy#0', 'join#1']); // devices released before the retry
    expect(frames[1]!.joinedWith[0]).toEqual({ ...ROOM, startVideoOff: true, videoSource: false });
  });

  it('a join REJECTED for the camera also falls back to audio-only', async () => {
    const frames: FakeFrame[] = [];
    const result = await joinWithCameraFallback(
      () => {
        const index = frames.length;
        const f = fakeFrame(async () => {
          if (index === 0) throw { errorMsg: 'NotReadableError: Could not start video source' };
          return 'ok';
        });
        frames.push(f);
        return f;
      },
      ROOM,
      () => undefined,
    );
    expect(result.cameraOff).toBe(true);
    expect(frames[0]!.destroyed).toBe(true);
  });

  it('a non-camera failure is rethrown after the frame is destroyed (no audio retry)', async () => {
    const frames: FakeFrame[] = [];
    await expect(
      joinWithCameraFallback(
        () => { const f = fakeFrame(async () => { throw { errorMsg: 'exp-token' }; }); frames.push(f); return f; },
        ROOM,
        () => undefined,
      ),
    ).rejects.toEqual({ errorMsg: 'exp-token' });
    expect(frames).toHaveLength(1);
    expect(frames[0]!.destroyed).toBe(true);
  });

  it('a camera failure after joining turns video off and notifies — the call continues', async () => {
    const notified = vi.fn();
    const { frame } = await joinWithCameraFallback(() => fakeFrame(async () => 'ok'), ROOM, notified);
    (frame as FakeFrame).emit(camInUse);
    expect((frame as FakeFrame).videoOn).toBe(false);
    expect(notified).toHaveBeenCalledTimes(1);
  });
});
