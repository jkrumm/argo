/* eslint-disable no-console */
/**
 * P2c — how often does the horizon get set by the ground within 500 m?
 *
 * This decides an API contract. A 76 m DEM pixel two steps away is your own
 * hillside plus the model's vertical noise, not a skyline; but a real cliff at
 * 300 m is a real skyline. If near-field wins are rare, splitting the profile
 * into near and far bands costs nothing and lets the scorer trust the far one.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { decodePng } from '../../../apps/api/scripts/terrarium-dem.js'
import { terrariumElevation } from '../../../apps/api/src/lib/terrain-horizon.js'
import { lonToTileX, latToTileY } from '../../../apps/api/src/lib/lp-tile.js'
import { CACHE_DIR, demFor, SITES, type PocSite } from './sites.js'

const NEAR_M = 500
const M_PER_DEG_LAT = 111_320
const R_EFF = 6_371_000 / (1 - 0.13)
const rad = (d: number) => (d * Math.PI) / 180

const CANDIDATES: PocSite[] = [
  ...SITES,
  {
    id: 'eng-karwendel',
    name: 'Eng / Karwendel valley floor',
    lat: 47.4083,
    lon: 11.5978,
    timeZone: 'Europe/Berlin',
  },
  {
    id: 'sylvenstein',
    name: 'Sylvensteinspeicher',
    lat: 47.5722,
    lon: 11.5236,
    timeZone: 'Europe/Berlin',
  },
  {
    id: 'herzogstand',
    name: 'Herzogstand summit',
    lat: 47.6072,
    lon: 11.3153,
    timeZone: 'Europe/Berlin',
  },
  {
    id: 'wallberg',
    name: 'Wallberg summit',
    lat: 47.6631,
    lon: 11.7736,
    timeZone: 'Europe/Berlin',
  },
]

for (const z of [11, 12]) await demFor(CANDIDATES, z)

function loadGrids(zoom: number) {
  const grids = new Map<string, { width: number; height: number; rgb: Uint8Array }>()
  for (const name of readdirSync(`${CACHE_DIR}/z${zoom}`)) {
    const m = /^(\d+)_(\d+)_(\d+)\.png$/.exec(name)
    if (!m || Number(m[1]) !== zoom) continue
    grids.set(
      `${m[2]}/${m[3]}`,
      decodePng(new Uint8Array(readFileSync(`${CACHE_DIR}/z${zoom}/${name}`))),
    )
  }
  return (lat: number, lon: number): number => {
    const x = lonToTileX(lon, zoom)
    const y = latToTileY(lat, zoom)
    const g = grids.get(`${Math.floor(x)}/${Math.floor(y)}`)
    if (!g) return Number.NaN
    const c = Math.min(g.width - 1, Math.max(0, Math.floor((x - Math.floor(x)) * g.width)))
    const r = Math.min(g.height - 1, Math.max(0, Math.floor((y - Math.floor(y)) * g.height)))
    const i = (r * g.width + c) * 3
    return terrariumElevation(g.rgb[i]!, g.rgb[i + 1]!, g.rgb[i + 2]!)
  }
}

function bands(sampler: (lat: number, lon: number) => number, site: PocSite, stepM: number) {
  const h0 = sampler(site.lat, site.lon)
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(rad(site.lat))
  const near: number[] = []
  const far: number[] = []
  for (let azDeg = 0; azDeg < 360; azDeg += 5) {
    const az = rad(azDeg)
    let n = -90
    let f = -90
    for (let r = stepM; r <= 60_000; r += stepM) {
      const h = sampler(
        site.lat + (r * Math.cos(az)) / M_PER_DEG_LAT,
        site.lon + (r * Math.sin(az)) / mPerDegLon,
      )
      if (!Number.isFinite(h)) continue
      const a = (Math.atan2(h - h0 - (r * r) / (2 * R_EFF), r) * 180) / Math.PI
      if (r <= NEAR_M) {
        if (a > n) n = a
      } else if (a > f) f = a
    }
    near.push(n)
    far.push(f)
  }
  return { near, far }
}

const s11 = loadGrids(11)
const s12 = loadGrids(12)
const arc = (v: number[]) => Math.max(...v.filter((_, i) => i * 5 >= 150 && i * 5 <= 215))

console.log(`Near band = 0–${NEAR_M} m.  wins = azimuths where near > far.\n`)
console.log('site                              wins/72   Snear   Sfar   Sfar z11→z12')
for (const site of CANDIDATES) {
  const b11 = bands(s11, site, 150)
  const b12 = bands(s12, site, 75)
  const wins = b11.near.filter((n, i) => n > b11.far[i]!).length
  console.log(
    `${site.name.padEnd(32)} ${String(wins).padStart(6)}  ${arc(b11.near).toFixed(2).padStart(6)} ${arc(b11.far).toFixed(2).padStart(6)}   ${arc(b11.far).toFixed(2)} → ${arc(b12.far).toFixed(2)}  (Δ ${(arc(b12.far) - arc(b11.far)).toFixed(2)})`,
  )
}
