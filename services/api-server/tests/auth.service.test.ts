import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@daktari/encryption';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { ApiError } from '../src/lib/errors.js';

const PASSWORD = 'Siri-Kali-1!';
let passwordHash: string;

const registration = {
  phone: '+255754111222',
  password: PASSWORD,
  fullName: 'Fatuma Kombo',
  dateOfBirth: new Date('1992-11-05T00:00:00.000Z'),
  gender: 'FEMALE' as const,
  language: 'sw' as const,
};

const meta = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

let deps: FakeDeps;
let clock: { now: Date };
let service: AuthService;

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error(`expected ApiError ${code}, but the call succeeded`);
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
  return error as ApiError;
}

beforeAll(async () => {
  applyTestEnv();
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  deps = makeFakeDeps();
  clock = { now: new Date('2026-07-15T09:00:00.000Z') };
  service = new AuthService(deps, () => clock.now);
});

describe('register', () => {
  it('creates an unverified patient user and sends a PHONE_VERIFY OTP', async () => {
    const result = await service.register(registration);
    expect(result.message.sw).toBeTruthy();

    const user = [...deps.state.users.values()][0]!;
    expect(user.role).toBe('PATIENT');
    expect(user.phoneVerifiedAt).toBeNull();
    expect(deps.state.patients.size).toBe(1);

    const otp = [...deps.state.otps.values()][0]!;
    expect(otp.purpose).toBe('PHONE_VERIFY');
    expect(deps.sms.lastCode()).toMatch(/^\d{6}$/);
    expect(deps.sms.sent[0]!.to).toBe(registration.phone);
  });

  it('is enumeration-resistant: identical response for an existing phone, no duplicate user', async () => {
    const fresh = await service.register(registration);
    const repeat = await service.register(registration);

    expect(repeat).toEqual(fresh); // byte-identical response shape and content
    expect(deps.state.users.size).toBe(1);
    const lastSms = deps.sms.sent.at(-1)!;
    expect(lastSms.body).toMatch(/tayari imesajiliwa/); // "already registered" heads-up
    expect(lastSms.body).not.toMatch(/\d{6}/); // no OTP for the impostor
  });
});

describe('resend-otp (Phase 9)', () => {
  it('is enumeration-resistant: byte-identical response for unknown, verified, and unverified phones', async () => {
    await service.register(registration); // unverified account exists
    deps.seedUser({ phone: '+255754333444' }); // verified account

    const unverified = await service.resendVerificationOtp(registration.phone);
    const verified = await service.resendVerificationOtp('+255754333444');
    const unknown = await service.resendVerificationOtp('+255754999000');

    expect(verified).toEqual(unverified); // byte-identical bodies
    expect(unknown).toEqual(unverified);
  });

  it('issues an OTP only for a matching unverified account', async () => {
    await service.register(registration);
    const smsBefore = deps.sms.sent.length;

    await service.resendVerificationOtp('+255754999000'); // unknown
    deps.seedUser({ phone: '+255754333444' });
    await service.resendVerificationOtp('+255754333444'); // already verified
    expect(deps.sms.sent.length).toBe(smsBefore); // no OTP for either

    await service.resendVerificationOtp(registration.phone); // unverified
    expect(deps.sms.sent.length).toBe(smsBefore + 1);
    expect(deps.sms.lastCode()).toMatch(/^\d{6}$/);
  });

  it('replaces the previous code: old rejected, new accepted (single active code)', async () => {
    await service.register(registration);
    const oldCode = deps.sms.lastCode();

    await service.resendVerificationOtp(registration.phone);
    const newCode = deps.sms.lastCode();
    expect(newCode).not.toBe(oldCode);

    // The old code is invalidated by the resend…
    await expectApiError(
      service.verifyOtpCode(registration.phone, 'PHONE_VERIFY', oldCode),
      'INVALID_OTP',
    );
    // …and the new one verifies the phone.
    await service.verifyOtpCode(registration.phone, 'PHONE_VERIFY', newCode);
    expect([...deps.state.users.values()][0]!.phoneVerifiedAt).not.toBeNull();
  });
});

