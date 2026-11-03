/**
 * Money rules (see CLAUDE.md): every amount is WHOLE TZS as an integer.
 * No floats, no cents, no implicit division — ever. Rates are integer basis
 * points (1 bps = 0.01%; 2000 bps = 20%), so a rate like 12.5% is exact.
 *
 * FEE MODEL (Phase 13a). The patient pays the doctor's consultation fee F in
 * full; medical services are VAT-exempt, so NO VAT is ever added to F. The
 * platform's commission is a taxable service, so VAT applies to the
 * commission only:
 *
 *   commission C = roundHalfUp(F × commissionBps / 10000)
 *   ON_TOP_OF_COMMISSION   (default): VAT V = roundHalfUp(C × vatBps / 10000)
 *                                     doctor D = F − C − V
 *                                     platform revenue (ex VAT) = C
 *   INCLUDED_IN_COMMISSION:            C already contains the VAT — the VAT
 *                                     comes out of the PLATFORM's commission,
 *                                     never out of the doctor's share:
 *                                     V = roundHalfUp(C × vatBps / (10000 + vatBps))
 *                                     doctor D = F − C (same as with VAT off)
 *                                     platform revenue (ex VAT) = C − V
 *   vatEnabled = false:                V = 0 in both modes
 *
 * Rounding rule: commission and VAT are each rounded half-up to the whole
 * shilling (x.5 → up); the DOCTOR receives the exact residual, so nothing is
 * ever lost or invented. Invariant (property-tested), in every mode:
 *
 *   platformCommissionTzs + vatTzs + doctorAmountTzs === feeTzs, all ≥ 0
 *
 * Worked example, 15,000 TZS at 20% / 18% on top: C = 3,000, V = 540,
 * D = 11,460.
 */

export type VatMode = 'ON_TOP_OF_COMMISSION' | 'INCLUDED_IN_COMMISSION';

export interface FeeRates {
  commissionBps: number;
  vatEnabled: boolean;
  vatBps: number;
  vatMode: VatMode;
}

export interface FeeBreakdown {
  feeTzs: number;
  /** Platform revenue, EXCLUDING VAT. */
  platformCommissionTzs: number;
  /** VAT on the commission — owed to TRA, not platform revenue. */
  vatTzs: number;
  doctorAmountTzs: number;
  /** Gross commission deducted from the doctor's fee (= commission + VAT on top, or C incl. VAT). */
  deductedFromDoctorTzs: number;
}

/** Commission ceiling: a commission above half the fee is a misconfiguration, not a price. */
export const MAX_COMMISSION_BPS = 5_000;
/** VAT ceiling for validation (Tanzania standard rate is 18%). */
export const MAX_VAT_BPS = 3_000;

export const DEFAULT_FEE_RATES: FeeRates = {
  commissionBps: 2_000,
  vatEnabled: true,
  vatBps: 1_800,
  vatMode: 'ON_TOP_OF_COMMISSION',
};

function assertWholeTzs(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}`);
  }
}

function assertBps(value: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer 0–${max} bps, got ${value}`);
  }
}

/** round(numerator / denominator), half-up, integers only (numerator, denominator > 0). */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Percent with ≤ 2 decimals → basis points (20 → 2000, 12.5 → 1250); null when not exact. */
export function percentToBps(percent: number): number | null {
  const bps = Math.round(percent * 100);
  return Math.abs(percent * 100 - bps) < 1e-6 ? bps : null;
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function validateFeeRates(rates: FeeRates): void {
  assertBps(rates.commissionBps, MAX_COMMISSION_BPS, 'commissionBps');
  assertBps(rates.vatBps, MAX_VAT_BPS, 'vatBps');
}

/** Split a consultation fee into platform commission, VAT and doctor amount. */
export function calculateFees(feeTzs: number, rates: FeeRates): FeeBreakdown {
  assertWholeTzs(feeTzs, 'feeTzs');
  validateFeeRates(rates);

  const commission = roundHalfUpDiv(feeTzs * rates.commissionBps, 10_000);
  const vatBps = rates.vatEnabled ? rates.vatBps : 0;
  let vatTzs: number;
  let doctorAmountTzs: number;
  let platformCommissionTzs: number;
  if (rates.vatMode === 'ON_TOP_OF_COMMISSION') {
    vatTzs = vatBps === 0 ? 0 : roundHalfUpDiv(commission * vatBps, 10_000);
    platformCommissionTzs = commission;
    doctorAmountTzs = feeTzs - commission - vatTzs;
  } else {
    vatTzs = vatBps === 0 ? 0 : roundHalfUpDiv(commission * vatBps, 10_000 + vatBps);
    platformCommissionTzs = commission - vatTzs;
    doctorAmountTzs = feeTzs - commission;
  }
  if (doctorAmountTzs < 0 || platformCommissionTzs < 0) {
    // Unreachable within the validated ceilings; refuse rather than pay out a negative.
    throw new RangeError(`fee split went negative for ${feeTzs} TZS`);
  }
  return {
    feeTzs,
    platformCommissionTzs,
    vatTzs,
    doctorAmountTzs,
    deductedFromDoctorTzs: feeTzs - doctorAmountTzs,
  };
}
