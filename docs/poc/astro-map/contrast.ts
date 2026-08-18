/**
 * Iteration 6 — the metric that actually decides whether a Milky Way frame works:
 * CORE CONTRAST = (sky background in the core's direction) − (core surface brightness
 * after atmospheric extinction along the same path). Both in mag/arcsec², both at the
 * core's real altitude, so airmass hits the target and the sky glow together.
 *
 * Inputs: Lorenz atlas (light pollution, directional), Open-Meteo CAMS aerosol optical
 * depth (extinction + scattering amplification), Argo's own ephemeris (altitude/azimuth).
 */
import { lpi } from './lorenz-lib.ts'
import { galacticCorePosition } from '../../../apps/api/src/lib/astro-ephemeris.ts'

const YEAR = 2025,
  H_SCAT = 5,
  DR = 2,
  R_MAX = 120
/** Intrinsic surface brightness of the bright Sagittarius star clouds, mag/arcsec². */
const CORE_SB = 21.0
/** Rayleigh + ozone zenith extinction at ~600 m elevation, mag/airmass (V band). */
const K_RAYLEIGH = 0.16
/** Aerosol extinction per unit AOD550, mag/airmass: 2.5·log10(e). */
const K_PER_AOD = 1.086

const SITES = [
  { name: 'Munich', lat: 48.1374, lon: 11.5755 },
  { name: 'Alpenvorland (Bad Tölz)', lat: 47.8167, lon: 11.4667 },
  { name: 'Bayerischer Wald', lat: 48.9333, lon: 13.4167 },
  { name: 'Walchensee', lat: 47.6, lon: 11.33 },
]

const W = (r: number, alt: number) =>
  Math.exp(-(r * Math.tan((alt * Math.PI) / 180)) / H_SCAT) / (1 + (r / 10) ** 1.5)
async function ray(site: { lat: number; lon: number }, az: number, alt: number) {
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
/** Kasten & Young 1989 relative optical airmass — valid down to the horizon, unlike sec z. */
const airmass = (altDeg: number) =>
  1 / (Math.sin((altDeg * Math.PI) / 180) + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364))
/** van Rhijn: the natural airglow layer is longer along a slanted path, so the natural sky brightens near the horizon. */
const vanRhijn = (altDeg: number, layerKm = 90) => {
  const R = 6371,
    z = ((90 - altDeg) * Math.PI) / 180
  return 1 / Math.sqrt(1 - Math.pow((R / (R + layerKm)) * Math.sin(z), 2))
}

async function aod(lat: number, lon: number): Promise<number> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=aerosol_optical_depth&forecast_days=2&timezone=UTC`
  const r = await fetch(url)
  const j: any = await r.json()
  const vals = (j.hourly.aerosol_optical_depth as (number | null)[]).filter(
    (v): v is number => v != null,
  )
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

const NIGHT = new Date('2026-07-15T22:00:00Z')
console.log('site'.padEnd(24) + 'alt  az    AOD   k_tot  X    sky_bg  core_ext  contrast')
console.log('-'.repeat(88))
const rows: { name: string; contrast: number; sky: number }[] = []
for (const s of SITES) {
  const atlas = await lpi(YEAR, s.lat, s.lon)
  const k = atlas / (await ray(s, 0, 90))
  const A = await aod(s.lat, s.lon)

  // core at transit
  let best = { alt: -90, az: 0 }
  for (let h = -6; h <= 6; h += 0.25) {
    const p = galacticCorePosition(
      { lat: s.lat, lon: s.lon },
      new Date(NIGHT.getTime() + h * 3600_000),
    )
    if (p.altitude > best.alt) best = { alt: p.altitude, az: p.azimuth }
  }
  const X = airmass(best.alt)
  const kTot = K_RAYLEIGH + K_PER_AOD * A

  // artificial glow toward the core, in LPI units; natural component scaled by van Rhijn,
  // then dimmed by the same extinction the target sees (glow originates below most of it, so
  // only a fraction applies — use half the path as the standard first-order treatment).
  const artificial = k * (await ray(s, best.az, best.alt))
  const natural = vanRhijn(best.alt)
  const skyLinear = (natural + artificial) * Math.pow(10, -0.4 * (kTot * X * 0.5))
  const sky = 22.0 - 2.5 * Math.log10(skyLinear)
  const coreExt = CORE_SB + kTot * X
  const contrast = sky - coreExt
  rows.push({ name: s.name, contrast, sky })
  console.log(
    s.name.padEnd(24) +
      `${best.alt.toFixed(1)}° ${best.az.toFixed(0)}°  ${A.toFixed(3)}  ${kTot.toFixed(3)}  ${X.toFixed(2)}  ${sky.toFixed(2)}   ${coreExt.toFixed(2)}     ${contrast >= 0 ? '+' : ''}${contrast.toFixed(2)}`,
  )
}
console.log(
  '\ncontrast > 0 : core is brighter than the sky behind it (visually detectable, easy in camera)',
)
console.log('contrast < 0 : core is fainter than the background — recoverable only by stacking')
console.log(
  '\nranking by core contrast: ' +
    [...rows]
      .sort((a, b) => b.contrast - a.contrast)
      .map((r) => `${r.name} (${r.contrast.toFixed(2)})`)
      .join('  >  '),
)

// sensitivity of the verdict to aerosol load alone, for one site
console.log('\nAOD sensitivity at Walchensee (all else fixed):')
const s = SITES[3]!
const atlas = await lpi(YEAR, s.lat, s.lon)
const k = atlas / (await ray(s, 0, 90))
let best = { alt: -90, az: 0 }
for (let h = -6; h <= 6; h += 0.25) {
  const p = galacticCorePosition(
    { lat: s.lat, lon: s.lon },
    new Date(NIGHT.getTime() + h * 3600_000),
  )
  if (p.altitude > best.alt) best = { alt: p.altitude, az: p.azimuth }
}
const art = k * (await ray(s, best.az, best.alt))
const X = airmass(best.alt)
for (const A of [0.05, 0.1, 0.2, 0.3, 0.5, 0.8]) {
  const kTot = K_RAYLEIGH + K_PER_AOD * A
  const sky =
    22.0 - 2.5 * Math.log10((vanRhijn(best.alt) + art) * Math.pow(10, -0.4 * kTot * X * 0.5))
  console.log(
    `  AOD ${A.toFixed(2)}  k=${kTot.toFixed(2)}  sky ${sky.toFixed(2)}  core ${(CORE_SB + kTot * X).toFixed(2)}  contrast ${(sky - CORE_SB - kTot * X).toFixed(2)}`,
  )
}
