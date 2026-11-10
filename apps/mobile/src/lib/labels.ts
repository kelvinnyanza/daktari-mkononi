/**
 * Display labels for server enum codes (presentation only — the codes sent
 * to the API are unchanged).
 */
import { doctorSpecialtySchema, regionFromAny } from '@daktari/schemas';
import type { useT } from '../i18n';

type T = ReturnType<typeof useT>;

/** "PEDIATRICS" → "Magonjwa ya watoto" / "Paediatrics"; unknown codes fall back to spaced words. */
export function specialtyLabel(t: T, code: string): string {
  const parsed = doctorSpecialtySchema.safeParse(code);
  return parsed.success ? t(`specialty.${parsed.data}`) : titleCase(code);
}

/**
 * "DAR_ES_SALAAM" → "Dar es Salaam", "KASKAZINI_PEMBA" → "Kaskazini Pemba"
 * (proper nouns, not translated). Also accepts legacy stored names
 * ("Mwanza") via regionFromAny; anything else is title-cased as is.
 */
export function regionLabel(value: string): string {
  return titleCase(regionFromAny(value) ?? value).replace(/\bEs\b/g, 'es');
}

function titleCase(code: string): string {
  return code
    .toLowerCase()
    .split(/[_\s]+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** "O_POS" → "O+", "AB_NEG" → "AB−" (universal notation, not translated). */
export function bloodTypeLabel(value: string): string {
  const [group, sign] = value.split('_');
  return `${group ?? value}${sign === 'POS' ? '+' : sign === 'NEG' ? '−' : ''}`;
}
