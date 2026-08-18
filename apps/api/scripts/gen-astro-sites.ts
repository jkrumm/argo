/* eslint-disable no-console */
/**
 * Measures every number in `src/lib/astro-sites.ts` and prints them.
 *
 * Run from `apps/api`:
 *
 *   bun run gen:astro-sites
 *
 * It PRINTS the site literal; it does not write the module. A generator that
 * rewrites the file it generates is a foot-gun — the numbers here come from two
 * public upstreams and a model with real error bars, so a human reads the table,
 * sees whether anything moved, and pastes. The committed values then carry the
 * date they were measured (`ASTRO_SITE_MEASUREMENTS.computedOn`), which is the
 * whole point of not typing them by hand.
 *
 * Sources:
 *   - Light pollution: David J. Lorenz's binary tiles, via `clients/lorenz-atlas.ts`.
 *   - Direction-resolved skyglow: the ray-march in `lib/skyglow.ts`, over the same tiles.
 *   - Terrain: AWS `elevation-tiles-prod` terrarium DEM at z11, via `lib/terrain-horizon.ts`.
 *
 * SELF-CHECKING. Every quantity is compared against the acceptance table
 * published in `docs/ASTRO-MAP-RESEARCH.md` §1.4, §2.5 and §3, and the run exits
 * non-zero on any FAIL. That makes a re-run a regression test over the whole
 * Phase 1–3 pipeline — decoder, ray-march, ephemeris and horizon geometry — not
 * just a data refresh. When the atlas publishes a new vintage the numbers WILL
 * move: update the expectations here in the same commit as the site table, and
 * say so in the message. Never widen a tolerance to make a run pass.
 */

// `clients/lorenz-atlas.ts` reaches `telemetry.ts`, which validates the API's
// entire env at import time. This generator touches neither Postgres nor the
// bearer guard, so stub the two required vars instead of forcing every run
// through `secrets-run` for credentials it will not use. The import below is
// dynamic precisely so these land first — a static one is hoisted above them.
process.env['DATABASE_URL'] ??= 'postgres://gen-astro-sites@localhost/unused'
process.env['API_SECRET'] ??= 'gen-astro-sites'

import { join } from 'node:path'
import { galacticCorePosition } from '../src/lib/astro-ephemeris.js'
import { ASTRO_SITES } from '../src/lib/astro-sites.js'
import { LATEST_LORENZ_YEAR } from '../src/lib/lorenz-decode.js'
import {
  HORIZON_AZIMUTH_STEP_DEG,
  HORIZON_DEM_ZOOM,
  HORIZON_RANGE_M,
  horizonProfile,
  SOUTH_ARC,
  southernHorizon,
} from '../src/lib/terrain-horizon.js'
import { terrariumDem } from './terrarium-dem.js'

const { fetchLightPollution, fetchSkyglow } = await import('../src/clients/lorenz-atlas.js')

/**
 * The season reference the published core-direction figures were taken at —
 * pinned, never `today`.
 *
 * The core's azimuth at peak altitude swings with the date, and so therefore
 * does which part of the light dome the camera looks into. A generator run in
 * December would produce a different (and, for this feature, meaningless)
 * geometry and silently disagree with the paper. Mid-July at ~22:00 UTC is the
 * middle of the season this whole feature exists for.
 */
const REFERENCE_INSTANT = new Date('2026-07-15T22:00:00Z')

/** Peak search around the reference instant: ±6 h in 15-minute steps. */
const PEAK_SEARCH_HOURS = 6
const PEAK_SEARCH_STEP_HOURS = 0.25

/** Tiles are fetched over a square 1.6× the march range, matching `docs/poc/astro-map/horizon.py`. */
const DEM_PREFETCH_RADIUS_M = HORIZON_RANGE_M * 1.6

const DEM_CACHE_DIR = join(import.meta.dir, '../.cache/terrarium')

// ── Acceptance table (docs/ASTRO-MAP-RESEARCH.md §1.4, §2.5, §3) ─────────

type Expectation = {
  mpsas: number
  lpi: number
  zone: string
  trend10yPercent: number
  coreDirectionMpsas: number
  domePenaltyMag: number
  southHorizonDeg: number
  southHorizonMeanDeg: number
  siteElevationM: number
}

