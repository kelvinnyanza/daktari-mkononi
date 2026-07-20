/** In-memory implementations of the repository ports for unit tests. */
import type { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type {
  AIScreeningResult,
  Appointment,
  Consultation,
  DoctorPayment,
  Payment,
  ConsultationMessage,
  ConsultationRating,
  CreateAppointmentInput,
  CreateOtpInput,
  CreatePatientUserInput,
  CreateDoctorUserInput,
  CreateSessionInput,
  Diagnosis,
  Doctor,
  DoctorDocument,
  DoctorSchedule,
  MedicalRecord,
  OtpCode,
  OtpPurpose,
  Patient,
  PatientInsurance,
  Session,
  User,
  UserWithProfiles,
} from '@daktari/db';
import { AlreadyRatedError, SlotTakenError, SLOT_HOLDING_STATUSES } from '@daktari/db';
import type { SmsPort } from '@daktari/notifications';
import type { StoragePort } from '@daktari/storage';
import { FakeVideo } from '@daktari/video';
import { FakeAi } from '@daktari/ai';
import { FakePayments } from '@daktari/payments';
import type { AppDeps, AuditLogEntry } from '../../src/lib/ports.js';
import { FakePaymentPort } from '../../src/lib/fake-payment.js';
import { InMemoryPubSub } from '../../src/lib/pubsub.js';

export function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: randomUUID(),
    phone: '+255712345678',
    email: null,
    passwordHash: 'unset',
    fullName: 'Juma Mwinyi',
    role: 'PATIENT',
    language: 'SW',
    isActive: true,
    phoneVerifiedAt: now,
    failedLoginCount: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

export function makePatient(userId: string, overrides: Partial<Patient> = {}): Patient {
  const now = new Date();
  return {
    id: randomUUID(),
    userId,
    patientNumber: `PN-${randomUUID().slice(0, 8)}`,
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
    gender: 'FEMALE',
    bloodType: null,
    region: 'UNKNOWN',
    district: 'UNKNOWN',
    ward: null,
    street: null,
    address: null,
    heightCm: null,
    weightKg: null,
    allergies: [],
    chronicConditions: [],
    currentMedications: [],
    nhifCardNumber: null,
    nhifVerifiedAt: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

export function makeDoctor(userId: string, overrides: Partial<Doctor> = {}): Doctor {
  const now = new Date();
  return {
    id: randomUUID(),
    userId,
    tmcRegistrationNumber: `TMC/REG/${Math.floor(Math.random() * 100000)}`,
    specialty: 'GENERAL_PRACTICE',
    subSpecialty: null,
    yearsOfExperience: 5,
    consultationFeeTzs: 20_000,
    bio: null,
    languages: ['sw'],
    verificationStatus: 'PENDING',
    verifiedAt: null,
    verifiedByUserId: null,
    claimedByUserId: null,
    rejectionReason: null,
    suspensionReason: null,
    region: 'DAR_ES_SALAAM',
    acceptsNhif: false,
    hospitalId: null,
    isAvailable: true,
    averageRating: 0,
    totalRatings: 0,
    totalConsultations: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export class FakeSms implements SmsPort {
  readonly sent: Array<{ to: string; body: string }> = [];

  sendSms(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
    return Promise.resolve();
  }

  /** Extract the 6-digit OTP from the most recent message. */
  lastCode(): string {
    const last = this.sent.at(-1);
    const match = last?.body.match(/\d{6}/);
    if (!match) throw new Error('no OTP found in last SMS');
    return match[0];
  }
}

/** In-memory StoragePort — records blobs so tests can assert what was stored. */
export class FakeStorage implements StoragePort {
  readonly blobs = new Map<string, { data: Buffer; contentType: string }>();

  put(key: string, data: Buffer, contentType: string): Promise<void> {
    this.blobs.set(key, { data, contentType });
    return Promise.resolve();
  }

  getSignedUrl(key: string, _ttlSeconds: number): Promise<string> {
    return Promise.resolve(`/api/v1/files/fake-token-for-${encodeURIComponent(key)}`);
  }

  delete(key: string): Promise<void> {
    this.blobs.delete(key);
    return Promise.resolve();
  }

  read(key: string): Promise<Buffer> {
    const blob = this.blobs.get(key);
    if (!blob) return Promise.reject(new Error(`fake storage: no blob ${key}`));
    return Promise.resolve(blob.data);
  }
}

export interface FakeDeps extends AppDeps {
  sms: FakeSms;
  storage: FakeStorage;
  payments: FakePaymentPort;
  video: FakeVideo;
  pubsub: InMemoryPubSub;
  ai: FakeAi;
  mobileMoney: FakePayments;
  state: {
    users: Map<string, User>;
    patients: Map<string, Patient>;
    doctors: Map<string, Doctor>;
    doctorDocuments: Map<string, DoctorDocument>;
    schedules: Map<string, DoctorSchedule>;
    appointments: Map<string, Appointment>;
    consultations: Map<string, Consultation>;
    diagnoses: Map<string, Diagnosis>;
    consultationMessages: Map<string, ConsultationMessage>;
    medicalRecords: Map<string, MedicalRecord>;
    consultationRatings: Map<string, ConsultationRating>;
    screenings: Map<string, AIScreeningResult>;
    paymentRows: Map<string, Payment>;
    doctorPaymentRows: Map<string, DoctorPayment>;
    insurances: Map<string, PatientInsurance>;
    sessions: Map<string, Session>;
    otps: Map<string, OtpCode>;
    auditEntries: AuditLogEntry[];
  };
  seedUser(overrides?: Partial<User>): User;
  seedPatient(userOverrides?: Partial<User>, patientOverrides?: Partial<Patient>): { user: User; patient: Patient };
  seedDoctor(userOverrides?: Partial<User>, doctorOverrides?: Partial<Doctor>): { user: User; doctor: Doctor };
  seedInsurance(patientId: string, overrides?: Partial<PatientInsurance>): PatientInsurance;
  seedSchedule(doctorId: string, overrides?: Partial<DoctorSchedule>): DoctorSchedule;
}

export function makeFakeDeps(): FakeDeps {
  const users = new Map<string, User>();
  const patients = new Map<string, Patient>();
  const doctors = new Map<string, Doctor>();
  const doctorDocuments = new Map<string, DoctorDocument>();
  const schedules = new Map<string, DoctorSchedule>();
  const appointments = new Map<string, Appointment>();
  const consultations = new Map<string, Consultation>();
  const diagnoses = new Map<string, Diagnosis>();
  const consultationMessages = new Map<string, ConsultationMessage>();
  const medicalRecords = new Map<string, MedicalRecord>();
  const consultationRatings = new Map<string, ConsultationRating>();
  const screenings = new Map<string, AIScreeningResult>();
  const paymentRows = new Map<string, Payment>();
  const doctorPaymentRows = new Map<string, DoctorPayment>();
  const insurances = new Map<string, PatientInsurance>();
  const sessions = new Map<string, Session>();
  const otps = new Map<string, OtpCode>();
  const auditEntries: AuditLogEntry[] = [];
  const sms = new FakeSms();
  const storage = new FakeStorage();
  const payments = new FakePaymentPort();
  const video = new FakeVideo();
  const pubsub = new InMemoryPubSub();
  const ai = new FakeAi();
  const mobileMoney = new FakePayments();

  function mustGet<T>(map: Map<string, T>, id: string): T {
    const value = map.get(id);
    if (value === undefined) throw new Error(`fake: no record ${id}`);
    return value;
  }

  function mutateUser(id: string, patch: Partial<User>): Promise<User> {
    const user = mustGet(users, id);
    const next = { ...user, ...patch, updatedAt: new Date() };
    users.set(id, next);
    return Promise.resolve(next);
  }

  function withUser<T extends { userId: string }>(row: T): T & { user: User } {
    return { ...row, user: mustGet(users, row.userId) };
  }

  const holdsSlot = (appointment: Appointment): boolean =>
    (SLOT_HOLDING_STATUSES as readonly string[]).includes(appointment.status);

  function makeAppointment(input: CreateAppointmentInput): Appointment {
    // Mirror the partial unique index: one slot-holding row per (doctorId, scheduledAt).
    const conflict = [...appointments.values()].some(
      (existing) =>
        existing.doctorId === input.doctorId &&
        existing.scheduledAt.getTime() === input.scheduledAt.getTime() &&
        holdsSlot(existing),
    );
    if (conflict) throw new SlotTakenError();
    const now = new Date();
    return {
      id: randomUUID(),
      patientId: input.patientId,
      doctorId: input.doctorId,
      type: input.type,
      status: input.status,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      reason: input.reason,
      paymentIntent: input.paymentIntent,
      pendingReason: input.pendingReason ?? null,
      expiresAt: input.expiresAt ?? null,
      checkInToken: input.checkInToken ?? null,
      confirmedAt: input.confirmedAt ?? null,
      checkedInAt: null,
      technicalFailureAt: null,
      screeningResultId: input.screeningResultId ?? null,
      cancellationReason: null,
      cancelledByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  const deps: FakeDeps = {
    sms,
    storage,
    payments,
    video,
    pubsub,
    ai,
    mobileMoney,
    localFiles: (key) => storage.read(key),
    state: {
      users,
      patients,
      doctors,
      doctorDocuments,
      schedules,
      appointments,
      consultations,
      diagnoses,
      consultationMessages,
      medicalRecords,
      consultationRatings,
      screenings,
      paymentRows,
      doctorPaymentRows,
      insurances,
      sessions,
      otps,
      auditEntries,
    },

    seedUser(overrides: Partial<User> = {}): User {
      const user = makeUser(overrides);
      users.set(user.id, user);
      return user;
    },

    seedPatient(userOverrides: Partial<User> = {}, patientOverrides: Partial<Patient> = {}) {
      const user = deps.seedUser({ role: 'PATIENT', ...userOverrides });
      const patient = makePatient(user.id, patientOverrides);
      patients.set(patient.id, patient);
      return { user, patient };
    },

    seedDoctor(userOverrides: Partial<User> = {}, doctorOverrides: Partial<Doctor> = {}) {
      const user = deps.seedUser({ role: 'DOCTOR', phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, ...userOverrides });
      const doctor = makeDoctor(user.id, doctorOverrides);
      doctors.set(doctor.id, doctor);
      return { user, doctor };
    },

    seedInsurance(patientId: string, overrides: Partial<PatientInsurance> = {}): PatientInsurance {
      const insurance: PatientInsurance = {
        id: randomUUID(),
        patientId,
        provider: 'NHIF',
        memberNumber: '123456789',
        validUntil: null,
        isPrimary: true,
        verifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
      insurances.set(insurance.id, insurance);
      return insurance;
    },

    seedSchedule(doctorId: string, overrides: Partial<DoctorSchedule> = {}): DoctorSchedule {
      const schedule: DoctorSchedule = {
        id: randomUUID(),
        doctorId,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '12:00',
        breaks: [],
        slotDurationMinutes: 30,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
      schedules.set(schedule.id, schedule);
      return schedule;
    },

    users: {
      findById: (id) => Promise.resolve(users.get(id) ?? null),
      findByPhone: (phone) =>
        Promise.resolve([...users.values()].find((user) => user.phone === phone) ?? null),
      findByIdWithProfiles: (id) => {
        const user = users.get(id);
        if (!user) return Promise.resolve(null);
        const patient = [...patients.values()].find((entry) => entry.userId === id) ?? null;
        const doctor = [...doctors.values()].find((entry) => entry.userId === id) ?? null;
        const result: UserWithProfiles = { ...user, patient, doctor };
        return Promise.resolve(result);
      },
      createPatientUser: (input: CreatePatientUserInput) => {
        const user = makeUser({
          phone: input.phone,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          language: input.language,
          phoneVerifiedAt: null,
        });
        users.set(user.id, user);
        const patient = makePatient(user.id, {
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
        });
        patients.set(patient.id, patient);
        return Promise.resolve(user);
      },
      createDoctorUser: (input: CreateDoctorUserInput) => {
        const user = makeUser({
          phone: input.phone,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          language: input.language,
          role: 'DOCTOR',
          phoneVerifiedAt: null,
        });
        users.set(user.id, user);
        const doctor = makeDoctor(user.id, {
          tmcRegistrationNumber: input.tmcRegistrationNumber,
          specialty: input.specialty,
          subSpecialty: input.subSpecialty ?? null,
          yearsOfExperience: input.yearsOfExperience,
          consultationFeeTzs: input.consultationFeeTzs,
          bio: input.bio ?? null,
          languages: input.languages,
          region: input.region ?? null,
          acceptsNhif: input.acceptsNhif ?? false,
          hospitalId: input.hospitalId ?? null,
        });
        doctors.set(doctor.id, doctor);
        return Promise.resolve(user);
      },
      markPhoneVerified: (id) => mutateUser(id, { phoneVerifiedAt: new Date() }),
      recordFailedLogin: (id, lockedUntil) => {
        const user = mustGet(users, id);
        return mutateUser(id, {
          failedLoginCount: user.failedLoginCount + 1,
          lockedUntil,
        });
      },
      resetLoginFailures: (id) => mutateUser(id, { failedLoginCount: 0, lockedUntil: null }),
      updatePassword: (id, passwordHash) => mutateUser(id, { passwordHash }),
      update: (id, data) => mutateUser(id, data as Partial<User>),
    },

    patients: {
      findById: (id) => Promise.resolve(patients.get(id) ?? null),
      findByIdWithUser: (id) => {
        const patient = patients.get(id);
        return Promise.resolve(patient ? withUser(patient) : null);
      },
      findByUserId: (userId) =>
        Promise.resolve([...patients.values()].find((entry) => entry.userId === userId) ?? null),
      update: (id, data) => {
        const patient = mustGet(patients, id);
        const next = { ...patient, ...(data as Partial<Patient>), updatedAt: new Date() };
        patients.set(id, next);
        return Promise.resolve(next);
      },
      list: (filters) => {
        const all = [...patients.values()].filter(
          (patient) =>
            patient.deletedAt === null &&
            (filters.region === undefined || patient.region === filters.region) &&
            (filters.district === undefined || patient.district === filters.district),
        );
        const start = (filters.page - 1) * filters.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + filters.pageSize).map(withUser),
          total: all.length,
        });
      },
      findVerifiedInsurance: (patientId, provider, now) =>
        Promise.resolve(
          [...insurances.values()].find(
            (insurance) =>
              insurance.patientId === patientId &&
              (provider === null || insurance.provider === provider) &&
              insurance.verifiedAt !== null &&
              (insurance.validUntil === null || insurance.validUntil >= now),
          ) ?? null,
        ),
    },

    doctors: {
      findById: (id) => Promise.resolve(doctors.get(id) ?? null),
      findByIdWithUser: (id) => {
        const doctor = doctors.get(id);
        return Promise.resolve(doctor ? withUser(doctor) : null);
      },
      findByUserId: (userId) =>
        Promise.resolve([...doctors.values()].find((entry) => entry.userId === userId) ?? null),
      findByTmcNumber: (tmcRegistrationNumber) =>
        Promise.resolve(
          [...doctors.values()].find(
            (entry) => entry.tmcRegistrationNumber === tmcRegistrationNumber,
          ) ?? null,
        ),
      update: (id, data) => {
        const doctor = mustGet(doctors, id);
        const next = { ...doctor, ...(data as Partial<Doctor>), updatedAt: new Date() };
        doctors.set(id, next);
        return Promise.resolve(next);
      },
      listDirectory: (filters) => {
        const all = [...doctors.values()]
          .filter(
            (doctor) =>
              doctor.verificationStatus === 'APPROVED' &&
              (filters.specialty === undefined || doctor.specialty === filters.specialty) &&
              (filters.region === undefined || doctor.region === filters.region) &&
              (filters.language === undefined || doctor.languages.includes(filters.language)) &&
              (filters.acceptsNhif === undefined || doctor.acceptsNhif === filters.acceptsNhif) &&
              (filters.maxFeeTzs === undefined || doctor.consultationFeeTzs <= filters.maxFeeTzs),
          )
          .sort((a, b) => b.averageRating - a.averageRating);
        const start = (filters.page - 1) * filters.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + filters.pageSize).map(withUser),
          total: all.length,
        });
      },
      adminList: (filters) => {
        const all = [...doctors.values()]
          .filter(
            (doctor) =>
              filters.status === undefined || doctor.verificationStatus === filters.status,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const start = (filters.page - 1) * filters.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + filters.pageSize).map(withUser),
          total: all.length,
        });
      },
      listVerificationQueue: (page, pageSize) => {
        const all = [...doctors.values()]
          .filter((doctor) =>
            ['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'].includes(doctor.verificationStatus),
          )
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
        const start = (page - 1) * pageSize;
        return Promise.resolve({
          items: all.slice(start, start + pageSize).map(withUser),
          total: all.length,
        });
      },
      transitionVerification: (id, from, update) => {
        const doctor = doctors.get(id);
        if (!doctor || doctor.verificationStatus !== from) return Promise.resolve(null);
        const next: Doctor = {
          ...doctor,
          verificationStatus: update.status,
          ...(update.claimedByUserId !== undefined ? { claimedByUserId: update.claimedByUserId } : {}),
          ...(update.verifiedByUserId !== undefined ? { verifiedByUserId: update.verifiedByUserId } : {}),
          ...(update.verifiedAt !== undefined ? { verifiedAt: update.verifiedAt } : {}),
          ...(update.rejectionReason !== undefined ? { rejectionReason: update.rejectionReason } : {}),
          ...(update.suspensionReason !== undefined ? { suspensionReason: update.suspensionReason } : {}),
          updatedAt: new Date(),
        };
        doctors.set(id, next);
        return Promise.resolve(next);
      },
    },

    doctorDocuments: {
      upsertForType: (input) => {
        const existing = [...doctorDocuments.values()].find(
          (doc) => doc.doctorId === input.doctorId && doc.type === input.type,
        );
        const document: DoctorDocument = {
          id: existing?.id ?? randomUUID(),
          doctorId: input.doctorId,
          type: input.type,
          fileKey: input.fileKey,
          fileName: input.fileName,
          mimeType: input.mimeType,
          reviewStatus: 'PENDING',
          reviewedByUserId: null,
          uploadedAt: new Date(),
          reviewedAt: null,
          reviewNotes: null,
        };
        doctorDocuments.set(document.id, document);
        return Promise.resolve(document);
      },
      listByDoctor: (doctorId) =>
        Promise.resolve(
          [...doctorDocuments.values()]
            .filter((doc) => doc.doctorId === doctorId)
            .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime()),
        ),
      setReview: (doctorId, type, review) => {
        const document = [...doctorDocuments.values()].find(
          (doc) => doc.doctorId === doctorId && doc.type === type,
        );
        if (!document) throw new Error(`fake: no document ${type} for doctor ${doctorId}`);
        const next: DoctorDocument = {
          ...document,
          reviewStatus: review.status,
          reviewNotes: review.notes,
          reviewedByUserId: review.reviewedByUserId,
          reviewedAt: new Date(),
        };
        doctorDocuments.set(document.id, next);
        return Promise.resolve(next);
      },
    },

    schedules: {
      listForDoctor: (doctorId) =>
        Promise.resolve(
          [...schedules.values()]
            .filter((slot) => slot.doctorId === doctorId && slot.isActive)
            .sort(
              (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
            ),
        ),
      replaceForDoctor: (doctorId, slots) => {
        for (const [id, slot] of schedules) {
          if (slot.doctorId === doctorId) schedules.delete(id);
        }
        const created = slots.map((slot) => {
          const row: DoctorSchedule = {
            id: randomUUID(),
            doctorId,
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
            breaks: slot.breaks,
            slotDurationMinutes: slot.slotDurationMinutes,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          schedules.set(row.id, row);
          return row;
        });
        return Promise.resolve(created);
      },
    },

    appointments: {
      findById: (id) => Promise.resolve(appointments.get(id) ?? null),
      findByCheckInToken: (token) =>
        Promise.resolve(
          [...appointments.values()].find((entry) => entry.checkInToken === token) ?? null,
        ),
      create: (input) => {
        const appointment = makeAppointment(input);
        appointments.set(appointment.id, appointment);
        return Promise.resolve(appointment);
      },
      listForPatient: (patientId, query) => {
        const all = [...appointments.values()]
          .filter(
            (entry) =>
              entry.patientId === patientId &&
              (query.status === undefined || entry.status === query.status),
          )
          .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
        const start = (query.page - 1) * query.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + query.pageSize),
          total: all.length,
        });
      },
      listForDoctorBetween: (doctorId, from, to, query) => {
        const all = [...appointments.values()]
          .filter(
            (entry) =>
              entry.doctorId === doctorId && entry.scheduledAt >= from && entry.scheduledAt < to,
          )
          .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
        const start = (query.page - 1) * query.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + query.pageSize),
          total: all.length,
        });
      },
      listActiveForDoctorBetween: (doctorId, from, to) =>
        Promise.resolve(
          [...appointments.values()].filter(
            (entry) =>
              entry.doctorId === doctorId &&
              entry.scheduledAt >= from &&
              entry.scheduledAt < to &&
              holdsSlot(entry),
          ),
        ),
      hasActiveWith: (doctorId, patientId) =>
        Promise.resolve(
          [...appointments.values()].some(
            (entry) =>
              entry.doctorId === doctorId &&
              entry.patientId === patientId &&
              (entry.status === 'CONFIRMED' || entry.status === 'IN_PROGRESS'),
          ),
        ),
      transition: (id, from, data) => {
        const appointment = appointments.get(id);
        if (!appointment || appointment.status !== from) return Promise.resolve(null);
        const next = {
          ...appointment,
          ...(data as Partial<Appointment>),
          updatedAt: new Date(),
        };
        appointments.set(id, next);
        return Promise.resolve(next);
      },
      listExpiredPendingPayment: (now) =>
        Promise.resolve(
          [...appointments.values()].filter(
            (entry) =>
              entry.status === 'PENDING_PAYMENT' &&
              entry.paymentIntent === 'MOBILE_MONEY' &&
              entry.expiresAt !== null &&
              entry.expiresAt <= now,
          ),
        ),
      cancelAndRebook: (oldId, cancel, next) => {
        const previous = mustGet(appointments, oldId);
        const cancelled: Appointment = {
          ...previous,
          status: 'CANCELLED',
          cancellationReason: cancel.reason,
          cancelledByUserId: cancel.cancelledByUserId,
          updatedAt: new Date(),
        };
        appointments.set(oldId, cancelled);
        try {
          const created = makeAppointment(next);
          appointments.set(created.id, created);
          return Promise.resolve(created);
        } catch (error) {
          appointments.set(oldId, previous); // transaction rollback
          return Promise.reject(error);
        }
      },
    },

    consultations: {
      findById: (id) => Promise.resolve(consultations.get(id) ?? null),
      findByAppointmentId: (appointmentId) =>
        Promise.resolve(
          [...consultations.values()].find((entry) => entry.appointmentId === appointmentId) ?? null,
        ),
      create: (input) => {
        const consultation: Consultation = {
          id: randomUUID(),
          appointmentId: input.appointmentId,
          patientId: input.patientId,
          doctorId: input.doctorId,
          status: 'IN_PROGRESS',
          startedAt: input.startedAt,
          endedAt: null,
          durationSeconds: null,
          endReason: null,
          encryptedNotes: null,
          videoRoomId: input.videoRoomId ?? null,
          videoRoomUrl: input.videoRoomUrl ?? null,
          recordingConsentGiven: false,
          recordingConsentAt: null,
          followUpRequired: false,
          followUpDate: null,
          referredToInPerson: false,
          referralNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        consultations.set(consultation.id, consultation);
        return Promise.resolve(consultation);
      },
      update: (id, data) => {
        const consultation = mustGet(consultations, id);
        const next = { ...consultation, ...(data as Partial<Consultation>), updatedAt: new Date() };
        consultations.set(id, next);
        return Promise.resolve(next);
      },
      transitionStatus: (id, from, data) => {
        const consultation = consultations.get(id);
        if (!consultation || consultation.status !== from) return Promise.resolve(null);
        const next = { ...consultation, ...(data as Partial<Consultation>), updatedAt: new Date() };
        consultations.set(id, next);
        return Promise.resolve(next);
      },
      listDiagnoses: (consultationId) =>
        Promise.resolve(
          [...diagnoses.values()]
            .filter((entry) => entry.consultationId === consultationId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        ),
      addDiagnosis: (input) => {
        const diagnosis: Diagnosis = {
          id: randomUUID(),
          consultationId: input.consultationId,
          icd10Code: input.icd10Code,
          description: input.description,
          type: input.type,
          createdAt: new Date(),
        };
        diagnoses.set(diagnosis.id, diagnosis);
        return Promise.resolve(diagnosis);
      },
      removeDiagnosis: (consultationId, diagnosisId) => {
        const diagnosis = diagnoses.get(diagnosisId);
        if (!diagnosis || diagnosis.consultationId !== consultationId) return Promise.resolve(0);
        diagnoses.delete(diagnosisId);
        return Promise.resolve(1);
      },
      incrementDoctorConsultations: (doctorId) => {
        const doctor = mustGet(doctors, doctorId);
        doctors.set(doctorId, { ...doctor, totalConsultations: doctor.totalConsultations + 1 });
        return Promise.resolve(undefined);
      },
    },

    consultationMessages: {
      create: (input) => {
        const message: ConsultationMessage = {
          id: randomUUID(),
          consultationId: input.consultationId,
          senderUserId: input.senderUserId,
          encryptedBody: input.encryptedBody,
          sentAt: input.sentAt,
        };
        consultationMessages.set(message.id, message);
        return Promise.resolve(message);
      },
      listForConsultation: (consultationId, query) => {
        const all = [...consultationMessages.values()]
          .filter((entry) => entry.consultationId === consultationId)
          .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
        const start = (query.page - 1) * query.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + query.pageSize),
          total: all.length,
        });
      },
    },

    medicalRecords: {
      findById: (id) => {
        const record = medicalRecords.get(id);
        return Promise.resolve(record && record.deletedAt === null ? record : null);
      },
      listForPatient: (patientId, query) => {
        const all = [...medicalRecords.values()]
          .filter((entry) => entry.patientId === patientId && entry.deletedAt === null)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const start = (query.page - 1) * query.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + query.pageSize),
          total: all.length,
        });
      },
      create: (input) => {
        const record: MedicalRecord = {
          id: randomUUID(),
          patientId: input.patientId,
          consultationId: input.consultationId ?? null,
          type: input.type,
          title: input.title,
          summary: input.summary ?? null,
          encryptedContent: input.encryptedContent,
          createdByUserId: input.createdByUserId,
          addendumToId: input.addendumToId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        medicalRecords.set(record.id, record);
        return Promise.resolve(record);
      },
    },

    ratings: {
      findByConsultationId: (consultationId) =>
        Promise.resolve(
          [...consultationRatings.values()].find(
            (entry) => entry.consultationId === consultationId,
          ) ?? null,
        ),
      createWithAggregates: (input) => {
        const duplicate = [...consultationRatings.values()].some(
          (entry) => entry.consultationId === input.consultationId,
        );
        if (duplicate) return Promise.reject(new AlreadyRatedError());
        const rating: ConsultationRating = {
          id: randomUUID(),
          consultationId: input.consultationId,
          patientId: input.patientId,
          doctorId: input.doctorId,
          rating: input.rating,
          communication: input.communication ?? null,
          professionalism: input.professionalism ?? null,
          timeliness: input.timeliness ?? null,
          comment: input.comment ?? null,
          createdAt: new Date(),
        };
        consultationRatings.set(rating.id, rating);
        // Same arithmetic as the atomic SQL UPDATE in the real repository.
        const doctor = mustGet(doctors, input.doctorId);
        doctors.set(input.doctorId, {
          ...doctor,
          averageRating:
            (doctor.averageRating * doctor.totalRatings + input.rating) / (doctor.totalRatings + 1),
          totalRatings: doctor.totalRatings + 1,
        });
        return Promise.resolve(rating);
      },
    },

    screenings: {
      findById: (id) => Promise.resolve(screenings.get(id) ?? null),
      create: (input) => {
        const session: AIScreeningResult = {
          id: randomUUID(),
          patientId: input.patientId,
          sessionId: input.sessionId,
          language: input.language,
          status: 'ACTIVE',
          turnCount: 0,
          tokensUsed: 0,
          lastActivityAt: input.lastActivityAt,
          symptomsSummary: null,
          encryptedConversation: input.encryptedConversation,
          triageLevel: null,
          urgencyScore: null,
          recommendedSpecialty: null,
          confidence: null,
          escalatedToEmergency: false,
          createdAt: input.lastActivityAt, // clock-injected upstream
        };
        screenings.set(session.id, session);
        return Promise.resolve(session);
      },
      update: (id, data) => {
        const session = mustGet(screenings, id);
        const next = { ...session, ...(data as Partial<AIScreeningResult>) };
        screenings.set(id, next);
        return Promise.resolve(next);
      },
      transitionStatus: (id, from, data) => {
        const session = screenings.get(id);
        if (!session || session.status !== from) return Promise.resolve(null);
        const next = { ...session, ...(data as Partial<AIScreeningResult>) };
        screenings.set(id, next);
        return Promise.resolve(next);
      },
      listStale: (cutoff) =>
        Promise.resolve(
          [...screenings.values()].filter(
            (session) => session.status === 'ACTIVE' && session.lastActivityAt < cutoff,
          ),
        ),
      countCreatedSince: (patientId, since) =>
        Promise.resolve(
          [...screenings.values()].filter(
            (session) => session.patientId === patientId && session.createdAt >= since,
          ).length,
        ),
      usageSummary: () => {
        const all = [...screenings.values()];
        const byStatus: Record<string, number> = {};
        const triageLevels: Record<string, number> = {};
        let tokensUsed = 0;
        let emergencyCount = 0;
        for (const session of all) {
          byStatus[session.status] = (byStatus[session.status] ?? 0) + 1;
          if (session.triageLevel !== null) {
            triageLevels[session.triageLevel] = (triageLevels[session.triageLevel] ?? 0) + 1;
          }
          tokensUsed += session.tokensUsed;
          if (session.escalatedToEmergency) emergencyCount += 1;
        }
        return Promise.resolve({
          sessions: { total: all.length, byStatus },
          tokensUsed,
          triageLevels,
          emergencyCount,
        });
      },
    },

    paymentsRepo: {
      findById: (id) => Promise.resolve(paymentRows.get(id) ?? null),
      findByAppointmentId: (appointmentId) =>
        Promise.resolve(
          [...paymentRows.values()].find((row) => row.appointmentId === appointmentId) ?? null,
        ),
      findByIdempotencyKey: (idempotencyKey) =>
        Promise.resolve(
          [...paymentRows.values()].find((row) => row.idempotencyKey === idempotencyKey) ?? null,
        ),
      findByProviderReference: (providerReference) =>
        Promise.resolve(
          [...paymentRows.values()].find(
            (row) => row.aggregatorTransactionId === providerReference,
          ) ?? null,
        ),
      create: (input) => {
        const payment: Payment = {
          id: randomUUID(),
          patientId: input.patientId,
          appointmentId: input.appointmentId,
          deliveryId: null,
          amountTzs: input.amountTzs,
          platformFeeTzs: input.platformFeeTzs,
          doctorAmountTzs: input.doctorAmountTzs,
          method: input.method,
          status: 'PENDING',
          idempotencyKey: input.idempotencyKey,
          attempt: 1,
          payerPhone: input.payerPhone,
          aggregatorTransactionId: null,
          externalReference: null,
          failureReason: null,
          paidAt: null,
          refundAmountTzs: null,
          refundReference: null,
          refundReason: null,
          refundPending: false,
          refundedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        paymentRows.set(payment.id, payment);
        return Promise.resolve(payment);
      },
      update: (id, data) => {
        const payment = mustGet(paymentRows, id);
        const next = { ...payment, ...(data as Partial<Payment>), updatedAt: new Date() };
        paymentRows.set(id, next);
        return Promise.resolve(next);
      },
      transitionStatus: (id, from, data) => {
        const payment = paymentRows.get(id);
        if (!payment || !from.includes(payment.status)) return Promise.resolve(null);
        const next = { ...payment, ...(data as Partial<Payment>), updatedAt: new Date() };
        paymentRows.set(id, next);
        return Promise.resolve(next);
      },
      listProcessingOlderThan: (cutoff) =>
        Promise.resolve(
          [...paymentRows.values()].filter(
            (row) => row.status === 'PROCESSING' && row.updatedAt < cutoff,
          ),
        ),
      listForPatient: (patientId, query) => {
        const all = [...paymentRows.values()]
          .filter((row) => row.patientId === patientId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const start = (query.page - 1) * query.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + query.pageSize),
          total: all.length,
        });
      },
      adminList: (filters) => {
        const all = [...paymentRows.values()]
          .filter(
            (row) =>
              (filters.status === undefined || row.status === filters.status) &&
              (filters.from === undefined || row.createdAt >= filters.from) &&
              (filters.to === undefined || row.createdAt <= filters.to),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const start = (filters.page - 1) * filters.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + filters.pageSize),
          total: all.length,
        });
      },
      listRefundPending: () =>
        Promise.resolve([...paymentRows.values()].filter((row) => row.refundPending)),
    },

    doctorPayments: {
      createIfMissing: (input) => {
        const existing = [...doctorPaymentRows.values()].some(
          (row) => row.reference === input.reference,
        );
        if (existing) return Promise.resolve(null);
        const accrual: DoctorPayment = {
          id: randomUUID(),
          doctorId: input.doctorId,
          amountTzs: input.amountTzs,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          status: 'PENDING',
          reference: input.reference,
          paidAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        doctorPaymentRows.set(accrual.id, accrual);
        return Promise.resolve(accrual);
      },
      listForDoctor: (doctorId, query) => {
        const all = [...doctorPaymentRows.values()]
          .filter((row) => row.doctorId === doctorId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const start = (query.page - 1) * query.pageSize;
        return Promise.resolve({
          items: all.slice(start, start + query.pageSize),
          total: all.length,
          totalAmountTzs: all.reduce((sum, row) => sum + row.amountTzs, 0),
        });
      },
    },

    sessions: {
      create: (input: CreateSessionInput) => {
        const session: Session = {
          id: input.id ?? randomUUID(),
          userId: input.userId,
          refreshTokenHash: input.refreshTokenHash,
          tokenFamily: input.tokenFamily,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
          expiresAt: input.expiresAt,
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        sessions.set(session.id, session);
        return Promise.resolve(session);
      },
      findById: (id) => Promise.resolve(sessions.get(id) ?? null),
      rotateRefreshHash: (id, refreshTokenHash) => {
        const session = mustGet(sessions, id);
        const next = { ...session, refreshTokenHash };
        sessions.set(id, next);
        return Promise.resolve(next);
      },
      revoke: (id, reason) => {
        const session = mustGet(sessions, id);
        const next = { ...session, revokedAt: new Date(), revokedReason: reason };
        sessions.set(id, next);
        return Promise.resolve(next);
      },
      revokeAllForUser: (userId, reason) => {
        let count = 0;
        for (const [id, session] of sessions) {
          if (session.userId === userId && session.revokedAt === null) {
            sessions.set(id, { ...session, revokedAt: new Date(), revokedReason: reason });
            count += 1;
          }
        }
        return Promise.resolve(count);
      },
    },

    otps: {
      create: (input: CreateOtpInput) => {
        const otp: OtpCode = {
          id: randomUUID(),
          userId: input.userId,
          phone: input.phone,
          codeHash: input.codeHash,
          purpose: input.purpose,
          attempts: 0,
          expiresAt: input.expiresAt,
          consumedAt: null,
          createdAt: new Date(),
        };
        otps.set(otp.id, otp);
        return Promise.resolve(otp);
      },
      findActive: (phone: string, purpose: OtpPurpose, now: Date) => {
        const active = [...otps.values()]
          .filter(
            (otp) =>
              otp.phone === phone &&
              otp.purpose === purpose &&
              otp.consumedAt === null &&
              otp.expiresAt > now,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(active[0] ?? null);
      },
      recordAttempt: (id) => {
        const otp = mustGet(otps, id);
        const next = { ...otp, attempts: otp.attempts + 1 };
        otps.set(id, next);
        return Promise.resolve(next);
      },
      consume: (id) => {
        const otp = mustGet(otps, id);
        const next = { ...otp, consumedAt: new Date() };
        otps.set(id, next);
        return Promise.resolve(next);
      },
      invalidateAll: (phone, purpose) => {
        let count = 0;
        for (const [id, otp] of otps) {
          if (otp.phone === phone && otp.purpose === purpose && otp.consumedAt === null) {
            otps.set(id, { ...otp, consumedAt: new Date() });
            count += 1;
          }
        }
        return Promise.resolve(count);
      },
    },

    auditLogs: {
      append: (entry) => {
        auditEntries.push(entry);
        return Promise.resolve(entry);
      },
    },

    health: { db: null, redis: null },
  };

  return deps;
}
