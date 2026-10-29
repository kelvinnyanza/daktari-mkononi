/**
 * Join a Daily call so that a camera problem never blocks the consultation.
 *
 * Daily Prebuilt opens the camera itself (its pre-join check / call-quality
 * test). On Windows a camera another process holds — or that the previous
 * frame has not released yet — fails with NotReadableError, which Daily
 * reports as `camera-error` type `cam-in-use` and the join stalls or
 * rejects. The doctor must still reach the patient: on a camera failure the
 * frame is destroyed (awaited, so it lets go of the devices) and the join is
 * retried with the camera off, audio only. The caller then offers a camera
 * picker to turn video back on.
 */
export interface CallFrame {
  join(options: { url: string; token: string; startVideoOff?: boolean; videoSource?: boolean }): Promise<unknown>;
  on(event: 'camera-error', handler: (event: unknown) => void): unknown;
  setLocalVideo(enabled: boolean): unknown;
  destroy(): Promise<void>;
}

/** Camera-side failures that audio-only can survive (mic-only problems cannot). */
const CAMERA_TYPES = new Set(['cam-in-use', 'cam-mic-in-use', 'not-found', 'constraints', 'permissions', 'unknown']);
const CAMERA_TEXT = /notreadableerror|could not start video source|cam-in-use|camera/i;

export function isCameraUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const inner = (error as { error?: { type?: unknown } }).error;
  if (typeof inner === 'object' && inner !== null && typeof inner.type === 'string') {
    return CAMERA_TYPES.has(inner.type);
  }
  const text = (error as { errorMsg?: unknown }).errorMsg ?? (error instanceof Error ? error.message : undefined);
  return typeof text === 'string' && CAMERA_TEXT.test(text);
}

export interface JoinResult {
  frame: CallFrame;
  /** True when joined audio-only because the camera could not start. */
  cameraOff: boolean;
}

export async function joinWithCameraFallback(
  createFrame: () => CallFrame,
  room: { url: string; token: string },
  /** Camera failures AFTER joining (e.g. a picked camera is busy). */
  onCameraUnavailable: () => void,
): Promise<JoinResult> {
  const first = createFrame();
  let joined = false;
  let signalCameraFailure: () => void = () => undefined;
  const cameraFailed = new Promise<'camera'>((resolve) => {
    signalCameraFailure = () => resolve('camera');
  });
  first.on('camera-error', (event) => {
    if (!isCameraUnavailable(event)) return;
    if (joined) {
      first.setLocalVideo(false);
      onCameraUnavailable();
    } else {
      signalCameraFailure();
    }
  });

  const outcome = await Promise.race([
    first.join(room).then(
      () => 'joined' as const,
      (error: unknown) => ({ error }),
    ),
    cameraFailed,
  ]);

  if (outcome === 'joined') {
    joined = true;
    return { frame: first, cameraOff: false };
  }
  // Release the devices BEFORE the next frame asks for them.
  await first.destroy();
  if (outcome !== 'camera' && !isCameraUnavailable(outcome.error)) throw outcome.error;

  const audioOnly = createFrame();
  audioOnly.on('camera-error', (event) => {
    if (isCameraUnavailable(event)) {
      audioOnly.setLocalVideo(false);
      onCameraUnavailable();
    }
  });
  try {
    await audioOnly.join({ ...room, startVideoOff: true, videoSource: false });
  } catch (error) {
    await audioOnly.destroy();
    throw error;
  }
  return { frame: audioOnly, cameraOff: true };
}