const EXPECTED: Record<string, Expectation> = {
  munich: {
    mpsas: 18.44,
    lpi: 25.49,
    zone: '6b',
    trend10yPercent: 8,
    coreDirectionMpsas: 17.31,
    domePenaltyMag: 1.09,
    southHorizonDeg: 1.0,
    southHorizonMeanDeg: 0.7,
    siteElevationM: 525,
  },
  alpenvorland: {
    mpsas: 21.14,
    lpi: 1.22,
    zone: '4a',
    trend10yPercent: 27,
    coreDirectionMpsas: 19.7,
    domePenaltyMag: 1.04,
    southHorizonDeg: 3.8,
    southHorizonMeanDeg: 2.6,
    siteElevationM: 599,
  },
  'bayerischer-wald': {
    mpsas: 21.57,
    lpi: 0.48,
    zone: '3a',
    trend10yPercent: 6,
    coreDirectionMpsas: 19.76,
    domePenaltyMag: 1.34,
    southHorizonDeg: 0.6,
    southHorizonMeanDeg: 0.2,
    siteElevationM: 809,
  },
  walchensee: {
    mpsas: 21.55,
    lpi: 0.51,
    zone: '3a',
    trend10yPercent: 25,
    coreDirectionMpsas: 19.98,
    domePenaltyMag: 1.03,
    southHorizonDeg: 5.7,
    southHorizonMeanDeg: 4.5,
    siteElevationM: 801,
  },
}

/** Per-quantity tolerances. Widening one to make a run pass defeats the check. */
const TOLERANCE = {
  mpsas: 0.01,
  lpi: 0.01,
  coreDirectionMpsas: 0.02,
  domePenaltyMag: 0.02,
  horizonDeg: 0.2,
  siteElevationM: 3,
  trendPercentagePoints: 1,
} as const

// ── Measurement ──────────────────────────────────────────────────────────

type Measurement = {
  id: string
  name: string
  lat: number
  lon: number
  mpsas: number
  lpi: number
  zone: string
  trend10yPercent: number | null
  coreAzimuthDeg: number
  coreAltitudeDeg: number
  coreDirectionMpsas: number
  domePenaltyMag: number
  southHorizonDeg: number
  southHorizonMeanDeg: number
  siteElevationM: number
  highestHorizonDeg: number
  highestHorizonAzimuthDeg: number
  /** The committed skyline: far-band altitude per azimuth, ascending from 0°, 2 dp. */
  horizonDeg: number[]
}

/**
 * Where the core stands at its best moment near the reference instant.
 *
 * The −90° seed is a sentinel for "never checked a real position", not a
 * possible answer — `measure()` below refuses to act on it (see there for why).
 */
function corePeak(site: { lat: number; lon: number }): { azimuthDeg: number; altitudeDeg: number } {
  let peak = { azimuthDeg: 180, altitudeDeg: -90 }
  for (
    let hours = -PEAK_SEARCH_HOURS;
    hours <= PEAK_SEARCH_HOURS;
    hours += PEAK_SEARCH_STEP_HOURS
  ) {
    const at = new Date(REFERENCE_INSTANT.getTime() + hours * 3_600_000)
    const position = galacticCorePosition(site, at)
    if (position.altitude > peak.altitudeDeg) {
      peak = { azimuthDeg: position.azimuth, altitudeDeg: position.altitude }
    }
  }
  return peak
}

/** One upstream tile (atlas or DEM) that failed to resolve during this run. */
type FetchFailure = { site: string; reason: string }

