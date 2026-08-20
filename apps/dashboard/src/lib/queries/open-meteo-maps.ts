import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { openMeteoMetaUrl, type OmDomainId } from '../../features/astro-window/map-layers'

/**
 * Open-Meteo's own domain metadata — `https://map-tiles.open-meteo.com/data_spatial/{domain}/
 * latest.json?variable={variable}`.
 *
 * A THIRD-PARTY fetch, deliberately NOT an Eden Treaty call against the Argo API (`lib/eden.ts`'s
 * `api`, the pattern every other file in this directory follows) — same reasoning
 * `rainviewer.ts` already wrote down for its own bare `fetch`: there is no API key to hide
 * (Open-Meteo is keyless and serves `access-control-allow-origin: *`, verified live 2026-08-20),
 * so routing this through an Argo API route would add a server hop that only forwards the same
 * bytes back out.
 *
 * Only ONE variable is queried per domain, not one per `'om-model'` catalogue row — `cloud_cover`,
 * chosen because it is guaranteed present on every domain in `OM_DOMAINS` (verified 2026-08-20,
 * see `map-layers.ts`'s own doc on `openMeteoMetaUrl`). `reference_time`/`valid_times[]` describe
 * the model RUN, not the variable — every variable off the same run shares the same forecast
 * steps, so `model-cloud`/`model-cloud-low`/`model-precip` all read off this one query instead of
 * three independent fetches of what is structurally the same timeline.
 */

const OPEN_METEO_META_VARIABLE = 'cloud_cover'

/** ICON-D2 (the default domain) publishes a new run every 3 h — 10 minutes is a cheap way to pick
 * up a fresh run promptly without polling every request. */
const OPEN_METEO_META_REFRESH_MS = 10 * 60_000

/**
 * Only the three fields this app actually reads are required; every other field Open-Meteo's
 * response carries (`completed`, `crs_wkt`, `last_modified_time`) is left to `.passthrough()`
 * rather than typed — this endpoint's full shape was probed but not exhaustively pinned, and a
 * field this app never reads is not worth failing validation over if it is ever renamed.
 */
const OpenMeteoLatestSchema = z
  .object({
    reference_time: z.string(),
    valid_times: z.array(z.string()),
    variables: z.array(z.string()),
  })
  .passthrough()

export type OpenMeteoDomainMeta = {
  referenceTime: Date
  /** ISO instants with NO seconds (`2026-08-20T06:00Z`) — `new Date()` parses that form fine, but
   * do not assume a `.000Z` suffix anywhere downstream of this. */
  validTimes: readonly Date[]
  variables: readonly string[]
}

async function fetchOpenMeteoMeta(domain: OmDomainId): Promise<OpenMeteoDomainMeta> {
  const response = await fetch(openMeteoMetaUrl(domain, OPEN_METEO_META_VARIABLE))
  if (!response.ok) {
    throw new Error(`Open-Meteo metadata fetch failed: ${response.status} ${response.statusText}`)
  }
  const parsed = OpenMeteoLatestSchema.parse(await response.json())
  return {
    referenceTime: new Date(parsed.reference_time),
    validTimes: parsed.valid_times.map((time) => new Date(time)),
    variables: parsed.variables,
  }
}

export const openMeteoMapsQueries = {
  all: () => ['open-meteo-maps'] as const,
  meta: (domain: OmDomainId) =>
    queryOptions({
      queryKey: [...openMeteoMapsQueries.all(), 'meta', domain] as const,
      queryFn: () => fetchOpenMeteoMeta(domain),
      staleTime: OPEN_METEO_META_REFRESH_MS,
      refetchInterval: OPEN_METEO_META_REFRESH_MS,
    }),
}
