/**
 * Role-based permission matrix for Phases 3–4.
 *
 * Grants may be exact permissions, a namespace wildcard ("payment:*"),
 * or the global wildcard ("*").
 *
 * Matrix overview (✓ = granted, ns:* = whole namespace):
 *
 * | Permission                    | PATIENT | DOCTOR | HOSPITAL_ADMIN | PHARMACY_STAFF | PLATFORM_ADMIN | SUPER_ADMIN |
 * |-------------------------------|---------|--------|----------------|----------------|----------------|-------------|
 * | patient:read:own / update:own |   ✓     |        |                |                |  patient:*     |     *       |
 * | patient:read:assigned         |         |   ✓    |                |                |  patient:*     |     *       |
 * | patient:read:any              |         |        |                |                |  patient:*     |     *       |
 * | doctor:update:own             |         |   ✓    |                |                |  doctor:*      |     *       |
 * | doctor:read:any               |   ✓     |   ✓    |      ✓         |                |  doctor:*      |     *       |
 * | doctor:verify                 |         |        |                |                |  doctor:*      |     *       |
 * | appointment:create/read:own…  |   ✓     | :assigned |  :hospital  |                |  appointment:* |     *       |
 * | consultation:conduct          |         |   ✓    |                |                |  consultation:*|     *       |
 * | prescription:create           |         |   ✓    |                |                |  prescription:*|     *       |
 * | prescription:dispense         |         |        |                |       ✓        |  prescription:*|     *       |
 * | medical-record:read:own       |   ✓     |        |                |                | medical-record:*|    *       |
 * | medical-record:read:assigned  |         |   ✓    |                |                | medical-record:*|    *       |
 * | vitals:record:own             |   ✓     |        |                |                |  vitals:*      |     *       |
 * | vitals:read:assigned          |         |   ✓    |                |                |  vitals:*      |     *       |
 * | payment:initiate              |   ✓     |        |                |                |  payment:*     |     *       |
 * | payment:refund                |         |        |                |                |  payment:*     |     *       |
 * | delivery:manage               |         |        |                |       ✓        |  delivery:*    |     *       |
 * | hospital:manage:own           |         |        |      ✓         |                |  hospital:*    |     *       |
 * | user:manage / audit:read      |         |        |                |                |      ✓         |     *       |
 * | admin:*                       |         |        |                |                |      ✓         |     *       |
 * | system:* (destructive ops)    |         |        |                |                |     ✗ NO       |     *       |
 */

export const ROLES = [
  'PATIENT',
  'DOCTOR',
  'HOSPITAL_ADMIN',
  'PHARMACY_STAFF',
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

/** Every concrete permission the platform checks against. */
export const ALL_PERMISSIONS = [
  'patient:read:own',
  'patient:update:own',
  'patient:read:assigned',
  'patient:read:any',
  'doctor:read:any',
  'doctor:update:own',
  'doctor:verify',
  'appointment:create',
  'appointment:read:own',
  'appointment:read:assigned',
  'appointment:read:hospital',
  'appointment:cancel:own',
  'consultation:conduct',
  'consultation:read:own',
  'consultation:read:assigned',
  'screening:use',
  'prescription:create',
  'prescription:read:own',
  'prescription:read:assigned',
  'prescription:dispense',
  'medical-record:create',
  'medical-record:read:own',
  'medical-record:read:assigned',
  'vitals:record:own',
  'vitals:read:own',
  'vitals:read:assigned',
  'payment:initiate',
  'payment:read:own',
  'payment:refund',
  'delivery:manage',
  'delivery:read:own',
  'hospital:read:any',
  'hospital:manage:own',
  'user:manage',
  'audit:read',
  'admin:dashboard',
  'admin:reports',
  'system:purge-data',
  'system:manage-admins',
  'system:rotate-keys',
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

/** A grant: an exact permission, a namespace wildcard, or the global wildcard. */
export type Grant = Permission | '*' | `${string}:*`;

export const PERMISSIONS: Readonly<Record<Role, readonly Grant[]>> = {
  PATIENT: [
    'patient:read:own',
    'patient:update:own',
    'doctor:read:any',
    'hospital:read:any',
    'appointment:create',
    'appointment:read:own',
    'appointment:cancel:own',
    'consultation:read:own',
    'screening:use',
    'prescription:read:own',
    'medical-record:read:own',
    'vitals:record:own',
    'vitals:read:own',
    'payment:initiate',
    'payment:read:own',
    'delivery:read:own',
  ],
  DOCTOR: [
    'doctor:read:any',
    'doctor:update:own',
    'hospital:read:any',
    'patient:read:assigned',
    'appointment:read:assigned',
    'consultation:conduct',
    'consultation:read:assigned',
    'prescription:create',
    'prescription:read:assigned',
    'medical-record:create',
    'medical-record:read:assigned',
    'vitals:read:assigned',
  ],
  HOSPITAL_ADMIN: [
    'hospital:manage:own',
    'hospital:read:any',
    'doctor:read:any',
    'appointment:read:hospital',
  ],
  PHARMACY_STAFF: [
    'prescription:read:assigned',
    'prescription:dispense',
    'delivery:manage',
  ],
  // Everything except system-level destructive ops (system:*).
  PLATFORM_ADMIN: [
    'patient:*',
    'doctor:*',
    'appointment:*',
    'consultation:*',
    'screening:*',
    'prescription:*',
    'medical-record:*',
    'vitals:*',
    'payment:*',
    'delivery:*',
    'hospital:*',
    'user:manage',
    'audit:read',
    'admin:*',
  ],
  SUPER_ADMIN: ['*'],
};

/**
 * Check whether a role holds a permission, honoring namespace wildcards
 * ("payment:*" grants "payment:refund") and the global wildcard ("*").
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role].some(
    (grant) =>
      grant === '*' ||
      grant === permission ||
      (grant.endsWith(':*') && permission.startsWith(grant.slice(0, -1))),
  );
}

/** Fluent sugar: `can('DOCTOR').do('prescription:create')`. */
export function can(role: Role): { do: (permission: Permission) => boolean } {
  return { do: (permission) => hasPermission(role, permission) };
}
