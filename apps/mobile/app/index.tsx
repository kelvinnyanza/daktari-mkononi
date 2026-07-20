import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/stores/auth';

/** Auth gate: PATIENT → patient shell; DOCTOR (and staff roles) → placeholder;
 *  unauthenticated → login. */
export default function Index(): React.JSX.Element {
  const { isAuthenticated, role } = useAuthStore();
  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }
  if (role === 'PATIENT') {
    return <Redirect href="/(patient)/home" />;
  }
  return <Redirect href="/doctor-coming-soon" />;
}
