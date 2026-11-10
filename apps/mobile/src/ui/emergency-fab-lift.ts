/**
 * Lift the "Dharura" button above a screen's own bottom bar (chat input +
 * Send, call controls, sticky Save/Pay footer) while that screen is focused.
 * Tabs keep visited screens mounted, so registration follows FOCUS, not mount.
 *
 * Separate from the ui index on purpose: it needs expo-router's navigation
 * context, which the design-system components (and their tests) do not.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useId } from 'react';
import { useEmergencyShell } from './EmergencyShell';

export function useEmergencyFabLift(px: number): void {
  const shell = useEmergencyShell();
  const id = useId();
  useFocusEffect(
    useCallback(() => {
      shell?.setLift(id, px);
      return () => shell?.setLift(id, null);
    }, [shell, id, px]),
  );
}
