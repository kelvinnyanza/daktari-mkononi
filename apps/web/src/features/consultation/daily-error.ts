/**
 * Daily rejects `join()` with an object carrying `errorMsg` (e.g.
 * "account-missing-payment-method", "exp-token"), not always an Error. The
 * code is not patient data and is what makes a failed join diagnosable, so
 * the video panel shows it next to the generic message.
 */
export function dailyErrorDetail(error: unknown): string | null {
  if (typeof error === 'object' && error !== null) {
    const errorMsg = (error as { errorMsg?: unknown }).errorMsg;
    if (typeof errorMsg === 'string' && errorMsg !== '') return errorMsg;
    if (error instanceof Error && error.message !== '') return error.message;
  }
  if (typeof error === 'string' && error !== '') return error;
  return null;
}
