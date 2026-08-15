import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export type AstroWindowParams = {
  site: string
  nights: number
  detailDate?: string
}

/** The API caches every upstream for an hour — 10 minutes keeps the page feeling live without
 * re-fetching on every filter tweak inside that window. */
const WINDOW_STALE_MS = 10 * 60_000

export const astroQueries = {
  all: () => ['astro'] as const,
  sites: () =>
    queryOptions({
      queryKey: [...astroQueries.all(), 'sites'] as const,
      queryFn: async () => unwrap(await api.astro.sites.get()),
      // Static data — the site list is a hand-maintained constant, not a live feed.
      staleTime: Infinity,
    }),
  window: (params: AstroWindowParams) =>
    queryOptions({
      queryKey: [...astroQueries.all(), 'window', params] as const,
      queryFn: async () =>
        unwrap(
          await api.astro.window.get({
            query: {
              site: params.site,
              nights: params.nights,
              ...(params.detailDate !== undefined && { detailDate: params.detailDate }),
            },
          }),
        ),
      staleTime: WINDOW_STALE_MS,
    }),
}
