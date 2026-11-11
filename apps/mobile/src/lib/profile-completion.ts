/**
 * Profile completion for the Profile header: four steps, in the order we ask
 * for them. Pure so it can be tested.
 */
import { regionFromAny } from '@daktari/schemas';

export type CompletionStep = 'health' | 'address' | 'street' | 'contact';

export interface CompletionInput {
  healthProfileCompleted: boolean;
  region: string;
  district: string;
  ward: string | null;
  street: string | null;
  emergencyContact: unknown;
}

const filled = (value: string | null): boolean => value !== null && value.trim() !== '' && value !== 'UNKNOWN';

export function profileCompletion(profile: CompletionInput): { percent: number; next: CompletionStep | null } {
  const steps: Array<[CompletionStep, boolean]> = [
    ['health', profile.healthProfileCompleted],
    ['address', regionFromAny(profile.region) !== null && filled(profile.district)],
    ['street', filled(profile.ward) && filled(profile.street)],
    ['contact', profile.emergencyContact !== null && profile.emergencyContact !== undefined],
  ];
  const done = steps.filter(([, ok]) => ok).length;
  return {
    percent: Math.round((done / steps.length) * 100),
    next: steps.find(([, ok]) => !ok)?.[0] ?? null,
  };
}

const MONTHS = {
  sw: ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
} as const;

/** "2026-11-10T…Z" → "Novemba 2026" / "November 2026" (EAT calendar). */
export function monthYearLabel(iso: string, locale: 'sw' | 'en'): string {
  const eat = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  return `${MONTHS[locale][eat.getUTCMonth()]} ${eat.getUTCFullYear()}`;
}

/** "2026-11-10T…Z" → "10 Novemba 2026" (EAT calendar). */
export function dayMonthYearLabel(iso: string, locale: 'sw' | 'en'): string {
  const eat = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  return `${eat.getUTCDate()} ${monthYearLabel(iso, locale)}`;
}
