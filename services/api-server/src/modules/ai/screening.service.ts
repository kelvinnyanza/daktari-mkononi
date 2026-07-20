import { randomUUID } from 'node:crypto';
import type { AIScreeningResult, Patient, TriageLevel } from '@daktari/db';
import { decryptHealthData, encryptHealthData } from '@daktari/encryption';
import { AiOutputInvalidError, AiProviderError, type AiPort } from '@daktari/ai';
import { triageCheckSchema, type TriageCheck } from '@daktari/schemas';
import { ApiError, msg } from '../../lib/errors.js';
import type {
  AppointmentRepoPort,
  AuditLogPort,
  DoctorRepoPort,
  PatientRepoPort,
  ScreeningRepoPort,
  UserRepoPort,
} from '../../lib/ports.js';
import type { SlidingWindowLimiter } from '../../lib/rate-limiter.js';
import { matchEmergencyKeyword } from './emergency-keywords.js';
import { containsDosagePattern } from './output-gate.js';
import {
  BUDGET_CAP_MESSAGE,
  COMPLETION_MESSAGE,
  EMERGENCY_MESSAGE,
  OPENING_MESSAGE,
  OUTPUT_BLOCKED_MESSAGE,
  TECHNICAL_HICCUP_MESSAGE,
  TRIAGE_CHECK_SYSTEM_PROMPT,
  TURN_CAP_MESSAGE,
  buildScreeningSystemPrompt,
  toAgeBand,
  type ScreeningLanguage,
} from './prompts.js';

export const SESSION_IDLE_EXPIRY_MS = 30 * 60_000;
export const MAX_TURNS = 12;
export const SESSION_TOKEN_BUDGET = 8_000;
export const MAX_TOKENS_PER_TURN = 500;
export const MESSAGES_PER_HOUR = 20;
export const SESSIONS_PER_DAY = 3;

const SESSION_NOT_FOUND = (): ApiError =>
  new ApiError(404, 'SESSION_NOT_FOUND', msg('Kikao hakijapatikana', 'Screening session not found'));

const RATE_LIMITED = (): ApiError =>
  new ApiError(
    429,
    'RATE_LIMITED',
    msg(
      'Maombi mengi mno — jaribu tena baadaye. Kama ni dharura, piga 112 au 115 sasa hivi.',
      'Too many requests — try again later. If this is an emergency, call 112 or 115 now.',
    ),
  );

interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface ScreeningReply {
  sessionId: string;
  status: AIScreeningResult['status'];
  reply: string;
  triage?: {
    triageLevel: TriageLevel;
    urgencyScore: number | null;
    recommendedSpecialty: string | null;
  };
  suggestedDoctors?: Array<{
    id: string;
    fullName: string;
    specialty: string;
    consultationFeeTzs: number;
    averageRating: number;
  }>;
}

export interface ScreeningServiceDeps {
  screenings: ScreeningRepoPort;
  patients: PatientRepoPort;
  doctors: DoctorRepoPort;
  appointments: AppointmentRepoPort;
  users: UserRepoPort;
  ai: AiPort;
  auditLogs: AuditLogPort;
}

