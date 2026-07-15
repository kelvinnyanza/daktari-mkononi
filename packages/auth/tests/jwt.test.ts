import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  TokenExpiredError,
  TokenInvalidError,
  TokenMalformedError,
  verifyAccessToken,
  verifyRefreshToken,
} from '../src/index.js';
import { applyTestEnv, TEST_ACCESS_SECRET } from './env-fixture.js';

const payload = { sub: 'user-1', role: 'DOCTOR', sessionId: 'sess-1' } as const;
const accessKey = new TextEncoder().encode(TEST_ACCESS_SECRET);

beforeAll(() => {
  applyTestEnv();
});

describe('access tokens', () => {
  it('signs and verifies a round-trip payload', async () => {
    const token = await signAccessToken(payload);
    await expect(verifyAccessToken(token)).resolves.toEqual(payload);
  });

  it('throws TokenExpiredError (code EXPIRED) for an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await signAccessToken(payload, { expiresIn: past });
    const error = await verifyAccessToken(token).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TokenExpiredError);
    expect((error as TokenExpiredError).code).toBe('EXPIRED');
  });

  it('throws TokenInvalidError for a tampered signature', async () => {
    const token = await signAccessToken(payload);
    const [header, body, signature] = token.split('.');
    const flipped = signature!.slice(0, -2) + (signature!.endsWith('AA') ? 'BB' : 'AA');
    const error = await verifyAccessToken(`${header}.${body}.${flipped}`).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TokenInvalidError);
    expect((error as TokenInvalidError).code).toBe('INVALID');
  });

  it('rejects an HS256-signed token even with the correct secret', async () => {
    const hs256Token = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(accessKey);
    const error = await verifyAccessToken(hs256Token).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TokenInvalidError);
  });

  it('throws TokenMalformedError for a well-signed token with the wrong claim shape', async () => {
    const wrongShape = await new SignJWT({ sub: 'user-1', role: 'WIZARD', sessionId: 's' })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(accessKey);
    const error = await verifyAccessToken(wrongShape).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TokenMalformedError);
    expect((error as TokenMalformedError).code).toBe('MALFORMED');
  });

  it('throws TokenMalformedError for garbage input', async () => {
    await expect(verifyAccessToken('not.a.jwt')).rejects.toBeInstanceOf(TokenMalformedError);
  });
});

describe('refresh tokens', () => {
  const refreshPayload = { sub: 'user-1', sessionId: 'sess-1', tokenFamily: 'fam-1' };

  it('signs and verifies a round-trip payload', async () => {
    const token = await signRefreshToken(refreshPayload);
    await expect(verifyRefreshToken(token)).resolves.toEqual(refreshPayload);
  });

  it('access and refresh tokens are not interchangeable (different secrets)', async () => {
    const refreshToken = await signRefreshToken(refreshPayload);
    await expect(verifyAccessToken(refreshToken)).rejects.toBeInstanceOf(TokenInvalidError);
  });
});
