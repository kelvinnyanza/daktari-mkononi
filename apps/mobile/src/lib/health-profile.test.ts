import { makeHealthProfileInputSchema, type HealthProfileView } from '@daktari/schemas';
import { en, sw } from '../i18n/translations';
import {
  ageFromParts,
  dobFromParts,
  EMPTY_HEALTH_FORM,
  errorKey,
  fieldOf,
  formFromView,
  parseList,
  parseNumber,
  toHealthInput,
} from './health-profile';
import { bloodTypeLabel } from './labels';

const NOW = new Date('2026-11-10T07:00:00.000Z'); // 10:00 EAT
const schema = makeHealthProfileInputSchema(() => NOW);

const FILLED = {
  ...EMPTY_HEALTH_FORM,
  day: '12',
  month: '4',
  year: '1990',
  sex: 'UNDISCLOSED' as const,
  height: '165',
  weight: '62,5',
  region: 'MWANZA' as const,
  district: 'Ilemela',
  bpHistory: 'UNKNOWN' as const,
  allergies: 'penicillin\nsulfa, Penicillin',
  consent: true,
};

describe('date of birth (typed as parts, age calculated)', () => {
  it('pads parts into an ISO date and shows the age', () => {
    expect(dobFromParts('2', '4', '1990')).toBe('1990-04-02');
    expect(dobFromParts('', '4', '1990')).toBe('');
    expect(ageFromParts('12', '4', '1990', NOW)).toBe(36);
  });

  it('shows no age for impossible or partial dates', () => {
    expect(ageFromParts('31', '2', '1990', NOW)).toBeNull();
    expect(ageFromParts('12', '4', '', NOW)).toBeNull();
  });
});

describe('parsing', () => {
  it('numbers accept a decimal comma; empty means "not given"', () => {
    expect(parseNumber('62,5')).toBe(62.5);
    expect(parseNumber(' 170 ')).toBe(170);
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('abc')).toBeNaN();
  });

  it('lists split on lines/commas, trimmed, de-duplicated', () => {
    expect(parseList('penicillin\nsulfa, Penicillin;  ,')).toEqual(['penicillin', 'sulfa']);
  });
});

describe('form → API body', () => {
  it('a filled form passes the server schema', () => {
    const parsed = schema.parse(toHealthInput(FILLED));
    expect(parsed).toMatchObject({ sex: 'UNDISCLOSED', weightKg: 62.5, allergies: ['penicillin', 'sulfa'] });
    expect(parsed.emergencyContact).toBeUndefined();
  });

  it('a minor, missing consent and bad ranges map to the right messages', () => {
    const result = schema.safeParse(
      toHealthInput({ ...FILLED, year: '2010', height: '17', consent: false }),
    );
    expect(result.success).toBe(false);
    const shown = Object.fromEntries(
      (result.success ? [] : result.error.issues).map((issue) => {
        const field = fieldOf(String(issue.path[0]));
        return [field, errorKey(field, issue.message)];
      }),
    );
    expect(shown).toMatchObject({
      dateOfBirth: 'health.error.minor',
      heightCm: 'health.error.height',
      consent: 'health.error.consent',
    });
  });

  it('an empty form reports every required field with a translated message', () => {
    const result = schema.safeParse(toHealthInput(EMPTY_HEALTH_FORM));
    const keys = (result.success ? [] : result.error.issues).map((issue) => {
      const field = fieldOf(String(issue.path[0]));
      return errorKey(field, issue.message);
    });
    for (const key of keys) {
      expect(sw[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
    expect(new Set(keys).size).toBeGreaterThanOrEqual(7);
  });

  it('round-trips a saved profile into the form', () => {
    const view: HealthProfileView = {
      dateOfBirth: '1990-04-02',
      age: 36,
      sex: 'FEMALE',
      heightCm: 165,
      weightKg: 62.5,
      region: 'MWANZA',
      district: 'Ilemela',
      bpHistory: 'NONE',
      bloodGroup: 'O_POS',
      allergies: ['penicillin'],
      chronicConditions: [],
      currentMedications: [],
      emergencyContact: { name: 'Asha', phone: '+255713111222' },
      consentGivenAt: '2026-11-10T07:00:00.000Z',
      completed: true,
    };
    const form = formFromView(view);
    expect(form).toMatchObject({ day: '2', month: '4', year: '1990', contactPhone: '713111222', consent: true });
    expect(schema.parse(toHealthInput(form)).emergencyContact).toEqual({ name: 'Asha', phone: '+255713111222' });
  });
});

describe('blood type labels', () => {
  it('uses the universal notation', () => {
    expect(bloodTypeLabel('O_POS')).toBe('O+');
    expect(bloodTypeLabel('AB_NEG')).toBe('AB−');
  });
});
