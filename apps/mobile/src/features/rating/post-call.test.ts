import { isAlreadyRated, postCallStep } from './post-call';

const ok = (status: string, rating: unknown = null) => ({ isError: false, data: { status, rating } });
const base = { appointmentId: 'a1', skipped: false, rated: false };

describe('post-call step (completed → rating → record)', () => {
  it('asks for a rating on a completed, not-yet-rated consultation', () => {
    expect(postCallStep({ ...base, status: ok('COMPLETED') })).toBe('rate');
  });

  it('while the rating status loads it shows the form (with Skip), not a dead end', () => {
    expect(postCallStep({ ...base, status: { isError: false, data: undefined } })).toBe('rate');
  });

  it('Skip goes straight to the record', () => {
    expect(postCallStep({ ...base, skipped: true, status: ok('COMPLETED') })).toBe('record');
  });

  it('after rating it moves on to the record', () => {
    expect(postCallStep({ ...base, rated: true, status: ok('COMPLETED') })).toBe('record');
  });

  it('already rated (one rating per consultation) → record, no second form', () => {
    expect(postCallStep({ ...base, status: ok('COMPLETED', { rating: 5 }) })).toBe('record');
  });

  it('never blocks the record: status error, not rateable, or no appointment id', () => {
    expect(postCallStep({ ...base, status: { isError: true, data: undefined } })).toBe('record');
    expect(postCallStep({ ...base, status: ok('ABANDONED') })).toBe('record');
    expect(postCallStep({ ...base, appointmentId: undefined, status: ok('COMPLETED') })).toBe('record');
  });

  it('409 ALREADY_RATED counts as done', () => {
    expect(isAlreadyRated({ code: 'ALREADY_RATED' })).toBe(true);
    expect(isAlreadyRated({ code: 'NETWORK' })).toBe(false);
    expect(isAlreadyRated(undefined)).toBe(false);
  });
});
