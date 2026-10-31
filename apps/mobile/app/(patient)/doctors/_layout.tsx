import { Stack } from 'expo-router';

/**
 * Makes `doctors` ONE (hidden) route of the patient tabs — see
 * appointments/_layout.tsx for why a folder without a layout produced
 * "No route named doctors".
 */
export default function DoctorsLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
