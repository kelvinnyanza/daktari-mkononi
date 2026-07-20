/**
 * Seed realistic Tanzanian test data. Idempotent: safe to run repeatedly.
 * Run with: pnpm --filter @daktari/db db:seed
 */
import { randomUUID } from 'node:crypto';
import { hashPassword } from '@daktari/encryption';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'Daktari123!';

// argon2id is intentionally slow; hash once and reuse for every seeded user.
const seedPasswordHash: Promise<string> = hashPassword(SEED_PASSWORD);

async function seedHospitals() {
  const muhimbili = await prisma.hospital.upsert({
    where: { id: 'seed-hosp-muhimbili' },
    update: {},
    create: {
      id: 'seed-hosp-muhimbili',
      name: 'Muhimbili National Hospital',
      region: 'Dar es Salaam',
      district: 'Ilala',
      address: 'Barabara ya Malik, Upanga, Dar es Salaam',
      phone: '+255222151591',
      email: 'info@mnh.or.tz',
      departments: {
        createMany: {
          data: [
            { name: 'Internal Medicine', nameSw: 'Magonjwa ya Ndani' },
            { name: 'Pediatrics', nameSw: 'Watoto' },
            { name: 'Obstetrics & Gynecology', nameSw: 'Uzazi na Magonjwa ya Wanawake' },
          ],
          skipDuplicates: true,
        },
      },
    },
  });

  const bugando = await prisma.hospital.upsert({
    where: { id: 'seed-hosp-bugando' },
    update: {},
    create: {
      id: 'seed-hosp-bugando',
      name: 'Bugando Medical Centre',
      region: 'Mwanza',
      district: 'Nyamagana',
      address: 'Wurzburg Road, Mwanza',
      phone: '+255282500513',
      email: 'info@bugandomedicalcentre.co.tz',
      departments: {
        createMany: {
          data: [
            { name: 'General Practice', nameSw: 'Tiba ya Jumla' },
            { name: 'Cardiology', nameSw: 'Magonjwa ya Moyo' },
          ],
          skipDuplicates: true,
        },
      },
    },
  });

  return { muhimbili, bugando };
}

interface DoctorSeed {
  phone: string;
  fullName: string;
  tmcRegistrationNumber: string;
  specialty: string;
  yearsOfExperience: number;
  consultationFeeTzs: number;
  bio: string;
  hospitalId: string | null;
}

