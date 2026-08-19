import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { rainviewerTileUrl } from '../../features/astro-window/map-layers'

/**
 * RainViewer's public radar catalogue — `https://api.rainviewer.com/public/weather-maps.json`.
 *
 * A THIRD-PARTY fetch, deliberately NOT an Eden Treaty call against the Argo API (`lib/eden.ts`'s
 * `api`, the pattern every other file in this directory follows): there is no API key to hide
 * (RainViewer is keyless and serves `access-control-allow-origin: *`), so routing it through an
 * Argo API route would add a server hop that only forwards the same bytes back out. This is the
 * one query factory in the directory with a bare `fetch` in its `queryFn` — the reason is written
 * down here rather than left for the next reader to rediscover.
 *
 * Verified live 2026-08-19 against the exact URL below: `radar.past` carried 13 five-minutely
 * frames; `radar.nowcast` and `satellite.infrared` were both empty arrays — RainViewer
 * discontinued both 2026-01-01. The schema still declares them (so a future revival would not
 * silently overrun a stripped-down type) but nothing in this app reads them; only `radar.past`
 * is projected into `rainviewerQueries.radar()`'s resolved frames.
 */

const RainViewerFrameSchema = z.object({
  time: z.number(),
  path: z.string(),
})

const RainViewerResponseSchema = z.object({
  version: z.string(),
  generated: z.number(),
  host: z.string(),
  radar: z.object({
    past: z.array(RainViewerFrameSchema),
    nowcast: z.array(RainViewerFrameSchema),
  }),
  satellite: z.object({
    infrared: z.array(RainViewerFrameSchema),
  }),
})

/** A frame resolved to what `map-overlays.ts` needs to mount it — a real `Date` (not the raw unix
 * seconds RainViewer publishes) and a tile URL template ready for MapLibre's `{z}/{x}/{y}`
 * substitution. */
export type RainViewerFrame = { time: Date; tileUrl: string }

/** RainViewer publishes a new radar frame every 5 minutes — matches `staleTime`/`refetchInterval`
 * below, so the query re-fetches on the same cadence the upstream actually changes at. */
const RAINVIEWER_REFRESH_MS = 5 * 60_000

async function fetchRainViewerFrames(): Promise<readonly RainViewerFrame[]> {
  const response = await fetch('https://api.rainviewer.com/public/weather-maps.json')
  if (!response.ok) {
    throw new Error(`RainViewer catalogue fetch failed: ${response.status} ${response.statusText}`)
  }
  const parsed = RainViewerResponseSchema.parse(await response.json())
  return parsed.radar.past.map((frame) => ({
    time: new Date(frame.time * 1000),
    tileUrl: rainviewerTileUrl(parsed.host, frame.path),
  }))
}

export const rainviewerQueries = {
  all: () => ['rainviewer'] as const,
  radar: () =>
    queryOptions({
      queryKey: [...rainviewerQueries.all(), 'radar'] as const,
      queryFn: fetchRainViewerFrames,
      staleTime: RAINVIEWER_REFRESH_MS,
      refetchInterval: RAINVIEWER_REFRESH_MS,
    }),
}
