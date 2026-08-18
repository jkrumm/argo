/* eslint-disable no-console */
/**
 * P1 — is our terrarium raymarch the same horizon PVGIS computes?
 *
 * PVGIS is the independent reference: SRTM-3 (~90 m), its own curvature and
 * refraction handling, EU coverage, keyless. Ours is terrarium z11 (~76 m at
 * 48°N) over a 60 km ray. If the two agree inside the DEM's own vertical noise
 * we can serve the profile ourselves — no rate limit, no EU-only boundary, and
 * every azimuth instead of 48.
 */

import { horizonProfile } from '../../../apps/api/src/lib/terrain-horizon.js'
import { demFor, horizonAt, pvgisHorizon, SITES } from './sites.js'

const ZOOM = Number(process.env.ZOOM ?? 11)

function stats(values: number[]) {
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const rms = Math.sqrt(values.reduce((a, b) => a + b * b, 0) / n)
  const sorted = [...values].sort((a, b) => a - b)
  const p = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))]!
  return { mean, rms, min: sorted[0]!, max: sorted[n - 1]!, median: p(0.5), p90: p(0.9) }
}

const f = (x: number) => (x >= 0 ? ' ' : '') + x.toFixed(2)

const dem = await demFor(SITES, ZOOM)
console.log(`DEM z${ZOOM}: ${JSON.stringify(dem.stats())}\n`)

const allDeltas: number[] = []
const southDeltas: number[] = []

for (const site of SITES) {
  const mine = horizonProfile({ sampler: dem.sampler, site })
  const theirs = await pvgisHorizon(site.lat, site.lon)

  const deltas = theirs.points.map((p) => ({
    az: p.azimuthDeg,
    pvgis: p.altitudeDeg,
    ours: horizonAt(mine.points, p.azimuthDeg),
  }))
  const d = deltas.map((x) => x.ours - x.pvgis)
  allDeltas.push(...d)

  // The arc the core actually crosses (compass 150–215°).
  const south = deltas.filter((x) => x.az >= 150 && x.az <= 215)
  southDeltas.push(...south.map((x) => x.ours - x.pvgis))

  const s = stats(d)
  const ss = stats(south.map((x) => x.ours - x.pvgis))
  const worst = deltas.reduce((a, b) =>
    Math.abs(b.ours - b.pvgis) > Math.abs(a.ours - a.pvgis) ? b : a,
  )

  console.log(`## ${site.name}`)
  console.log(
    `   elevation   ours ${mine.elevationM.toFixed(0)} m   PVGIS ${theirs.elevationM.toFixed(0)} m   Δ ${f(mine.elevationM - theirs.elevationM)} m`,
  )
  console.log(
    `   all 48 az   bias ${f(s.mean)}°  rms ${s.rms.toFixed(2)}°  |Δ|max ${Math.abs(worst.ours - worst.pvgis).toFixed(2)}° at ${worst.az}° (ours ${worst.ours.toFixed(1)} vs ${worst.pvgis.toFixed(1)})`,
  )
  console.log(
    `   south arc   bias ${f(ss.mean)}°  rms ${ss.rms.toFixed(2)}°  max ${ss.max.toFixed(2)}°  min ${ss.min.toFixed(2)}°`,
  )
  console.log(
    `   south max   ours ${Math.max(...south.map((x) => x.ours)).toFixed(2)}°   PVGIS ${Math.max(...south.map((x) => x.pvgis)).toFixed(2)}°`,
  )
  console.log()
}

const a = stats(allDeltas)
const b = stats(southDeltas)
console.log(
  `ALL SITES  n=${allDeltas.length}  bias ${f(a.mean)}°  rms ${a.rms.toFixed(2)}°  median ${f(a.median)}°  p90 ${f(a.p90)}°  range [${f(a.min)}, ${f(a.max)}]°`,
)
console.log(
  `SOUTH ARC  n=${southDeltas.length}  bias ${f(b.mean)}°  rms ${b.rms.toFixed(2)}°  median ${f(b.median)}°  range [${f(b.min)}, ${f(b.max)}]°`,
)
