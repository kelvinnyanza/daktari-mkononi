/** Persists ONLY the active screening session id (not PHI, not transcript). */
import * as SecureStore from 'expo-secure-store';

const KEY = 'daktari.screeningSessionId';

export async function loadSessionId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveSessionId(sessionId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, sessionId, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Persistence is best-effort; the chat still works for this app run.
  }
}

export async function clearSessionId(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore
  }
}
