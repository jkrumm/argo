/* eslint-disable no-console */
/**
 * Shared harness for the horizon POC: the four committed sites plus a handful
 * of scouting candidates, and a DEM sampler factory that reuses the generator's
 * own tile reader so the POC and the shipped generator cannot diverge.
 */

import { terrariumDem } from '../../../apps/api/scripts/terrarium-dem.js'
import { HORIZON_RANGE_M } from '../../../apps/api/src/lib/terrain-horizon.js'

export type PocSite = { id: string; name: string; lat: number; lon: number; timeZone: string }

/** The four committed sites, verbatim from `astro-sites.ts`. */
export const SITES: PocSite[] = [
  { id: 'munich', name: 'Munich', lat: 48.1374, lon: 11.5755, timeZone: 'Europe/Berlin' },
  {
    id: 'alpenvorland',
    name: 'Alpenvorland (Bad Tölz)',
    lat: 47.8167,
    lon: 11.4667,
    timeZone: 'Europe/Berlin',
  },
  {
    id: 'bayerischer-wald',
    name: 'Bayerischer Wald',
    lat: 48.9333,
    lon: 13.4167,
    timeZone: 'Europe/Berlin',
  },
  { id: 'walchensee', name: 'Walchensee', lat: 47.6, lon: 11.33, timeZone: 'Europe/Berlin' },
]

export const CACHE_DIR = new URL('.cache/dem', import.meta.url).pathname

export async function demFor(
  sites: { lat: number; lon: number }[],
  zoom: number,
  rangeM = HORIZON_RANGE_M,
) {
  const dem = await terrariumDem({ zoom, cacheDir: `${CACHE_DIR}/z${zoom}` })
  await dem.prefetch(sites.map((s) => ({ lat: s.lat, lon: s.lon, radiusM: rangeM })))
  return dem
}

/** PVGIS azimuth (South=0, West=+90) → compass azimuth (North=0, East=90). */
export function pvgisToCompass(a: number): number {
  const compass = (180 + a) % 360
  return compass < 0 ? compass + 360 : compass
}

export type PvgisHorizon = {
  elevationM: number
  points: { azimuthDeg: number; altitudeDeg: number }[]
}

export async function pvgisHorizon(lat: number, lon: number): Promise<PvgisHorizon> {
  const url = `https://re.jrc.ec.europa.eu/api/v5_3/printhorizon?lat=${lat}&lon=${lon}&outputformat=json`
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`PVGIS ${res.status} for ${lat},${lon}`)
  const body = (await res.json()) as {
    inputs: { location: { elevation: number } }
    outputs: { horizon_profile: { A: number; H_hor: number }[] }
  }
  return {
    elevationM: body.inputs.location.elevation,
    points: body.outputs.horizon_profile
      .map((p) => ({ azimuthDeg: pvgisToCompass(p.A), altitudeDeg: p.H_hor }))
      // A = -180 and A = +180 are the same bearing; keep one.
      .filter((p, i, all) => all.findIndex((q) => q.azimuthDeg === p.azimuthDeg) === i)
      .sort((a, b) => a.azimuthDeg - b.azimuthDeg),
  }
}

/** Linear interpolation of a profile (ascending azimuth, wraps at 360) at an arbitrary bearing. */
export function horizonAt(
  points: { azimuthDeg: number; altitudeDeg: number }[],
  azimuthDeg: number,
): number {
  const az = ((azimuthDeg % 360) + 360) % 360
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    const span = (b.azimuthDeg - a.azimuthDeg + 360) % 360
    const offset = (az - a.azimuthDeg + 360) % 360
    if (offset <= span && span > 0)
      return a.altitudeDeg + ((b.altitudeDeg - a.altitudeDeg) * offset) / span
  }
  return points[0]!.altitudeDeg
}
