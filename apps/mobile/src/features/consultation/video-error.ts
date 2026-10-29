/**
 * Classify a Daily join/runtime error — pure and testable.
 *
 * Only a real camera/microphone permission denial gets the "open settings"
 * screen; everything else (e.g. `account-missing-payment-method`,
 * `exp-token`, network) shows Daily's own error code, so a failed call is
 * diagnosable instead of sending the patient into their settings.
 */
export type JoinFailure = { kind: 'permission' } | { kind: 'failed'; detail: string | null };

const PERMISSION = /permission|notallowed|not[-_ ]allowed|denied/i;

export function classifyJoinError(error: unknown): JoinFailure {
  const detail = errorText(error);
  const type = nestedErrorType(error);
  if (type === 'permissions' || (detail !== null && PERMISSION.test(detail))) {
    return { kind: 'permission' };
  }
  return { kind: 'failed', detail };
}

function errorText(error: unknown): string | null {
  if (typeof error === 'string') return error === '' ? null : error;
  if (typeof error !== 'object' || error === null) return null;
  const errorMsg = (error as { errorMsg?: unknown }).errorMsg;
  if (typeof errorMsg === 'string' && errorMsg !== '') return errorMsg;
  if (error instanceof Error && error.message !== '') return error.message;
  return null;
}

/** Daily's `camera-error` payload: `{ error: { type: 'permissions' | 'cam-in-use' | … } }`. */
function nestedErrorType(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const inner = (error as { error?: unknown }).error;
  if (typeof inner !== 'object' || inner === null) return null;
  const type = (inner as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}
