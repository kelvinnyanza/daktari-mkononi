import { createHash, randomUUID } from 'node:crypto';
import { env } from '@daktari/config';
import {
  evaluateRefreshAttempt,
  newTokenFamily,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@daktari/auth';
import type { OtpPurpose, User } from '@daktari/db';
import { generateOtp, hashOtp, hashPassword, verifyOtp, verifyPassword } from '@daktari/encryption';
import type { SmsPort } from '@daktari/notifications';
import type { DoctorRegistrationInput, PatientRegistrationInput } from '@daktari/schemas';
import { ApiError, msg, unauthorized, type BilingualMessage } from '../../lib/errors.js';
import type { DoctorRepoPort, OtpRepoPort, SessionRepoPort, UserRepoPort } from '../../lib/ports.js';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const LOCK_THRESHOLD = 8;
const LOCK_MS = 15 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

const sha256hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const invalidCredentials = (): ApiError =>
  new ApiError(
    401,
    'INVALID_CREDENTIALS',
    msg('Namba ya simu au nenosiri si sahihi', 'Incorrect phone number or password'),
  );

const invalidOtp = (): ApiError =>
  new ApiError(
    400,
    'INVALID_OTP',
    msg('Nambari ya uthibitisho si sahihi au imeisha muda', 'The verification code is invalid or has expired'),
  );

/** Identical for both register outcomes — response must not reveal phone existence. */
const REGISTER_MESSAGE: BilingualMessage = msg(
  'Kama namba hii inafaa, tumetuma SMS yenye maelekezo',
  'If this number is eligible, we have sent an SMS with instructions',
);

const GENERIC_OTP_SENT: BilingualMessage = msg(
  'Kama akaunti ipo, tumetuma nambari ya uthibitisho kwa SMS',
  'If an account exists, we have sent a verification code by SMS',
);

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface UserSummary {
  id: string;
  phone: string;
  fullName: string;
  role: User['role'];
  language: User['language'];
  phoneVerified: boolean;
}

export type LoginResult =
  | ({ status: 'OK'; user: UserSummary } & TokenPair)
  | {
      status: '2FA_REQUIRED';
      /** Intermediate challenge shape; the full 2FA flow lands in a later phase. */
      challenge: { type: 'OTP'; challengeId: string; expiresInSeconds: number };
    };

export interface AuthServiceDeps {
  users: UserRepoPort;
  sessions: SessionRepoPort;
  otps: OtpRepoPort;
  doctors: Pick<DoctorRepoPort, 'findByTmcNumber'>;
  sms: SmsPort;
}

// Constant-work dummy for unknown phones: hashed once per process, verified on
// every unknown-phone login so response timing matches the known-phone path.
let dummyHash: Promise<string> | undefined;
const getDummyHash = (): Promise<string> => (dummyHash ??= hashPassword(randomUUID()));

export class AuthService {
  constructor(
    private readonly deps: AuthServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private otpContext(userId: string, purpose: OtpPurpose): { pepper: string; context: string } {
    return { pepper: env.OTP_PEPPER, context: `${userId}:${purpose}` };
  }

  private async issueOtp(user: User, purpose: OtpPurpose): Promise<void> {
    await this.deps.otps.invalidateAll(user.phone, purpose);
    const code = generateOtp();
    await this.deps.otps.create({
      userId: user.id,
      phone: user.phone,
      codeHash: hashOtp(code, this.otpContext(user.id, purpose)),
      purpose,
      expiresAt: new Date(this.now().getTime() + OTP_TTL_MS),
    });
    const body =
      user.language === 'EN'
        ? `Daktari Mkononi: your verification code is ${code}. It expires in 5 minutes.`
        : `Daktari Mkononi: nambari yako ya uthibitisho ni ${code}. Inaisha baada ya dakika 5.`;
    await this.deps.sms.sendSms(user.phone, body);
  }

  /** Patient self-registration — anti-enumeration contract in registerCore. */
  async register(input: PatientRegistrationInput): Promise<{ message: BilingualMessage }> {
    return this.registerCore(input.phone, input.password, input.language, (passwordHash) =>
      this.deps.users.createPatientUser({
        phone: input.phone,
        passwordHash,
        fullName: input.fullName,
        language: input.language === 'en' ? 'EN' : 'SW',
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
      }),
    );
  }

  /**
   * Doctor self-onboarding: same anti-enumeration contract as patient
   * registration for the PHONE. The TMC registration number is deliberately
   * NOT masked — the TMC register is public information in Tanzania, and the
   * legitimate owner needs an actionable error.
   */
  async registerDoctor(input: DoctorRegistrationInput): Promise<{ message: BilingualMessage }> {
    const tmcTaken = await this.deps.doctors.findByTmcNumber(input.tmcRegistrationNumber);
    if (tmcTaken) {
      throw new ApiError(
        409,
        'TMC_NUMBER_ALREADY_REGISTERED',
        msg(
          'Namba hii ya usajili wa TMC tayari imesajiliwa — wasiliana na msaada kama ni yako',
          'This TMC registration number is already registered — contact support if it is yours',
        ),
      );
    }
    return this.registerCore(input.phone, input.password, input.language, (passwordHash) =>
      this.deps.users.createDoctorUser({
        phone: input.phone,
        passwordHash,
        fullName: input.fullName,
        language: input.language === 'en' ? 'EN' : 'SW',
        tmcRegistrationNumber: input.tmcRegistrationNumber,
        specialty: input.specialty,
        subSpecialty: input.subSpecialty ?? null,
        yearsOfExperience: input.yearsOfExperience,
        consultationFeeTzs: input.consultationFeeTzs,
        bio: input.bio ?? null,
        languages: input.languages,
        region: input.region ?? null,
        acceptsNhif: input.acceptsNhif,
        hospitalId: input.hospitalId ?? null,
      }),
    );
  }

  /**
   * Shared registration core. Anti-enumeration: the response is byte-identical
   * whether or not the phone is already registered, and the password is hashed
   * in both paths so timing does not differ meaningfully. An existing owner
   * gets a heads-up SMS instead of a duplicate account.
   */
  private async registerCore(
    phone: string,
    password: string,
    language: 'sw' | 'en',
    createUser: (passwordHash: string) => Promise<User>,
  ): Promise<{ message: BilingualMessage }> {
    const passwordHash = await hashPassword(password);
    const existing = await this.deps.users.findByPhone(phone);
    if (existing) {
      const body =
        language === 'en'
          ? 'Daktari Mkononi: this number is already registered. If this was not you, ignore this message or reset your password.'
          : 'Daktari Mkononi: namba hii tayari imesajiliwa. Kama si wewe, puuza ujumbe huu au badilisha nenosiri lako.';
      await this.deps.sms.sendSms(phone, body);
      return { message: REGISTER_MESSAGE };
    }
    const user = await createUser(passwordHash);
    await this.issueOtp(user, 'PHONE_VERIFY');
    return { message: REGISTER_MESSAGE };
  }

  /**
   * Registration OTP re-send (Phase 9). Anti-enumeration: the response is
   * byte-identical whether the phone is unknown, already verified, or
   * pending — an OTP is issued only for a matching UNVERIFIED account.
   * issueOtp() invalidates every previous active code for that user+purpose,
   * so exactly one code is redeemable at any time.
   */
  async resendVerificationOtp(phone: string): Promise<{ message: BilingualMessage }> {
    const user = await this.deps.users.findByPhone(phone);
    if (user && user.phoneVerifiedAt === null) {
      await this.issueOtp(user, 'PHONE_VERIFY');
    }
    return { message: GENERIC_OTP_SENT };
  }

  /**
   * Verify an OTP: purpose-scoped, 5-minute expiry, max 5 attempts, single
   * use. Attempts are counted before the code is checked so the cap holds.
   */
  private async verifyOtpInternal(phone: string, purpose: OtpPurpose, code: string): Promise<User> {
    const user = await this.deps.users.findByPhone(phone);
    if (!user) throw invalidOtp();
    const otp = await this.deps.otps.findActive(phone, purpose, this.now());
    if (!otp) throw invalidOtp();
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new ApiError(
        400,
        'OTP_ATTEMPTS_EXCEEDED',
        msg('Umejaribu mara nyingi mno — omba nambari mpya', 'Too many attempts — request a new code'),
      );
    }
    await this.deps.otps.recordAttempt(otp.id);
    if (!verifyOtp(code, otp.codeHash, this.otpContext(user.id, purpose))) {
      throw invalidOtp();
    }
    await this.deps.otps.consume(otp.id);
    return user;
  }

  async verifyOtpCode(
    phone: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<{ message: BilingualMessage }> {
    const user = await this.verifyOtpInternal(phone, purpose, code);
    if (purpose === 'PHONE_VERIFY') {
      await this.deps.users.markPhoneVerified(user.id);
    }
    return {
      message: msg('Uthibitisho umefanikiwa', 'Verification successful'),
    };
  }

  async login(phone: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.deps.users.findByPhone(phone);
    if (!user) {
      // Constant work: verify against a real argon2 hash before failing.
      await verifyPassword(await getDummyHash(), password);
      throw invalidCredentials();
    }
    const now = this.now();
    if (user.lockedUntil !== null && user.lockedUntil > now) {
      throw new ApiError(
        403,
        'ACCOUNT_LOCKED',
        msg(
          'Akaunti imefungwa kwa muda baada ya majaribio mengi — jaribu tena baada ya dakika 15',
          'Account temporarily locked after too many attempts — try again in 15 minutes',
        ),
      );
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      const failures = user.failedLoginCount + 1;
      const lockedUntil =
        failures >= LOCK_THRESHOLD ? new Date(now.getTime() + LOCK_MS) : null;
      await this.deps.users.recordFailedLogin(user.id, lockedUntil);
      throw invalidCredentials();
    }
    if (user.phoneVerifiedAt === null) {
      throw new ApiError(
        403,
        'PHONE_NOT_VERIFIED',
        msg('Thibitisha namba yako ya simu kwanza', 'Verify your phone number first'),
      );
    }
    if (user.failedLoginCount > 0 || user.lockedUntil !== null) {
      await this.deps.users.resetLoginFailures(user.id);
    }
    if (user.twoFactorEnabled) {
      return {
        status: '2FA_REQUIRED',
        challenge: { type: 'OTP', challengeId: randomUUID(), expiresInSeconds: 300 },
      };
    }
    const tokens = await this.createSession(user, meta);
    return { status: 'OK', user: this.toSummary(user), ...tokens };
  }

  private async createSession(user: User, meta: RequestMeta): Promise<TokenPair> {
    const sessionId = randomUUID();
    const tokenFamily = newTokenFamily();
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({ sub: user.id, role: user.role, sessionId }),
      signRefreshToken({ sub: user.id, sessionId, tokenFamily }),
    ]);
    await this.deps.sessions.create({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: sha256hex(refreshToken),
      tokenFamily,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS),
    });
    return { accessToken, refreshToken };
  }

  /**
   * Refresh rotation with family reuse detection: replaying an old (already
   * rotated) refresh token revokes the whole session — see CLAUDE.md.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = await verifyRefreshToken(refreshToken);
    const session = await this.deps.sessions.findById(payload.sessionId);
    if (!session || session.expiresAt <= this.now()) {
      throw unauthorized('TOKEN_INVALID', msg('Kikao si halali', 'Invalid session'));
    }
    const decision = evaluateRefreshAttempt({
      presentedTokenHash: sha256hex(refreshToken),
      activeTokenHash: session.refreshTokenHash,
      familyRevokedAt: session.revokedAt,
    });
    if (decision.action === 'REVOKE_FAMILY') {
      if (decision.reason === 'REUSE_DETECTED') {
        await this.deps.sessions.revoke(session.id, 'REFRESH_REUSE_DETECTED');
      }
      throw unauthorized(
        'SESSION_REVOKED',
        msg('Kikao kimefungwa kwa usalama — ingia tena', 'Session revoked for security — sign in again'),
      );
    }
    const user = await this.deps.users.findById(payload.sub);
    if (!user) {
      throw unauthorized('TOKEN_INVALID', msg('Kikao si halali', 'Invalid session'));
    }
    const [accessToken, nextRefreshToken] = await Promise.all([
      signAccessToken({ sub: user.id, role: user.role, sessionId: session.id }),
      signRefreshToken({ sub: user.id, sessionId: session.id, tokenFamily: payload.tokenFamily }),
    ]);
    await this.deps.sessions.rotateRefreshHash(session.id, sha256hex(nextRefreshToken));
    return { accessToken, refreshToken: nextRefreshToken };
  }

  async logout(sessionId: string): Promise<void> {
    await this.deps.sessions.revoke(sessionId, 'LOGOUT');
  }

  /** Anti-enumeration: same response whether or not the phone has an account. */
  async forgotPassword(phone: string): Promise<{ message: BilingualMessage }> {
    const user = await this.deps.users.findByPhone(phone);
    if (user) {
      await this.issueOtp(user, 'PASSWORD_RESET');
    }
    return { message: GENERIC_OTP_SENT };
  }

  /** Password reset consumes the OTP and revokes every session for the user. */
  async resetPassword(
    phone: string,
    code: string,
    newPassword: string,
  ): Promise<{ message: BilingualMessage }> {
    const user = await this.verifyOtpInternal(phone, 'PASSWORD_RESET', code);
    const passwordHash = await hashPassword(newPassword);
    await this.deps.users.updatePassword(user.id, passwordHash);
    await this.deps.users.resetLoginFailures(user.id);
    await this.deps.sessions.revokeAllForUser(user.id, 'PASSWORD_RESET');
    return {
      message: msg('Nenosiri limebadilishwa — ingia tena', 'Password changed — sign in again'),
    };
  }

  async me(userId: string): Promise<Record<string, unknown>> {
    const user = await this.deps.users.findByIdWithProfiles(userId);
    if (!user) {
      throw unauthorized('TOKEN_INVALID', msg('Kikao si halali', 'Invalid session'));
    }
    return {
      user: this.toSummary(user),
      profile: user.patient
        ? {
            type: 'PATIENT',
            dateOfBirth: user.patient.dateOfBirth,
            gender: user.patient.gender,
            region: user.patient.region,
            district: user.patient.district,
          }
        : user.doctor
          ? {
              type: 'DOCTOR',
              specialty: user.doctor.specialty,
              verificationStatus: user.doctor.verificationStatus,
              consultationFeeTzs: user.doctor.consultationFeeTzs,
            }
          : null,
    };
  }

  private toSummary(user: User): UserSummary {
    return {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      language: user.language,
      phoneVerified: user.phoneVerifiedAt !== null,
    };
  }
}
