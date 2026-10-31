import { Stack } from 'expo-router';

/**
 * Makes `appointments` ONE route of the patient tabs (list → detail inside the
 * tab, with back). Without a layout, expo-router flattened the folder into
 * the tab navigator as `appointments/index` + `appointments/[id]`, so the
 * tabs' `name="appointments"` matched nothing ("No route named appointments").
 */
export default function AppointmentsLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
