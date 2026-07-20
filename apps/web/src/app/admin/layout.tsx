'use client';

import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth-gate';
import { PortalShell, type NavItem } from '@/components/portal-shell';

const NAV: NavItem[] = [
  { href: '/admin/verification', labelKey: 'admin.nav.verification' },
  { href: '/admin/payments', labelKey: 'admin.nav.payments' },
  { href: '/admin/ai-usage', labelKey: 'admin.nav.aiUsage' },
  { href: '/admin/doctors', labelKey: 'admin.nav.doctors' },
  { href: '/admin/patients', labelKey: 'admin.nav.patients' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate required="admin">
      <PortalShell nav={NAV}>{children}</PortalShell>
    </AuthGate>
  );
}
