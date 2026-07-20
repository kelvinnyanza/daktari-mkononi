import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  forgotPasswordSchema,
  loginSchema,
  patientRegistrationSchema,
  refreshTokenSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from '@daktari/schemas';
import { env } from '@daktari/config';
import { ApiError, msg } from '../../lib/errors.js';
import type { SessionRepoPort } from '../../lib/ports.js';
import { makeAuthenticate } from '../../middleware/authenticate.js';
import type { AuthService, RequestMeta } from './auth.service.js';

const meta = (request: FastifyRequest): RequestMeta => ({
  ipAddress: request.ip,
  userAgent: request.headers['user-agent'] ?? null,
});

/**
 * Browser clients never receive the refresh token in a JS-readable place: it
 * is delivered as an httpOnly cookie scoped to the refresh endpoint only.
 * Mobile clients keep the existing body delivery (SecureStore).
 */
const REFRESH_COOKIE = 'daktari_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
const REFRESH_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // matches SESSION_TTL_MS

/** A web client identifies itself by header or an explicit body flag. */
const isWebClient = (request: FastifyRequest): boolean => {
  if (request.headers['x-daktari-client'] === 'web') return true;
  const body = request.body as { client?: unknown } | null;
  return body?.client === 'web';
};

function setRefreshCookie(reply: FastifyReply, refreshToken: string): void {
  void reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true, // never readable by JS — XSS cannot exfiltrate it
    secure: env.NODE_ENV === 'production', // plain http on the LAN in dev
    sameSite: 'strict', // the CSRF defense (see CLAUDE.md)
    path: REFRESH_COOKIE_PATH, // sent to /refresh and nowhere else
    maxAge: REFRESH_COOKIE_MAX_AGE_S,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  void reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

/** Rate-limit key by phone when the body carries one, falling back to IP. */
const phoneKey = (request: FastifyRequest): string => {
  const body = request.body as { phone?: unknown; phoneNumber?: unknown } | null;
  const phone =
    typeof body?.phone === 'string'
      ? body.phone
      : typeof body?.phoneNumber === 'string'
        ? body.phoneNumber
        : null;
  return phone !== null ? `phone:${phone}` : `ip:${request.ip}`;
};

export function buildAuthRoutes(
  service: AuthService,
  sessions: SessionRepoPort,
  now: () => Date = () => new Date(),
): FastifyPluginAsync {
  const authenticate = makeAuthenticate(sessions, now);

  return async (app) => {
    app.post(
      '/register',
      { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, // per IP
      async (request, reply) => {
        const input = patientRegistrationSchema.parse(request.body);
        const result = await service.register(input);
        // 202 with an identical body whether or not the phone already exists.
        return reply.code(202).send(result);
      },
    );

    app.post(
      '/verify-otp',
      {
        config: {
          rateLimit: { max: 10, timeWindow: '15 minutes', keyGenerator: phoneKey },
        },
      },
      async (request) => {
        const input = verifyOtpSchema.parse(request.body);
        return service.verifyOtpCode(input.phone, input.purpose, input.code);
      },
    );

    app.post(
      '/resend-otp',
      {
        config: {
          rateLimit: { max: 3, timeWindow: '1 hour', keyGenerator: phoneKey },
        },
      },
      async (request, reply) => {
        const input = resendOtpSchema.parse(request.body);
        const result = await service.resendVerificationOtp(input.phoneNumber);
        // 202 with an identical body whether or not the phone exists.
        return reply.code(202).send(result);
      },
    );

    app.post(
      '/login',
      {
        config: {
          rateLimit: { max: 10, timeWindow: '15 minutes', keyGenerator: phoneKey },
        },
      },
      async (request, reply) => {
        const input = loginSchema.parse(request.body);
        const result = await service.login(input.phone, input.password, meta(request));
        // Web: refresh token goes to an httpOnly cookie, never the body.
        if (result.status === 'OK' && isWebClient(request)) {
          setRefreshCookie(reply, result.refreshToken);
          const { refreshToken: _omitted, ...webResult } = result;
          return webResult;
        }
        return result;
      },
    );

    app.post('/refresh', async (request, reply) => {
      // Web sends no body: the token rides in the httpOnly cookie.
      const cookieToken = request.cookies[REFRESH_COOKIE];
      const hasCookie = cookieToken !== undefined && cookieToken !== '';

      // Second CSRF layer. `SameSite=Strict` already stops a cross-site page
      // from getting the browser to attach this cookie, but that is one
      // browser-enforced control on one attribute. Requiring a custom header
      // the request could only have set deliberately means a plain cross-site
      // form post — the shape SameSite exists to block — cannot spend the
      // cookie even if the attribute is ever weakened or a browser bug lets a
      // request through. A cookie without the header is not a browser we want
      // to serve, so it is rejected outright rather than falling back to the
      // body: silently accepting it would restore exactly the hole this
      // closes.
      if (hasCookie && !isWebClient(request)) {
        throw new ApiError(
          401,
          'WEB_CLIENT_HEADER_REQUIRED',
          msg(
            'Ombi si halali kwa kivinjari hiki',
            'Cookie-based refresh requires the web client header',
          ),
        );
      }

      const fromCookie = hasCookie;
      const refreshToken = fromCookie
        ? cookieToken
        : refreshTokenSchema.parse(request.body).refreshToken;

      let pair;
      try {
        pair = await service.refresh(refreshToken);
      } catch (error) {
        // A dead/replayed cookie must not linger in the browser.
        if (fromCookie) clearRefreshCookie(reply);
        throw error;
      }
      if (fromCookie) {
        // Rotation still enforced — the new token replaces the cookie.
        setRefreshCookie(reply, pair.refreshToken);
        return { accessToken: pair.accessToken };
      }
      return pair;
    });

    app.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
      // authenticate guarantees request.auth is set
      await service.logout(request.auth!.sessionId);
      clearRefreshCookie(reply);
      return { message: msg('Umetoka salama', 'Signed out') };
    });

    app.post(
      '/forgot-password',
      {
        config: {
          rateLimit: { max: 3, timeWindow: '1 hour', keyGenerator: phoneKey },
        },
      },
      async (request) => {
        const input = forgotPasswordSchema.parse(request.body);
        return service.forgotPassword(input.phone);
      },
    );

    app.post('/reset-password', async (request) => {
      const input = resetPasswordSchema.parse(request.body);
      return service.resetPassword(input.phone, input.code, input.newPassword);
    });

    app.get(
      '/me',
      { preHandler: [authenticate], config: { audit: 'phi-read' } },
      async (request) => service.me(request.auth!.userId),
    );
  };
}