async function measure(): Promise<{ rows: Measurement[]; fetchFailures: FetchFailure[] }> {
  const fetchFailures: FetchFailure[] = []

  console.log(`Terrarium DEM z${HORIZON_DEM_ZOOM} → ${DEM_CACHE_DIR}`)
  const dem = await terrariumDem({ zoom: HORIZON_DEM_ZOOM, cacheDir: DEM_CACHE_DIR })
  await dem.prefetch(
    ASTRO_SITES.map((site) => ({ lat: site.lat, lon: site.lon, radiusM: DEM_PREFETCH_RADIUS_M })),
  )
  const tiles = dem.stats()
  console.log(`  ${tiles.tiles} tiles (${tiles.fromCache} cached, ${tiles.missing} unavailable)\n`)
  // Previously logged and ignored: a missing DEM tile still lets the horizon
  // math run over incomplete terrain, and the number it produces can land
  // inside tolerance by luck — an "all PASS" report with silently wrong data.
  if (tiles.missing > 0) {
    fetchFailures.push({
      site: '(DEM prefetch)',
      reason: `${tiles.missing} of ${tiles.tiles} terrarium DEM tile(s) unavailable`,
    })
  }

  const measurements: Measurement[] = []

  for (const site of ASTRO_SITES) {
    console.log(`measuring ${site.name}…`)
    const point = { lat: site.lat, lon: site.lon }
    const peak = corePeak(point)

    // The core's declination is −29°, so above ~61°N it never clears the
    // horizon and `corePeak` returns its −90° sentinel unchanged. Feeding that
    // into `fetchSkyglow` would ray-march a direction under the ground and
    // write a confident, meaningless number into committed data — the same
    // reasoning `GET /astro/skyglow` 422s on at runtime (`routes/astro.ts`).
    if (peak.altitudeDeg <= 0) {
      throw new Error(
        `${site.id}: the galactic core never clears the horizon here (peaks at ${peak.altitudeDeg.toFixed(1)}°) — refusing to generate garbage skyglow data for it.`,
      )
    }

    const [pollution, skyglow] = await Promise.all([
      fetchLightPollution({ ...point, year: LATEST_LORENZ_YEAR }),
      fetchSkyglow({
        ...point,
        year: LATEST_LORENZ_YEAR,
        coreAzimuthDeg: peak.azimuthDeg,
        coreAltitudeDeg: peak.altitudeDeg,
      }),
    ])
    if (!pollution) {
      fetchFailures.push({ site: site.id, reason: 'light-pollution atlas tile unavailable' })
      continue
    }
    if (!skyglow) {
      fetchFailures.push({ site: site.id, reason: 'skyglow march tile(s) unavailable' })
      continue
    }
    if (pollution.trend10yPercent === null) {
      fetchFailures.push({
        site: site.id,
        reason: 'baseline (2016) atlas tile unavailable for trend',
      })
    }

    const profile = horizonProfile({ sampler: dem.sampler, site: point })
    const south = southernHorizon(profile)
    const highest = profile.points.reduce((a, b) => (b.altitudeDeg > a.altitudeDeg ? b : a))
    // The committed skyline: one entry per azimuth, ascending from 0° — exactly
    // `profile.points`' own order, since `horizonProfile` already walks 0..355
    // in `HORIZON_AZIMUTH_STEP_DEG` steps. Never re-derive this by re-marching;
    // it must be the SAME far-band values `southHorizonDeg` was reduced from.
    const horizonDeg = profile.points.map((point_) => round2(point_.altitudeDeg))

    measurements.push({
      id: site.id,
      name: site.name,
      lat: site.lat,
      lon: site.lon,
      mpsas: pollution.mpsas,
      lpi: pollution.lpi,
      zone: pollution.zone,
      trend10yPercent: pollution.trend10yPercent,
      coreAzimuthDeg: peak.azimuthDeg,
      coreAltitudeDeg: peak.altitudeDeg,
      coreDirectionMpsas: skyglow.core.mpsas,
      domePenaltyMag: skyglow.core.domePenaltyMag,
      southHorizonDeg: south.maxDeg,
      southHorizonMeanDeg: south.meanDeg,
      siteElevationM: profile.elevationM,
      highestHorizonDeg: highest.altitudeDeg,
      highestHorizonAzimuthDeg: highest.azimuthDeg,
      horizonDeg,
    })
  }

  return { rows: measurements, fetchFailures }
}

function printFetchFailures(failures: FetchFailure[]): void {
  if (failures.length === 0) return
  console.log('\n── fetch failures (checked independently of acceptance) ────────────────')
  for (const failure of failures) console.log(`FAIL  ${pad(failure.site, 20)}${failure.reason}`)
  console.log(
    `\n${failures.length} fetch failure(s) — a network blip, not a modelling regression. Re-run once the upstream is healthy; this alone fails the run regardless of the acceptance table above.`,
  )
}

// ── Output ───────────────────────────────────────────────────────────────

const pad = (value: string, width: number) => value.padEnd(width)
const num = (value: number, digits = 2) => value.toFixed(digits)
const round2 = (value: number) => Math.round(value * 100) / 100

