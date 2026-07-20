import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth-gate';

/** Public route, but a signed-in user is bounced to their own area. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return <AuthGate required={null}>{children}</AuthGate>;
}
