import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  makeHealthProfileInputSchema,
  patientRegistrationSchema,
} from '../src/index.js';

// 2026-11-10 10:00 EAT
const NOW = new Date('2026-11-10T07:00:00.000Z');
const schema = makeHealthProfileInputSchema(() => NOW);

const valid = {
  dateOfBirth: '1990-04-12',
  sex: 'FEMALE',
  heightCm: 165,
  weightKg: 62.5,
  region: 'MWANZA',
  district: 'Ilemela',
  bpHistory: 'NONE',
  consent: true,
};

function firstIssue(input: Record<string, unknown>): { path: string; message: string } {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected failure');
  const issue = result.error.issues[0]!;
  return { path: issue.path.join('.'), message: issue.message };
}

describe('ageInYears', () => {
  it('counts completed years on the EAT calendar', () => {
    expect(ageInYears(new Date('1990-11-10T00:00:00Z'), NOW)).toBe(36);
    expect(ageInYears(new Date('1990-11-11T00:00:00Z'), NOW)).toBe(35);
  });

  it('uses the EAT date, not the UTC date, near midnight', () => {
    // 2026-11-09 22:30 UTC is already 2026-11-10 01:30 EAT → birthday reached.
    const lateUtc = new Date('2026-11-09T22:30:00.000Z');
    expect(ageInYears(new Date('2008-11-10T00:00:00Z'), lateUtc)).toBe(18);
  });
});

describe('health profile input', () => {
  it('accepts a complete adult profile and defaults the lists', () => {
    const parsed = schema.parse(valid);
    expect(parsed.allergies).toEqual([]);
    expect(parsed.dateOfBirth.toISOString()).toBe('1990-04-12T00:00:00.000Z');
  });

  it('accepts UNDISCLOSED sex ("Sipendi kusema") and UNKNOWN blood group ("Sijui")', () => {
    expect(schema.safeParse({ ...valid, sex: 'UNDISCLOSED', bloodGroup: 'UNKNOWN' }).success).toBe(true);
  });

  it('requires explicit consent', () => {
    expect(firstIssue({ ...valid, consent: false })).toEqual({ path: 'consent', message: 'CONSENT_REQUIRED' });
    expect(firstIssue({ ...valid, consent: undefined }).message).toBe('CONSENT_REQUIRED');
  });

  it('rejects minors (under 18 on the EAT calendar)', () => {
    expect(firstIssue({ ...valid, dateOfBirth: '2008-11-11' }).message).toBe('AGE_UNDER_MINIMUM');
    expect(schema.safeParse({ ...valid, dateOfBirth: '2008-11-10' }).success).toBe(true);
  });

  it('rejects future, impossible and unrealistic dates', () => {
    expect(firstIssue({ ...valid, dateOfBirth: '2027-01-01' }).message).toBe('DATE_IN_FUTURE');
    expect(firstIssue({ ...valid, dateOfBirth: '1990-02-31' }).message).toBe('DATE_INVALID');
    expect(firstIssue({ ...valid, dateOfBirth: '12/04/1990' }).message).toBe('DATE_FORMAT');
    expect(firstIssue({ ...valid, dateOfBirth: '1890-01-01' }).message).toBe('AGE_UNREALISTIC');
  });

  it('enforces adult height and weight ranges', () => {
    expect(firstIssue({ ...valid, heightCm: 17 }).message).toBe('HEIGHT_RANGE');
    expect(firstIssue({ ...valid, heightCm: 251 }).message).toBe('HEIGHT_RANGE');
    expect(firstIssue({ ...valid, weightKg: 6 }).message).toBe('WEIGHT_RANGE');
    expect(firstIssue({ ...valid, weightKg: 301 }).message).toBe('WEIGHT_RANGE');
  });

  it('normalizes the emergency contact phone and rejects unknown fields', () => {
    const parsed = schema.parse({ ...valid, emergencyContact: { name: 'Asha', phone: '0713 111 222' } });
    expect(parsed.emergencyContact?.phone).toBe('+255713111222');
    expect(schema.safeParse({ ...valid, patientNumber: 'X' }).success).toBe(false);
  });
});

describe('registration (UI Phase 2)', () => {
  const base = { phone: '0712345678', password: 'Daktari123', fullName: 'Neema Mushi', language: 'sw' };

  it('no longer requires date of birth or sex', () => {
    expect(patientRegistrationSchema.safeParse(base).success).toBe(true);
  });

  it('still validates a date of birth when an older app sends one', () => {
    expect(patientRegistrationSchema.safeParse({ ...base, dateOfBirth: '1990-01-01', gender: 'MALE' }).success).toBe(true);
    expect(patientRegistrationSchema.safeParse({ ...base, dateOfBirth: '2099-01-01' }).success).toBe(false);
  });
});
