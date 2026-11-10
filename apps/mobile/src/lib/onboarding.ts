/**
 * "Onboarding already shown" — a device flag (not an account setting), so the
 * four intro screens appear once per install. Stored next to the auth flags in
 * SecureStore; no PHI, no network.
 *
 * Storage failure is treated as "seen": showing the intro on every launch
 * would be worse than never showing it. (Web preview: the secure-store stand-in
 * is in-memory, so the intro shows again after a full page reload.)
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'daktari.onboarding-seen.v1';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, '1');
  } catch {
    // Best effort — see above.
  }
}
