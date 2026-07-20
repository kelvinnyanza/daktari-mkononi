/**
 * API base URL. Set EXPO_PUBLIC_API_URL in .env / the shell before
 * `expo start`. NOTE for device testing: a phone cannot reach your laptop's
 * `localhost` — use the laptop's LAN IP (e.g. http://192.168.1.20:4000) and
 * make sure the API server's CORS origin allows it (see the README note).
 */
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
