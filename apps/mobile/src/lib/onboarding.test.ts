import { en, sw, type TranslationKey } from '../i18n/translations';
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding';

const mockStore = new Map<string, string>();
let mockFailing = false;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) =>
    mockFailing ? Promise.reject(new Error('keystore unavailable')) : Promise.resolve(mockStore.get(key) ?? null),
  ),
  setItemAsync: jest.fn((key: string, value: string) => {
    if (mockFailing) return Promise.reject(new Error('keystore unavailable'));
    mockStore.set(key, value);
    return Promise.resolve();
  }),
}));

beforeEach(() => {
  mockStore.clear();
  mockFailing = false;
});

describe('first-launch onboarding flag', () => {
  it('is unseen on a fresh install and seen once marked', async () => {
    expect(await hasSeenOnboarding()).toBe(false);
    await markOnboardingSeen();
    expect(await hasSeenOnboarding()).toBe(true);
  });

  it('a storage failure counts as seen (never trap the user in the intro) and marking never throws', async () => {
    mockFailing = true;
    expect(await hasSeenOnboarding()).toBe(true);
    await expect(markOnboardingSeen()).resolves.toBeUndefined();
  });
});

describe('onboarding copy', () => {
  it('every page has a title, body and image description in Swahili and English', () => {
    for (const page of ['1', '2', '3', '4']) {
      for (const part of ['title', 'body', 'alt']) {
        const key = `onboarding.${page}.${part}` as TranslationKey;
        expect(sw[key].trim().length).toBeGreaterThan(0);
        expect(en[key].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('makes no diagnosis promise: the symptom page says it is not a diagnosis', () => {
    expect(sw['onboarding.2.body']).toContain('si utambuzi');
    expect(en['onboarding.2.body']).toContain('not a diagnosis');
  });
});
