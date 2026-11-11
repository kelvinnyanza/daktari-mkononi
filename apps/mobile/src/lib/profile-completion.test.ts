import { dayMonthYearLabel, monthYearLabel, profileCompletion } from './profile-completion';

const base = {
  healthProfileCompleted: false,
  region: 'UNKNOWN',
  district: 'UNKNOWN',
  ward: null,
  street: null,
  emergencyContact: null,
};

describe('profile completion', () => {
  it('a new account is 0% and asks for the health profile first', () => {
    expect(profileCompletion(base)).toEqual({ percent: 0, next: 'health' });
  });

  it('counts each step; legacy region names count as set', () => {
    expect(profileCompletion({ ...base, healthProfileCompleted: true, region: 'Mwanza', district: 'Ilemela' })).toEqual({
      percent: 50,
      next: 'street',
    });
    expect(
      profileCompletion({
        healthProfileCompleted: true,
        region: 'MWANZA',
        district: 'Ilemela',
        ward: 'Kirumba',
        street: 'Mtaa wa Ziwa',
        emergencyContact: { name: 'Asha', phone: '+255713111222' },
      }),
    ).toEqual({ percent: 100, next: null });
  });
});

describe('dates for the profile header (EAT)', () => {
  it('names the month in Swahili and English', () => {
    expect(monthYearLabel('2026-11-10T07:00:00Z', 'sw')).toBe('Novemba 2026');
    expect(monthYearLabel('2026-11-10T07:00:00Z', 'en')).toBe('November 2026');
    // 22:30 UTC on 31 Oct is already 1 Nov in Dar es Salaam.
    expect(dayMonthYearLabel('2026-10-31T22:30:00Z', 'sw')).toBe('1 Novemba 2026');
  });
});
