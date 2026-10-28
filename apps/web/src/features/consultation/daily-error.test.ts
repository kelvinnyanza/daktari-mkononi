import { describe, expect, it } from 'vitest';
import { dailyErrorDetail } from './daily-error';

describe('dailyErrorDetail', () => {
  it("reads Daily's errorMsg from a join rejection", () => {
    expect(dailyErrorDetail({ action: 'error', errorMsg: 'account-missing-payment-method' })).toBe(
      'account-missing-payment-method',
    );
  });

  it('falls back to an Error message (e.g. the duplicate-instance guard)', () => {
    expect(dailyErrorDetail(new Error('Duplicate DailyIframe instances are not allowed'))).toBe(
      'Duplicate DailyIframe instances are not allowed',
    );
  });

  it('returns null when there is nothing useful', () => {
    expect(dailyErrorDetail(undefined)).toBeNull();
    expect(dailyErrorDetail({})).toBeNull();
    expect(dailyErrorDetail(new Error(''))).toBeNull();
  });
});
