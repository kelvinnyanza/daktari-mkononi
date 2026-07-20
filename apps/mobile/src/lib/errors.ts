/** Map an unknown failure to a user-facing string for the active locale. */
import { pickBilingual, translate, type TranslationKey } from '../i18n';
import { ApiError, NetworkError } from '../services/api';

const KNOWN_CODES = new Set([
  'INVALID_CREDENTIALS',
  'PHONE_NOT_VERIFIED',
  'ACCOUNT_LOCKED',
  'RATE_LIMITED',
  'TOKEN_EXPIRED',
  'SESSION_REVOKED',
  'VALIDATION_ERROR',
  'INVALID_OTP',
  'OTP_ATTEMPTS_EXCEEDED',
  'CANCELLATION_WINDOW_PASSED',
  'SLOT_TAKEN',
  'NOT_FOUND',
]);

/** Type guard for branching on server error codes (e.g. SLOT_TAKEN). */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorMessage(error: unknown, _fallback?: string): string {
  if (error instanceof NetworkError) {
    return translate('common.error.network');
  }
  if (error instanceof ApiError) {
    // Prefer the server's bilingual envelope; fall back to the ported map.
    const fromServer = pickBilingual(error.userMessage);
    if (fromServer !== undefined) return fromServer;
    if (KNOWN_CODES.has(error.code)) {
      return translate(`error.${error.code}` as TranslationKey);
    }
  }
  return translate('common.error.generic');
}
