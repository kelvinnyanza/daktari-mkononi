import { create } from 'zustand';
import { en, sw, type TranslationKey } from './translations';

export type Locale = 'sw' | 'en';

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/** Swahili is the default; switching updates every subscribed screen live. */
export const useI18nStore = create<I18nState>((set) => ({
  locale: 'sw',
  setLocale: (locale) => set({ locale }),
}));

const TABLES: Record<Locale, Record<TranslationKey, string>> = { sw, en };

/** Translate outside React (API layer, stores). */
export function translate(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: Locale = useI18nStore.getState().locale,
): string {
  // sw is the canonical table; en is typed to carry every key. Fallback chain
  // guards against future drift without crashing the UI.
  const text = TABLES[locale][key] ?? TABLES.sw[key] ?? key;
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
export function pickBilingual(message: { sw: string; en: string } | undefined): string | undefined {
  if (!message) return undefined;
  return useI18nStore.getState().locale === 'en' ? message.en : message.sw;
}

export type { TranslationKey };
