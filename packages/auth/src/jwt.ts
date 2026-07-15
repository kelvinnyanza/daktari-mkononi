/**
 * JWT signing/verification (HS512 only).
 *
 * Verification is strict on three axes, each with its own error type so the
 * API layer can map them to distinct responses:
 *  - EXPIRED   → token was valid but is past exp (client should refresh)
 *  - INVALID   → bad signature or disallowed algorithm (reject, maybe alert)
 *  - MALFORMED → not a JWT at all, or claims don't match our payload schema
 */
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { env } from '@daktari/config';
import { ROLES } from './permissions.js';

const JWT_ALG = 'HS512';

export type TokenErrorCode = 'EXPIRED' | 'INVALID' | 'MALFORMED';

/** Base class for all token verification failures. */
export class TokenError extends Error {
  constructor(
    readonly code: TokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

/** Structurally valid, correctly signed, but past its expiry. */
export class TokenExpiredError extends TokenError {
  constructor() {
    super('EXPIRED', 'Token has expired');
    this.name = 'TokenExpiredError';
  }
}

/** Signature does not verify, or the algorithm is not HS512. */
export class TokenInvalidError extends TokenError {
  constructor() {
    super('INVALID', 'Token signature or algorithm is invalid');
    this.name = 'TokenInvalidError';
  }
}

/** Not parseable as a JWT, or the claims don't match the expected shape. */
export class TokenMalformedError extends TokenError {
  constructor(message = 'Token is malformed') {
    super('MALFORMED', message);
    this.name = 'TokenMalformedError';
  }
}

export const accessTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(ROLES),
  sessionId: z.string().min(1),
});
export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;

export const refreshTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  sessionId: z.string().min(1),
  tokenFamily: z.string().min(1),
});
export type RefreshTokenPayload = z.infer<typeof refreshTokenPayloadSchema>;

export interface SignOptions {
  /** Override the env-configured expiry (jose timespan string, or epoch seconds). */
  expiresIn?: string | number;
}

function accessSecret(): Uint8Array {
  return new TextEncoder().encode(env.JWT_ACCESS_SECRET);
}

function refreshSecret(): Uint8Array {
  return new TextEncoder().encode(env.JWT_REFRESH_SECRET);
}

function sign(
  payload: Record<string, string>,
  secret: Uint8Array,
  expiresIn: string | number,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

function mapJoseError(error: unknown): TokenError {
  if (error instanceof joseErrors.JWTExpired) {
    return new TokenExpiredError();
  }
  if (
    error instanceof joseErrors.JWSSignatureVerificationFailed ||
    error instanceof joseErrors.JOSEAlgNotAllowed
  ) {
    return new TokenInvalidError();
  }
  return new TokenMalformedError();
}

async function verify<T>(token: string, secret: Uint8Array, schema: z.ZodType<T>): Promise<T> {
  let claims: unknown;
  try {
    // Explicit algorithm allowlist — a token signed HS256 (or alg:none) is
    // rejected before the signature is even checked.
    const result = await jwtVerify(token, secret, { algorithms: [JWT_ALG] });
    claims = result.payload;
  } catch (error) {
    throw mapJoseError(error);
  }
  const parsed = schema.safeParse(claims);
  if (!parsed.success) {
    throw new TokenMalformedError('Token claims do not match the expected shape');
  }
  return parsed.data;
}

/** Sign an access token (HS512, default expiry JWT_ACCESS_EXPIRY, 15m). */
export function signAccessToken(
  payload: AccessTokenPayload,
  options?: SignOptions,
): Promise<string> {
  return sign({ ...payload }, accessSecret(), options?.expiresIn ?? env.JWT_ACCESS_EXPIRY);
}

/**
 * Verify an access token and its payload shape.
 * @throws TokenExpiredError | TokenInvalidError | TokenMalformedError
 */
export function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  return verify(token, accessSecret(), accessTokenPayloadSchema);
}

/** Sign a refresh token (HS512, default expiry JWT_REFRESH_EXPIRY, 30d). */
export function signRefreshToken(
  payload: RefreshTokenPayload,
  options?: SignOptions,
): Promise<string> {
  return sign({ ...payload }, refreshSecret(), options?.expiresIn ?? env.JWT_REFRESH_EXPIRY);
}

/**
 * Verify a refresh token and its payload shape.
 * @throws TokenExpiredError | TokenInvalidError | TokenMalformedError
 */
export function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  return verify(token, refreshSecret(), refreshTokenPayloadSchema);
}
