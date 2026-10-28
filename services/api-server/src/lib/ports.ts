/**
 * Structural ports the API server depends on. The Prisma repositories in
 * packages/db satisfy them in production; tests satisfy them with in-memory
 * fakes. Services receive these via constructor injection.
 */
import type {
  AddDiagnosisInput,
  AdminPaymentFilters,
  AIScreeningResult,
  Appointment,
  AppointmentPage,
  AppointmentStatus,
  Consultation,
  ConsultationMessage,
  ConsultationRating,
  ConsultationStatus,
  CreateAppointmentInput,
  CreateConsultationInput,
  CreateDoctorUserInput,
  CreateMedicalRecordInput,
  CreateMessageInput,
  CreateOtpInput,
  CreatePatientUserInput,
  CreateAccrualInput,
  CreatePaymentInput,
  CreateRatingInput,
  CreateScreeningSessionInput,
  CreateSessionInput,
  Diagnosis,
  Doctor,
  DoctorPayment,
  DoctorDocument,
  DoctorDocumentType,
  DoctorSchedule,
  DoctorVerificationStatus,
  DoctorWithUser,
  DocumentReviewStatus,
  MedicalRecord,
  OtpCode,
  OtpPurpose,
  Patient,
  Payment,
  PaymentStatus,
  PatientInsurance,
  PatientWithUser,
  Prisma,
  ScheduleSlotInput,
  ScreeningSessionStatus,
  ScreeningUsageSummary,
  Session,
  UpsertDoctorDocumentInput,
  User,
  UserWithProfiles,
  VerificationUpdate,
} from '@daktari/db';
import type { SmsPort } from '@daktari/notifications';
import type { StoragePort } from '@daktari/storage';
import type { VideoPort } from '@daktari/video';
import type { AIProvider } from '@daktari/ai';
import type { MobileMoneyPort } from '@daktari/payments';
import type { PubSubPort } from './pubsub.js';

