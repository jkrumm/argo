import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export type MarineWindowParams = {
  spot: string
  days: number
  detailDate?: string
}

/** The API caches every upstream for an hour — 10 minutes keeps the page feeling live without
 * re-fetching on every filter tweak inside that window. */
const WINDOW_STALE_MS = 10 * 60_000

export const marineQueries = {
  all: () => ['marine'] as const,
  spots: () =>
    queryOptions({
      queryKey: [...marineQueries.all(), 'spots'] as const,
      queryFn: async () => unwrap(await api.marine.spots.get()),
      // Static data — the spot list is a hand-maintained constant, not a live feed.
      staleTime: Infinity,
    }),
  window: (params: MarineWindowParams) =>
    queryOptions({
      queryKey: [...marineQueries.all(), 'window', params] as const,
      queryFn: async () =>
        unwrap(
          await api.marine.window.get({
            query: {
              spot: params.spot,
              days: params.days,
              ...(params.detailDate !== undefined && { detailDate: params.detailDate }),
            },
          }),
        ),
      staleTime: WINDOW_STALE_MS,
    }),
}
