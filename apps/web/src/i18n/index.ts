import { create } from 'zustand';
import { en, sw, type TranslationKey } from './translations';

export type Locale = 'en' | 'sw';

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/** English is the portal default (staff console); switching is live. */
export const useI18nStore = create<I18nState>((set) => ({
  locale: 'en',
  setLocale: (locale) => {
    set({ locale });
  },
}));

const TABLES: Record<Locale, Record<TranslationKey, string>> = { en, sw };

/** Translate outside React (API layer, stores). */
export function translate(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: Locale = useI18nStore.getState().locale,
): string {
  // en is canonical; sw is typed to carry every key. The fallback guards
  // against runtime drift without crashing a screen.
  const text = TABLES[locale][key] ?? TABLES.en[key] ?? key;
  if (!params) return text;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    text,
  );
}

/** Hook form: re-renders on locale change. */
export function useT(): (key: TranslationKey, params?: Record<string, string | number>) => string {
  const locale = useI18nStore((state) => state.locale);
  return (key, params) => translate(key, params, locale);
}

/** Bilingual server envelope → the string for the active locale. */
export function pickBilingual(
  message: { sw: string; en: string } | undefined,
  locale: Locale = useI18nStore.getState().locale,
): string | undefined {
  if (!message) return undefined;
  return locale === 'sw' ? message.sw : message.en;
}

export type { TranslationKey };
