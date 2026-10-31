/**
 * Keep the screen awake during a call — but only while it can work.
 *
 * Android refuses activation when there is no foreground Activity ("Unable to
 * activate keep awake"), e.g. the app is backgrounded or the screen is off.
 * Activating then rejects; unawaited, that surfaced as an unhandled promise.
 * So: activate only while the call screen is focused AND the app is in the
 * foreground AND a call is live; deactivate as soon as any of those stops;
 * every failure is caught and logged, never thrown.
 *
 * Pure controller (no React) so the rules are unit-tested; useCallKeepAwake
 * (use-call-keep-awake.ts) only feeds it focus / AppState / call state.
 */
export const CALL_KEEP_AWAKE_TAG = 'daktari-call';

export interface KeepAwakeConditions {
  focused: boolean;
  foreground: boolean;
  inCall: boolean;
}

export interface KeepAwakeController {
  update: (conditions: KeepAwakeConditions) => void;
  /** Leaving the screen: release unconditionally. */
  release: () => void;
}

export function createKeepAwakeController(deps: {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  log: (message: string, error: unknown) => void;
}): KeepAwakeController {
  let held = false;

  const off = (): void => {
    if (!held) return;
    held = false;
    deps.deactivate().catch((error: unknown) => deps.log('keep-awake: deactivate failed', error));
  };

  return {
    update: ({ focused, foreground, inCall }) => {
      const want = focused && foreground && inCall;
      if (want && !held) {
        held = true;
        deps.activate().catch((error: unknown) => {
          held = false; // not actually held — a later foreground retries
          deps.log('keep-awake: activate failed', error);
        });
      } else if (!want) {
        off();
      }
    },
    release: off,
  };
}
