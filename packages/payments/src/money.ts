/**
 * Money rules (see CLAUDE.md): every amount is WHOLE TZS as an integer.
 * No floats, no cents, no implicit division — ever.
 */

/** Platform commission on consultations, percent of the gross amount. */
export const DEFAULT_PLATFORM_FEE_PERCENT = 10;

export interface FeeSplit {
  platformFeeTzs: number;
  doctorAmountTzs: number;
}

/**
 * Split a gross amount into platform fee + doctor amount using integer math.
 * The doctor receives the floor of their share; the platform receives the
 * rounding remainder. Invariant (property-tested):
 *   platformFeeTzs + doctorAmountTzs === amountTzs
 */
export function splitFee(amountTzs: number, feePercent: number = DEFAULT_PLATFORM_FEE_PERCENT): FeeSplit {
  if (!Number.isSafeInteger(amountTzs) || amountTzs < 0) {
    throw new RangeError(`amountTzs must be a non-negative integer, got ${amountTzs}`);
  }
  if (!Number.isSafeInteger(feePercent) || feePercent < 0 || feePercent > 100) {
    throw new RangeError(`feePercent must be an integer 0–100, got ${feePercent}`);
  }
  const doctorAmountTzs = Math.floor((amountTzs * (100 - feePercent)) / 100);
  const platformFeeTzs = amountTzs - doctorAmountTzs; // remainder goes to the platform
  return { platformFeeTzs, doctorAmountTzs };
}
