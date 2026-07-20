/** Thin, typed wrappers over the API — one function per endpoint the app uses. */
import { apiRequest, type BilingualMessage } from './api';

// ── Auth ─────────────────────────────────────────────────────────────────────
export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  status?: 'OK' | '2FA_REQUIRED';
  user?: { id: string; role: string; language: string; phoneVerified: boolean };
  challenge?: { type: 'OTP'; challengeId: string; expiresInSeconds: number };
}

export const authApi = {
  register: (body: {
    phone: string;
    password: string;
    fullName: string;
    dateOfBirth: string;
    gender: 'MALE' | 'FEMALE';
    language: 'sw' | 'en';
  }) =>
    apiRequest<{ message: BilingualMessage }>('/api/v1/auth/register', {
      method: 'POST',
      body,
      anonymous: true,
    }),
  verifyOtp: (body: { phone: string; purpose: 'PHONE_VERIFY' | 'PASSWORD_RESET'; code: string }) =>
    apiRequest<{ message: BilingualMessage }>('/api/v1/auth/verify-otp', {
      method: 'POST',
      body,
      anonymous: true,
    }),
  login: (body: { phone: string; password: string }) =>
    apiRequest<TokenPairResponse>('/api/v1/auth/login', { method: 'POST', body, anonymous: true }),
  forgotPassword: (body: { phone: string }) =>
    apiRequest<{ message: BilingualMessage }>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body,
      anonymous: true,
    }),
  resetPassword: (body: { phone: string; code: string; newPassword: string }) =>
    apiRequest<{ message: BilingualMessage }>('/api/v1/auth/reset-password', {
      method: 'POST',
      body,
      anonymous: true,
    }),
  logout: () => apiRequest<{ message: BilingualMessage }>('/api/v1/auth/logout', { method: 'POST' }),
  me: () =>
    apiRequest<{ user: { id: string; phone: string; fullName: string; language: string } }>(
      '/api/v1/auth/me',
    ),
  /** Registration OTP re-send (Phase 9) — anti-enumeration 202 always. */
  resendOtp: (body: { phoneNumber: string }) =>
    apiRequest<{ message: BilingualMessage }>('/api/v1/auth/resend-otp', {
      method: 'POST',
      body: { ...body, purpose: 'phone_verify' },
      anonymous: true,
    }),
};

// ── Patient profile ──────────────────────────────────────────────────────────
export interface PatientProfile {
  patientNumber: string;
  region: string;
  district: string;
  ward: string | null;
  street: string | null;
  emergencyContact: { name: string; phone: string; relationship: string } | null;
  profileCompletion: { complete: boolean; missingFields: string[] };
  /** Present on own-profile reads — gates the NHIF payment intent. */
  insurance?: { verifiedNhif: boolean };
}

export const patientApi = {
  myProfile: () => apiRequest<PatientProfile>('/api/v1/patients/me/profile'),
  updateProfile: (body: Record<string, unknown>) =>
    apiRequest<PatientProfile>('/api/v1/patients/me/profile', { method: 'PATCH', body }),
};

// ── Appointments ─────────────────────────────────────────────────────────────
export interface AppointmentItem {
  id: string;
  doctorId: string;
  type: 'VIDEO' | 'AUDIO' | 'CHAT' | 'IN_PERSON';
  status:
    | 'PENDING_PAYMENT'
    | 'CONFIRMED'
    | 'CHECKED_IN'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'NO_SHOW';
  scheduledAt: string;
  durationMinutes: number;
  reason: string;
  paymentIntent: 'MOBILE_MONEY' | 'NHIF' | 'INSURANCE' | 'CASH_AT_FACILITY';
  pendingReason: string | null;
  expiresAt: string | null;
  cancellationReason: string | null;
}

export const appointmentApi = {
  listMine: (page = 1) =>
    apiRequest<{ items: AppointmentItem[]; total: number; page: number; pageSize: number }>(
      `/api/v1/appointments/me?page=${page}&pageSize=50`,
    ),
  book: (body: {
    doctorId: string;
    type: string;
    scheduledAt: string;
    reason: string;
    paymentIntent: string;
    screeningResultId?: string;
  }) => apiRequest<AppointmentItem>('/api/v1/appointments', { method: 'POST', body }),
  cancel: (id: string, reason: string) =>
    apiRequest<AppointmentItem>(`/api/v1/appointments/${id}/cancel`, {
      method: 'POST',
      body: { reason },
    }),
  pay: (id: string) =>
    apiRequest<PaymentItem>(`/api/v1/appointments/${id}/pay`, { method: 'POST' }),
};

// ── Payments ─────────────────────────────────────────────────────────────────
export interface PaymentItem {
  id: string;
  appointmentId: string | null;
  amountTzs: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  attempt: number;
  failureReason: string | null;
  refundPending: boolean;
  paidAt: string | null;
  refundedAt: string | null;
}

export const paymentApi = {
  listMine: (page = 1) =>
    apiRequest<{ items: PaymentItem[]; total: number }>(
      `/api/v1/payments/me?page=${page}&pageSize=50`,
    ),
};

// ── Screening ────────────────────────────────────────────────────────────────
export interface ScreeningTriage {
  triageLevel: 'SELF_CARE' | 'TELECONSULTATION' | 'IN_PERSON_VISIT' | 'EMERGENCY';
  urgencyScore: number | null;
  recommendedSpecialty: string | null;
}

