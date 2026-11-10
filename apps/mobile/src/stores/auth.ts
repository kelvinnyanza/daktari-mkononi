/**
 * Auth state. Persists ONLY { userId, role, isAuthenticated } via a
 * SecureStore adapter — tokens NEVER pass through this store: the access
 * token lives in memory in services/api.ts, the refresh token in its own
 * SecureStore key touched exclusively by the API layer.
 */
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type Role = 'PATIENT' | 'DOCTOR' | 'HOSPITAL_ADMIN' | 'PHARMACY_STAFF' | 'PLATFORM_ADMIN' | 'SUPER_ADMIN';

export interface AuthState {
  userId: string | null;
  role: Role | null;
  isAuthenticated: boolean;
  signIn: (userId: string, role: Role) => void;
  signOut: () => void;
}

const secureStorage: StateStorage = {
  getItem: (name) => SecureStore.getItemAsync(name),
  setItem: (name, value) => SecureStore.setItemAsync(name, value),
  removeItem: (name) => SecureStore.deleteItemAsync(name),
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      userId: null,
      role: null,
      isAuthenticated: false,
      signIn: (userId, role) => set({ userId, role, isAuthenticated: true }),
      signOut: () => set({ userId: null, role: null, isAuthenticated: false }),
    }),
    {
      name: 'daktari.auth-flags',
      storage: createJSONStorage(() => secureStorage),
      // Only the flags — never anything token-shaped.
      partialize: (state) => ({
        userId: state.userId,
        role: state.role,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

/**
 * True once the persisted auth flags have been read from SecureStore (async).
 * Before that, `isAuthenticated` is the initial `false` — routing on it would
 * send a signed-in patient to login on every cold start.
 */
export function useAuthHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    const unsubscribe = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    // Hydration may have finished between the first render and this effect.
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsubscribe;
  }, [hydrated]);
  return hydrated;
}
