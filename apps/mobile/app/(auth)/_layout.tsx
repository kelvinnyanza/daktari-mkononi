import { Stack } from 'expo-router';
import { EmergencyShell } from '../../src/ui';

export default function AuthLayout(): React.JSX.Element {
  return (
    <EmergencyShell>
      <Stack screenOptions={{ headerShown: false }} />
    </EmergencyShell>
  );
}
