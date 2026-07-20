'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onSessionExpired } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

/**
 * Session bootstrap + query cache.
 *
 * On first mount the app tries exactly one silent refresh: the access token
 * lives in memory, so a page reload always starts signed-out until the
 * httpOnly cookie is exchanged. `ready` gates every route so a signed-in
 * operator never sees the login form flash.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const restore = useAuthStore((state) => state.restore);
  const clear = useAuthStore((state) => state.clear);
  const started = useRef(false);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // 401s are already handled by the api layer (refresh + one retry);
            // retrying them here would just multiply failed calls.
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void restore();
  }, [restore]);

  useEffect(
    () =>
      onSessionExpired(() => {
        clear();
        queryClient.clear(); // never leave PHI in a cache after a dead session
        router.replace('/login');
      }),
    [clear, queryClient, router],
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