function printTable(rows: Measurement[]): void {
  console.log('\n── measured ────────────────────────────────────────────────────────────')
  console.log(
    `${pad('site', 18)}${pad('mpsas', 8)}${pad('lpi', 8)}${pad('zone', 6)}${pad('trend', 8)}${pad('core mag', 10)}${pad('penalty', 9)}${pad('S-hor max/mean', 16)}elev`,
  )
  for (const row of rows) {
    const trend =
      row.trend10yPercent === null
        ? 'n/a'
        : `${row.trend10yPercent >= 0 ? '+' : ''}${num(row.trend10yPercent, 0)}%`
    console.log(
      `${pad(row.id, 18)}${pad(num(row.mpsas), 8)}${pad(num(row.lpi), 8)}${pad(row.zone, 6)}${pad(trend, 8)}${pad(num(row.coreDirectionMpsas), 10)}${pad(num(row.domePenaltyMag), 9)}${pad(`${num(row.southHorizonDeg, 1)}° / ${num(row.southHorizonMeanDeg, 1)}°`, 16)}${num(row.siteElevationM, 0)} m`,
    )
  }
  console.log('\ncore geometry at the pinned reference instant, and the highest horizon overall:')
  for (const row of rows) {
    console.log(
      `  ${pad(row.id, 18)}core ${num(row.coreAltitudeDeg, 1)}° @ az ${num(row.coreAzimuthDeg, 0)}°   highest horizon ${num(row.highestHorizonDeg, 1)}° @ az ${num(row.highestHorizonAzimuthDeg, 0)}°`,
    )
  }
}

function printLiteral(rows: Measurement[], computedOn: string): void {
  console.log('\n── paste into src/lib/astro-sites.ts ───────────────────────────────────')
  console.log(`export const ASTRO_SITE_MEASUREMENTS = {`)
  console.log(`  atlasYear: ${LATEST_LORENZ_YEAR},`)
  console.log(`  computedOn: '${computedOn}',`)
  console.log(`  generator: 'apps/api/scripts/gen-astro-sites.ts',`)
  console.log(`} as const\n`)
  for (const row of rows) {
    console.log(`  // ${row.name}`)
    console.log(`    mpsas: ${num(row.mpsas)},`)
    console.log(`    lpi: ${num(row.lpi)},`)
    console.log(`    zone: '${row.zone}',`)
    console.log(
      `    trend10yPercent: ${row.trend10yPercent === null ? 'null' : num(row.trend10yPercent, 0)},`,
    )
    console.log(`    coreDirectionMpsas: ${num(row.coreDirectionMpsas)},`)
    console.log(`    domePenaltyMag: ${num(row.domePenaltyMag)},`)
    console.log(`    southHorizonDeg: ${num(row.southHorizonDeg, 1)},`)
    console.log(`    siteElevationM: ${num(row.siteElevationM, 0)},`)
    console.log(`    horizonDeg: [${row.horizonDeg.map((deg) => num(deg)).join(', ')}],`)
  }
}

// ── Acceptance check ─────────────────────────────────────────────────────

type Check = { site: string; quantity: string; got: string; want: string; ok: boolean; tol: string }

function checkNumber(args: {
  site: string
  quantity: string
  got: number | null
  want: number
  tolerance: number
  unit: string
  digits: number
}): Check {
  const ok = args.got !== null && Math.abs(args.got - args.want) <= args.tolerance
  return {
    site: args.site,
    quantity: args.quantity,
    got: args.got === null ? 'null' : num(args.got, args.digits),
    want: num(args.want, args.digits),
    ok,
    tol: `±${args.tolerance}${args.unit}`,
  }
}

/**
 * Self-check on the paste-ready `horizonDeg` array itself, independent of the
 * hand-typed `EXPECTED` table: the array must have exactly one entry per
 * `HORIZON_AZIMUTH_STEP_DEG` step around the compass, and its max over
 * `SOUTH_ARC` must equal the committed `southHorizonDeg` to 0.01° — the same
 * reduction `southernHorizon()` performs on the profile this array was cut
 * from. This is what catches a stale paste (one column pasted, the other
 * forgotten) rather than a wrong measurement.
 */
function horizonDegSelfCheck(row: Measurement): Check[] {
  const expectedLength = 360 / HORIZON_AZIMUTH_STEP_DEG
  const lengthOk = row.horizonDeg.length === expectedLength

  let southMax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < row.horizonDeg.length; i++) {
    const azimuthDeg = i * HORIZON_AZIMUTH_STEP_DEG
    if (azimuthDeg < SOUTH_ARC.fromDeg || azimuthDeg > SOUTH_ARC.toDeg) continue
    const altitudeDeg = row.horizonDeg[i]!
    if (altitudeDeg > southMax) southMax = altitudeDeg
  }

  return [
    {
      site: row.id,
      quantity: 'horizonDeg length',
      got: String(row.horizonDeg.length),
      want: String(expectedLength),
      ok: lengthOk,
      tol: 'exact',
    },
    checkNumber({
      site: row.id,
      quantity: 'horizonDeg S-max',
      got: southMax,
      want: row.southHorizonDeg,
      tolerance: 0.01,
      unit: '°',
      digits: 2,
    }),
  ]
}

