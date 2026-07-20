/**
 * Tanzanian MNO prefix map — REVIEWABLE CONSTANTS.
 *
 * The mobile-money checkout must name the payer's network; it is derived
 * from the MSISDN prefix (+255 XX .......). Update here when TCRA reassigns
 * ranges. `azamProvider` is the provider string AzamPay's checkout expects.
 */
export interface MnoEntry {
  /** Two digits after +255. */
  prefix: string;
  network: 'VODACOM' | 'TIGO' | 'AIRTEL' | 'HALOTEL';
  azamProvider: 'Mpesa' | 'Tigo' | 'Airtel' | 'Halopesa';
}

export const MNO_PREFIXES: readonly MnoEntry[] = [
  // Vodacom (M-Pesa)
  { prefix: '74', network: 'VODACOM', azamProvider: 'Mpesa' },
  { prefix: '75', network: 'VODACOM', azamProvider: 'Mpesa' },
  { prefix: '76', network: 'VODACOM', azamProvider: 'Mpesa' },
  // Tigo (Tigo Pesa)
  { prefix: '71', network: 'TIGO', azamProvider: 'Tigo' },
  { prefix: '65', network: 'TIGO', azamProvider: 'Tigo' },
  { prefix: '67', network: 'TIGO', azamProvider: 'Tigo' },
  // Airtel (Airtel Money)
  { prefix: '68', network: 'AIRTEL', azamProvider: 'Airtel' },
  { prefix: '69', network: 'AIRTEL', azamProvider: 'Airtel' },
  { prefix: '78', network: 'AIRTEL', azamProvider: 'Airtel' },
  // Halotel (Halopesa)
  { prefix: '62', network: 'HALOTEL', azamProvider: 'Halopesa' },
] as const;

/**
 * Derive the MNO from a +255XXXXXXXXX MSISDN.
 * Throws MobileMoneyError(INVALID_MSISDN) upstream when null.
 */
export function deriveMno(phoneE164: string): MnoEntry | null {
  const match = /^\+255(\d{2})\d{7}$/.exec(phoneE164);
  if (!match) return null;
  return MNO_PREFIXES.find((entry) => entry.prefix === match[1]) ?? null;
}
