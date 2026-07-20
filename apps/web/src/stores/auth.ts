import { create } from 'zustand';
import { api, apiRequest, refreshAccessToken, setAccessToken } from '@/lib/api';
import type { Role } from '@/lib/auth-gate';

export interface SessionUser {
  id: string;
  phone: string;
  fullName: string;
  role: Role;
  language: 'sw' | 'en';
  phoneVerified: boolean;
}

interface LoginOk {
  status: 'OK';
  user: SessionUser;
  accessToken: string;
}
interface LoginTwoFactor {
  status: '2FA_REQUIRED';
}
type LoginResponse = LoginOk | LoginTwoFactor;

interface AuthState {
  user: SessionUser | null;
  /** False until the initial cookie-refresh attempt has settled. */
  ready: boolean;
  login: (phone: string, password: string) => Promise<SessionUser>;
  /** Restore a session on page load from the httpOnly refresh cookie. */
  restore: () => Promise<void>;
  logout: () => Promise<void>;
  /** Local teardown when the server has already killed the session. */
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  ready: false,

  login: async (phone, password) => {
    // No `refreshToken` in the body for web clients — the server sets the
    // httpOnly cookie instead (x-daktari-client: web, added by the api layer).
    const result = await apiRequest<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: { phone, password, client: 'web' },
      anonymous: true,
    });
    if (result.status !== 'OK') {
      // The portal has no 2FA challenge screen yet; fail loudly rather than
      // half-authenticating someone.
      throw new Error('2FA_REQUIRED');
    }
    setAccessToken(result.accessToken);
    set({ user: result.user, ready: true });
    return result.user;
  },

  restore: async () => {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      set({ user: null, ready: true });
      return;
    }
    try {
      const me = await api.get<{ user: SessionUser }>('/api/v1/auth/me');
      set({ user: me.user, ready: true });
    } catch {
      setAccessToken(null);
      set({ user: null, ready: true });
    }
  },

  logout: async () => {
    try {
      await api.post('/api/v1/auth/logout');
    } catch {
      // Even if the call fails, drop local state — the cookie is scoped to
      // /refresh and a stale one simply fails on next use.
    }
    setAccessToken(null);
    set({ user: null, ready: true });
  },

  clear: () => {
    setAccessToken(null);
    set({ user: null, ready: true });
  },
}));
