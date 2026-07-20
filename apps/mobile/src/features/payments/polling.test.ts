import { POLL_INTERVAL_MS, mnoWalletLabel, pollInterval } from './polling';

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

  it('unknown/loading status does not poll', () => {
    expect(pollInterval(undefined, true)).toBe(false);
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