async function seedDoctors(hospitalIds: { muhimbili: string; bugando: string }) {
  const doctors: DoctorSeed[] = [
    {
      phone: '+255712000001',
      fullName: 'Dkt. Amani Mwakasege',
      tmcRegistrationNumber: 'TMC/REG/10234',
      specialty: 'GENERAL_PRACTICE',
      yearsOfExperience: 8,
      consultationFeeTzs: 15_000,
      bio: 'Daktari wa tiba ya jumla mwenye uzoefu wa miaka 8, Dar es Salaam.',
      hospitalId: hospitalIds.muhimbili,
    },
    {
      phone: '+255712000002',
      fullName: 'Dkt. Neema Shirima',
      tmcRegistrationNumber: 'TMC/REG/10567',
      specialty: 'PEDIATRICS',
      yearsOfExperience: 12,
      consultationFeeTzs: 25_000,
      bio: 'Daktari bingwa wa watoto, Muhimbili.',
      hospitalId: hospitalIds.muhimbili,
    },
    {
      phone: '+255712000003',
      fullName: 'Dkt. Baraka Kileo',
      tmcRegistrationNumber: 'TMC/REG/11890',
      specialty: 'CARDIOLOGY',
      yearsOfExperience: 15,
      consultationFeeTzs: 60_000,
      bio: 'Daktari bingwa wa magonjwa ya moyo, Bugando Medical Centre, Mwanza.',
      hospitalId: hospitalIds.bugando,
    },
    {
      phone: '+255712000004',
      fullName: 'Dkt. Zainabu Mnyika',
      tmcRegistrationNumber: 'TMC/REG/12045',
      specialty: 'OBSTETRICS_GYNECOLOGY',
      yearsOfExperience: 10,
      consultationFeeTzs: 35_000,
      bio: 'Daktari bingwa wa uzazi na magonjwa ya wanawake, Arusha.',
      hospitalId: null,
    },
  ];

  for (const seed of doctors) {
    await prisma.user.upsert({
      where: { phone: seed.phone },
      update: {},
      create: {
        phone: seed.phone,
        passwordHash: await seedPasswordHash,
        fullName: seed.fullName,
        role: 'DOCTOR',
        language: 'SW',
        phoneVerifiedAt: new Date(),
        doctor: {
          create: {
            tmcRegistrationNumber: seed.tmcRegistrationNumber,
            specialty: seed.specialty,
            yearsOfExperience: seed.yearsOfExperience,
            consultationFeeTzs: seed.consultationFeeTzs,
            bio: seed.bio,
            languages: ['sw', 'en'],
            verificationStatus: 'APPROVED',
            verifiedAt: new Date(),
            isAvailable: true,
            hospitalId: seed.hospitalId,
            schedules: {
              create: [
                { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
                { dayOfWeek: 3, startTime: '14:00', endTime: '18:00' },
                { dayOfWeek: 6, startTime: '09:00', endTime: '12:00' },
              ],
            },
          },
        },
      },
    });
  }
}

interface PatientSeed {
  phone: string;
  fullName: string;
  gender: 'MALE' | 'FEMALE';
  dateOfBirth: string;
  region: string;
  district: string;
  nhifCardNumber: string | null;
}

async function seedPatients() {
  const patients: PatientSeed[] = [
    {
      phone: '+255754000001',
      fullName: 'Juma Rashidi Mwinyi',
      gender: 'MALE',
      dateOfBirth: '1985-03-12',
      region: 'Dar es Salaam',
      district: 'Kinondoni',
      nhifCardNumber: '110023456789',
    },
    {
      phone: '+255754000002',
      fullName: 'Fatuma Hassani Kombo',
      gender: 'FEMALE',
      dateOfBirth: '1992-11-05',
      region: 'Mwanza',
      district: 'Ilemela',
      nhifCardNumber: null,
    },
    {
      phone: '+255754000003',
      fullName: 'Elia Msigwa Sanga',
      gender: 'MALE',
      dateOfBirth: '1978-07-22',
      region: 'Arusha',
      district: 'Arusha Mjini',
      nhifCardNumber: '110087654321',
    },
    {
      phone: '+255754000004',
      fullName: 'Rehema Petro Mollel',
      gender: 'FEMALE',
      dateOfBirth: '2001-01-30',
      region: 'Dodoma',
      district: 'Dodoma Mjini',
      nhifCardNumber: null,
    },
  ];

  for (const seed of patients) {
    await prisma.user.upsert({
      where: { phone: seed.phone },
      update: {},
      create: {
        phone: seed.phone,
        passwordHash: await seedPasswordHash,
        fullName: seed.fullName,
        role: 'PATIENT',
        language: 'SW',
        phoneVerifiedAt: new Date(),
        patient: {
          create: {
            dateOfBirth: new Date(`${seed.dateOfBirth}T00:00:00.000Z`),
            gender: seed.gender,
            region: seed.region,
            district: seed.district,
            allergies: [],
            nhifCardNumber: seed.nhifCardNumber,
          },
        },
      },
    });
  }
}

async function seedClinicalJourney() {
  const patientUser = await prisma.user.findUnique({
    where: { phone: '+255754000001' },
    include: { patient: true },
  });
  const doctorUser = await prisma.user.findUnique({
    where: { phone: '+255712000001' },
    include: { doctor: true },
  });
  if (!patientUser?.patient || !doctorUser?.doctor) {
    throw new Error('seed ordering error: patient/doctor users missing');
  }
  const patient = patientUser.patient;
  const doctor = doctorUser.doctor;

  const existing = await prisma.appointment.findFirst({
    where: { patientId: patient.id, doctorId: doctor.id },
  });
  if (existing) return; // journey already seeded

  const screening = await prisma.aIScreeningResult.create({
    data: {
      patientId: patient.id,
      sessionId: randomUUID(),
      language: 'SW',
      status: 'COMPLETED',
      symptomsSummary: 'Homa ya siku tatu, maumivu ya kichwa na viungo. Hakuna dalili za hatari.',
      triageLevel: 'TELECONSULTATION',
      recommendedSpecialty: 'GENERAL_PRACTICE',
      confidence: 0.86,
    },
  });

  const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      type: 'VIDEO',
      status: 'CONFIRMED',
      scheduledAt,
      reason: 'Homa na maumivu ya kichwa',
      paymentIntent: 'MOBILE_MONEY',
      confirmedAt: new Date(),
      screeningResultId: screening.id,
    },
  });

  await prisma.payment.create({
    data: {
      patientId: patient.id,
      appointmentId: appointment.id,
      amountTzs: doctor.consultationFeeTzs,
      method: 'MPESA',
      status: 'COMPLETED',
      idempotencyKey: `seed-payment-${appointment.id}`,
      payerPhone: patientUser.phone,
      aggregatorTransactionId: 'AGG-TZ-SEED-000001',
      paidAt: new Date(),
    },
  });

  await prisma.vitalSign.create({
    data: {
      patientId: patient.id,
      systolicBp: 122,
      diastolicBp: 78,
      heartRate: 84,
      temperatureC: 38.4,
      oxygenSaturation: 97,
      notes: 'Kipimo cha nyumbani kabla ya miadi',
    },
  });

  await prisma.chronicTracking.create({
    data: {
      patientId: patient.id,
      condition: 'HYPERTENSION',
      diagnosedAt: new Date('2023-06-15T00:00:00.000Z'),
      notes: 'Anatumia dawa za presha; ufuatiliaji kila baada ya miezi mitatu.',
      nextCheckupDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.patientInsurance.upsert({
    where: {
      patientId_provider_memberNumber: {
        patientId: patient.id,
        provider: 'NHIF',
        memberNumber: '110023456789',
      },
    },
    update: {},
    create: {
      patientId: patient.id,
      provider: 'NHIF',
      memberNumber: '110023456789',
      isPrimary: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'SEED_DATA_CREATED',
      resourceType: 'Seed',
      metadata: { note: 'Phase 1 seed journey for patient Juma Rashidi Mwinyi' },
    },
  });
}

async function main() {
  const platformAdmin = await prisma.user.upsert({
    where: { phone: '+255713000000' },
    update: {},
    create: {
      phone: '+255713000000',
      email: 'admin@daktarimkononi.co.tz',
      passwordHash: await seedPasswordHash,
      fullName: 'Asha Mkapa',
      role: 'PLATFORM_ADMIN',
      language: 'SW',
      phoneVerifiedAt: new Date(),
    },
  });

  const { muhimbili, bugando } = await seedHospitals();
  await seedDoctors({ muhimbili: muhimbili.id, bugando: bugando.id });
  await seedPatients();
  await seedClinicalJourney();

  console.log(`Seed complete. Platform admin: ${platformAdmin.phone} / ${SEED_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
