import { queryOptions } from '@tanstack/react-query'
import type { HorizonResponse, VisibilityResponse } from '@argo/api'
import { api, unwrap } from '../eden'

export type AstroWindowParams = {
  site: string
  nights: number
  detailDate?: string
}

export type HorizonParams = { lat: number; lon: number }
export type SkyglowParams = { lat: number; lon: number; date: string }
export type VisibilityParams = { site: string }

/**
 * `GET /astro/horizon` and `GET /astro/visibility` return a raw `Response` — no Elysia `response`
 * schema — so they can own their Cache-Control/ETag headers and answer a bodiless 304. Eden Treaty
 * therefore infers `data` as the bare `Response` rather than a parsed body, even though it parses
 * correctly at RUNTIME (the handlers set `content-type: application/json`, which is all Eden's body
 * switch reads). The cast below is unavoidable; what it casts TO is not. These are the API's own
 * exported `z.infer` types, so the shape cannot drift the way a hand-mirrored copy would.
 */
export type { HorizonResponse, VisibilityResponse } from '@argo/api'

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
  // Static per coordinate — terrain doesn't move and the light-pollution atlas is annual, the
  // same reasoning `sites()` above already relies on. `skyglow` is keyed by `date` too (its
  // `core`/`coreTime` fields are night-specific even though the `profile` rose isn't), so a night
  // change gets its own cache entry rather than invalidating the whole coordinate.
  horizon: (params: HorizonParams) =>
    queryOptions({
      queryKey: [...astroQueries.all(), 'horizon', params] as const,
      queryFn: async () =>
        unwrap(await api.astro.horizon.get({ query: params })) as unknown as HorizonResponse,
      staleTime: Infinity,
    }),
  skyglow: (params: SkyglowParams) =>
    queryOptions({
      queryKey: [...astroQueries.all(), 'skyglow', params] as const,
      queryFn: async () => unwrap(await api.astro.skyglow.get({ query: params })),
      staleTime: Infinity,
    }),
  visibility: (params: VisibilityParams) =>
    queryOptions({
      queryKey: [...astroQueries.all(), 'visibility', params] as const,
      queryFn: async () =>
        unwrap(await api.astro.visibility.get({ query: params })) as unknown as VisibilityResponse,
      staleTime: Infinity,
    }),
}
