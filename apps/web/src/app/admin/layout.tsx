'use client';

import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth-gate';
import { PortalShell, type NavItem } from '@/components/portal-shell';

const NAV: NavItem[] = [
  { href: '/admin/verification', labelKey: 'admin.nav.verification' },
  { href: '/admin/payments', labelKey: 'admin.nav.payments' },
  { href: '/admin/fees', labelKey: 'admin.nav.fees' },
  { href: '/admin/payouts', labelKey: 'admin.nav.payouts' },
  { href: '/admin/reports', labelKey: 'admin.nav.reports' },
  { href: '/admin/ai-usage', labelKey: 'admin.nav.aiUsage' },
  { href: '/admin/doctors', labelKey: 'admin.nav.doctors' },
  { href: '/admin/patients', labelKey: 'admin.nav.patients' },
  { href: '/admin/health-tips', labelKey: 'admin.nav.tips' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate required="admin">
      <PortalShell nav={NAV}>{children}</PortalShell>
    </AuthGate>
  );
}
