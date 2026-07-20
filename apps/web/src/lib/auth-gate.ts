/**
 * Role → area routing, kept pure so it can be unit-tested without a router.
 *
 * The portal serves exactly two audiences: platform admins and doctors.
 * PATIENT (and every hospital/pharmacy role) has no web UX this phase — they
 * are told so explicitly rather than being bounced into an empty shell.
 */
export type Role =
  | 'PATIENT'
  | 'DOCTOR'
  | 'PLATFORM_ADMIN'
  | 'SUPER_ADMIN'
  | 'HOSPITAL_ADMIN'
  | 'PHARMACIST';

export type PortalArea = 'admin' | 'doctor';

const ADMIN_ROLES: readonly Role[] = ['PLATFORM_ADMIN', 'SUPER_ADMIN'];

/** The area a role belongs to, or null when the portal has nothing for them. */
export function areaForRole(role: Role): PortalArea | null {
  if (ADMIN_ROLES.includes(role)) return 'admin';
  if (role === 'DOCTOR') return 'doctor';
  return null;
}

/** Landing route after login. */
export function landingPathForRole(role: Role): string {
  const area = areaForRole(role);
  if (area === 'admin') return '/admin/verification';
  if (area === 'doctor') return '/doctor/today';
  return '/no-access';
}

export type GateDecision =
  | { kind: 'loading' }
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string };

export interface GateInput {
  /** null while the session is still being restored from the refresh cookie. */
  role: Role | null;
  /** True once the initial refresh attempt has settled. */
  ready: boolean;
  /** The area the current route belongs to; null for public routes. */
  required: PortalArea | null;
  pathname: string;
}

/**
 * Single decision function for every guarded route.
 *
 * Rules, in order:
 *  - not ready → render nothing (never flash a login screen at a signed-in user)
 *  - signed out on a guarded route → /login (remembering where they wanted to go)
 *  - signed in with no portal area → /no-access
 *  - signed in but in the wrong area → their own landing page
 *  - signed in and already on /login → their landing page
 */
export function evaluateGate(input: GateInput): GateDecision {
  const { role, ready, required, pathname } = input;

  if (!ready) return { kind: 'loading' };

  if (role === null) {
    // The root is pure routing — a signed-out visitor belongs at /login.
    if (pathname === '/') return { kind: 'redirect', to: '/login' };
    if (required === null) return { kind: 'allow' };
    const next = encodeURIComponent(pathname);
    return { kind: 'redirect', to: `/login?next=${next}` };
  }

  const area = areaForRole(role);

  if (area === null) {
    return pathname === '/no-access'
      ? { kind: 'allow' }
      : { kind: 'redirect', to: '/no-access' };
  }

  // A signed-in user has no business on the login page.
  if (pathname === '/login' || pathname === '/') {
    return { kind: 'redirect', to: landingPathForRole(role) };
  }

  if (required !== null && required !== area) {
    return { kind: 'redirect', to: landingPathForRole(role) };
  }

  return { kind: 'allow' };
}

/**
 * Where to go after a successful login: the route they were originally
 * heading for, but only if their role may actually enter it. An attacker-
 * supplied `next` can never move someone outside their own area, and a
 * protocol-relative or absolute URL is rejected outright (open-redirect).
 */
export function resolvePostLoginPath(role: Role, next: string | null): string {
  const fallback = landingPathForRole(role);
  if (next === null || next === '') return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;

  const area = areaForRole(role);
  if (area === null) return fallback;
  return next.startsWith(`/${area}/`) ? next : fallback;
}
