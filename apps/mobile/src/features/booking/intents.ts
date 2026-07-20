/** Booking gating rules — pure and testable. The server re-validates all of it. */

export type AppointmentType = 'VIDEO' | 'AUDIO' | 'CHAT' | 'IN_PERSON';
export type PaymentIntent = 'MOBILE_MONEY' | 'NHIF' | 'CASH_AT_FACILITY';

/** Remote types always; IN_PERSON only for hospital-affiliated doctors. */
export function availableTypes(doctor: { hospitalAffiliated: boolean }): AppointmentType[] {
  const types: AppointmentType[] = ['VIDEO', 'AUDIO', 'CHAT'];
  if (doctor.hospitalAffiliated) types.push('IN_PERSON');
  return types;
}

/**
 * MOBILE_MONEY is always offered (default). NHIF only with a verified
 * insurance row. CASH_AT_FACILITY only for IN_PERSON appointments.
 */
export function availableIntents(input: {
  type: AppointmentType;
  verifiedNhif: boolean;
}): PaymentIntent[] {
  const intents: PaymentIntent[] = ['MOBILE_MONEY'];
  if (input.verifiedNhif) intents.push('NHIF');
  if (input.type === 'IN_PERSON') intents.push('CASH_AT_FACILITY');
  return intents;
}
