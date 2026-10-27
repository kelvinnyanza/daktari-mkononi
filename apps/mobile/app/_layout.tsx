import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { MisconfiguredScreen } from '../src/components/misconfigured-screen';
import { onSessionExpired } from '../src/services/api';
import { API_CONFIG } from '../src/services/config';
import { useAuthStore } from '../src/stores/auth';

export default function RootLayout(): React.JSX.Element {
  // Missing/invalid EXPO_PUBLIC_API_URL: render no route at all, so no screen
  // can fire requests at an empty base URL.
  if (!API_CONFIG.ok) return <MisconfiguredScreen />;
  return <ConfiguredApp />;
}

function ConfiguredApp(): React.JSX.Element {
  const router = useRouter();
  const signOut = useAuthStore((state) => state.signOut);
  // One QueryClient for the app: gentle retries with backoff for 2G/3G.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
            staleTime: 60_000,
            gcTime: 24 * 60 * 60_000, // keep read caches a day for offline reads
          },
        },
      }),
  );

  useEffect(
    () =>
      // SESSION_REVOKED / failed refresh → clear auth + hard redirect to login.
      onSessionExpired(() => {
        signOut();
        router.replace('/(auth)/login');
      }),
    [router, signOut],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
