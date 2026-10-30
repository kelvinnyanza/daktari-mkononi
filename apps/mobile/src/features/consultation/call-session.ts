/**
 * One Daily call's lifecycle, outside React — so it is testable and so React
 * re-renders cannot restart it.
 *
 * Why it exists (device smoke test, check 9): the call lived in a useEffect
 * keyed on the parent's callbacks. The parent passed an inline `onControls`,
 * so EVERY re-render (a chat message, a WS state change, a quality flag)
 * left the call and joined again — Daily's history showed the tablet leaving
 * and rejoining every few seconds after the doctor arrived. And `leave()` /
 * `destroy()` were not awaited, so the next call object was created while
 * the old one still held the camera and the Daily singleton.
 *
 * Rules enforced here:
 *  - a session is keyed only by (roomUrl, token); listeners are read through
 *    a getter on every event, so their identity never matters;
 *  - a new session waits until the previous one has fully left AND been
 *    destroyed (module-wide release chain — Daily allows one call object);
 *  - remote presence follows joined-meeting / participant-joined / -updated /
 *    -left, so a doctor already in the room shows up and one who leaves and
 *    rejoins is replaced, not frozen.
 */
import type { LoadedDaily, VideoCall } from '../../services/video/daily-boundary';
import { classifyJoinError, type JoinFailure } from './video-error';

interface TrackState {
  state?: string;
  persistentTrack?: unknown;
}

export interface CallParticipant {
  session_id?: string;
  local?: boolean;
  /** Current API (daily-js ≥0.7x): tracks.<kind>.persistentTrack. */
  tracks?: { video?: TrackState; audio?: TrackState };
  /** @deprecated by Daily ("will be removed"); may be `false`, not null. */
  videoTrack?: unknown;
  /** @deprecated by Daily ("will be removed"); may be `false`, not null. */
  audioTrack?: unknown;
}

/**
 * The tracks DailyMediaView needs (`MediaStreamTrack | null`). Reads the
 * current `tracks.*.persistentTrack` API, falls back to the deprecated
 * top-level fields, and never passes Daily's `false` through.
 */
export function participantTracks(participant: CallParticipant | null): { video: unknown; audio: unknown } {
  const pick = (state: TrackState | undefined, legacy: unknown): unknown => {
    const track = state?.persistentTrack ?? legacy;
    return track === undefined || track === false ? null : track;
  };
  return {
    video: pick(participant?.tracks?.video, participant?.videoTrack),
    audio: pick(participant?.tracks?.audio, participant?.audioTrack),
  };
}

/**
 * Poor connection from a network-quality-change payload. daily-js 0.74+
 * reports `networkState` (good | warning | bad | unknown) and deprecates
 * `threshold`; read the new field first, the old one as a fallback.
 */
export function isPoorNetwork(payload: unknown): boolean {
  const { networkState, threshold } = (payload ?? {}) as { networkState?: string; threshold?: string };
  if (networkState !== undefined) return networkState === 'bad';
  return threshold === 'low' || threshold === 'very-low';
}

export interface CallListeners {
  onLoaded: (daily: LoadedDaily, call: VideoCall) => void;
  onLoadFailed: () => void;
  onLocal: (participant: CallParticipant) => void;
  onRemote: (participant: CallParticipant | null) => void;
  onQuality: (poor: boolean) => void;
  onFailure: (failure: JoinFailure) => void;
}

export interface CallSession {
  stop: () => void;
}

let releasing: Promise<void> = Promise.resolve();

/** Resolves once every previously stopped call has left and been destroyed. */
export function callReleased(): Promise<void> {
  return releasing;
}

export function startCallSession(options: {
  load: () => Promise<LoadedDaily>;
  roomUrl: string;
  token: string;
  listeners: () => CallListeners;
}): CallSession {
  let stopped = false;
  let call: VideoCall | null = null;
  let remoteSessionId: string | undefined;
  const on = (): CallListeners => options.listeners();

  const showParticipant = (participant: CallParticipant | undefined): void => {
    if (stopped || participant === undefined) return;
    if (participant.local === true) {
      on().onLocal(participant);
    } else {
      remoteSessionId = participant.session_id;
      on().onRemote(participant);
    }
  };

  void (async () => {
    await releasing; // the previous call must be gone before Daily makes a new one
    if (stopped) return;
    let daily: LoadedDaily;
    try {
      daily = await options.load();
    } catch {
      if (!stopped) on().onLoadFailed();
      return;
    }
    if (stopped) return;
    call = daily.createCall();
    const current = call;
    on().onLoaded(daily, current);

    current.on('joined-meeting', (payload) => {
      const participants = (payload as { participants?: Record<string, CallParticipant> }).participants ?? {};
      for (const participant of Object.values(participants)) showParticipant(participant);
    });
    for (const event of ['participant-joined', 'participant-updated']) {
      current.on(event, (payload) => showParticipant((payload as { participant?: CallParticipant }).participant));
    }
    current.on('participant-left', (payload) => {
      const left = (payload as { participant?: CallParticipant }).participant;
      if (stopped || left === undefined || left.local === true) return;
      if (left.session_id === undefined || left.session_id === remoteSessionId) {
        remoteSessionId = undefined;
        on().onRemote(null);
      }
    });
    current.on('network-quality-change', (payload) => {
      if (!stopped) on().onQuality(isPoorNetwork(payload));
    });
    // Fatal meeting errors: only a real permission denial gets the settings
    // screen; anything else shows Daily's code.
    current.on('error', (payload) => {
      if (!stopped) on().onFailure(classifyJoinError(payload));
    });
    current.on('camera-error', (payload) => {
      const failure = classifyJoinError(payload);
      if (!stopped && failure.kind === 'permission') on().onFailure(failure);
    });

    try {
      await current.join({ url: options.roomUrl, token: options.token });
    } catch (caught) {
      if (!stopped) on().onFailure(classifyJoinError(caught));
    }
  })();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      const current = call;
      if (current === null) return;
      // Chain onto the release queue: leave, then destroy, each awaited.
      releasing = releasing
        .then(() => current.leave())
        .catch(() => undefined)
        .then(() => current.destroy())
        .then(
          () => undefined,
          () => undefined,
        );
    },
  };
}
