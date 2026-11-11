'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AuthGate } from '@/components/auth-gate';
import { PortalShell, type NavItem } from '@/components/portal-shell';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

const NAV: NavItem[] = [
  { href: '/doctor/today', labelKey: 'doctor.nav.today' },
  { href: '/doctor/schedule', labelKey: 'doctor.nav.schedule' },
  { href: '/doctor/earnings', labelKey: 'doctor.nav.earnings' },
  { href: '/doctor/health-tips', labelKey: 'doctor.nav.tips' },
  { href: '/doctor/onboarding', labelKey: 'onboarding.nav' },
];

export default function DoctorLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate required="doctor">
      <PortalShell nav={NAV}>
        <OnboardingRedirect>{children}</OnboardingRedirect>
      </PortalShell>
    </AuthGate>
  );
}

/**
 * Until an administrator approves the doctor there is nothing to do on the
 * "Today" landing page: send them to /doctor/onboarding instead, and show a
 * banner elsewhere. The server still enforces approval on every action — this
 * only saves the doctor a confusing empty screen.
 */
function OnboardingRedirect({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const signedIn = useAuthStore((state) => state.user !== null);
  const verification = useQuery({
    queryKey: ['doctor-verification'],
    queryFn: () => api.get<{ verificationStatus: string }>('/api/v1/doctors/me/verification'),
    enabled: signedIn,
  });
  const approved = verification.data?.verificationStatus === 'APPROVED';
  const notApproved = verification.data !== undefined && !approved;

  useEffect(() => {
    if (notApproved && pathname === '/doctor/today') router.replace('/doctor/onboarding');
  }, [notApproved, pathname, router]);

  return (
    <>
      {notApproved && pathname !== '/doctor/onboarding' && (
        <div role="status" className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {t('onboarding.notApprovedBanner')}{' '}
          <Link href="/doctor/onboarding" className="underline">
            {t('onboarding.nav')}
          </Link>
        </div>
      )}
      {children}
    </>
  );
}
