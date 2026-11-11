import type { HealthTipCategory, PublicHealthTip } from '@daktari/schemas';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { dailySet } from './rotation';
import { fetchCached, tipDetailPath, tipsListPath, TipsUnavailableError, type TipsPage } from './tips-api';
import { tipsCache } from './tips-cache';

/** Home: up to 30 newest/priority tips → today's rotating set of 10. */
export function useHomeTips() {
  return useQuery({
    queryKey: ['tips', 'home'],
    queryFn: () => fetchCached<TipsPage>(tipsListPath({ page: 1, pageSize: 30 })),
    select: (result) => ({ tips: dailySet(result.data.items, new Date(), 10), offline: result.offline }),
    staleTime: 10 * 60_000,
  });
}

/** "Vidokezo vyote": category + search, infinite scroll (20 per page). */
export function useTipsList(category: HealthTipCategory | null, q: string) {
  return useInfiniteQuery({
    queryKey: ['tips', 'list', category, q],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchCached<TipsPage>(tipsListPath({ category, q, page: pageParam, pageSize: 20 })),
    getNextPageParam: (last) => {
      const { page, pageSize, total } = last.data;
      return page * pageSize < total ? page + 1 : undefined;
    },
    staleTime: 10 * 60_000,
  });
}

function findCachedTip(slug: string): PublicHealthTip | undefined {
  for (const body of tipsCache.bodies()) {
    if (typeof body !== 'object' || body === null) continue;
    if ('slug' in body && (body as PublicHealthTip).slug === slug) return body as PublicHealthTip;
    if ('items' in body) {
      const hit = (body as TipsPage).items.find((tip) => tip.slug === slug);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/** One tip; offline, falls back to the copy inside any cached list. */
export function useTip(slug: string) {
  return useQuery({
    queryKey: ['tips', 'detail', slug],
    queryFn: async () => {
      try {
        return await fetchCached<PublicHealthTip>(tipDetailPath(slug));
      } catch (error) {
        const cached = findCachedTip(slug);
        if (cached !== undefined) return { data: cached, offline: true };
        throw error instanceof TipsUnavailableError ? error : new TipsUnavailableError();
      }
    },
    staleTime: 10 * 60_000,
  });
}