export class ScreeningService {
  constructor(
    private readonly deps: ScreeningServiceDeps,
    private readonly limiter: SlidingWindowLimiter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Session lifecycle ──────────────────────────────────────────────────────

  async startSession(
    userId: string,
    language?: ScreeningLanguage,
  ): Promise<{ sessionId: string; status: string; message: string }> {
    const patient = await this.ownPatient(userId);
    const since = new Date(this.now().getTime() - 24 * 60 * 60_000);
    if ((await this.deps.screenings.countCreatedSince(patient.id, since)) >= SESSIONS_PER_DAY) {
      throw RATE_LIMITED();
    }

    const user = await this.deps.users.findById(userId);
    const lang: ScreeningLanguage = language ?? (user?.language === 'EN' ? 'en' : 'sw');
    // Canned opening (never a model call): guarantees the disclaimer + 112/115.
    const opening = OPENING_MESSAGE[lang];
    const transcript: TranscriptEntry[] = [
      { role: 'assistant', content: opening, at: this.now().toISOString() },
    ];
    const session = await this.deps.screenings.create({
      patientId: patient.id,
      sessionId: randomUUID(),
      language: lang === 'en' ? 'EN' : 'SW',
      encryptedConversation: encryptHealthData(JSON.stringify(transcript)),
      lastActivityAt: this.now(),
    });
    await this.audit(userId, 'SCREENING_SESSION_STARTED', session.id);
    return { sessionId: session.id, status: session.status, message: opening };
  }

  /**
   * One patient message through the full safety pipeline:
   *   ownership/ACTIVE → per-patient rate limit → emergency keyword
   *   pre-screen (NO model call) → turn cap → token budget → model reply →
   *   output gate → structured triage check → persistence/completion.
   */
  async handleMessage(userId: string, id: string, message: string): Promise<ScreeningReply> {
    const patient = await this.ownPatient(userId);
    let session = await this.deps.screenings.findById(id);
    if (!session || session.patientId !== patient.id) throw SESSION_NOT_FOUND();
    session = await this.expireIfStale(session);
    if (session.status !== 'ACTIVE') {
      throw new ApiError(
        409,
        'SESSION_NOT_ACTIVE',
        msg('Kikao hiki kimeshafungwa', 'This screening session is no longer active'),
        { status: session.status },
      );
    }
    const lang = this.langOf(session);
    const transcript = this.decryptTranscript(session);
    transcript.push({ role: 'user', content: message, at: this.now().toISOString() });

    // 1. Emergency keyword pre-screen — BEFORE the rate limit and any model
    //    call (Phase 7 fix): a rate-limited patient typing an emergency
    //    phrase must get the 112/115 completion, never a 429.
    const keyword = matchEmergencyKeyword(message);
    if (keyword) {
      const reply = EMERGENCY_MESSAGE[lang];
      transcript.push({ role: 'assistant', content: reply, at: this.now().toISOString() });
      await this.completeSession(session, transcript, {
        triageLevel: 'EMERGENCY',
        urgencyScore: 10,
        escalated: true,
      });
      await this.audit(userId, 'SCREENING_EMERGENCY_KEYWORD', session.id, {
        keywordTriggered: true,
        category: keyword.category,
      });
      return { sessionId: session.id, status: 'COMPLETED', reply, triage: this.triageView('EMERGENCY', 10, null) };
    }

    if (!this.limiter.tryAcquire(`screening-msg:${patient.id}`, MESSAGES_PER_HOUR, 60 * 60_000)) {
      throw RATE_LIMITED();
    }

    // 2. Turn cap.
    if (session.turnCount >= MAX_TURNS) {
      return this.closeOut(userId, session, transcript, TURN_CAP_MESSAGE[lang], 'TURN_CAP');
    }
    // 3. Cumulative token budget (cost guard) — graceful close-out, never an error.
    if (session.tokensUsed >= SESSION_TOKEN_BUDGET) {
      return this.closeOut(userId, session, transcript, BUDGET_CAP_MESSAGE[lang], 'TOKEN_BUDGET');
    }

    // 4. Conversational model call. Patient text goes ONLY into the user role.
    const system = buildScreeningSystemPrompt(lang, {
      ageBand: toAgeBand(patient.dateOfBirth, this.now()),
      gender: patient.gender,
      chronicConditions: patient.chronicConditions,
      allergies: patient.allergies,
    });
    let replyText: string;
    let tokensThisTurn = 0;
    try {
      const completion = await this.deps.ai.complete({
        system,
        messages: transcript.map((entry) => ({ role: entry.role, content: entry.content })),
        maxTokens: MAX_TOKENS_PER_TURN,
      });
      replyText = completion.text;
      tokensThisTurn += completion.usage.inputTokens + completion.usage.outputTokens;
    } catch (error) {
      return this.gracefulAiFailure(userId, session, transcript, lang, error);
    }

    // 5. Output gate: dosage patterns never reach the patient.
    if (containsDosagePattern(replyText)) {
      await this.audit(userId, 'SCREENING_OUTPUT_BLOCKED', session.id, {
        reason: 'dosage-pattern',
      });
      replyText = OUTPUT_BLOCKED_MESSAGE[lang];
    }
    transcript.push({ role: 'assistant', content: replyText, at: this.now().toISOString() });

    // 6. Structured triage check over the updated transcript.
    let triage: TriageCheck;
    try {
      const structured = await this.deps.ai.completeStructured(
        {
          system: TRIAGE_CHECK_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: transcript
                .map((entry) => `${entry.role === 'user' ? 'PATIENT' : 'ASSISTANT'}: ${entry.content}`)
                .join('\n'),
            },
          ],
          maxTokens: MAX_TOKENS_PER_TURN,
        },
        triageCheckSchema,
      );
      triage = structured.value;
      tokensThisTurn += structured.usage.inputTokens + structured.usage.outputTokens;
    } catch (error) {
      if (error instanceof AiOutputInvalidError) {
        // Persist the exchange, stay ACTIVE, tell the patient gently.
        await this.persistExchange(session, transcript, tokensThisTurn);
        await this.audit(userId, 'SCREENING_TRIAGE_CHECK_FAILED', session.id, {
          reason: 'invalid-structured-output',
        });
        return { sessionId: session.id, status: 'ACTIVE', reply: TECHNICAL_HICCUP_MESSAGE[lang] };
      }
      return this.gracefulAiFailure(userId, session, transcript, lang, error);
    }

