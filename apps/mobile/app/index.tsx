import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { hasSeenOnboarding } from '../src/lib/onboarding';
import { useAuthHydrated, useAuthStore } from '../src/stores/auth';

/** Auth gate: PATIENT → patient shell; DOCTOR (and staff roles) → placeholder;
 *  unauthenticated → onboarding on first launch, otherwise login. Waits for the
 *  persisted auth flags and the onboarding flag (both local, tens of ms). */
export default function Index(): React.JSX.Element | null {
  const { isAuthenticated, role } = useAuthStore();
  const hydrated = useAuthHydrated();
  const [seenOnboarding, setSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void hasSeenOnboarding().then((seen) => {
      if (alive) setSeenOnboarding(seen);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!hydrated) return null;
  if (!isAuthenticated) {
    if (seenOnboarding === null) return null;
    return <Redirect href={seenOnboarding ? '/(auth)/login' : '/onboarding'} />;
  }
  if (role === 'PATIENT') {
    return <Redirect href="/(patient)/home" />;
  }
  return <Redirect href="/doctor-portal" />;
}
