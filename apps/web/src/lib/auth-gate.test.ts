import { describe, expect, it } from 'vitest';
import {
  areaForRole,
  evaluateGate,
  landingPathForRole,
  resolvePostLoginPath,
  type Role,
} from './auth-gate';

describe('areaForRole', () => {
  it('maps both admin roles to the admin area', () => {
    expect(areaForRole('PLATFORM_ADMIN')).toBe('admin');
    expect(areaForRole('SUPER_ADMIN')).toBe('admin');
  });

  it('maps DOCTOR to the doctor area', () => {
    expect(areaForRole('DOCTOR')).toBe('doctor');
  });

  it.each<Role>(['PATIENT', 'HOSPITAL_ADMIN', 'PHARMACIST'])(
    'gives %s no portal area (out of scope this phase)',
    (role) => {
      expect(areaForRole(role)).toBeNull();
      expect(landingPathForRole(role)).toBe('/no-access');
    },
  );
});

describe('evaluateGate', () => {
  it('renders nothing until the session restore has settled', () => {
    // Otherwise a signed-in operator sees the login form flash on every reload.
    expect(
      evaluateGate({ role: null, ready: false, required: 'admin', pathname: '/admin/payments' }),
    ).toEqual({ kind: 'loading' });
  });

  it('sends a signed-out visitor to /login, remembering the destination', () => {
    expect(
      evaluateGate({ role: null, ready: true, required: 'admin', pathname: '/admin/payments' }),
    ).toEqual({ kind: 'redirect', to: '/login?next=%2Fadmin%2Fpayments' });
  });

  it('lets a signed-out visitor stay on a public route', () => {
    expect(
      evaluateGate({ role: null, ready: true, required: null, pathname: '/login' }),
    ).toEqual({ kind: 'allow' });
  });

  it('routes the bare root to /login when signed out', () => {
    expect(evaluateGate({ role: null, ready: true, required: null, pathname: '/' })).toEqual({
      kind: 'redirect',
      to: '/login',
    });
  });

  it('allows an admin into the admin area', () => {
    expect(
      evaluateGate({
        role: 'PLATFORM_ADMIN',
        ready: true,
        required: 'admin',
        pathname: '/admin/verification',
      }),
    ).toEqual({ kind: 'allow' });
  });

  it('bounces a doctor out of the admin area to their own landing page', () => {
    expect(
      evaluateGate({
        role: 'DOCTOR',
        ready: true,
        required: 'admin',
        pathname: '/admin/payments',
      }),
    ).toEqual({ kind: 'redirect', to: '/doctor/today' });
  });

  it('bounces an admin out of the doctor area', () => {
    expect(
      evaluateGate({
        role: 'SUPER_ADMIN',
        ready: true,
        required: 'doctor',
        pathname: '/doctor/today',
      }),
    ).toEqual({ kind: 'redirect', to: '/admin/verification' });
  });

  it('sends a patient to /no-access and lets them stay there', () => {
    expect(
      evaluateGate({ role: 'PATIENT', ready: true, required: 'doctor', pathname: '/doctor/today' }),
    ).toEqual({ kind: 'redirect', to: '/no-access' });
    expect(
      evaluateGate({ role: 'PATIENT', ready: true, required: null, pathname: '/no-access' }),
    ).toEqual({ kind: 'allow' });
  });

  it('keeps a signed-in user off the login page', () => {
    expect(
      evaluateGate({ role: 'DOCTOR', ready: true, required: null, pathname: '/login' }),
    ).toEqual({ kind: 'redirect', to: '/doctor/today' });
  });
});

describe('resolvePostLoginPath', () => {
  it('honours a `next` inside the user’s own area', () => {
    expect(resolvePostLoginPath('PLATFORM_ADMIN', '/admin/payments')).toBe('/admin/payments');
  });

  it('ignores a `next` that points into another area', () => {
    // A crafted link must never move someone outside their permissions.
    expect(resolvePostLoginPath('DOCTOR', '/admin/payments')).toBe('/doctor/today');
  });

  it('rejects absolute and protocol-relative URLs (open redirect)', () => {
    expect(resolvePostLoginPath('DOCTOR', 'https://evil.example/x')).toBe('/doctor/today');
    expect(resolvePostLoginPath('DOCTOR', '//evil.example/x')).toBe('/doctor/today');
  });

  it('falls back to the landing page when `next` is absent', () => {
    expect(resolvePostLoginPath('SUPER_ADMIN', null)).toBe('/admin/verification');
    expect(resolvePostLoginPath('SUPER_ADMIN', '')).toBe('/admin/verification');
  });
});
