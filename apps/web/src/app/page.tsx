'use client';

import { AuthGate } from '@/components/auth-gate';

/**
 * The root is pure routing: `evaluateGate` sends a signed-in user to their
 * landing page and everyone else to /login. Nothing renders here.
 */
export default function IndexPage() {
  return <AuthGate required={null}>{null}</AuthGate>;
}