    // 7. Triage complete?
    if (triage.triageComplete && triage.triageLevel !== undefined) {
      if (triage.triageLevel === 'EMERGENCY') {
        // Model-detected emergency behaves exactly like the keyword path.
        const reply = EMERGENCY_MESSAGE[lang];
        transcript.push({ role: 'assistant', content: reply, at: this.now().toISOString() });
        await this.completeSession(session, transcript, {
          triageLevel: 'EMERGENCY',
          urgencyScore: Math.round(triage.urgencyScore),
          escalated: true,
          tokensThisTurn,
          confidence: triage.confidence,
        });
        await this.audit(userId, 'SCREENING_EMERGENCY_MODEL', session.id, {
          urgencyScore: triage.urgencyScore,
        });
        return {
          sessionId: session.id,
          status: 'COMPLETED',
          reply,
          triage: this.triageView('EMERGENCY', Math.round(triage.urgencyScore), null),
        };
      }

      const specialty = this.normalizeSpecialty(triage.suggestedSpecialty);
      const closing = `${replyText}\n\n${COMPLETION_MESSAGE[lang][triage.triageLevel] ?? COMPLETION_MESSAGE[lang].TELECONSULTATION!}`;
      transcript[transcript.length - 1] = {
        role: 'assistant',
        content: closing,
        at: this.now().toISOString(),
      };
      await this.completeSession(session, transcript, {
        triageLevel: triage.triageLevel,
        urgencyScore: Math.round(triage.urgencyScore),
        escalated: false,
        tokensThisTurn,
        confidence: triage.confidence,
        recommendedSpecialty: specialty,
      });
      await this.audit(userId, 'SCREENING_TRIAGE_COMPLETED', session.id, {
        triageLevel: triage.triageLevel,
        urgencyScore: triage.urgencyScore,
      });

      const suggestedDoctors =
        triage.triageLevel === 'SELF_CARE'
          ? undefined
          : await this.matchDoctors(specialty, patient);
      return {
        sessionId: session.id,
        status: 'COMPLETED',
        reply: closing,
        triage: this.triageView(triage.triageLevel, Math.round(triage.urgencyScore), specialty),
        ...(suggestedDoctors !== undefined ? { suggestedDoctors } : {}),
      };
    }

