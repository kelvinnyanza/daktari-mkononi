/**
 * The ONLY module that touches @daily-co/react-native-daily-js, and even here
 * it is behind a runtime dynamic import — no static import anywhere in the app.
 * Consequences: jest-expo never loads native code, and the TypeScript build
 * never depends on Daily's type exports. (The Daily SDK has known Expo/Metro
 * friction; isolating it here contains the blast radius.)
 */
import type { ComponentType } from 'react';

/** Minimal surface of Daily's DailyCall object that the call screen uses. */
export interface VideoCall {
  join(opts: { url: string; token: string }): Promise<unknown>;
  leave(): Promise<unknown>;
  setLocalAudio(enabled: boolean): void;
  setLocalVideo(enabled: boolean): void;
  cycleCamera(): Promise<unknown>;
  on(event: string, handler: (payload: unknown) => void): void;
  destroy(): Promise<unknown>;
}

/** Props we pass Daily's <DailyMediaView>; typed loosely to avoid the dep. */
export interface DailyMediaViewProps {
  videoTrack?: unknown;
  audioTrack?: unknown;
  mirror?: boolean;
  objectFit?: 'contain' | 'cover';
  style?: unknown;
}

export interface LoadedDaily {
  createCall: () => VideoCall;
  MediaView: ComponentType<DailyMediaViewProps>;
}

/**
 * Load the Daily SDK at runtime. Resolves only on a real device / dev build;
 * throws a friendly, actionable error in Expo Go / web / tests where the
 * native module is unavailable.
 */
export async function loadDaily(): Promise<LoadedDaily> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped native boundary
  let mod: any;
  try {
    mod = await import('@daily-co/react-native-daily-js');
  } catch {
    throw new Error(
      'Video calling requires the Daktari dev build (not Expo Go). See README → Running the mobile app.',
    );
  }
  const createCallObject = mod.default?.createCallObject ?? mod.createCallObject;
  const MediaView = (mod.DailyMediaView ?? mod.default?.DailyMediaView) as
    | ComponentType<DailyMediaViewProps>
    | undefined;
  if (typeof createCallObject !== 'function' || MediaView === undefined) {
    throw new Error('Daily SDK loaded but expected exports were missing');
  }
  return { createCall: () => createCallObject() as VideoCall, MediaView };
}
