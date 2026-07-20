import { pickBilingual, translate, useI18nStore } from './index';
import { en, sw } from './translations';

describe('i18n', () => {
  afterEach(() => {
    useI18nStore.setState({ locale: 'sw' });
  });

  it('defaults to Swahili and switches live to English', () => {
    expect(translate('auth.login.title')).toBe('Ingia');
    useI18nStore.getState().setLocale('en');
    expect(translate('auth.login.title')).toBe('Sign in');
  });

  it('the English table covers every Swahili key (typed + runtime)', () => {
    const swKeys = Object.keys(sw).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(swKeys);
  });

  it('interpolates parameters', () => {
    expect(translate('auth.otp.resendWait', { seconds: 42 })).toContain('42');
  });

  it('rate-limit and emergency strings carry the 112/115 guidance in both languages', () => {
    expect(sw['error.RATE_LIMITED']).toContain('112');
    expect(sw['error.RATE_LIMITED']).toContain('115');
    expect(en['error.RATE_LIMITED']).toContain('call 112 or 115');
    expect(sw['emergency.banner']).toContain('112');
    expect(en['emergency.banner']).toContain('115');
    // Never any other emergency number (999/911/114).
    for (const table of [sw, en]) {
      for (const value of Object.values(table)) {
        expect(value).not.toMatch(/\b(999|911|114)\b/);
      }
    }
  });

  it('pickBilingual follows the active locale', () => {
    const message = { sw: 'Ndio', en: 'Yes' };
    expect(pickBilingual(message)).toBe('Ndio');
    useI18nStore.getState().setLocale('en');
    expect(pickBilingual(message)).toBe('Yes');
    expect(pickBilingual(undefined)).toBeUndefined();
  });
});