describe('verify-otp', () => {
  it('marks the phone verified, consumes the code, and rejects reuse (single use)', async () => {
    await service.register(registration);
    const code = deps.sms.lastCode();

    await service.verifyOtpCode(registration.phone, 'PHONE_VERIFY', code);
    const user = [...deps.state.users.values()][0]!;
    expect(user.phoneVerifiedAt).not.toBeNull();

    await expectApiError(
      service.verifyOtpCode(registration.phone, 'PHONE_VERIFY', code),
      'INVALID_OTP',
    );
  });

  it('rejects a wrong code and counts the attempt', async () => {
    await service.register(registration);
    await expectApiError(
      service.verifyOtpCode(registration.phone, 'PHONE_VERIFY', '000000'),
      'INVALID_OTP',
    );
    expect([...deps.state.otps.values()][0]!.attempts).toBe(1);
  });

  it('caps attempts at 5 — the correct code is refused afterwards', async () => {
    await service.register(registration);
    const code = deps.sms.lastCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectApiError(
        service.verifyOtpCode(registration.phone, 'PHONE_VERIFY', '000000'),
        'INVALID_OTP',
      );
    }
    await expectApiError(
      service.verifyOtpCode(registration.phone, 'PHONE_VERIFY', code),
      'OTP_ATTEMPTS_EXCEEDED',
    );
  });

  it('rejects an expired code (5-minute TTL)', async () => {
    await service.register(registration);
    const code = deps.sms.lastCode();
    clock.now = new Date(clock.now.getTime() + 6 * 60_000);
    await expectApiError(
      service.verifyOtpCode(registration.phone, 'PHONE_VERIFY', code),
      'INVALID_OTP',
    );
  });

  it('is purpose-scoped: a PHONE_VERIFY code is useless for PASSWORD_RESET', async () => {
    await service.register(registration);
    const code = deps.sms.lastCode();
    await expectApiError(
      service.verifyOtpCode(registration.phone, 'PASSWORD_RESET', code),
      'INVALID_OTP',
    );
  });
});

describe('login', () => {
  it('returns a token pair and creates a session', async () => {
    deps.seedUser({ phone: '+255754000001', passwordHash });
    const result = await service.login('+255754000001', PASSWORD, meta);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') throw new Error('unreachable');
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.user.phoneVerified).toBe(true);
    const session = [...deps.state.sessions.values()][0]!;
    expect(session.tokenFamily).toBeTruthy();
    expect(session.ipAddress).toBe('127.0.0.1');
  });

  it('answers unknown phone and wrong password with the same error (anti-enumeration)', async () => {
    deps.seedUser({ phone: '+255754000001', passwordHash });
    const unknown = await expectApiError(
      service.login('+255754999999', PASSWORD, meta),
      'INVALID_CREDENTIALS',
    );
    const wrongPassword = await expectApiError(
      service.login('+255754000001', 'Wrong-Pass-1', meta),
      'INVALID_CREDENTIALS',
    );
    expect(unknown.statusCode).toBe(wrongPassword.statusCode);
    expect(unknown.userMessage).toEqual(wrongPassword.userMessage);
  });

  it('refuses login for an unverified phone — only with the correct password', async () => {
    deps.seedUser({ phone: '+255754000001', passwordHash, phoneVerifiedAt: null });
    const error = await expectApiError(
      service.login('+255754000001', PASSWORD, meta),
      'PHONE_NOT_VERIFIED',
    );
    expect(error.statusCode).toBe(403);
  });

  it('does not reveal unverified accounts: wrong password answers exactly like an unknown phone', async () => {
    deps.seedUser({ phone: '+255754000001', passwordHash, phoneVerifiedAt: null });
    const unknownPhone = await expectApiError(
      service.login('+255754999999', 'Wrong-Pass-1', meta),
      'INVALID_CREDENTIALS',
    );
    const unverifiedWrongPassword = await expectApiError(
      service.login('+255754000001', 'Wrong-Pass-1', meta),
      'INVALID_CREDENTIALS',
    );
    // Everything an attacker can observe must match the unknown-phone response.
    expect(unverifiedWrongPassword.statusCode).toBe(unknownPhone.statusCode);
    expect(unverifiedWrongPassword.code).toBe(unknownPhone.code);
    expect(unverifiedWrongPassword.userMessage).toEqual(unknownPhone.userMessage);
    expect(unverifiedWrongPassword.details).toEqual(unknownPhone.details);
  });

  it('counts failed logins toward lockout even when the account is unverified', async () => {
    const user = deps.seedUser({ phone: '+255754000001', passwordHash, phoneVerifiedAt: null });
    await expectApiError(
      service.login('+255754000001', 'Wrong-Pass-1', meta),
      'INVALID_CREDENTIALS',
    );
    expect(deps.state.users.get(user.id)!.failedLoginCount).toBe(1);
    await expectApiError(
      service.login('+255754000001', 'Wrong-Pass-1', meta),
      'INVALID_CREDENTIALS',
    );
    expect(deps.state.users.get(user.id)!.failedLoginCount).toBe(2);
  });

  it('locks the account after 8 failures for 15 minutes, then recovers', async () => {
    const user = deps.seedUser({ phone: '+255754000001', passwordHash });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expectApiError(
        service.login('+255754000001', 'Wrong-Pass-1', meta),
        'INVALID_CREDENTIALS',
      );
    }
    // Locked: even the correct password is refused.
    await expectApiError(service.login('+255754000001', PASSWORD, meta), 'ACCOUNT_LOCKED');
    expect(deps.state.users.get(user.id)!.lockedUntil).not.toBeNull();

    // 16 minutes later the lock has expired and login succeeds + counters reset.
    clock.now = new Date(clock.now.getTime() + 16 * 60_000);
    const result = await service.login('+255754000001', PASSWORD, meta);
    expect(result.status).toBe('OK');
    expect(deps.state.users.get(user.id)!.failedLoginCount).toBe(0);
    expect(deps.state.users.get(user.id)!.lockedUntil).toBeNull();
  });

  it('returns a 2FA challenge (and no session) when twoFactorEnabled', async () => {
    deps.seedUser({ phone: '+255754000001', passwordHash, twoFactorEnabled: true });
    const result = await service.login('+255754000001', PASSWORD, meta);
    expect(result.status).toBe('2FA_REQUIRED');
    if (result.status !== '2FA_REQUIRED') throw new Error('unreachable');
    expect(result.challenge.type).toBe('OTP');
    expect(result.challenge.expiresInSeconds).toBe(300);
    expect(deps.state.sessions.size).toBe(0);
  });
});

