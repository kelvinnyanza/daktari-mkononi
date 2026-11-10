/**
 * Health profile form ↔ API (UI Phase 2). The form keeps raw strings; this
 * turns them into the PUT body that makeHealthProfileInputSchema (the same
 * schema the server uses) validates, and maps its error CODES to sw/en text.
 */
import {
  ageInYears,
  type BloodGroupAnswer,
  type BpHistory,
  type HealthProfileView,
  type TzRegion,
} from '@daktari/schemas';
import type { TranslationKey } from '../i18n/translations';
import { fromE164, toE164 } from './phone';

export type Sex = 'MALE' | 'FEMALE' | 'UNDISCLOSED';

export interface HealthFormState {
  day: string;
  month: string;
  year: string;
  sex: Sex | null;
  height: string;
  weight: string;
  region: TzRegion | null;
  district: string;
  bpHistory: BpHistory | null;
  bloodGroup: BloodGroupAnswer | null;
  allergies: string;
  chronicConditions: string;
  currentMedications: string;
  contactName: string;
  contactPhone: string; // 9 local digits
  consent: boolean;
}

export const EMPTY_HEALTH_FORM: HealthFormState = {
  day: '',
  month: '',
  year: '',
  sex: null,
  height: '',
  weight: '',
  region: null,
  district: '',
  bpHistory: null,
  bloodGroup: null,
  allergies: '',
  chronicConditions: '',
  currentMedications: '',
  contactName: '',
  contactPhone: '',
  consent: false,
};

/** "12", "4", "1990" → "1990-04-12"; '' until all three parts are filled. */
export function dobFromParts(day: string, month: string, year: string): string {
  const d = day.trim();
  const m = month.trim();
  const y = year.trim();
  if (d === '' || m === '' || y === '') return '';
  return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Age to show next to the date (never typed by the patient); null until the date is valid. */
export function ageFromParts(day: string, month: string, year: string, now: Date): number | null {
  const iso = dobFromParts(day, month, year);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  const age = ageInYears(date, now);
  return age >= 0 && age <= 130 ? age : null;
}

/** "62,5" → 62.5; '' → undefined (→ "required"); junk → NaN (→ "a number"). */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return undefined;
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** One item per line or comma; trimmed, empties dropped, duplicates removed. */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const item = raw.trim();
    const folded = item.toLowerCase();
    if (item === '' || seen.has(folded)) continue;
    seen.add(folded);
    items.push(item);
  }
  return items;
}

export function toHealthInput(form: HealthFormState): Record<string, unknown> {
  const contactGiven = form.contactName.trim() !== '' || form.contactPhone !== '';
  return {
    dateOfBirth: dobFromParts(form.day, form.month, form.year),
    sex: form.sex ?? undefined,
    heightCm: parseNumber(form.height),
    weightKg: parseNumber(form.weight),
    region: form.region ?? undefined,
    district: form.district,
    bpHistory: form.bpHistory ?? undefined,
    ...(form.bloodGroup !== null ? { bloodGroup: form.bloodGroup } : {}),
    allergies: parseList(form.allergies),
    chronicConditions: parseList(form.chronicConditions),
    currentMedications: parseList(form.currentMedications),
    ...(contactGiven
      ? { emergencyContact: { name: form.contactName, phone: toE164(form.contactPhone) } }
      : {}),
    consent: form.consent,
  };
}

export function formFromView(view: HealthProfileView): HealthFormState {
  const [year = '', month = '', day = ''] = view.dateOfBirth?.split('-') ?? [];
  const region = view.region as TzRegion | null;
  return {
    day: day.replace(/^0/, ''),
    month: month.replace(/^0/, ''),
    year,
    sex: view.sex,
    height: view.heightCm === null ? '' : String(view.heightCm),
    weight: view.weightKg === null ? '' : String(view.weightKg),
    region,
    district: view.district ?? '',
    bpHistory: view.bpHistory,
    bloodGroup: view.bloodGroup,
    allergies: view.allergies.join('\n'),
    chronicConditions: view.chronicConditions.join('\n'),
    currentMedications: view.currentMedications.join('\n'),
    contactName: view.emergencyContact?.name ?? '',
    contactPhone: fromE164(view.emergencyContact?.phone),
    // Consent is re-confirmed on every save (the box is pre-ticked once given).
    consent: view.consentGivenAt !== null,
  };
}

/** Form field each API field's error is shown under. */
export type HealthField =
  | 'dateOfBirth'
  | 'sex'
  | 'heightCm'
  | 'weightKg'
  | 'region'
  | 'district'
  | 'bpHistory'
  | 'emergencyContact'
  | 'consent'
  | 'lists';

const CODE_KEYS: Readonly<Record<string, TranslationKey>> = {
  DATE_FORMAT: 'health.error.date',
  DATE_INVALID: 'health.error.date',
  DATE_IN_FUTURE: 'health.error.future',
  AGE_UNDER_MINIMUM: 'health.error.minor',
  AGE_UNREALISTIC: 'health.error.date',
  HEIGHT_RANGE: 'health.error.height',
  WEIGHT_RANGE: 'health.error.weight',
  CONSENT_REQUIRED: 'health.error.consent',
  DISTRICT_REQUIRED: 'health.error.district',
  NAME_TOO_SHORT: 'health.error.contactName',
};

const FIELD_FALLBACK: Readonly<Record<HealthField, TranslationKey>> = {
  dateOfBirth: 'health.error.date',
  sex: 'health.error.sex',
  heightCm: 'health.error.height',
  weightKg: 'health.error.weight',
  region: 'health.error.region',
  district: 'health.error.district',
  bpHistory: 'health.error.bp',
  emergencyContact: 'health.error.contact',
  consent: 'health.error.consent',
  lists: 'health.error.list',
};

export function fieldOf(apiField: string): HealthField {
  if (apiField === 'allergies' || apiField === 'chronicConditions' || apiField === 'currentMedications') return 'lists';
  return (apiField in FIELD_FALLBACK ? apiField : 'lists') as HealthField;
}

/** Schema issue (field + code) → the translation key to show. */
export function errorKey(field: HealthField, code: string): TranslationKey {
  return CODE_KEYS[code] ?? FIELD_FALLBACK[field];
}
