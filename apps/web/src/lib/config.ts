/**
 * Public runtime config. The portal talks to the API directly from the
 * browser (no Next proxy) — see src/lib/api.ts for why.
 */
export const API_BASE_URL =
  process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/** External TMC register — opened in a new tab from the verification screen. */
export const TMC_REGISTER_URL = 'https://mct.go.tz/registers';
