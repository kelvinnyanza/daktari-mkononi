import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptHealthData } from '@daktari/encryption';
import { healthProfileInputSchema, HEALTH_CONSENT_VERSION, updatePatientProfileSchema } from '@daktari/schemas';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { PatientService } from '../src/modules/patients/patient.service.js';
import { ApiError } from '../src/lib/errors.js';
import { toPromptContext } from '../src/modules/ai/prompts.js';

let deps: FakeDeps;
let service: PatientService;

beforeAll(() => {
  applyTestEnv();
});

beforeEach(() => {
  deps = makeFakeDeps();
  service = new PatientService(deps);
});

describe('own profile', () => {
  it('reports profile completion with the missing fields', async () => {
    const { user } = deps.seedPatient();
    const profile = await service.getOwnProfile(user.id);
    expect(profile.profileCompletion.complete).toBe(false);
    expect(profile.profileCompletion.missingFields).toContain('ward');
    expect(profile.profileCompletion.missingFields).toContain('region'); // seeded as UNKNOWN
  });

  it('updates the editable fields and completes the profile', async () => {
    const { user } = deps.seedPatient();
    const updated = await service.updateOwnProfile(user.id, {
      region: 'DAR_ES_SALAAM',
      district: 'Kinondoni',
      ward: 'Msasani',
      street: 'Mikoroshini',
      emergencyContact: { name: 'Asha Mwinyi', phone: '+255713111222', relationship: 'dada' },
      language: 'en',
    });
    expect(updated.profileCompletion.complete).toBe(true);
    expect(updated.region).toBe('DAR_ES_SALAAM');
    expect(updated.emergencyContact?.phone).toBe('+255713111222');
    // Language lives on User and is updated there.
    expect(deps.state.users.get(user.id)!.language).toBe('EN');
  });

  it('setting a new NHIF number resets its verification state', async () => {
    const { user, patient } = deps.seedPatient({}, { nhifCardNumber: '11112222', nhifVerifiedAt: new Date() });
    const updated = await service.updateOwnProfile(user.id, { nhifCardNumber: '99998888' });
    expect(updated.nhifVerified).toBe(false);
    expect(deps.state.patients.get(patient.id)!.nhifVerifiedAt).toBeNull();
  });

  it('the update schema rejects platform-owned fields outright (strict)', () => {
    expect(() => updatePatientProfileSchema.parse({ patientNumber: 'PN-HACK' })).toThrow();
    expect(() => updatePatientProfileSchema.parse({ nhifVerifiedAt: new Date().toISOString() })).toThrow();
    expect(() => updatePatientProfileSchema.parse({ userId: 'someone-else' })).toThrow();
    expect(() => updatePatientProfileSchema.parse({ id: 'someone-else' })).toThrow();
  });

  it('404 for accounts without a patient profile (e.g. doctors)', async () => {
    const { user } = deps.seedDoctor();
    const error = await service.getOwnProfile(user.id).then(
      () => {
        throw new Error('expected PATIENT_NOT_FOUND');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('PATIENT_NOT_FOUND');
  });
});

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const caught = await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ApiError);
  return caught as ApiError;
}

const RAW_HEALTH = {
  dateOfBirth: '1990-04-12',
  sex: 'FEMALE',
  heightCm: 165,
  weightKg: 62.5,
  region: 'MWANZA',
  district: 'Ilemela',
  bpHistory: 'YES_ON_MEDICATION',
  bloodGroup: 'O_POS',
  allergies: ['penicillin'],
  chronicConditions: ['pumu'],
  currentMedications: ['amlodipine'],
  emergencyContact: { name: 'Asha Mwinyi', phone: '0713111222' },
  consent: true,
};
const HEALTH_INPUT = healthProfileInputSchema.parse(RAW_HEALTH);

