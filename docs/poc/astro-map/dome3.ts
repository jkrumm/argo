/**
 * Iteration 4 — the deliverable metric: light-dome load in the direction the
 * galactic core actually occupies, in absolute LPI units comparable across sites.
 *
 * Directional estimator: atlas ray-march (no population data). Calibrated per
 * site so that the zenith ray reproduces the atlas point value exactly, which
 * makes every other direction commensurable with it.
 *
 * Core geometry comes from Argo's own shipped ephemeris.
 */
import { lpi, mpsas, mod } from './lorenz-lib.ts'
import { galacticCorePosition } from '../../../apps/api/src/lib/astro-ephemeris.ts'

const YEAR = 2025
const H_SCAT_KM = 5.0
const DR = 2
const R_MAX = 120

const SITES = [
  { id: 'munich', name: 'Munich', lat: 48.1374, lon: 11.5755, claimedBortle: 8 },
  {
    id: 'alpenvorland',
    name: 'Alpenvorland (Bad Tölz)',
    lat: 47.8167,
    lon: 11.4667,
    claimedBortle: 4,
  },
  {
    id: 'bayerischer-wald',
    name: 'Bayerischer Wald',
    lat: 48.9333,
    lon: 13.4167,
    claimedBortle: 3,
  },
  { id: 'walchensee', name: 'Walchensee', lat: 47.6, lon: 11.33, claimedBortle: 4 },
]
const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]
const compass = (az: number) => COMPASS[Math.round(mod(az, 360) / 22.5) % 16]!
const W = (r: number, altDeg: number) =>
  Math.exp(-(r * Math.tan((altDeg * Math.PI) / 180)) / H_SCAT_KM) / (1 + (r / 10) ** 1.5)

async function rawGlow(site: { lat: number; lon: number }, az: number, alt: number) {
  const kmLat = 111.32,
    kmLon = 111.32 * Math.cos((site.lat * Math.PI) / 180)
  const rad = (az * Math.PI) / 180
  let acc = 0
  for (let r = 0; r <= R_MAX; r += DR) {
    const v = await lpi(
      YEAR,
      site.lat + (r * Math.cos(rad)) / kmLat,
      site.lon + (r * Math.sin(rad)) / kmLon,
    )
    if (Number.isFinite(v)) acc += v * W(r, alt)
  }
  return acc
}

// Sample the core's track through one clear summer night, and again in spring.
const NIGHTS = [new Date('2026-07-15T22:00:00Z'), new Date('2026-05-15T23:00:00Z')]

for (const s of SITES) {
  const atlas = await lpi(YEAR, s.lat, s.lon)
  const zenithRaw = await rawGlow(s, 0, 90)
  const k = atlas / zenithRaw // calibration: zenith ray == atlas point value
  const glow = async (az: number, alt: number) => k * (await rawGlow(s, az, alt))

  console.log(`\n=== ${s.name}  (claimed Bortle ${s.claimedBortle}) ===`)
  console.log(`zenith        LPI ${atlas.toFixed(3)}  ->  ${mpsas(atlas).toFixed(2)} mag/arcsec²`)

  // where the core actually is, over its visible arc
  const track: { t: Date; az: number; alt: number }[] = []
  for (const base of NIGHTS) {
    for (let h = -5; h <= 5; h += 0.5) {
      const t = new Date(base.getTime() + h * 3600_000)
      const p = galacticCorePosition({ lat: s.lat, lon: s.lon }, t)
      if (p.altitude >= 8) track.push({ t, az: p.azimuth, alt: p.altitude })
    }
  }
  const azs = track.map((p) => p.az)
  const alts = track.map((p) => p.alt)
  console.log(
    `core arc      az ${Math.min(...azs).toFixed(0)}–${Math.max(...azs).toFixed(0)}° (${compass(Math.min(...azs))}–${compass(Math.max(...azs))}), alt ${Math.min(...alts).toFixed(1)}–${Math.max(...alts).toFixed(1)}°`,
  )

  let worst = { az: 0, alt: 0, g: -1 },
    sum = 0
  for (const p of track) {
    const g = await glow(p.az, p.alt)
    sum += g
    if (g > worst.g) worst = { az: p.az, alt: p.alt, g }
  }
  const meanCore = sum / track.length
  const transit = await glow(180, 90 - s.lat - 29.008)

  console.log(
    `core-direction LPI  mean ${meanCore.toFixed(2)}  worst ${worst.g.toFixed(2)} (az ${worst.az.toFixed(0)}° alt ${worst.alt.toFixed(1)}°)  at-transit ${transit.toFixed(2)}`,
  )
  console.log(
    `core-direction mag  mean ${mpsas(meanCore).toFixed(2)}  ->  penalty vs zenith ${(mpsas(atlas) - mpsas(meanCore)).toFixed(2)} mag`,
  )

  const prof: string[] = []
  for (let az = 0; az < 360; az += 30)
    prof.push(`${compass(az)} ${(await glow(az, 10)).toFixed(2)}`)
  console.log(`horizon glow @10° (absolute LPI): ${prof.join('  ')}`)
}
