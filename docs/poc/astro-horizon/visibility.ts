/* eslint-disable no-console */
/**
 * P3/P4 — what does a real horizon do to the answer?
 *
 * The shipped gate is `MIN_CORE_ALTITUDE = 8`, a flat constant standing in for
 * "the core is behind something". With a measured profile the honest gate is
 * per-instant: the core is up when its altitude clears the TERRAIN at its own
 * azimuth. Same for the moon — a mountain blocks moonlight exactly as well as
 * the earth does, and `SearchRiseSet` cannot know that.
 *
 * Output is an annual budget: how many minutes a year the core is actually
 * shootable from each site, under three progressively honest gates.
 */

import { Body, Illumination, Observer as AstroObserver, Equator, Horizon } from 'astronomy-engine'
import { galacticCorePosition } from '../../../apps/api/src/lib/astro-ephemeris.js'
import { horizonProfile } from '../../../apps/api/src/lib/terrain-horizon.js'
import { demFor, horizonAt, SITES } from './sites.js'

const YEAR = Number(process.env.YEAR ?? 2027)
const STEP_MIN = 10
const MAX_MOON_ILLUM = 0.25

const dem = await demFor(SITES, 11)

type Gate = 'flat8' | 'terrain' | 'terrainMoon'
type Bucket = Record<Gate, number>

function emptyBuckets(): Bucket {
  return { flat8: 0, terrain: 0, terrainMoon: 0 }
}

console.log(`Year ${YEAR}, ${STEP_MIN}-minute grid, moon illumination ceiling ${MAX_MOON_ILLUM}\n`)

for (const site of SITES) {
  const profile = horizonProfile({ sampler: dem.sampler, site })
  const observer = new AstroObserver(site.lat, site.lon, profile.elevationM)
  const core = { lat: site.lat, lon: site.lon }

  const total = emptyBuckets()
  const byMonth: Bucket[] = Array.from({ length: 12 }, emptyBuckets)
  let darkMinutes = 0
  let peakCore = -90
  let peakClearance = -90
  let peakClearanceDate = ''

  const start = Date.UTC(YEAR, 0, 1)
  const end = Date.UTC(YEAR + 1, 0, 1)
  for (let t = start; t < end; t += STEP_MIN * 60_000) {
    const time = new Date(t)
    const sun = Horizon(time, observer, ...eq(Body.Sun, time, observer)).altitude
    if (sun >= -18) continue
    darkMinutes += STEP_MIN

    const c = galacticCorePosition(core, time)
    if (c.altitude > peakCore) peakCore = c.altitude
    const terrainAtCore = horizonAt(profile.points, c.azimuth)
    const clearance = c.altitude - terrainAtCore
    if (clearance > peakClearance) {
      peakClearance = clearance
      peakClearanceDate = time.toISOString().slice(0, 10)
    }

    const moonEq = eq(Body.Moon, time, observer)
    const moon = Horizon(time, observer, ...moonEq, 'normal')
    const illum = Illumination(Body.Moon, time).phase_fraction
    const moonFlatDown = moon.altitude < 0 || illum <= MAX_MOON_ILLUM
    const moonTerrainDown =
      moon.altitude < horizonAt(profile.points, moon.azimuth) || illum <= MAX_MOON_ILLUM

    const month = new Date(t).getUTCMonth()
    if (c.altitude >= 8 && moonFlatDown) {
      total.flat8 += STEP_MIN
      byMonth[month]!.flat8 += STEP_MIN
    }
    if (clearance > 0 && c.altitude >= 8 && moonFlatDown) {
      total.terrain += STEP_MIN
      byMonth[month]!.terrain += STEP_MIN
    }
    if (clearance > 0 && c.altitude >= 8 && moonTerrainDown) {
      total.terrainMoon += STEP_MIN
      byMonth[month]!.terrainMoon += STEP_MIN
    }
  }

  const h = (m: number) => (m / 60).toFixed(1).padStart(6)
  console.log(`## ${site.name}   elev ${profile.elevationM.toFixed(0)} m`)
  console.log(`   astronomical darkness      ${h(darkMinutes)} h/yr`)
  console.log(`   core ≥8°, moon down         ${h(total.flat8)} h/yr   (the shipped flat gate)`)
  console.log(
    `   + above measured terrain    ${h(total.terrain)} h/yr   ${pct(total.terrain, total.flat8)}`,
  )
  console.log(
    `   + moon blocked by terrain   ${h(total.terrainMoon)} h/yr   ${pct(total.terrainMoon, total.flat8)}`,
  )
  console.log(
    `   peak core altitude ${peakCore.toFixed(2)}°   best clearance ${peakClearance.toFixed(2)}° on ${peakClearanceDate}`,
  )
  console.log(
    `   month  ${Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(5)).join('')}`,
  )
  console.log(`   flat8  ${byMonth.map((b) => (b.flat8 / 60).toFixed(0).padStart(5)).join('')}`)
  console.log(`   terrain${byMonth.map((b) => (b.terrain / 60).toFixed(0).padStart(5)).join('')}`)
  console.log()
}

function pct(a: number, b: number): string {
  if (b === 0) return ''
  const d = ((a - b) / b) * 100
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}% vs flat`
}

function eq(body: Body, time: Date, observer: AstroObserver): [number, number] {
  const e = Equator(body, time, observer, true, true)
  return [e.ra, e.dec]
}
