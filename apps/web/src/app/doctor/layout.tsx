'use client';

import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth-gate';
import { PortalShell, type NavItem } from '@/components/portal-shell';

const NAV: NavItem[] = [
  { href: '/doctor/today', labelKey: 'doctor.nav.today' },
  { href: '/doctor/schedule', labelKey: 'doctor.nav.schedule' },
  { href: '/doctor/earnings', labelKey: 'doctor.nav.earnings' },
];

export default function DoctorLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate required="doctor">
      <PortalShell nav={NAV}>{children}</PortalShell>
    </AuthGate>
  );
}