describe('health profile (UI Phase 2)', () => {
  it('a new registration has no health profile yet', async () => {
    const { user } = deps.seedPatient({}, { dateOfBirth: null, gender: null });
    const view = await service.getOwnHealthProfile(user.id);
    expect(view).toMatchObject({ completed: false, age: null, sex: null, region: null, consentGivenAt: null });
    expect((await service.getOwnProfile(user.id)).healthProfileCompleted).toBe(false);
  });

  it('saves the clinical fields ENCRYPTED, never as plaintext columns', async () => {
    const { user, patient } = deps.seedPatient({}, { dateOfBirth: null, gender: null });
    const view = await service.saveOwnHealthProfile(user.id, HEALTH_INPUT);
    expect(view).toMatchObject({
      completed: true,
      sex: 'FEMALE',
      heightCm: 165,
      weightKg: 62.5,
      bpHistory: 'YES_ON_MEDICATION',
      bloodGroup: 'O_POS',
      region: 'MWANZA',
      emergencyContact: { name: 'Asha Mwinyi', phone: '+255713111222' },
    });
    expect(view.age).toBeGreaterThanOrEqual(36);

    const row = deps.state.patients.get(patient.id)!;
    expect(row.encryptedHealthProfile).not.toBeNull();
    // Nothing clinical in plaintext anywhere else on the row.
    const plain = JSON.stringify({ ...row, encryptedHealthProfile: null });
    for (const secret of ['penicillin', 'pumu', 'amlodipine', 'YES_ON_MEDICATION', 'O_POS']) {
      expect(plain).not.toContain(secret);
    }
    expect(row.heightCm).toBeNull();
    expect(row.bloodType).toBeNull();
    // The blob is the encryption v1 payload and decrypts to the profile.
    expect(JSON.parse(row.encryptedHealthProfile!)).toMatchObject({ v: 1 });
    expect(JSON.parse(decryptHealthData(row.encryptedHealthProfile!))).toMatchObject({
      allergies: ['penicillin'],
      bpHistory: 'YES_ON_MEDICATION',
    });
  });

  it('stamps and audits consent once per wording version', async () => {
    const { user, patient } = deps.seedPatient();
    await service.saveOwnHealthProfile(user.id, HEALTH_INPUT);
    await service.saveOwnHealthProfile(user.id, HEALTH_INPUT);
    const row = deps.state.patients.get(patient.id)!;
    expect(row.healthConsentAt).not.toBeNull();
    expect(row.healthConsentVersion).toBe(HEALTH_CONSENT_VERSION);
    const consents = deps.state.auditEntries.filter((entry) => entry.action === 'HEALTH_DATA_CONSENT_GIVEN');
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ actorUserId: user.id, resourceId: patient.id });
  });

  it('the API schema refuses a save without consent or for a minor', () => {
    expect(healthProfileInputSchema.safeParse({ ...RAW_HEALTH, consent: false }).success).toBe(false);
    const minorDob = new Date();
    minorDob.setUTCFullYear(minorDob.getUTCFullYear() - 17);
    const result = healthProfileInputSchema.safeParse({
      ...RAW_HEALTH,
      dateOfBirth: minorDob.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('AGE_UNDER_MINIMUM');
  });

  it('PUT semantics: omitted optional fields are cleared', async () => {
    const { user } = deps.seedPatient();
    await service.saveOwnHealthProfile(user.id, HEALTH_INPUT);
    const { bloodGroup: _blood, emergencyContact: _contact, ...rest } = RAW_HEALTH;
    const view = await service.saveOwnHealthProfile(
      user.id,
      healthProfileInputSchema.parse({ ...rest, allergies: [] }),
    );
    expect(view.bloodGroup).toBeNull();
    expect(view.emergencyContact).toBeNull();
    expect(view.allergies).toEqual([]);
  });

  it('reads legacy plaintext rows until they are backfilled', async () => {
    const { user } = deps.seedPatient({}, { heightCm: 170, bloodType: 'A_NEG', allergies: ['sulfa'] });
    const view = await service.getOwnHealthProfile(user.id);
    expect(view).toMatchObject({ heightCm: 170, bloodGroup: 'A_NEG', allergies: ['sulfa'], bpHistory: null });
  });

  it('PATCH health fields need consent, then land in the blob', async () => {
    const { user, patient } = deps.seedPatient();
    const error = await rejection(service.updateOwnProfile(user.id, { heightCm: 170 }));
    expect(error.code).toBe('HEALTH_CONSENT_REQUIRED');

    await service.saveOwnHealthProfile(user.id, HEALTH_INPUT);
    const updated = await service.updateOwnProfile(user.id, { weightKg: 70 });
    expect(updated.weightKg).toBe(70);
    expect(updated.allergies).toEqual(['penicillin']);
    expect(deps.state.patients.get(patient.id)!.weightKg).toBeNull();
  });

  it('the AI provider only ever gets age band and sex', async () => {
    const { user, patient } = deps.seedPatient();
    await service.saveOwnHealthProfile(user.id, HEALTH_INPUT);
    const row = deps.state.patients.get(patient.id)!;
    const context = toPromptContext(row, new Date('2026-11-10T07:00:00Z'));
    expect(context).toEqual({ ageBand: '30-44', sex: 'FEMALE' });
    expect(toPromptContext({ dateOfBirth: null, gender: 'UNDISCLOSED' }, new Date())).toEqual({
      ageBand: null,
      sex: null,
    });
  });
});

describe('admin reads', () => {
  it('adminGetPatient returns profile + user identity; 404 for unknown ids', async () => {
    const { patient } = deps.seedPatient({}, { region: 'MWANZA', district: 'Ilemela' });
    const result = await service.adminGetPatient(patient.id);
    expect(result.profile.region).toBe('MWANZA');
    // Clinical fields never reach the admin view.
    expect(result.profile).not.toHaveProperty('allergies');
    expect(result.profile).not.toHaveProperty('heightCm');
    expect(result.profile).not.toHaveProperty('bloodType');
    expect(result.user.phone).toBeTruthy();

    const error = await service.adminGetPatient('c0000000000000000000nope').then(
      () => {
        throw new Error('expected 404');
      },
      (caught: unknown) => caught,
    );
    expect((error as ApiError).code).toBe('PATIENT_NOT_FOUND');
  });

  it('adminListPatients paginates and filters by region/district', async () => {
    deps.seedPatient({ phone: '+255754000001' }, { region: 'MWANZA', district: 'Ilemela' });
    deps.seedPatient({ phone: '+255754000002' }, { region: 'MWANZA', district: 'Nyamagana' });
    deps.seedPatient({ phone: '+255754000003' }, { region: 'ARUSHA', district: 'Arusha Mjini' });

    const mwanza = await service.adminListPatients({ page: 1, pageSize: 10, region: 'MWANZA' });
    expect(mwanza.total).toBe(2);

    const ilemela = await service.adminListPatients({
      page: 1,
      pageSize: 10,
      region: 'MWANZA',
      district: 'Ilemela',
    });
    expect(ilemela.total).toBe(1);

    const paged = await service.adminListPatients({ page: 2, pageSize: 2 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);
  });
});