export interface UserRepoPort {
  findById(id: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findByIdWithProfiles(id: string): Promise<UserWithProfiles | null>;
  createPatientUser(input: CreatePatientUserInput): Promise<User>;
  createDoctorUser(input: CreateDoctorUserInput): Promise<User>;
  markPhoneVerified(id: string): Promise<User>;
  recordFailedLogin(id: string, lockedUntil: Date | null): Promise<User>;
  resetLoginFailures(id: string): Promise<User>;
  updatePassword(id: string, passwordHash: string): Promise<User>;
  update(id: string, data: Prisma.UserUpdateInput): Promise<User>;
}

export interface SessionRepoPort {
  create(input: CreateSessionInput): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  rotateRefreshHash(id: string, refreshTokenHash: string): Promise<Session>;
  revoke(id: string, reason: string): Promise<Session>;
  revokeAllForUser(userId: string, reason: string): Promise<number>;
}

export interface OtpRepoPort {
  create(input: CreateOtpInput): Promise<OtpCode>;
  findActive(phone: string, purpose: OtpPurpose, now: Date): Promise<OtpCode | null>;
  recordAttempt(id: string): Promise<OtpCode>;
  consume(id: string): Promise<OtpCode>;
  invalidateAll(phone: string, purpose: OtpPurpose): Promise<number>;
}

export interface PatientRepoPort {
  findById(id: string): Promise<Patient | null>;
  findByIdWithUser(id: string): Promise<PatientWithUser | null>;
  findByUserId(userId: string): Promise<Patient | null>;
  update(id: string, data: Prisma.PatientUpdateInput): Promise<Patient>;
  list(filters: {
    region?: string;
    district?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: PatientWithUser[]; total: number }>;
  /** provider null = any verified insurance row. */
  findVerifiedInsurance(
    patientId: string,
    provider: string | null,
    now: Date,
  ): Promise<PatientInsurance | null>;
}

export interface DoctorRepoPort {
  findById(id: string): Promise<Doctor | null>;
  findByIdWithUser(id: string): Promise<DoctorWithUser | null>;
  findByUserId(userId: string): Promise<Doctor | null>;
  findByTmcNumber(tmcRegistrationNumber: string): Promise<Doctor | null>;
  update(id: string, data: Prisma.DoctorUpdateInput): Promise<Doctor>;
  listDirectory(filters: {
    specialty?: string;
    region?: string;
    language?: string;
    acceptsNhif?: boolean;
    maxFeeTzs?: number;
    page: number;
    pageSize: number;
  }): Promise<{ items: DoctorWithUser[]; total: number }>;
  adminList(filters: {
    status?: DoctorVerificationStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: DoctorWithUser[]; total: number }>;
  listVerificationQueue(
    page: number,
    pageSize: number,
  ): Promise<{ items: DoctorWithUser[]; total: number }>;
  transitionVerification(
    id: string,
    from: DoctorVerificationStatus,
    update: VerificationUpdate,
  ): Promise<Doctor | null>;
}

export interface DoctorDocumentRepoPort {
  upsertForType(input: UpsertDoctorDocumentInput): Promise<DoctorDocument>;
  listByDoctor(doctorId: string): Promise<DoctorDocument[]>;
  setReview(
    doctorId: string,
    type: DoctorDocumentType,
    review: { status: DocumentReviewStatus; notes: string | null; reviewedByUserId: string },
  ): Promise<DoctorDocument>;
}

export interface ScheduleRepoPort {
  listForDoctor(doctorId: string): Promise<DoctorSchedule[]>;
  replaceForDoctor(doctorId: string, slots: ScheduleSlotInput[]): Promise<DoctorSchedule[]>;
}

export interface AppointmentRepoPort {
  findById(id: string): Promise<Appointment | null>;
  findByCheckInToken(token: string): Promise<Appointment | null>;
  /** Throws SlotTakenError (from @daktari/db) when the DB rejects a double-booking. */
  create(input: CreateAppointmentInput): Promise<Appointment>;
  listForPatient(
    patientId: string,
    query: { status?: AppointmentStatus; page: number; pageSize: number },
  ): Promise<AppointmentPage>;
  listForDoctorBetween(
    doctorId: string,
    from: Date,
    to: Date,
    query: { page: number; pageSize: number },
  ): Promise<AppointmentPage>;
  listActiveForDoctorBetween(doctorId: string, from: Date, to: Date): Promise<Appointment[]>;
  transition(
    id: string,
    from: AppointmentStatus,
    data: Prisma.AppointmentUpdateManyMutationInput & { status: AppointmentStatus },
  ): Promise<Appointment | null>;
  listExpiredPendingPayment(now: Date, limit?: number): Promise<Appointment[]>;
  cancelAndRebook(
    oldId: string,
    cancel: { reason: string; cancelledByUserId: string },
    next: CreateAppointmentInput,
  ): Promise<Appointment>;
  /** Does the doctor currently have a CONFIRMED/IN_PROGRESS appointment with the patient? */
  hasActiveWith(doctorId: string, patientId: string): Promise<boolean>;
}

export interface ConsultationRepoPort {
  findById(id: string): Promise<Consultation | null>;
  findByAppointmentId(appointmentId: string): Promise<Consultation | null>;
  create(input: CreateConsultationInput): Promise<Consultation>;
  update(id: string, data: Prisma.ConsultationUpdateInput): Promise<Consultation>;
  transitionStatus(
    id: string,
    from: ConsultationStatus,
    data: Prisma.ConsultationUpdateManyMutationInput & { status: ConsultationStatus },
  ): Promise<Consultation | null>;
  listDiagnoses(consultationId: string): Promise<Diagnosis[]>;
  addDiagnosis(input: AddDiagnosisInput): Promise<Diagnosis>;
  removeDiagnosis(consultationId: string, diagnosisId: string): Promise<number>;
  incrementDoctorConsultations(doctorId: string): Promise<unknown>;
}

export interface ConsultationMessageRepoPort {
  create(input: CreateMessageInput): Promise<ConsultationMessage>;
  listForConsultation(
    consultationId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: ConsultationMessage[]; total: number }>;
}

export interface MedicalRecordRepoPort {
  findById(id: string): Promise<MedicalRecord | null>;
  listForPatient(
    patientId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: MedicalRecord[]; total: number }>;
  create(input: CreateMedicalRecordInput): Promise<MedicalRecord>;
}

export interface RatingRepoPort {
  findByConsultationId(consultationId: string): Promise<ConsultationRating | null>;
  /** Throws AlreadyRatedError (from @daktari/db) on a duplicate rating. */
  createWithAggregates(input: CreateRatingInput): Promise<ConsultationRating>;
}

export interface ScreeningRepoPort {
  findById(id: string): Promise<AIScreeningResult | null>;
  create(input: CreateScreeningSessionInput): Promise<AIScreeningResult>;
  update(id: string, data: Prisma.AIScreeningResultUpdateInput): Promise<AIScreeningResult>;
  transitionStatus(
    id: string,
    from: ScreeningSessionStatus,
    data: Prisma.AIScreeningResultUpdateManyMutationInput & { status: ScreeningSessionStatus },
  ): Promise<AIScreeningResult | null>;
  listStale(cutoff: Date, limit?: number): Promise<AIScreeningResult[]>;
  countCreatedSince(patientId: string, since: Date): Promise<number>;
  usageSummary(): Promise<ScreeningUsageSummary>;
}

/**
 * Payment port the appointment/consultation flows depend on. Implemented by
 * PaymentService (backed by MobileMoneyPort) in production wiring and by
 * FakePaymentPort in unit tests.
 */
export interface PaymentPort {
  initiateMobileMoney(input: {
    appointmentId: string;
    patientId: string;
    amountTzs: number;
    payerPhone: string;
  }): Promise<{ reference: string }>;
  /** Full automatic refund when a PAID appointment is cancelled; no-op otherwise. */
  refundIfPaid(appointmentId: string, reason: string): Promise<void>;
}

export interface PaymentRepoPort {
  findById(id: string): Promise<Payment | null>;
  findByAppointmentId(appointmentId: string): Promise<Payment | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null>;
  findByProviderReference(providerReference: string): Promise<Payment | null>;
  create(input: CreatePaymentInput): Promise<Payment>;
  update(id: string, data: Prisma.PaymentUpdateInput): Promise<Payment>;
  transitionStatus(
    id: string,
    from: PaymentStatus[],
    data: Prisma.PaymentUpdateManyMutationInput & { status: PaymentStatus },
  ): Promise<Payment | null>;
  listProcessingOlderThan(cutoff: Date, limit?: number): Promise<Payment[]>;
  listForPatient(
    patientId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: Payment[]; total: number }>;
  adminList(filters: AdminPaymentFilters): Promise<{ items: Payment[]; total: number }>;
  listRefundPending(): Promise<Payment[]>;
}

export interface DoctorPaymentRepoPort {
  createIfMissing(input: CreateAccrualInput): Promise<DoctorPayment | null>;
  listForDoctor(
    doctorId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: DoctorPayment[]; total: number; totalAmountTzs: number }>;
}

export interface AuditLogEntry {
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface AuditLogPort {
  append(entry: AuditLogEntry): Promise<unknown>;
}

export interface HealthChecks {
  /** Resolves if Postgres answers; null when not wired (unit tests). */
  db: (() => Promise<void>) | null;
  /** Resolves if Redis answers; null when not wired. */
  redis: (() => Promise<void>) | null;
}

/** Reads a locally stored file by key — null when storage is remote (S3). */
export type LocalFileReader = ((key: string) => Promise<Buffer>) | null;

export interface AppDeps {
  users: UserRepoPort;
  sessions: SessionRepoPort;
  otps: OtpRepoPort;
  patients: PatientRepoPort;
  doctors: DoctorRepoPort;
  doctorDocuments: DoctorDocumentRepoPort;
  schedules: ScheduleRepoPort;
  appointments: AppointmentRepoPort;
  consultations: ConsultationRepoPort;
  consultationMessages: ConsultationMessageRepoPort;
  medicalRecords: MedicalRecordRepoPort;
  ratings: RatingRepoPort;
  screenings: ScreeningRepoPort;
  ai: AIProvider | null;
  paymentsRepo: PaymentRepoPort;
  doctorPayments: DoctorPaymentRepoPort;
  mobileMoney: MobileMoneyPort;
  storage: StoragePort;
  video: VideoPort;
  pubsub: PubSubPort;
  localFiles: LocalFileReader;
  auditLogs: AuditLogPort;
  sms: SmsPort;
  health: HealthChecks;
}
