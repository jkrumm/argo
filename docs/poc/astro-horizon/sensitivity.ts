/* eslint-disable no-console */
/**
 * P2 — what resolution does a horizon actually need, and what does it cost?
 *
 * The shipped generator runs once per atlas vintage on a laptop, so it can
 * afford z11 over 60 km. A click-anywhere endpoint cannot: that box is ~100
 * DEM tiles per point. This measures what each knob buys, in degrees of
 * southern-arc horizon, against what it costs in tiles.
 */

import { HORIZON_RANGE_M, southernHorizon } from '../../../apps/api/src/lib/terrain-horizon.js'
import { demFor, SITES } from './sites.js'

const REF_ZOOM = 12

// One DEM per zoom, prefetched over the full 60 km box for every site.
const dems = new Map<number, Awaited<ReturnType<typeof demFor>>>()
for (const zoom of [9, 10, 11, 12]) {
  const t0 = performance.now()
  dems.set(zoom, await demFor(SITES, zoom))
  const s = dems.get(zoom)!.stats()
  console.log(
    `z${zoom}: ${s.tiles} tiles for 4 sites (${((performance.now() - t0) / 1000).toFixed(1)} s, ${s.missing} missing)`,
  )
}
console.log()

type Row = {
  site: string
  zoom: number
  stepM: number
  rangeM: number
  maxDeg: number
  meanDeg: number
  ms: number
}
const rows: Row[] = []

function run(site: (typeof SITES)[number], zoom: number, stepM: number, rangeM: number): Row {
  const dem = dems.get(zoom)!
  const t0 = performance.now()
  // `horizonProfile` reads module constants, so vary them by sampling a
  // restricted ray here: a sampler that returns NaN past `rangeM` truncates the
  // march exactly as a shorter HORIZON_RANGE_M would.
  const profile = horizonProfileWith(dem.sampler, site, stepM, rangeM)
  const ms = performance.now() - t0
  const s = southernHorizon(profile)
  return { site: site.id, zoom, stepM, rangeM, maxDeg: s.maxDeg, meanDeg: s.meanDeg, ms }
}

/** Local copy of the shipped march with step/range as parameters. */
function horizonProfileWith(
  sampler: (lat: number, lon: number) => number,
  site: { lat: number; lon: number },
  stepM: number,
  rangeM: number,
) {
  const M_PER_DEG_LAT = 111_320
  const R = 6_371_000 / (1 - 0.13)
  const rad = (d: number) => (d * Math.PI) / 180
  const elevationM = sampler(site.lat, site.lon)
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(rad(site.lat))
  const points = []
  for (let azimuthDeg = 0; azimuthDeg < 360; azimuthDeg += 5) {
    const az = rad(azimuthDeg)
    let best = { azimuthDeg, altitudeDeg: -90, rangeM: 0, summitM: Number.NaN }
    for (let r = stepM; r <= rangeM; r += stepM) {
      const lat = site.lat + (r * Math.cos(az)) / M_PER_DEG_LAT
      const lon = site.lon + (r * Math.sin(az)) / mPerDegLon
      const summitM = sampler(lat, lon)
      const drop = (r * r) / (2 * R)
      const a =
        Number.isFinite(summitM) && Number.isFinite(elevationM)
          ? (Math.atan2(summitM - elevationM - drop, r) * 180) / Math.PI
          : -90
      if (a > best.altitudeDeg) best = { azimuthDeg, altitudeDeg: a, rangeM: r, summitM }
    }
    points.push(best)
  }
  return { elevationM, points }
}

const reference = new Map<string, number>()
for (const site of SITES) reference.set(site.id, run(site, REF_ZOOM, 75, HORIZON_RANGE_M).maxDeg)

console.log('Southern-arc MAX horizon (deg), and Δ vs the z12/75 m/60 km reference:\n')
console.log('site               zoom  step   range   max    Δref    ms')
for (const site of SITES) {
  for (const [zoom, stepM, rangeM] of [
    [12, 75, 60_000],
    [11, 150, 60_000],
    [11, 300, 60_000],
    [10, 300, 60_000],
    [9, 600, 60_000],
    [11, 150, 30_000],
    [11, 150, 15_000],
    [11, 150, 100_000],
  ] as const) {
    const r = run(site, zoom, stepM, rangeM)
    rows.push(r)
    const d = r.maxDeg - reference.get(site.id)!
    console.log(
      `${site.id.padEnd(18)} z${String(zoom).padEnd(4)} ${String(stepM).padStart(4)}m ${String(rangeM / 1000).padStart(5)}km  ${r.maxDeg.toFixed(2).padStart(5)}  ${(d >= 0 ? '+' : '') + d.toFixed(2)}   ${r.ms.toFixed(0)}`,
    )
  }
  console.log()
}
