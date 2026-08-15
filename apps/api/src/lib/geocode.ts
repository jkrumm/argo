import { tracedFetch } from './traced-fetch.js'

/**
 * Open-Meteo city → coordinates lookup, cached in-process.
 *
 * City coordinates never change, so cache entries carry no TTL — once
 * resolved, a city stays resolved for the life of the process. The cache is
 * module-scope and therefore per-process and lost on redeploy, which is fine
 * on this single-instance deploy (the same trade-off `routes/walking-pad.ts`
 * documents for its live-snapshot store). Unlike that store's fixed single
 * row, `geocodeCity` may be called with arbitrary user input from more than
 * one route, so the cache is capped (`MAX_CACHE_ENTRIES`) and evicts the
 * oldest entry FIFO once full — except the pre-seeded `'munich'` default,
 * which is never evicted.
 */

const OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search'

const MAX_CACHE_ENTRIES = 500

export interface ResolvedLocation {
  lat: number
  lon: number
  city: string
  country: string
  timezone: string
}

export const MUNICH: ResolvedLocation = {
  lat: 48.137,
  lon: 11.575,
  city: 'Munich',
  country: 'Germany',
  timezone: 'Europe/Berlin',
}

// City locations don't change — cache forever, pre-seed with default
const geocodeCache = new Map<string, ResolvedLocation>([['munich', MUNICH]])

interface GeocodingResponse {
  results?: {
    name: string
    latitude: number
    longitude: number
    country: string
    timezone: string
  }[]
}

export async function geocodeCity(city: string): Promise<ResolvedLocation | null> {
  const key = city.trim().toLowerCase()
  const cached = geocodeCache.get(key)
  if (cached) return cached

  const params = new URLSearchParams({
    name: city,
    count: '1',
    language: 'en',
    format: 'json',
  })
  const res = await tracedFetch(`${OPEN_METEO_GEOCODING}?${params}`)
  if (!res.ok) throw new Error(`Open-Meteo geocoding error: ${res.status}`)
  const data = (await res.json()) as GeocodingResponse
  const hit = data.results?.[0]
  if (!hit) return null

  const resolved: ResolvedLocation = {
    lat: hit.latitude,
    lon: hit.longitude,
    city: hit.name,
    country: hit.country,
    timezone: hit.timezone,
  }

  if (geocodeCache.size >= MAX_CACHE_ENTRIES) {
    let oldestKey = geocodeCache.keys().next().value
    if (oldestKey === 'munich') {
      const iterator = geocodeCache.keys()
      iterator.next()
      oldestKey = iterator.next().value
    }
    if (oldestKey !== undefined) geocodeCache.delete(oldestKey)
  }
  geocodeCache.set(key, resolved)
  return resolved
}
