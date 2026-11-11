import { Stack } from 'expo-router';

/** Makes `tips` one hidden route of the patient tabs (see doctors/_layout.tsx). */
export default function TipsLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
