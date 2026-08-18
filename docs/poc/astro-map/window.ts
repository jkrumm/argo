/**
 * Iteration 7 — the number a photographer actually plans on: how many minutes
 * the galactic core is BOTH above the local terrain horizon and high enough to
 * shoot, per night, per site. Terrain from horizon.json (terrarium DEM, z11).
 */
import { readFileSync } from 'node:fs'
import { galacticCorePosition } from '../../../apps/api/src/lib/astro-ephemeris.ts'

const H = JSON.parse(readFileSync(`${import.meta.dir}/.cache/horizon.json`, 'utf8')) as Record<
  string,
  { h0: number; prof: Record<string, [number, number, number]> }
>
const SITES = [
  { key: 'Munich', lat: 48.1374, lon: 11.5755 },
  { key: 'Alpenvorland (Bad Tolz)', lat: 47.8167, lon: 11.4667 },
  { key: 'Bayerischer Wald', lat: 48.9333, lon: 13.4167 },
  { key: 'Walchensee', lat: 47.6, lon: 11.33 },
]
const MIN_ALT = 8 // the scorer's existing MIN_CORE_ALTITUDE
const CLEAR_MARGIN = 2 // degrees the core must sit above the ridge to be usable

function horizonAt(key: string, az: number): number {
  const p = H[key]!.prof
  const a = (((Math.round(az / 5) * 5) % 360) + 360) % 360
  return p[String(a)]![0]
}

const NIGHTS = ['2026-05-15', '2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15']
console.log(
  'site                       night        alt>8° only    alt>8° AND clears ridge   lost to terrain',
)
for (const s of SITES) {
  for (const d of NIGHTS) {
    let openFlat = 0,
      openReal = 0
    let firstReal: string | null = null,
      lastReal: string | null = null
    for (let m = 0; m < 24 * 60; m += 2) {
      const t = new Date(`${d}T00:00:00Z`)
      t.setUTCMinutes(m)
      const p = galacticCorePosition({ lat: s.lat, lon: s.lon }, t)
      if (p.altitude < MIN_ALT) continue
      openFlat += 2
      if (p.altitude >= horizonAt(s.key, p.azimuth) + CLEAR_MARGIN) {
        openReal += 2
        const hhmm = t.toISOString().slice(11, 16)
        firstReal ??= hhmm
        lastReal = hhmm
      }
    }
    const lost = openFlat - openReal
    console.log(
      `${s.key.padEnd(26)} ${d}   ${String(openFlat).padStart(4)} min       ${String(openReal).padStart(4)} min  ${(firstReal ? `(${firstReal}–${lastReal} UTC)` : '(never)').padEnd(20)}  ${lost > 0 ? `-${lost} min (${((lost / openFlat) * 100).toFixed(0)}%)` : '—'}`,
    )
  }
  console.log()
}
