import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updatePatientProfileSchema } from '@daktari/schemas';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { PatientService } from '../src/modules/patients/patient.service.js';
import { ApiError } from '../src/lib/errors.js';

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
      heightCm: 168,
      weightKg: 62,
      allergies: ['penicillin'],
      chronicConditions: ['ASTHMA'],
      currentMedications: ['salbutamol inhaler'],
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

describe('admin reads', () => {
  it('adminGetPatient returns profile + user identity; 404 for unknown ids', async () => {
    const { patient } = deps.seedPatient({}, { region: 'MWANZA', district: 'Ilemela' });
    const result = await service.adminGetPatient(patient.id);
    expect(result.profile.region).toBe('MWANZA');
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