export interface ScreeningReplyResponse {
  sessionId: string;
  status: 'ACTIVE' | 'COMPLETED';
  reply: string;
  triage?: ScreeningTriage;
  suggestedDoctors?: Array<{
    id: string;
    fullName: string;
    specialty: string;
    consultationFeeTzs: number;
    averageRating: number;
  }>;
}

export const screeningApi = {
  start: () =>
    apiRequest<{ sessionId: string; status: string; message: string }>(
      '/api/v1/ai/screening/sessions',
      { method: 'POST', body: {} },
    ),
  sendMessage: (sessionId: string, message: string) =>
    apiRequest<ScreeningReplyResponse>(`/api/v1/ai/screening/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { message },
    }),
  getSession: (sessionId: string) =>
    apiRequest<{
      sessionId: string;
      status: string;
      transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
    }>(`/api/v1/ai/screening/sessions/${sessionId}`),
};

// ── Doctors (public directory) ───────────────────────────────────────────────
export interface DoctorListItem {
  id: string;
  fullName: string;
  specialty: string;
  subSpecialty: string | null;
  yearsOfExperience: number;
  consultationFeeTzs: number;
  bio: string | null;
  languages: string[];
  region: string | null;
  acceptsNhif: boolean;
  averageRating: number;
  totalConsultations: number;
  hospitalAffiliated: boolean;
}

export interface AvailabilitySlot {
  startUtc: string;
  startEat: string;
  durationMinutes: number;
}

export const doctorApi = {
  directory: (filters: {
    specialization?: string;
    region?: string;
    acceptsNhif?: boolean;
    maxFee?: number;
    page?: number;
  }) => {
    const params = new URLSearchParams({ page: String(filters.page ?? 1), pageSize: '20' });
    if (filters.specialization) params.set('specialization', filters.specialization);
    if (filters.region) params.set('region', filters.region);
    if (filters.acceptsNhif) params.set('acceptsNhif', 'true');
    if (filters.maxFee !== undefined) params.set('maxFee', String(filters.maxFee));
    return apiRequest<{ items: DoctorListItem[]; total: number }>(
      `/api/v1/doctors?${params.toString()}`,
    );
  },
  detail: (id: string) => apiRequest<DoctorListItem>(`/api/v1/doctors/${id}`),
  availability: (id: string, date: string) =>
    apiRequest<{ date: string; slots: AvailabilitySlot[] }>(
      `/api/v1/doctors/${id}/availability?date=${date}`,
    ),
};

// ── Medical records ──────────────────────────────────────────────────────────
export interface MedicalRecordItem {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  addendumToId: string | null;
  createdAt: string;
}

export interface MedicalRecordDetail extends MedicalRecordItem {
  content: {
    notes?: {
      chiefComplaint?: string;
      historyOfPresentIllness?: string;
      examination?: string;
      assessment?: string;
      plan?: string;
    };
    diagnoses?: Array<{ icd10Code: string; description: string; type: string }>;
    referral?: {
      referredToInPerson: boolean;
      referralNotes: string | null;
      followUpRequired: boolean;
      followUpDate: string | null;
    };
  };
}

export const recordsApi = {
  listMine: (page = 1) =>
    apiRequest<{ items: MedicalRecordItem[]; total: number }>(
      `/api/v1/medical-records/me?page=${page}&pageSize=50`,
    ),
  detail: (id: string) => apiRequest<MedicalRecordDetail>(`/api/v1/medical-records/${id}`),
};

// ── Ratings ──────────────────────────────────────────────────────────────────
export interface RatingStatus {
  consultationId: string;
  status: string;
  rating: { rating: number; comment: string | null; createdAt: string } | null;
}

// ── Consultations (Phase 10) ─────────────────────────────────────────────────
export interface ConsultationView {
  id: string;
  appointmentId: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
  videoRoomUrl: string | null;
  recordingConsentGiven: boolean;
}

export interface ChatMessageRow {
  id: string;
  senderUserId: string;
  body: string;
  sentAt: string;
}

export const consultationApi = {
  get: (id: string) => apiRequest<ConsultationView>(`/api/v1/consultations/${id}`),
  /** Role-scoped Daily meeting token (patient fetches theirs). */
  meetingToken: (id: string) =>
    apiRequest<{ meetingToken: string; roomUrl: string }>(`/api/v1/consultations/${id}/token`),
  messages: (id: string, page = 1) =>
    apiRequest<{ items: ChatMessageRow[]; total: number; page: number; pageSize: number }>(
      `/api/v1/consultations/${id}/messages?page=${page}&pageSize=100`,
    ),
  abort: (id: string, reason: string) =>
    apiRequest<ConsultationView>(`/api/v1/consultations/${id}/abort`, {
      method: 'POST',
      body: { reason },
    }),
  /** Short-lived single-use WS ticket. */
  wsTicket: () => apiRequest<{ ticket: string; expiresInSeconds: number }>('/api/v1/ws/ticket', { method: 'POST' }),
};

export const ratingApi = {
  statusForAppointment: (appointmentId: string) =>
    apiRequest<RatingStatus>(`/api/v1/consultations/by-appointment/${appointmentId}`),
  rate: (
    consultationId: string,
    body: {
      rating: number;
      communication?: number;
      professionalism?: number;
      timeliness?: number;
      comment?: string;
    },
  ) =>
    apiRequest<{ id: string; rating: number }>(`/api/v1/consultations/${consultationId}/rating`, {
      method: 'POST',
      body,
    }),
};
