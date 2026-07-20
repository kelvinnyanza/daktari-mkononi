jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  };
});

import { useAuthStore } from './auth';

const secureStore = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('auth store', () => {
  it('tracks sign-in/out and persists ONLY the flags — never tokens', async () => {
    useAuthStore.getState().signIn('user-1', 'PATIENT');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().role).toBe('PATIENT');

    await flush(); // let the persist middleware write
    const persisted = secureStore.__store.get('daktari.auth-flags');
    expect(persisted).toBeDefined();
    const parsed = JSON.parse(persisted!) as { state: Record<string, unknown> };
    expect(Object.keys(parsed.state).sort()).toEqual(['isAuthenticated', 'role', 'userId']);
    expect(JSON.stringify(parsed)).not.toMatch(/token/i); // nothing token-shaped

    useAuthStore.getState().signOut();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().userId).toBeNull();
  });
});
