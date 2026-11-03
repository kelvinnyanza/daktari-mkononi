import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth-gate';

/** Public route (doctor self-registration). */
export default function RegisterLayout({ children }: { children: ReactNode }) {
  return <AuthGate required={null}>{children}</AuthGate>;
}
