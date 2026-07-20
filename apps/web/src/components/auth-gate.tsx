'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { evaluateGate, type PortalArea } from '@/lib/auth-gate';
import { useAuthStore } from '@/stores/auth';

/**
 * Route guard. All routing rules live in `evaluateGate` (pure, unit-tested);
 * this component only performs the side effect the decision asks for.
 */
export function AuthGate({ required, children }: { required: PortalArea | null; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);

  const decision = evaluateGate({
    role: user?.role ?? null,
    ready,
    required,
    pathname,
  });

  useEffect(() => {
    if (decision.kind === 'redirect') router.replace(decision.to);
  }, [decision, router]);

  if (decision.kind !== 'allow') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }
  return <>{children}</>;
}
