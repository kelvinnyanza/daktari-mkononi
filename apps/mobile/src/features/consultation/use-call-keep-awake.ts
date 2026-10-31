import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { CALL_KEEP_AWAKE_TAG, createKeepAwakeController, type KeepAwakeController } from './keep-awake';

/** Screen stays awake while this call screen is focused, foregrounded and in a call. */
export function useCallKeepAwake(inCall: boolean): void {
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const controller = useRef<KeepAwakeController | null>(null);
  controller.current ??= createKeepAwakeController({
    activate: () => activateKeepAwakeAsync(CALL_KEEP_AWAKE_TAG),
    deactivate: () => deactivateKeepAwake(CALL_KEEP_AWAKE_TAG),
    log: (message, error) => console.warn(message, error instanceof Error ? error.message : error),
  });

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) =>
      setForeground(state === 'active'),
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    controller.current?.update({ focused, foreground, inCall });
  }, [focused, foreground, inCall]);

  useEffect(() => () => controller.current?.release(), []);
}
