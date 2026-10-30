import { POLL_INTERVAL_MS, leftPendingPayment, mnoWalletLabel, pollInterval } from './polling';

describe('payment polling decisions', () => {
  it('polls every 5s only while PENDING_PAYMENT and focused', () => {
    expect(pollInterval('PENDING_PAYMENT', true)).toBe(POLL_INTERVAL_MS);
  });

  it('terminal states stop polling', () => {
    for (const status of ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']) {
      expect(pollInterval(status, true)).toBe(false);
    }
  });

  it('screen blur stops polling regardless of status', () => {
    expect(pollInterval('PENDING_PAYMENT', false)).toBe(false);
  });

  it('polls a remote CONFIRMED appointment so the Join action appears when the doctor starts', () => {
    expect(pollInterval('CONFIRMED', true, true)).toBe(POLL_INTERVAL_MS);
    expect(pollInterval('CONFIRMED', true, false)).toBe(false); // in-person: nothing to await
    expect(pollInterval('CONFIRMED', false, true)).toBe(false); // blurred
    expect(pollInterval('IN_PROGRESS', true, true)).toBe(POLL_INTERVAL_MS); // awaits COMPLETED → rating
    expect(pollInterval('COMPLETED', true, true)).toBe(false); // terminal
  });

  it('unknown/loading status does not poll', () => {
    expect(pollInterval(undefined, true)).toBe(false);
  });

  it('flags the PENDING_PAYMENT → other transition so payments refetch', () => {
    expect(leftPendingPayment('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(leftPendingPayment('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(leftPendingPayment('PENDING_PAYMENT', 'PENDING_PAYMENT')).toBe(false);
    expect(leftPendingPayment('PENDING_PAYMENT', undefined)).toBe(false); // refetch in flight
    expect(leftPendingPayment(undefined, 'CONFIRMED')).toBe(false); // first load
    expect(leftPendingPayment('CONFIRMED', 'COMPLETED')).toBe(false);
  });
});

describe('MNO wallet label (shared prefix map from @daktari/payments/mno)', () => {
  it.each([
    ['+255742345678', 'M-Pesa'],
    ['+255712345678', 'Tigo Pesa'],
    ['+255682345678', 'Airtel Money'],
    ['+255622345678', 'Halopesa'],
    ['+255992345678', 'Mobile Money'], // unknown prefix → generic label
  ])('%s → %s', (phone, label) => {
    expect(mnoWalletLabel(phone)).toBe(label);
  });
});