    // 8. Continue the conversation.
    await this.persistExchange(session, transcript, tokensThisTurn);
    return { sessionId: session.id, status: 'ACTIVE', reply: replyText };
  }

  /** Owner or a doctor with an active appointment; decrypted; PHI-audited. */
  async getSession(userId: string, id: string): Promise<{
    sessionId: string;
    status: string;
    language: string;
    turnCount: number;
    triage: { triageLevel: TriageLevel | null; urgencyScore: number | null; recommendedSpecialty: string | null };
    transcript: TranscriptEntry[];
  }> {
    const session = await this.deps.screenings.findById(id);
    if (!session) throw SESSION_NOT_FOUND();

    const patient = await this.deps.patients.findById(session.patientId);
    let allowed = patient?.userId === userId;
    if (!allowed) {
      const doctor = await this.deps.doctors.findByUserId(userId);
      allowed = doctor !== null && (await this.deps.appointments.hasActiveWith(doctor.id, session.patientId));
    }
    if (!allowed) throw SESSION_NOT_FOUND(); // no id enumeration

    await this.audit(userId, 'SCREENING_SESSION_VIEWED', session.id);
    return {
      sessionId: session.id,
      status: session.status,
      language: session.language,
      turnCount: session.turnCount,
      triage: {
        triageLevel: session.triageLevel,
        urgencyScore: session.urgencyScore,
        recommendedSpecialty: session.recommendedSpecialty,
      },
      transcript: this.decryptTranscript(session),
    };
  }

  /** Expiry sweep (callable job): ACTIVE + idle > 30 min → EXPIRED. */
  async expireStaleSessions(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - SESSION_IDLE_EXPIRY_MS);
    const stale = await this.deps.screenings.listStale(cutoff);
    let expired = 0;
    for (const session of stale) {
      const applied = await this.deps.screenings.transitionStatus(session.id, 'ACTIVE', {
        status: 'EXPIRED',
      });
      if (applied) expired += 1;
    }
    return expired;
  }

  async usageSummary(): ReturnType<ScreeningRepoPort['usageSummary']> {
    return this.deps.screenings.usageSummary();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async ownPatient(userId: string): Promise<Patient> {
    const patient = await this.deps.patients.findByUserId(userId);
    if (!patient) {
      throw new ApiError(404, 'PATIENT_NOT_FOUND', msg('Mgonjwa hajapatikana', 'Patient not found'));
    }
    return patient;
  }

  private langOf(session: AIScreeningResult): ScreeningLanguage {
    return session.language === 'EN' ? 'en' : 'sw';
  }

  private decryptTranscript(session: AIScreeningResult): TranscriptEntry[] {
    if (session.encryptedConversation === null) return [];
    return JSON.parse(decryptHealthData(session.encryptedConversation)) as TranscriptEntry[];
  }

  private async expireIfStale(session: AIScreeningResult): Promise<AIScreeningResult> {
    if (
      session.status === 'ACTIVE' &&
      session.lastActivityAt.getTime() < this.now().getTime() - SESSION_IDLE_EXPIRY_MS
    ) {
      return (
        (await this.deps.screenings.transitionStatus(session.id, 'ACTIVE', { status: 'EXPIRED' })) ??
        session
      );
    }
    return session;
  }

  private triageView(
    level: TriageLevel,
    urgencyScore: number | null,
    specialty: string | null,
  ): NonNullable<ScreeningReply['triage']> {
    return { triageLevel: level, urgencyScore, recommendedSpecialty: specialty };
  }

  private normalizeSpecialty(raw: string | undefined): string | null {
    if (raw === undefined) return null;
    const candidate = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return candidate.length > 0 ? candidate : null;
  }

  /** Top 3 APPROVED doctors by rating — reuses the public directory query. */
  private async matchDoctors(
    specialty: string | null,
    patient: Patient,
  ): Promise<NonNullable<ScreeningReply['suggestedDoctors']>> {
    const regionFilter =
      patient.region !== 'UNKNOWN' && patient.region !== '' ? { region: patient.region } : {};
    let { items } = await this.deps.doctors.listDirectory({
      ...(specialty !== null ? { specialty } : {}),
      ...regionFilter,
      page: 1,
      pageSize: 3,
    });
    if (items.length === 0) {
      // Relax the region filter rather than returning nothing.
      ({ items } = await this.deps.doctors.listDirectory({
        ...(specialty !== null ? { specialty } : {}),
        page: 1,
        pageSize: 3,
      }));
    }
    return items.map((doctor) => ({
      id: doctor.id,
      fullName: doctor.user.fullName,
      specialty: doctor.specialty,
      consultationFeeTzs: doctor.consultationFeeTzs,
      averageRating: doctor.averageRating,
    }));
  }

  private async persistExchange(
    session: AIScreeningResult,
    transcript: TranscriptEntry[],
    tokensThisTurn: number,
  ): Promise<void> {
    await this.deps.screenings.update(session.id, {
      encryptedConversation: encryptHealthData(JSON.stringify(transcript)),
      turnCount: session.turnCount + 1,
      tokensUsed: session.tokensUsed + tokensThisTurn,
      lastActivityAt: this.now(),
    });
  }

  private async completeSession(
    session: AIScreeningResult,
    transcript: TranscriptEntry[],
    result: {
      triageLevel: TriageLevel;
      urgencyScore: number;
      escalated: boolean;
      tokensThisTurn?: number;
      confidence?: number;
      recommendedSpecialty?: string | null;
    },
  ): Promise<void> {
    await this.deps.screenings.transitionStatus(session.id, 'ACTIVE', {
      status: 'COMPLETED',
      encryptedConversation: encryptHealthData(JSON.stringify(transcript)),
      turnCount: session.turnCount + 1,
      tokensUsed: session.tokensUsed + (result.tokensThisTurn ?? 0),
      lastActivityAt: this.now(),
      triageLevel: result.triageLevel,
      urgencyScore: result.urgencyScore,
      escalatedToEmergency: result.escalated,
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      ...(result.recommendedSpecialty !== undefined
        ? { recommendedSpecialty: result.recommendedSpecialty }
        : {}),
    });
  }

  /** Cap reached: canned close-out, COMPLETED with TELECONSULTATION triage. */
  private async closeOut(
    userId: string,
    session: AIScreeningResult,
    transcript: TranscriptEntry[],
    message: string,
    reason: 'TURN_CAP' | 'TOKEN_BUDGET',
  ): Promise<ScreeningReply> {
    transcript.push({ role: 'assistant', content: message, at: this.now().toISOString() });
    await this.completeSession(session, transcript, {
      triageLevel: 'TELECONSULTATION',
      urgencyScore: session.urgencyScore ?? 5,
      escalated: false,
    });
    await this.audit(userId, 'SCREENING_CLOSED_OUT', session.id, { reason });
    const patient = await this.deps.patients.findById(session.patientId);
    const suggestedDoctors = patient ? await this.matchDoctors(null, patient) : [];
    return {
      sessionId: session.id,
      status: 'COMPLETED',
      reply: message,
      triage: this.triageView('TELECONSULTATION', session.urgencyScore ?? 5, null),
      suggestedDoctors,
    };
  }

  /** Provider failure: graceful canned reply, session stays ACTIVE, audited. */
  private async gracefulAiFailure(
    userId: string,
    session: AIScreeningResult,
    transcript: TranscriptEntry[],
    lang: ScreeningLanguage,
    error: unknown,
  ): Promise<ScreeningReply> {
    const code = error instanceof AiProviderError ? error.code : 'PROVIDER_ERROR';
    await this.audit(userId, 'SCREENING_AI_ERROR', session.id, { code });
    // Keep the patient's message in the transcript so retrying keeps context.
    await this.deps.screenings.update(session.id, {
      encryptedConversation: encryptHealthData(JSON.stringify(transcript)),
      lastActivityAt: this.now(),
    });
    return { sessionId: session.id, status: 'ACTIVE', reply: TECHNICAL_HICCUP_MESSAGE[lang] };
  }

  private audit(
    actorUserId: string,
    action: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.deps.auditLogs.append({
      actorUserId,
      action,
      resourceType: 'AIScreeningResult',
      resourceId,
      ipAddress: null,
      userAgent: null,
      ...(metadata !== undefined ? { metadata: metadata as never } : {}),
    });
  }
}

/** Interval wiring for the session-expiry sweep — production only. */
export function startScreeningExpirySweep(
  service: ScreeningService,
  intervalMs = 60_000,
  onError: (error: unknown) => void = () => undefined,
): () => void {
  const timer = setInterval(() => {
    service.expireStaleSessions().catch(onError);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
