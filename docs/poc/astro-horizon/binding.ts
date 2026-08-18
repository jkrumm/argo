/* eslint-disable no-console */
/**
 * P3b — which constraint actually binds, and does terrain ever become the one?
 *
 * At the four committed sites the southern horizon is ≤5.7°, so the flat 8°
 * atmospheric floor swallows it whole. That is a property of the pre-alpine
 * plain, not of the model: the moment you scout a valley the ordering flips.
 * This runs the same budget over alpine candidates to find where.
 *
 * The honest gate is the max of two independent floors:
 *   atmospheric — 8°, extinction and the light dome, no terrain involved
 *   geometric   — the measured ridge at the core's own azimuth, + a framing margin
 */

import { Body, Equator, Horizon, Illumination, Observer as AstroObserver } from 'astronomy-engine'
import { galacticCorePosition } from '../../../apps/api/src/lib/astro-ephemeris.js'
import { horizonProfile } from '../../../apps/api/src/lib/terrain-horizon.js'
import { demFor, horizonAt, SITES, type PocSite } from './sites.js'

const YEAR = 2027
const STEP_MIN = 10
const ATMOSPHERIC_FLOOR = 8
const FRAMING_MARGIN = 2

/** Scouting candidates chosen to bracket the terrain regime, valley floor → ridge. */
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

const dem = await demFor(CANDIDATES, 11)
console.log(`DEM z11: ${JSON.stringify(dem.stats())}\n`)

const eq = (body: Body, time: Date, observer: AstroObserver): [number, number] => {
  const e = Equator(body, time, observer, true, true)
  return [e.ra, e.dec]
}

console.log(
  'site                              elev  Smax   core-h/yr  terr-h/yr  Δterr   +moon    bind%   peakClr',
)
for (const site of CANDIDATES) {
  const profile = horizonProfile({ sampler: dem.sampler, site })
  const observer = new AstroObserver(site.lat, site.lon, profile.elevationM)
  const southMax = Math.max(
    ...profile.points
      .filter((p) => p.azimuthDeg >= 150 && p.azimuthDeg <= 215)
      .map((p) => p.altitudeDeg),
  )

  let flat = 0
  let terrain = 0
  let terrainMoon = 0
  let terrainBinds = 0
  let peakClearance = -90

  for (let t = Date.UTC(YEAR, 0, 1); t < Date.UTC(YEAR + 1, 0, 1); t += STEP_MIN * 60_000) {
    const time = new Date(t)
    if (Horizon(time, observer, ...eq(Body.Sun, time, observer)).altitude >= -18) continue

    const c = galacticCorePosition(site, time)
    const ridge = horizonAt(profile.points, c.azimuth)
    const geometricFloor = ridge + FRAMING_MARGIN
    const clearance = c.altitude - ridge
    if (clearance > peakClearance && c.altitude >= ATMOSPHERIC_FLOOR) peakClearance = clearance

    const moon = Horizon(time, observer, ...eq(Body.Moon, time, observer))
    const illum = Illumination(Body.Moon, time).phase_fraction
    const moonFlat = moon.altitude < 0 || illum <= 0.25
    const moonTerrain = moon.altitude < horizonAt(profile.points, moon.azimuth) || illum <= 0.25

    if (c.altitude >= ATMOSPHERIC_FLOOR && moonFlat) {
      flat += STEP_MIN
      if (geometricFloor > ATMOSPHERIC_FLOOR) terrainBinds += STEP_MIN
    }
    const floor = Math.max(ATMOSPHERIC_FLOOR, geometricFloor)
    if (c.altitude >= floor && moonFlat) terrain += STEP_MIN
    if (c.altitude >= floor && moonTerrain) terrainMoon += STEP_MIN
  }

  const h = (m: number) => (m / 60).toFixed(1).padStart(7)
  const d = flat === 0 ? '   n/a' : `${(((terrain - flat) / flat) * 100).toFixed(0).padStart(5)}%`
  const dm =
    flat === 0
      ? '   n/a'
      : `${(((terrainMoon - flat) / flat) * 100 >= 0 ? '+' : '') + (((terrainMoon - flat) / flat) * 100).toFixed(0).padStart(5)}%`
  const bind = flat === 0 ? '  n/a' : `${((terrainBinds / flat) * 100).toFixed(0).padStart(4)}%`
  console.log(
    `${site.name.padEnd(32)} ${profile.elevationM.toFixed(0).padStart(4)}  ${southMax.toFixed(1).padStart(4)}  ${h(flat)}    ${h(terrain)}  ${d}  ${dm}   ${bind}   ${peakClearance.toFixed(1).padStart(5)}°`,
  )
}
console.log(
  '\nSmax = max terrain altitude over the 150–215° arc.  bind% = share of flat-gate minutes where terrain+2° is the tighter floor.',
)