function acceptance(rows: Measurement[]): Check[] {
  const checks: Check[] = []

  for (const row of rows) {
    const want = EXPECTED[row.id]
    if (!want) {
      checks.push({
        site: row.id,
        quantity: 'published?',
        got: 'measured',
        want: 'no published row',
        ok: false,
        tol: '—',
      })
      continue
    }

    checks.push(
      checkNumber({
        site: row.id,
        quantity: 'mpsas',
        got: row.mpsas,
        want: want.mpsas,
        tolerance: TOLERANCE.mpsas,
        unit: '',
        digits: 2,
      }),
      checkNumber({
        site: row.id,
        quantity: 'lpi',
        got: row.lpi,
        want: want.lpi,
        tolerance: TOLERANCE.lpi,
        unit: '',
        digits: 2,
      }),
      {
        site: row.id,
        quantity: 'zone',
        got: row.zone,
        want: want.zone,
        ok: row.zone === want.zone,
        tol: 'exact',
      },
      checkNumber({
        site: row.id,
        quantity: 'trend10y',
        got: row.trend10yPercent,
        want: want.trend10yPercent,
        tolerance: TOLERANCE.trendPercentagePoints,
        unit: ' pp',
        digits: 0,
      }),
      checkNumber({
        site: row.id,
        quantity: 'core mpsas',
        got: row.coreDirectionMpsas,
        want: want.coreDirectionMpsas,
        tolerance: TOLERANCE.coreDirectionMpsas,
        unit: '',
        digits: 2,
      }),
      checkNumber({
        site: row.id,
        quantity: 'dome penalty',
        got: row.domePenaltyMag,
        want: want.domePenaltyMag,
        tolerance: TOLERANCE.domePenaltyMag,
        unit: '',
        digits: 2,
      }),
      checkNumber({
        site: row.id,
        quantity: 'S-horizon max',
        got: row.southHorizonDeg,
        want: want.southHorizonDeg,
        tolerance: TOLERANCE.horizonDeg,
        unit: '°',
        digits: 2,
      }),
      checkNumber({
        site: row.id,
        quantity: 'S-horizon mean',
        got: row.southHorizonMeanDeg,
        want: want.southHorizonMeanDeg,
        tolerance: TOLERANCE.horizonDeg,
        unit: '°',
        digits: 2,
      }),
      checkNumber({
        site: row.id,
        quantity: 'DEM elevation',
        got: row.siteElevationM,
        want: want.siteElevationM,
        tolerance: TOLERANCE.siteElevationM,
        unit: ' m',
        digits: 0,
      }),
    )
    checks.push(...horizonDegSelfCheck(row))
  }

  return checks
}

function printAcceptance(checks: Check[]): number {
  console.log('\n── acceptance vs docs/ASTRO-MAP-RESEARCH.md §1.4 / §2.5 / §3 ───────────')
  let failed = 0
  for (const check of checks) {
    if (!check.ok) failed += 1
    console.log(
      `${check.ok ? 'PASS' : 'FAIL'}  ${pad(check.site, 18)}${pad(check.quantity, 16)}got ${pad(check.got, 10)}want ${pad(check.want, 10)}tol ${check.tol}`,
    )
  }
  console.log(
    failed === 0
      ? `\n${checks.length} checks, all PASS.`
      : `\n${checks.length} checks, ${failed} FAILED.`,
  )
  return failed
}

// ── Main ─────────────────────────────────────────────────────────────────

const computedOn = new Date().toISOString().slice(0, 10)
const { rows, fetchFailures } = await measure()

printTable(rows)
printLiteral(rows, computedOn)
const acceptanceFailed = printAcceptance(acceptance(rows))
printFetchFailures(fetchFailures)

console.log(`\nAtlas vintage ${LATEST_LORENZ_YEAR}; computed on ${computedOn} (UTC).`)
console.log(`Core geometry pinned to ${REFERENCE_INSTANT.toISOString()} ±${PEAK_SEARCH_HOURS} h.`)

// Fetch failures fail the run on their OWN, independent of the acceptance
// table: the whole premise of committing this script's output is that it is
// trustworthy, and a transient upstream blip must never be indistinguishable
// from a clean "all PASS" run just because the numbers it produced happened
// to land inside tolerance anyway.
//
// Explicit exit, because the OTel batch processor keeps a timer alive and
// would otherwise hold the process open long after the numbers are printed.
process.exit(acceptanceFailed === 0 && fetchFailures.length === 0 ? 0 : 1)
