/**
 * API base URL, from EXPO_PUBLIC_API_URL (set in .env / the shell before
 * `expo start`, or in the EAS build profile).
 *
 * There is deliberately NO localhost fallback: on a phone `localhost` is the
 * phone itself, so a silent default turns a missing variable into "network
 * error" on every screen. A missing or unusable value instead makes the root
 * layout render a bilingual "app is misconfigured" screen (see
 * `app/_layout.tsx`).
 *
 * NOTE for device testing: use the PC's LAN IP (e.g. http://192.168.1.20:4000)
 * — see "LAN gotchas" in the README. Native fetch is not subject to CORS.
 */

export type ApiConfig =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: 'MISSING' | 'INVALID'; raw: string | undefined };

/** Pure so it can be unit-tested without Expo's env inlining. */
export function resolveApiConfig(raw: string | undefined): ApiConfig {
  const value = raw?.trim();
  if (value === undefined || value === '') return { ok: false, reason: 'MISSING', raw };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'INVALID', raw };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'INVALID', raw };
  }
  // Callers append `/api/v1/...`; a trailing slash would double it.
  return { ok: true, baseUrl: value.replace(/\/+$/, '') };
}

// Must stay the literal `process.env.EXPO_PUBLIC_API_URL` — Expo inlines
// EXPO_PUBLIC_* variables at bundle time only for that exact expression.
export const API_CONFIG: ApiConfig = resolveApiConfig(process.env.EXPO_PUBLIC_API_URL);

/**
 * Empty when misconfigured. Nothing should call the API in that state — the
 * root layout renders the misconfiguration screen instead of any route.
 */
export const API_BASE_URL: string = API_CONFIG.ok ? API_CONFIG.baseUrl : '';
