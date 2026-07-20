import { availableIntents, availableTypes } from './intents';

describe('booking gating', () => {
  it('IN_PERSON is offered only for hospital-affiliated doctors', () => {
    expect(availableTypes({ hospitalAffiliated: false })).toEqual(['VIDEO', 'AUDIO', 'CHAT']);
    expect(availableTypes({ hospitalAffiliated: true })).toEqual(['VIDEO', 'AUDIO', 'CHAT', 'IN_PERSON']);
  });

  it('NHIF is hidden without a verified insurance row', () => {
    expect(availableIntents({ type: 'VIDEO', verifiedNhif: false })).toEqual(['MOBILE_MONEY']);
    expect(availableIntents({ type: 'VIDEO', verifiedNhif: true })).toEqual(['MOBILE_MONEY', 'NHIF']);
  });

  it('CASH_AT_FACILITY only for IN_PERSON; MOBILE_MONEY is always first (default)', () => {
    expect(availableIntents({ type: 'IN_PERSON', verifiedNhif: false })).toEqual([
      'MOBILE_MONEY',
      'CASH_AT_FACILITY',
    ]);
    expect(availableIntents({ type: 'IN_PERSON', verifiedNhif: true })).toEqual([
      'MOBILE_MONEY',
      'NHIF',
      'CASH_AT_FACILITY',
    ]);
    expect(availableIntents({ type: 'CHAT', verifiedNhif: false })[0]).toBe('MOBILE_MONEY');
  });
});