describe('refresh rotation + family reuse detection', () => {
  async function loginOk(): Promise<{ accessToken: string; refreshToken: string }> {
    deps.seedUser({ phone: '+255754000001', passwordHash });
    const result = await service.login('+255754000001', PASSWORD, meta);
    if (result.status !== 'OK') throw new Error('expected OK login');
    return result;
  }

  it('ROTATE: a fresh refresh token yields a new pair and updates the session hash', async () => {
    const login = await loginOk();
    const sessionBefore = [...deps.state.sessions.values()][0]!;
    const rotated = await service.refresh(login.refreshToken);
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    const sessionAfter = deps.state.sessions.get(sessionBefore.id)!;
    expect(sessionAfter.refreshTokenHash).not.toBe(sessionBefore.refreshTokenHash);
    expect(sessionAfter.revokedAt).toBeNull();
  });

  it('REVOKE_FAMILY: replaying a rotated token revokes the session; the new token dies too', async () => {
    const login = await loginOk();
    const rotated = await service.refresh(login.refreshToken);

    // Replay the OLD token — reuse detected, whole family revoked.
    await expectApiError(service.refresh(login.refreshToken), 'SESSION_REVOKED');
    const session = [...deps.state.sessions.values()][0]!;
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokedReason).toBe('REFRESH_REUSE_DETECTED');

    // The legitimately rotated token is now dead as well — attacker and victim both out.
    await expectApiError(service.refresh(rotated.refreshToken), 'SESSION_REVOKED');
  });

  it('logout revokes the session so refresh stops working', async () => {
    const login = await loginOk();
    const session = [...deps.state.sessions.values()][0]!;
    await service.logout(session.id);
    await expectApiError(service.refresh(login.refreshToken), 'SESSION_REVOKED');
  });
});

describe('password reset', () => {
  it('forgot-password responds identically for unknown phones and sends no SMS', async () => {
    deps.seedUser({ phone: '+255754000001', passwordHash });
    const known = await service.forgotPassword('+255754000001');
    const smsAfterKnown = deps.sms.sent.length;
    const unknown = await service.forgotPassword('+255754999999');
    expect(unknown).toEqual(known);
    expect(deps.sms.sent.length).toBe(smsAfterKnown); // nothing sent for unknown
  });

  it('reset consumes the OTP, changes the password, and revokes every session', async () => {
    deps.seedUser({ phone: '+255754000001', passwordHash });
    const first = await service.login('+255754000001', PASSWORD, meta);
    if (first.status !== 'OK') throw new Error('expected OK login');

    await service.forgotPassword('+255754000001');
    const code = deps.sms.lastCode();
    await service.resetPassword('+255754000001', code, 'Mpya-Kali-9!');

    // All sessions revoked → refresh with the pre-reset token fails.
    await expectApiError(service.refresh(first.refreshToken), 'SESSION_REVOKED');
    // Old password no longer works; the new one does.
    await expectApiError(service.login('+255754000001', PASSWORD, meta), 'INVALID_CREDENTIALS');
    const result = await service.login('+255754000001', 'Mpya-Kali-9!', meta);
    expect(result.status).toBe('OK');
  });
});
