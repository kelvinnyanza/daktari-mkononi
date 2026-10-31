/**
 * After the doctor completes: completed screen → rating → medical record.
 *
 * Rating is OPTIONAL and must never stand between the patient and their
 * record, so every uncertain case resolves to 'record': skipped, already
 * rated, rating status unavailable (error), or a consultation that is not
 * rateable. Only a COMPLETED, not-yet-rated consultation (or one whose
 * status is still loading — Skip is shown meanwhile) asks for a rating.
 * A skipped rating stays available on Appointment details.
 */
export type PostCallStep = 'rate' | 'record';

export function postCallStep(input: {
  appointmentId: string | undefined;
  skipped: boolean;
  rated: boolean;
  status: { isError: boolean; data: { status: string; rating: unknown } | undefined };
}): PostCallStep {
  const { appointmentId, skipped, rated, status } = input;
  if (appointmentId === undefined || skipped || rated || status.isError) return 'record';
  if (status.data === undefined) return 'rate'; // loading: form + Skip, never a dead end
  if (status.data.rating !== null) return 'record'; // one rating per consultation — already done
  return status.data.status === 'COMPLETED' ? 'rate' : 'record';
}

/** 409 ALREADY_RATED (e.g. rated from another screen) means "done", not "failed". */
export function isAlreadyRated(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ALREADY_RATED';
}
