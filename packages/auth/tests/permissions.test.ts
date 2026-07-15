import { describe, expect, it } from 'vitest';
import { can, hasPermission, PERMISSIONS, ROLES } from '../src/index.js';

describe('permission matrix', () => {
  it('grants patients their own data and nothing clinical', () => {
    expect(hasPermission('PATIENT', 'patient:read:own')).toBe(true);
    expect(hasPermission('PATIENT', 'vitals:record:own')).toBe(true);
    expect(hasPermission('PATIENT', 'payment:initiate')).toBe(true);
    expect(hasPermission('PATIENT', 'prescription:create')).toBe(false);
    expect(hasPermission('PATIENT', 'patient:read:any')).toBe(false);
    expect(hasPermission('PATIENT', 'doctor:verify')).toBe(false);
  });

  it('grants doctors clinical duties on assigned patients only', () => {
    expect(hasPermission('DOCTOR', 'consultation:conduct')).toBe(true);
    expect(hasPermission('DOCTOR', 'prescription:create')).toBe(true);
    expect(hasPermission('DOCTOR', 'medical-record:read:assigned')).toBe(true);
    expect(hasPermission('DOCTOR', 'patient:read:any')).toBe(false);
    expect(hasPermission('DOCTOR', 'payment:refund')).toBe(false);
    expect(hasPermission('DOCTOR', 'prescription:dispense')).toBe(false);
  });

  it('scopes pharmacy staff to dispensing and delivery', () => {
    expect(hasPermission('PHARMACY_STAFF', 'prescription:dispense')).toBe(true);
    expect(hasPermission('PHARMACY_STAFF', 'delivery:manage')).toBe(true);
    expect(hasPermission('PHARMACY_STAFF', 'medical-record:read:assigned')).toBe(false);
  });

  it('gives PLATFORM_ADMIN wildcard namespaces but no system-level destructive ops', () => {
    expect(hasPermission('PLATFORM_ADMIN', 'doctor:verify')).toBe(true);
    expect(hasPermission('PLATFORM_ADMIN', 'payment:refund')).toBe(true);
    expect(hasPermission('PLATFORM_ADMIN', 'patient:read:any')).toBe(true);
    expect(hasPermission('PLATFORM_ADMIN', 'admin:dashboard')).toBe(true);
    expect(hasPermission('PLATFORM_ADMIN', 'system:purge-data')).toBe(false);
    expect(hasPermission('PLATFORM_ADMIN', 'system:rotate-keys')).toBe(false);
  });

  it('gives SUPER_ADMIN absolutely everything', () => {
    expect(hasPermission('SUPER_ADMIN', 'system:purge-data')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'payment:refund')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'patient:read:own')).toBe(true);
  });

  it('wildcard matching stays within its namespace', () => {
    // HOSPITAL_ADMIN has hospital:manage:own but no payment grants at all
    expect(hasPermission('HOSPITAL_ADMIN', 'hospital:manage:own')).toBe(true);
    expect(hasPermission('HOSPITAL_ADMIN', 'payment:refund')).toBe(false);
  });

  it('supports the fluent can(role).do(permission) form', () => {
    expect(can('DOCTOR').do('prescription:create')).toBe(true);
    expect(can('PATIENT').do('doctor:verify')).toBe(false);
  });

  it('defines grants for every role', () => {
    for (const role of ROLES) {
      expect(PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });
});
