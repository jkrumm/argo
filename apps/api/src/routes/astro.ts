import { Elysia } from 'elysia'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  cloudAt,
  fetchAstroUpstreams,
  transparencyAt,
  type AstroUpstreams,
} from '../clients/astro-upstreams.js'
import {
  fetchLightPollution,
  fetchLpTile,
  fetchSkyglow,
  type LightPollutionPoint,
  type SkyglowResult,
} from '../clients/lorenz-atlas.js'
import {
  fetchHorizonProfile,
  horizonTileCount,
  MAX_HORIZON_TILES,
  type HorizonResult,
} from '../clients/terrarium-dem.js'
import {
  addDays,
  formatLocalDate,
  formatLocalTime,
  FRAMING_MARGIN_DEG,
  resolveNight,
  zonedTimeToUtc,
  type AstroNight,
  type NightSample,
} from '../lib/astro-night.js'
import { coreTransit, galacticCorePosition } from '../lib/astro-ephemeris.js'
import {
  annualVisibility,
  VISIBILITY_MAX_MOON_ILLUMINATION,
  VISIBILITY_STEP_MINUTES,
  type AnnualVisibility,
  type VisibilityGate,
} from '../lib/astro-visibility.js'
import { LORENZ_YEARS, LATEST_LORENZ_YEAR, type LorenzYear } from '../lib/lorenz-decode.js'
import { LP_TILE_MAX_ZOOM, LP_TILE_MIN_ZOOM } from '../lib/lp-tile.js'
import {
  HORIZON_AZIMUTH_STEP_DEG,
  HORIZON_DEM_ZOOM,
  HORIZON_RANGE_M,
  HORIZON_STEP_M,
  NEAR_FIELD_M,
  REFRACTION_K,
  SOUTH_ARC,
} from '../lib/terrain-horizon.js'
import {
  ASTRO_SITE_MEASUREMENTS,
  ASTRO_SITES,
  DEFAULT_SITE,
  distanceKm,
  findSite,
  nearestSite,
  type AstroSite,
} from '../lib/astro-sites.js'
import {
  astroWindowConfig,
  evaluationSamples,
  MIN_CORE_ALTITUDE,
  type AstroScoreInput,
} from '../lib/astro-score.js'
import { geocodeCity } from '../lib/geocode.js'
import { scoreWindow, type ScoredWindow } from '../lib/window-score.js'
import { completeSentence } from '../lib/ai-sentence.js'
import { aiComplete } from './ai.js'

/**
 * "Is tonight worth going out for?" — for Milky Way nightscapes.
 *
 * The division of labour here is the whole point and must not blur: the
 * altitude, the twilight boundary, the moon and the score are computed
 * deterministically in `lib/astro-*.ts`, and the model is handed the finished
 * verdict and asked only to write one sentence about it. A model that computes
 * an altitude is a bug factory; a model that phrases an already-computed
 * verdict is a nicety that can fail without taking the endpoint with it.
 *
 * Upstream fan-out is flat: one `fetchAstroUpstreams` call covers every night
 * in the range (three parallel HTTP calls, all cached for an hour), so a
 * 10-night request is not 10× anything.
 */

/** Open-Meteo and DWD are CC BY 4.0; 7Timer asks for a credit. Returned in every payload. */
const ATTRIBUTION =
  'Cloud data by Open-Meteo.com (CC BY 4.0), model DWD ICON. Atmospheric transparency by 7Timer!. Ephemeris computed locally.'

/** Hard ceiling on the requested range. Beyond ~2 weeks no forecast means anything. */
const MAX_NIGHTS = 14

/**
 * How far the nearest known site may be before its measured core-direction sky
 * brightness stops meaning anything about the requested coordinates. Beyond
 * this the value is reported as unknown and drops out of the score, lowering
 * `coverage` — which is honest, where handing back Munich's 17.31 mag/arcsec²
 * for a request in Tenerife would not be.
 */
const DARKNESS_INFERENCE_RADIUS_KM = 150

/** Wire resolution for the hourly detail series. The engine still samples at 5 min. */
const HOURLY_STEP_MINUTES = 30

/**
 * Only emit hourly points from late afternoon onward — the leading hours of the
 * sampling span are broad daylight and carry no information for this question.
 */
const HOURLY_SUN_ALTITUDE_CEILING = 5

/** How long a generated sentence is reused for. Forecasts refresh hourly at best. */
const SUMMARY_TTL_MS = 30 * 60_000

const KillerSchema = z.object({
  id: z.string().describe('Stable machine id, e.g. `moon`'),
  label: z.string(),
  reason: z.string().describe('Human-readable, already contains the numbers'),
})

const FactorSchema = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number().describe('Relative importance; only ratios are meaningful'),
  value: z.number().nullable().describe('0..1, 1 is perfect. null = the upstream had no data'),
  weighted: z.number().nullable(),
  detail: z.string().optional().describe('One-line human summary of the current value'),
})

const ShootingWindowSchema = z.object({
  date: z.string().describe('Local calendar date the night starts on, YYYY-MM-DD'),
  start: z.string().describe('ISO 8601 UTC'),
  end: z.string().describe('ISO 8601 UTC'),
  localStart: z.string().describe('HH:MM in the location timezone'),
  localEnd: z.string().describe('HH:MM in the location timezone'),
  minutes: z.number().int(),
  peakTime: z.string().describe('ISO 8601 UTC — when the core is highest inside the window'),
  localPeakTime: z.string(),
  peakCoreAltitude: z.number().describe('degrees'),
  peakCoreAzimuth: z.number().describe('degrees from north through east'),
  maxMoonAltitude: z.number().describe('degrees; negative means the moon is down throughout'),
})

const MoonSchema = z.object({
  illumination: z.number().describe('0..1 illuminated fraction at local midnight'),
  phase: z.number().describe('0..360°: 0 new, 90 first quarter, 180 full, 270 last quarter'),
  rise: z.string().nullable().describe('ISO 8601 UTC, or null if it does not rise this night'),
  set: z.string().nullable(),
})

const WeatherSchema = z.object({
  cloudLow: z.number().nullable().describe('mean % across the window'),
  cloudMid: z.number().nullable().describe('mean % across the window'),
  cloudHigh: z.number().nullable().describe('mean % across the window'),
  transparency: z.number().nullable().describe('7Timer band, 1 (best) to 8'),
})

const NightSchema = z.object({
  date: z.string().describe('Local calendar date the night starts on, YYYY-MM-DD'),
  verdict: z
    .enum(['excellent', 'good', 'marginal', 'poor', 'out'])
    .describe('`out` means a hard gate failed — see killers; it is not a low score'),
  score: z.number().describe('0..100. Always exactly 0 when verdict is `out`'),
  coverage: z
    .number()
    .describe('0..1 — share of the scoring weight that had upstream data behind it'),
  killers: z.array(KillerSchema),
  factors: z.array(FactorSchema),
  window: ShootingWindowSchema.nullable(),
  darkStart: z
    .string()
    .nullable()
    .describe('ISO 8601 UTC; null when there is no astronomical night'),
  darkEnd: z.string().nullable(),
  darkMinutes: z.number().int(),
  transit: z.string().describe('ISO 8601 UTC — galactic core upper transit'),
  localTransit: z.string(),
  maxCoreAltitude: z.number().describe('degrees at transit; ~12.8° is the Munich ceiling'),
  peakCoreClearanceDeg: z
    .number()
    .nullable()
    .describe(
      'Highest core altitude ABOVE the measured ridge while astronomically dark, degrees. Null when the location has no committed skyline (see `location.southHorizonDeg`) — a flat gate has nothing certain to say about clearance',
    ),
  moon: MoonSchema,
  weather: WeatherSchema,
})

const HourlyPointSchema = z.object({
  time: z.string().describe('ISO 8601 UTC'),
  localTime: z.string().describe('HH:MM in the location timezone'),
  coreAltitude: z.number(),
  coreAzimuth: z.number(),
  sunAltitude: z.number(),
  sunAzimuth: z.number().describe('Degrees from north through east'),
  moonAltitude: z.number(),
  moonAzimuth: z.number().describe('Degrees from north through east'),
  astroDark: z.boolean(),
  coreClearance: z
    .number()
    .nullable()
    .describe(
      'coreAltitude minus the measured ridge at coreAzimuth, degrees. Null without a profile',
    ),
  moonBehindTerrain: z
    .boolean()
    .describe('True when the moon is above 0° but below the measured ridge at its own azimuth'),
  cloudLow: z.number().nullable(),
  cloudMid: z.number().nullable(),
  cloudHigh: z.number().nullable(),
})

const LocationSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  name: z.string(),
  timeZone: z.string(),
  coreDirectionMpsas: z
    .number()
    .nullable()
    .describe(
      'Measured sky brightness where the galactic core sits, mag/arcsec² — higher is darker. Null when no known site is close enough to infer it',
    ),
  domePenaltyMag: z
    .number()
    .nullable()
    .describe(
      'How many magnitudes brighter the core direction is than the zenith. Measured at the site when `darknessSource` is `site`; inherited verbatim from the nearest site (up to 150 km away) when it is `nearest-site`. Null when unknown or when `coreDirectionMpsas` was overridden by the caller',
    ),
  southHorizonDeg: z
    .number()
    .nullable()
    .describe(
      'Highest terrain horizon across the 150–215° arc the core crosses, degrees — the same figure GET /astro/sites publishes. Only present when the location resolved to a committed site (`siteId` non-null); null for a raw lat/lon or city, which never fetches a DEM here — scoring stays synchronous, GET /astro/horizon is the door for an arbitrary coordinate',
    ),
  darknessSource: z
    .enum(['site', 'nearest-site', 'query', 'unknown'])
    .describe(
      '`nearest-site` means it was inferred from the closest known site; `unknown` means none was close enough and sky darkness dropped out of the score',
    ),
  siteId: z.string().nullable(),
  nearestSiteId: z.string(),
  nearestSiteKm: z.number(),
})

const WindowResponseSchema = z.object({
  location: LocationSchema,
  generatedAt: z.string(),
  nights: z.array(NightSchema).describe('One entry per requested night, earliest first'),
  verdict: z.enum(['excellent', 'good', 'marginal', 'poor', 'out']).describe('The best night’s'),
  score: z.number(),
  killers: z.array(KillerSchema).describe('Of the best night; empty unless every night is out'),
  bestWindow: ShootingWindowSchema.nullable().describe('Null when no night in the range is usable'),
  summary: z
    .string()
    .nullable()
    .describe('One-sentence plain-English recommendation. Null when the model is unavailable'),
  detail: z.object({
    date: z.string(),
    hourly: z.array(HourlyPointSchema),
  }),
  sources: z.object({
    dwdIcon: z.boolean(),
    globalForecast: z.boolean(),
    sevenTimer: z.boolean(),
  }),
  attribution: z.string(),
})

const SiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  timeZone: z.string(),
  driveMinutes: z.number().int(),
  mpsas: z.number().describe('Zenith sky brightness, mag/arcsec² — higher is darker'),
  lpi: z.number().describe('Light Pollution Index: artificial over natural zenith brightness'),
  zone: z.string().describe('Lorenz zone band, `0a`..`7b`'),
  trend10yPercent: z.number().describe('Change in `lpi` from the 2016 atlas to `atlasYear`'),
  coreDirectionMpsas: z
    .number()
    .describe('Sky brightness where the galactic core sits — the number a frame actually sees'),
  domePenaltyMag: z.number().describe('How much darker the zenith reads than the core direction'),
  southHorizonDeg: z
    .number()
    .describe('Highest terrain horizon across the 150–215° arc the core crosses, degrees'),
  siteElevationM: z.number().describe('DEM elevation of the site, metres'),
  note: z.string(),
})

const MeasurementSchema = z
  .object({
    atlasYear: z.number().int().describe('Lorenz atlas vintage every `mpsas`/`lpi`/`zone` reads'),
    computedOn: z.string().describe('ISO 8601 date the constants were last generated'),
    generator: z.string().describe('Script that produces them, and re-checks the acceptance table'),
  })
  .describe('Provenance of the committed per-site measurements — how stale these constants are')

const WindowQuerySchema = z.object({
  site: z.string().optional().describe('Site id from GET /astro/sites. Wins over lat/lon and city'),
  lat: z.coerce.number().min(-90).max(90).optional().describe('Required together with lon'),
  lon: z.coerce.number().min(-180).max(180).optional(),
  city: z
    .string()
    .min(2)
    .optional()
    .describe('Geocoded via Open-Meteo. Used only if no site/latlon'),
  nights: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_NIGHTS)
    .optional()
    .describe('How many nights from tonight. Default 10'),
  detailDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Which night the hourly series covers. Default: the best night'),
  coreMpsas: z.coerce
    .number()
    .min(14)
    .max(22.5)
    .optional()
    .describe('Override the core-direction sky brightness (mag/arcsec²) for a raw lat/lon'),
  // Not `z.coerce.boolean()`: `Boolean('false')` is `true`, so coercion would
  // silently ignore the one value anyone ever passes here.
  summary: z
    .enum(['true', 'false'])
    .optional()
    .describe('Set `false` to skip the generated sentence and the model call entirely'),
})

// ── Light pollution / skyglow ────────────────────────────────────────────

/** The atlas ships no licence; its author asks for this credit and nothing else. */
const ATLAS_ATTRIBUTION =
  'Light pollution from the Light Pollution Atlas by David J. Lorenz (djlorenz.github.io/astronomy). Ephemeris computed locally.'

/** Local wall-clock hour the core-peak search is anchored on — the middle of a shooting night. */
const CORE_SEARCH_ANCHOR_HOUR = 23

/** Half-width and resolution of the sweep around transit, in hours. Matches the research POC. */
const CORE_SEARCH_SPAN_HOURS = 6
const CORE_SEARCH_STEP_HOURS = 0.25

const LORENZ_YEAR_OPTIONS = LORENZ_YEARS.map(String) as [string, ...string[]]

const YearQueryParam = z
  .enum(LORENZ_YEAR_OPTIONS)
  .optional()
  .describe(`Atlas vintage. Default ${LATEST_LORENZ_YEAR}, the latest published`)

function parseYear(value: string | undefined): LorenzYear | undefined {
  return value === undefined ? undefined : (Number(value) as LorenzYear)
}

const PointQuerySchema = z.object({
  site: z.string().optional().describe('Site id from GET /astro/sites. Wins over lat/lon'),
  lat: z.coerce.number().min(-90).max(90).optional().describe('Required together with lon'),
  lon: z.coerce.number().min(-180).max(180).optional(),
  year: YearQueryParam,
})

const SkyglowQuerySchema = PointQuerySchema.extend({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Local calendar date of the night. Default: today in the location timezone'),
})

const LightPollutionResponseSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  siteId: z.string().nullable().describe('Null when the request used a raw lat/lon'),
  year: z.number().int().describe('Atlas vintage the values were read from'),
  lpi: z
    .number()
    .describe("Lorenz's Light Pollution Index — artificial over natural zenith brightness"),
  mpsas: z.number().describe('Total zenith brightness, mag/arcsec². Higher is darker'),
  zone: z.string().describe('Lorenz zone band, `0a`..`7b`. Each whole step is ×3 in LPI'),
  trend10yPercent: z
    .number()
    .nullable()
    .describe(
      'Percent change in LPI from 2016 to `year`. Null when the change is not measurable — the 2016 tile was unavailable, or its cell reads exactly 0 and a ratio against it has no meaning',
    ),
  source: z.string(),
  attribution: z.string(),
})

const SkyglowProfileSchema = z.object({
  azimuths: z.number().array().describe('Degrees from north through east, 0..355 in steps of 5'),
  altitudes: z.number().array().describe('Degrees above the horizon'),
  mpsas: z
    .number()
    .array()
    .array()
    .describe('[altitudeIndex][azimuthIndex] — ARTIFICIAL skyglow only, mag/arcsec²'),
  dominant: z
    .object({
      azimuthDeg: z.number(),
      compass: z.string().describe('16-point label, e.g. `NNE`'),
      mpsas: z.number(),
    })
    .describe('Brightest direction at 10° altitude — where the light dome sits'),
})

const SkyglowResponseSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  siteId: z.string().nullable(),
  year: z.number().int(),
  coreTime: z.string().describe('ISO 8601 UTC — the instant the core peaks on this night'),
  zenith: z.object({
    lpi: z.number(),
    mpsas: z.number().describe('Total zenith brightness, mag/arcsec²'),
    zone: z.string(),
  }),
  core: z.object({
    azimuthDeg: z.number().describe('Degrees from north through east'),
    altitudeDeg: z.number().describe('Degrees above the horizon at peak'),
    mpsas: z
      .number()
      .describe('Sky brightness where the camera points — artificial glow plus airglow'),
    domePenaltyMag: z
      .number()
      .describe('How many magnitudes darker the zenith reads than the core direction'),
  }),
  profile: SkyglowProfileSchema,
  model: z
    .object({
      hScatKm: z
        .number()
        .describe('Scattering scale height, km — how fast ground glow fades with altitude'),
      rangeKm: z.number().describe('How far the ray-march reaches outward from the site, km'),
      stepKm: z.number().describe('Distance between samples along each march ray, km'),
      coreRadiusKm: z
        .number()
        .describe(
          "The march's r0, km — keeps the site's own cell from behaving like a point source overhead",
        ),
      falloffExponent: z
        .number()
        .describe('Exponent on the `1 + (r/coreRadiusKm)^falloffExponent` falloff term'),
    })
    .describe('The ray-march kernel the numbers came out of — echoed so a result is reproducible'),
  source: z.string(),
  attribution: z.string(),
})

/**
 * `lat`/`lon` are both REQUIRED here, unlike `PointQuerySchema` — this route
 * has no `site` fallback and no default location, because the whole point is
 * answering for an arbitrary coordinate the map is scouting, not for one of
 * the four committed sites.
 */
const HorizonQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
})

const HorizonPointSchema = z.object({
  azimuthDeg: z.number().describe('Degrees from north through east'),
  altitudeDeg: z
    .number()
    .describe('Skyline altitude BEYOND the near field — the only band anything scores, degrees'),
  rangeM: z.number().describe('Distance to the obstruction that set altitudeDeg, metres'),
  summitM: z
    .number()
    .nullable()
    .describe(
      'Elevation of that obstruction, metres. Null when this azimuth had no far-band data at all',
    ),
  nearAltitudeDeg: z
    .number()
    .describe(
      'Highest ground WITHIN the near field, degrees — advisory, DEM-unstable at this range',
    ),
})

const HorizonResponseSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  elevationM: z.number().describe('DEM elevation of the coordinate itself, metres'),
  profile: z.array(HorizonPointSchema).describe('One entry per azimuth, ascending from 0°'),
  south: z.object({
    maxDeg: z.number().describe('The gate — the ridge that can hide the core outright'),
    meanDeg: z.number().describe('How walled-in the whole southern sweep is'),
  }),
  tilesRequested: z.number().int(),
  tilesResolved: z.number().int(),
  complete: z
    .boolean()
    .describe('False when any DEM tile failed — the profile is then a partial measurement'),
  source: z.string(),
  demZoom: z.number().int().describe('Web Mercator zoom the DEM was sampled at'),
  rangeM: z.number().describe('How far each ray was marched outward, metres'),
  stepM: z.number().describe('Distance between samples along each ray, metres'),
  nearFieldM: z.number().describe('Ray distance below which a sample is advisory-only, metres'),
  refractionK: z
    .number()
    .describe('Standard atmospheric refraction coefficient applied to every sample'),
  azimuthStepDeg: z.number().describe('Azimuth resolution of the profile, degrees'),
  southArc: z
    .object({ fromDeg: z.number(), toDeg: z.number() })
    .describe('The bearing range `south` is computed over — the arc the core actually crosses'),
})

// ── Annual visibility budget ────────────────────────────────────────────

/**
 * `lat`/`lon` mirror `HorizonQuerySchema`'s bounds, but are OPTIONAL here:
 * `site`, when given, resolves the location on its own and lat/lon are never
 * read. Exactly one of `site` or `lat`+`lon` must be present — checked in the
 * handler, because that is a cross-field rule the JSON Schema this produces
 * cannot express.
 */
const VisibilityQuerySchema = z.object({
  site: z
    .string()
    .optional()
    .describe(
      "Site id from GET /astro/sites. When given, uses that site's committed lat/lon/horizonDeg directly and skips coordinate resolution entirely — lat/lon and horizon are ignored",
    ),
  lat: z.coerce
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe('Required together with lon, unless site is given'),
  lon: z.coerce.number().min(-180).max(180).optional(),
  year: z.coerce
    .number()
    .int()
    .min(1900)
    .max(2100)
    .optional()
    .describe('Calendar year to integrate, UTC. Default: the current UTC year'),
  horizon: z
    .enum(['site', 'measure', 'none'])
    .optional()
    .describe(
      "How to resolve the skyline for a raw lat/lon — ignored when `site` is given. `site` (default): use a committed site's skyline ONLY when the coordinate resolves to one exactly, otherwise flat. `measure`: fetch a live terrain profile for this exact coordinate, the same door GET /astro/horizon uses. `none`: flat only, no DEM fetch",
    ),
})

const VisibilityGateSchema = z.object({
  minutes: z.number().int().describe('Total minutes in the year meeting this gate'),
  byMonth: z
    .number()
    .int()
    .array()
    .length(12)
    .describe('Minutes per calendar UTC month, index 0 = January'),
})

const VisibilityResponseSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  siteId: z
    .string()
    .nullable()
    .describe(
      'Non-null when `site` was given, or a raw lat/lon landed exactly on a committed site',
    ),
  year: z.number().int(),
  darkMinutes: z.number().int().describe('Minutes of astronomical night in the year'),
  flat: VisibilityGateSchema.describe(
    'Core above the flat atmospheric floor, moon down at 0° or under the illumination ceiling',
  ),
  terrain: VisibilityGateSchema.describe(
    '…and above max(atmosphericFloorDeg, skyline at the core’s azimuth + framingMarginDeg). Equals `flat` when horizonSource is `none`',
  ),
  terrainMoon: VisibilityGateSchema.describe(
    '…and the moon also counts as down when it sits behind the skyline at its own azimuth',
  ),
  peakCoreAltitudeDeg: z.number().describe('Highest core altitude reached during darkness'),
  peakClearanceDeg: z
    .number()
    .nullable()
    .describe(
      'Highest core clearance above the skyline during darkness. Null when horizonSource is `none`',
    ),
  peakClearanceDate: z
    .string()
    .nullable()
    .describe('ISO date of peakClearanceDeg. Null when horizonSource is `none`'),
  terrainBindsFraction: z
    .number()
    .describe(
      'Share of flat-gate minutes where the skyline plus margin was the tighter floor, 0..1',
    ),
  horizonSource: z.enum(['site', 'measured', 'none']).describe('Which skyline this answer used'),
  horizonComplete: z
    .boolean()
    .optional()
    .describe(
      'Only present when horizonSource is `measured` — false means at least one DEM tile failed and the profile is provisional',
    ),
  stepMinutes: z
    .number()
    .int()
    .describe('Sample spacing the annual integral was walked at, minutes'),
  atmosphericFloorDeg: z.number().describe('The flat core-altitude floor, before any terrain'),
  framingMarginDeg: z
    .number()
    .describe('Sky the frame needs above the ridge, added to the skyline'),
  maxMoonIllumination: z
    .number()
    .describe('Moon illuminated fraction above which the moon always counts as up'),
})

/**
 * Path params for the raster tile route.
 *
 * `y` carries the `.png` suffix rather than the route path: Elysia binds
 * `:y.png` as a parameter literally NAMED `y.png` (verified — it does not strip
 * the suffix), so the honest form is a plain `:y` segment whose value is
 * `"89.png"`. The suffix is REQUIRED, so the tile URL has exactly one shape.
 *
 * All three coordinates are matched as CANONICAL decimal strings rather than
 * coerced numbers, and that is the load-bearing half of "exactly one shape":
 * `z.coerce.number()` runs `Number()`, which happily accepts `0x87`, `1e2`,
 * `0135` and `%20135` as 135 — five URLs for one tile, each of which a browser
 * and Cloudflare would cache as a separate 30-day copy. The regex admits `0` or
 * a leading non-zero digit, and nothing else.
 *
 * The numeric bounds are cross-field (x and y run 0..2^z−1) or would not survive
 * the trip to JSON Schema, so they are checked in the handler.
 */
const CANONICAL_DECIMAL = /^(0|[1-9]\d{0,6})$/

const LpTileParamsSchema = z.object({
  year: z.enum(LORENZ_YEAR_OPTIONS).describe('Atlas vintage'),
  z: z
    .string()
    .regex(CANONICAL_DECIMAL)
    .describe(`Web Mercator zoom, ${LP_TILE_MIN_ZOOM}..${LP_TILE_MAX_ZOOM}`),
  x: z.string().regex(CANONICAL_DECIMAL).describe('Tile column, 0..2^z-1'),
  y: z
    .string()
    .regex(/^(0|[1-9]\d{0,6})\.png$/)
    .describe('Tile row followed by the required `.png` suffix, e.g. `89.png`'),
})

/**
 * 30 days. The atlas publishes once a year — but a vintage CAN be republished,
 * so not `immutable`.
 *
 * `private`, not `public`: the route is behind `authGuard`, and RFC 9111 §3.5
 * says a shared cache MUST NOT store a response to an `Authorization`-bearing
 * request UNLESS it carries `public`/`s-maxage`/`must-revalidate`. Saying
 * `public` is therefore the exact directive that would let the Cloudflare Tunnel
 * in front of argo.jkrumm.com keep a `.png` and replay it to callers with no
 * token. `private` buys the same browser caching without granting that.
 */
const LP_TILE_CACHE_CONTROL = 'private, max-age=2592000, stale-while-revalidate=86400'

/**
 * A partially covered render is provisional, so nothing may keep it.
 *
 * `fetchLpTile` already declines to cache it in-process precisely so the next
 * request re-tries the missing atlas tiles; handing the browser a 30-day copy
 * would pin the very bytes the client refused to keep. The unresolved region
 * encodes 22.00 — "pristine natural sky" — so a 20 s upstream blip during a z5
 * render would otherwise leave a fabricated dark zone over a city for a month.
 */
const LP_TILE_PARTIAL_CACHE_CONTROL = 'no-store'

/** Terrain does not move — the same 30-day/`private` reasoning as `LP_TILE_CACHE_CONTROL` above. */
const HORIZON_CACHE_CONTROL = 'private, max-age=2592000, stale-while-revalidate=86400'

/**
 * A partial profile is a fabricated horizon, not a measurement — caching it
 * for 30 days would pin the lie (the lesson `097e67b` paid for once already,
 * for the light-pollution tile route). `fetchHorizonProfile` already declines
 * to persist a partial result anywhere, so the next request re-tries the
 * missing DEM tiles; a browser-side copy would defeat that.
 */
const HORIZON_PARTIAL_CACHE_CONTROL = 'no-store'

/** Same derivation as `lpTileEtag` in `../clients/lorenz-atlas.ts` — hash the body once, not per hit. */
function horizonEtag(body: string): string {
  return `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`
}

/**
 * A complete answer is deterministic in (lat, lon, year, horizon source)
 * forever — terrain does not move and the calendar year is fixed. Same
 * 30-day/`private` reasoning as `HORIZON_CACHE_CONTROL`.
 */
const VISIBILITY_CACHE_CONTROL = 'private, max-age=2592000, stale-while-revalidate=86400'

/**
 * A `horizon=measure` answer built on an incomplete DEM profile is provisional
 * — same rule and reason as `HORIZON_PARTIAL_CACHE_CONTROL`: caching it would
 * pin a fabricated annual budget for 30 days instead of letting the next
 * request re-try the missing tiles.
 */
const VISIBILITY_PARTIAL_CACHE_CONTROL = 'no-store'

/**
 * Wire shapes for the two routes that return a raw `Response` rather than
 * declaring an Elysia `response` schema — they do that to own their
 * Cache-Control/ETag headers and answer a bodiless 304, which costs Eden Treaty
 * the ability to infer the parsed body. Exported so a client casts to THIS
 * rather than to a hand-mirrored copy that is free to drift.
 */
export type HorizonResponse = z.infer<typeof HorizonResponseSchema>
export type VisibilityResponse = z.infer<typeof VisibilityResponseSchema>

export type AstroRouteDeps = {
  fetchUpstreams: typeof fetchAstroUpstreams
  lightPollution: typeof fetchLightPollution
  lpTile: typeof fetchLpTile
  skyglow: typeof fetchSkyglow
  horizon: typeof fetchHorizonProfile
  complete: typeof aiComplete
  /** Injectable clock — a route whose answer depends on "tonight" is untestable without one. */
  now: () => Date
}

const defaultDeps: AstroRouteDeps = {
  fetchUpstreams: fetchAstroUpstreams,
  lightPollution: fetchLightPollution,
  lpTile: fetchLpTile,
  skyglow: fetchSkyglow,
  horizon: fetchHorizonProfile,
  complete: aiComplete,
  now: () => new Date(),
}

type AtlasPlace = { lat: number; lon: number; timeZone: string; siteId: string | null }

/**
 * Location for the two atlas routes: `site` > `lat`+`lon` > the default site —
 * the same precedence `/astro/window` uses, minus the geocoder (a map lookup
 * always arrives with coordinates already).
 */
function resolveAtlasPlace(query: {
  site?: string | undefined
  lat?: number | undefined
  lon?: number | undefined
}): AtlasPlace | null {
  if (query.site) {
    const site = findSite(query.site)
    if (!site) return null
    return { lat: site.lat, lon: site.lon, timeZone: site.timeZone, siteId: site.id }
  }
  if (query.lat !== undefined && query.lon !== undefined) {
    return {
      lat: query.lat,
      lon: query.lon,
      timeZone: nearestSite(query.lat, query.lon).timeZone,
      siteId: null,
    }
  }
  return {
    lat: DEFAULT_SITE.lat,
    lon: DEFAULT_SITE.lon,
    timeZone: DEFAULT_SITE.timeZone,
    siteId: DEFAULT_SITE.id,
  }
}

/**
 * `lat` and `lon` are only meaningful together — a lone one would otherwise
 * fall through `resolveAtlasPlace` to whichever fallback comes next (a named
 * site, or Munich), and these two endpoints' entire output is coordinate-
 * specific: a confidently wrong place is worse than a 422 naming the mistake.
 *
 * `GET /astro/window`'s `resolvePlace` deliberately keeps its own historical
 * fallback chain (`site` > `lat`+`lon` > `city` > Munich) — this check is
 * scoped to the two atlas point-lookup endpoints only.
 */
function hasIncompleteCoordinatePair(query: {
  lat?: number | undefined
  lon?: number | undefined
}): boolean {
  return (query.lat === undefined) !== (query.lon === undefined)
}

/**
 * Where the galactic core peaks on a given night.
 *
 * Anchoring on the local 23:00 and solving for transit puts the search on the
 * right night rather than the right UTC day — the two differ for any timezone
 * far from UTC. The sweep either side of transit is what the research POC did
 * and is kept for the same reason: it makes the peak an observed maximum of the
 * same ephemeris the rest of the astro surface uses, not a closed-form claim.
 */
function resolveCorePeak(args: {
  observer: { lat: number; lon: number }
  timeZone: string
  date: string
}): { time: Date; azimuthDeg: number; altitudeDeg: number } {
  const anchor = zonedTimeToUtc(
    {
      year: Number(args.date.slice(0, 4)),
      month: Number(args.date.slice(5, 7)),
      day: Number(args.date.slice(8, 10)),
      hour: CORE_SEARCH_ANCHOR_HOUR,
      minute: 0,
    },
    args.timeZone,
  )
  const transit = coreTransit(args.observer, anchor)

  let peak = { time: transit, azimuthDeg: 180, altitudeDeg: -90 }
  for (let h = -CORE_SEARCH_SPAN_HOURS; h <= CORE_SEARCH_SPAN_HOURS; h += CORE_SEARCH_STEP_HOURS) {
    const time = new Date(transit.getTime() + h * 3_600_000)
    const position = galacticCorePosition(args.observer, time)
    if (position.altitude > peak.altitudeDeg) {
      peak = { time, azimuthDeg: position.azimuth, altitudeDeg: position.altitude }
    }
  }
  return peak
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function serializeLightPollution(point: LightPollutionPoint, siteId: string | null) {
  return {
    lat: point.lat,
    lon: point.lon,
    siteId,
    year: point.year,
    lpi: round3(point.lpi),
    mpsas: round2(point.mpsas),
    zone: point.zone,
    trend10yPercent: point.trend10yPercent === null ? null : round1(point.trend10yPercent),
    source: point.source,
    attribution: ATLAS_ATTRIBUTION,
  }
}

function serializeSkyglow(
  result: SkyglowResult,
  place: AtlasPlace,
  coreTime: Date,
): z.infer<typeof SkyglowResponseSchema> {
  return {
    lat: result.lat,
    lon: result.lon,
    siteId: place.siteId,
    year: result.year,
    coreTime: coreTime.toISOString(),
    zenith: {
      lpi: round3(result.zenith.lpi),
      mpsas: round2(result.zenith.mpsas),
      zone: result.zenith.zone,
    },
    core: {
      azimuthDeg: round1(result.core.azimuthDeg),
      altitudeDeg: round1(result.core.altitudeDeg),
      mpsas: round2(result.core.mpsas),
      domePenaltyMag: round2(result.core.domePenaltyMag),
    },
    // No `topPolluters[]` here, even though doc §7 sketches one: naming the
    // cities behind a dome needs the GeoNames population kernel (model A), and
    // §2.2 drops that model outright. A named list is not derivable from the
    // atlas grid alone, and guessing one would be the only model-invented number
    // on this surface.
    profile: {
      azimuths: result.profile.azimuths,
      altitudes: result.profile.altitudes,
      mpsas: result.profile.mpsas.map((row) => row.map(round2)),
      dominant: {
        azimuthDeg: result.profile.dominant.azimuthDeg,
        compass: result.profile.dominant.compass,
        mpsas: round2(result.profile.dominant.mpsas),
      },
    },
    model: result.model,
    source: result.source,
    attribution: ATLAS_ATTRIBUTION,
  }
}

function serializeHorizon(result: HorizonResult): z.infer<typeof HorizonResponseSchema> {
  return {
    lat: result.lat,
    lon: result.lon,
    elevationM: result.elevationM,
    profile: result.profile.points.map((point) => ({
      azimuthDeg: point.azimuthDeg,
      altitudeDeg: round2(point.altitudeDeg),
      rangeM: point.rangeM,
      summitM: Number.isFinite(point.summitM) ? point.summitM : null,
      nearAltitudeDeg: round2(point.nearAltitudeDeg),
    })),
    south: { maxDeg: round2(result.south.maxDeg), meanDeg: round2(result.south.meanDeg) },
    tilesRequested: result.tilesRequested,
    tilesResolved: result.tilesResolved,
    complete: result.complete,
    source: result.source,
    demZoom: HORIZON_DEM_ZOOM,
    rangeM: HORIZON_RANGE_M,
    stepM: HORIZON_STEP_M,
    nearFieldM: NEAR_FIELD_M,
    refractionK: REFRACTION_K,
    azimuthStepDeg: HORIZON_AZIMUTH_STEP_DEG,
    southArc: { fromDeg: SOUTH_ARC.fromDeg, toDeg: SOUTH_ARC.toDeg },
  }
}

function serializeVisibilityGate(gate: VisibilityGate): z.infer<typeof VisibilityGateSchema> {
  return { minutes: gate.minutes, byMonth: gate.byMonth }
}

function serializeVisibility(args: {
  lat: number
  lon: number
  siteId: string | null
  horizonSource: 'site' | 'measured' | 'none'
  horizonComplete: boolean | undefined
  result: AnnualVisibility
}): z.infer<typeof VisibilityResponseSchema> {
  const { lat, lon, siteId, horizonSource, horizonComplete, result } = args
  return {
    lat,
    lon,
    siteId,
    year: result.year,
    darkMinutes: result.darkMinutes,
    flat: serializeVisibilityGate(result.flat),
    terrain: serializeVisibilityGate(result.terrain),
    terrainMoon: serializeVisibilityGate(result.terrainMoon),
    peakCoreAltitudeDeg: round1(result.peakCoreAltitudeDeg),
    peakClearanceDeg: result.peakClearanceDeg === null ? null : round1(result.peakClearanceDeg),
    peakClearanceDate: result.peakClearanceDate,
    terrainBindsFraction: round3(result.terrainBindsFraction),
    horizonSource,
    // Only present for `measured` — a spread rather than an explicit
    // `undefined` value, so `exactOptionalPropertyTypes` sees the key omitted
    // entirely for `site`/`none` instead of present-but-undefined.
    ...(horizonSource === 'measured' ? { horizonComplete: horizonComplete ?? false } : {}),
    stepMinutes: VISIBILITY_STEP_MINUTES,
    atmosphericFloorDeg: MIN_CORE_ALTITUDE,
    framingMarginDeg: FRAMING_MARGIN_DEG,
    maxMoonIllumination: VISIBILITY_MAX_MOON_ILLUMINATION,
  }
}

type ResolvedPlace = {
  lat: number
  lon: number
  name: string
  timeZone: string
  coreDirectionMpsas: number | null
  domePenaltyMag: number | null
  darknessSource: 'site' | 'nearest-site' | 'query' | 'unknown'
  site: AstroSite | null
}

type InferredDarkness = Pick<
  ResolvedPlace,
  'coreDirectionMpsas' | 'domePenaltyMag' | 'darknessSource'
>

/**
 * Core-direction darkness for a raw coordinate: the caller's override, the
 * nearest site's measurement, or nothing.
 *
 * The dome penalty rides along because it is measured in the same pass — but
 * only when the brightness itself was measured. An overridden brightness has no
 * zenith to be a penalty against, so it reports null rather than a number that
 * belongs to a different sky.
 */
function inferCoreDarkness(
  lat: number,
  lon: number,
  override: number | undefined,
): InferredDarkness {
  if (override !== undefined) {
    return { coreDirectionMpsas: override, domePenaltyMag: null, darknessSource: 'query' }
  }
  const near = nearestSite(lat, lon)
  if (distanceKm({ lat, lon }, near) > DARKNESS_INFERENCE_RADIUS_KM) {
    return { coreDirectionMpsas: null, domePenaltyMag: null, darknessSource: 'unknown' }
  }
  return {
    coreDirectionMpsas: near.coreDirectionMpsas,
    domePenaltyMag: near.domePenaltyMag,
    darknessSource: 'nearest-site',
  }
}

async function resolvePlace(
  query: z.infer<typeof WindowQuerySchema>,
): Promise<ResolvedPlace | null> {
  if (query.site) {
    const site = findSite(query.site)
    if (!site) return null
    return {
      lat: site.lat,
      lon: site.lon,
      name: site.name,
      timeZone: site.timeZone,
      coreDirectionMpsas: query.coreMpsas ?? site.coreDirectionMpsas,
      domePenaltyMag: query.coreMpsas === undefined ? site.domePenaltyMag : null,
      darknessSource: query.coreMpsas === undefined ? 'site' : 'query',
      site,
    }
  }

  if (query.lat !== undefined && query.lon !== undefined) {
    return {
      lat: query.lat,
      lon: query.lon,
      name: `${query.lat.toFixed(3)}, ${query.lon.toFixed(3)}`,
      timeZone: nearestSite(query.lat, query.lon).timeZone,
      ...inferCoreDarkness(query.lat, query.lon, query.coreMpsas),
      site: null,
    }
  }

  if (query.city) {
    const located = await geocodeCity(query.city)
    if (!located) return null
    return {
      lat: located.lat,
      lon: located.lon,
      name: located.city,
      // The geocoder knows the real timezone; the nearest site's is only a
      // fallback for a raw coordinate, which has no such lookup available.
      timeZone: located.timezone,
      ...inferCoreDarkness(located.lat, located.lon, query.coreMpsas),
      site: null,
    }
  }

  return {
    lat: DEFAULT_SITE.lat,
    lon: DEFAULT_SITE.lon,
    name: DEFAULT_SITE.name,
    timeZone: DEFAULT_SITE.timeZone,
    coreDirectionMpsas: query.coreMpsas ?? DEFAULT_SITE.coreDirectionMpsas,
    domePenaltyMag: query.coreMpsas === undefined ? DEFAULT_SITE.domePenaltyMag : null,
    darknessSource: query.coreMpsas === undefined ? 'site' : 'query',
    site: DEFAULT_SITE,
  }
}

/**
 * Samples the weather is averaged over: the recommended window, or the whole
 * dark stretch when there is no window, or civil darkness when there is no
 * astronomical night at all. The last fallback exists so a gated night still
 * shows cloud in the UI strip rather than a row of dashes.
 */
function weatherSamples(night: AstroNight): NightSample[] {
  const inWindow = evaluationSamples(night)
  if (inWindow.length > 0) return inWindow
  return night.samples.filter((sample) => sample.sunAltitude < -6)
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round((total / values.length) * 10) / 10
}

function nightWeather(night: AstroNight, upstreams: AstroUpstreams) {
  const samples = weatherSamples(night)
  const low: number[] = []
  const mid: number[] = []
  const high: number[] = []
  const transparency: number[] = []

  for (const sample of samples) {
    const cloud = cloudAt(upstreams.cloud, sample.time)
    if (cloud?.low !== null && cloud?.low !== undefined) low.push(cloud.low)
    if (cloud?.mid !== null && cloud?.mid !== undefined) mid.push(cloud.mid)
    if (cloud?.high !== null && cloud?.high !== undefined) high.push(cloud.high)
    const band = transparencyAt(upstreams.transparency, sample.time)
    if (band !== null) transparency.push(band)
  }

  return {
    cloudLow: mean(low),
    cloudMid: mean(mid),
    cloudHigh: mean(high),
    transparency: transparency.length === 0 ? null : Math.round(mean(transparency)!),
  }
}

function serializeWindow(night: AstroNight) {
  if (!night.window) return null
  const { timeZone } = night
  return {
    date: night.date,
    start: night.window.start.toISOString(),
    end: night.window.end.toISOString(),
    localStart: formatLocalTime(night.window.start, timeZone),
    localEnd: formatLocalTime(night.window.end, timeZone),
    minutes: night.window.minutes,
    peakTime: night.window.peakTime.toISOString(),
    localPeakTime: formatLocalTime(night.window.peakTime, timeZone),
    peakCoreAltitude: round1(night.window.peakCoreAltitude),
    peakCoreAzimuth: round1(night.window.peakCoreAzimuth),
    maxMoonAltitude: round1(night.window.maxMoonAltitude),
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function serializeNight(
  night: AstroNight,
  scored: ScoredWindow,
  weather: ReturnType<typeof nightWeather>,
) {
  const { timeZone } = night
  return {
    date: night.date,
    verdict: scored.verdict as 'excellent' | 'good' | 'marginal' | 'poor' | 'out',
    score: scored.score,
    coverage: scored.coverage,
    killers: scored.killers,
    factors: scored.factors,
    window: serializeWindow(night),
    darkStart: night.darkStart?.toISOString() ?? null,
    darkEnd: night.darkEnd?.toISOString() ?? null,
    darkMinutes: night.darkMinutes,
    transit: night.transit.toISOString(),
    localTransit: formatLocalTime(night.transit, timeZone),
    maxCoreAltitude: round1(night.maxCoreAltitude),
    peakCoreClearanceDeg: night.peakCoreClearance === null ? null : round1(night.peakCoreClearance),
    moon: {
      illumination: round3(night.moonIllumination),
      phase: round1(night.moonPhase),
      rise: night.moonRise?.toISOString() ?? null,
      set: night.moonSet?.toISOString() ?? null,
    },
    weather,
  }
}

function serializeHourly(night: AstroNight, upstreams: AstroUpstreams) {
  const stride = Math.max(1, Math.round(HOURLY_STEP_MINUTES / 5))
  const points = []
  for (let i = 0; i < night.samples.length; i += stride) {
    const sample = night.samples[i]!
    if (sample.sunAltitude > HOURLY_SUN_ALTITUDE_CEILING) continue
    const cloud = cloudAt(upstreams.cloud, sample.time)
    points.push({
      time: sample.time.toISOString(),
      localTime: formatLocalTime(sample.time, night.timeZone),
      coreAltitude: round1(sample.coreAltitude),
      coreAzimuth: round1(sample.coreAzimuth),
      sunAltitude: round1(sample.sunAltitude),
      sunAzimuth: round1(sample.sunAzimuth),
      moonAltitude: round1(sample.moonAltitude),
      moonAzimuth: round1(sample.moonAzimuth),
      astroDark: sample.astroDark,
      coreClearance: Number.isNaN(sample.coreClearance) ? null : round1(sample.coreClearance),
      moonBehindTerrain: sample.moonBehindTerrain,
      cloudLow: cloud?.low ?? null,
      cloudMid: cloud?.mid ?? null,
      cloudHigh: cloud?.high ?? null,
    })
  }
  return points
}

type SummaryFacts = {
  placeName: string
  /** Weekday name of the best night — computed here, never by the model. */
  weekday: string
  coreDirectionMpsas: number | null
  best: ReturnType<typeof serializeNight> | null
  bestWindow: ReturnType<typeof serializeWindow>
  nightCount: number
}

/** Cache keyed on the deterministic verdict, so a sentence is regenerated only when the verdict moves. */
const summaryCache = new Map<string, { text: string; expiresAt: number }>()

function summaryCacheKey(facts: SummaryFacts): string {
  return [
    facts.placeName,
    facts.nightCount,
    facts.best?.date ?? 'none',
    facts.best?.verdict ?? 'none',
    Math.round(facts.best?.score ?? -1),
    facts.bestWindow?.localStart ?? 'none',
  ].join('|')
}

/**
 * Turn the finished verdict into one sentence.
 *
 * Everything numeric in the prompt is already computed; the model is explicitly
 * forbidden from adding numbers of its own. Failure returns null and the
 * endpoint still serves the full verdict — the sentence is an enhancement, never
 * a dependency, so this swallows rather than propagates.
 */
async function generateSummary(
  facts: SummaryFacts,
  complete: AstroRouteDeps['complete'],
  now: Date,
): Promise<string | null> {
  const key = summaryCacheKey(facts)
  const cached = summaryCache.get(key)
  if (cached && cached.expiresAt > now.getTime()) return cached.text

  const lines: string[] = [
    facts.coreDirectionMpsas === null
      ? `Location: ${facts.placeName}, sky darkness unknown.`
      : `Location: ${facts.placeName}, sky brightness ${facts.coreDirectionMpsas.toFixed(2)} mag/arcsec² in the core direction.`,
    `Nights evaluated: ${facts.nightCount}.`,
  ]
  if (facts.best && facts.bestWindow) {
    lines.push(
      `Best night: ${facts.weekday} ${facts.best.date}, verdict ${facts.best.verdict}, score ${facts.best.score}/100.`,
      `Window: ${facts.bestWindow.localStart}–${facts.bestWindow.localEnd} local (${facts.bestWindow.minutes} min).`,
      `Galactic core peaks at ${facts.bestWindow.peakCoreAltitude}° at ${facts.bestWindow.localPeakTime}.`,
      `Moon ${Math.round(facts.best.moon.illumination * 100)}% illuminated.`,
      `Cloud: low ${facts.best.weather.cloudLow ?? 'unknown'}%, mid ${facts.best.weather.cloudMid ?? 'unknown'}%, high ${facts.best.weather.cloudHigh ?? 'unknown'}%.`,
    )
  } else {
    lines.push('No night in the range is usable.')
    const reasons = facts.best?.killers.map((killer) => killer.reason) ?? []
    if (reasons.length > 0) lines.push(`Reasons: ${reasons.join('; ')}.`)
  }

  const sentence = await completeSentence(complete, lines.join('\n'), {
    system:
      'You write ONE short sentence for an astrophotography planner — a terse field note, at most 25 words. Use ONLY the facts given: never compute, estimate or invent a number, time or date, and never restate every figure. Lead with the weekday and the window start, then the two or three numbers that actually decide the night. No preamble, no markdown, no list. Example of the register: "Saturday 21:40 — core 12°, moon 8%, low cloud 5% from the Alpenvorland; best window this month."',
    subTool: 'astro-window',
  })
  if (sentence) summaryCache.set(key, { text: sentence, expiresAt: now.getTime() + SUMMARY_TTL_MS })
  return sentence
}

/** Exported for tests — the summary cache is module-scope and would otherwise leak between cases. */
export function clearAstroSummaryCache(): void {
  summaryCache.clear()
}

export function createAstroRoutes(overrides: Partial<AstroRouteDeps> = {}) {
  const deps: AstroRouteDeps = { ...defaultDeps, ...overrides }

  return new Elysia({ prefix: '/astro' })
    .get(
      '/window',
      async ({ query, status }) => {
        const place = await resolvePlace(query)
        if (!place) {
          return status(
            404,
            query.site
              ? `Unknown site "${query.site}". See GET /astro/sites.`
              : `Could not geocode "${query.city}".`,
          )
        }

        const nightCount = query.nights ?? 10
        const now = deps.now()
        const firstDate = formatLocalDate(now, place.timeZone)

        // One upstream fetch covers the whole range: three parallel HTTP calls,
        // cached for an hour, regardless of how many nights were asked for.
        const upstreams = await deps.fetchUpstreams({
          lat: place.lat,
          lon: place.lon,
          days: nightCount + 1,
        })

        const scoredNights = []
        for (let offset = 0; offset < nightCount; offset++) {
          const date = addDays(firstDate, offset)
          const night = resolveNight({
            observer: { lat: place.lat, lon: place.lon },
            timeZone: place.timeZone,
            date,
            minCoreAltitude: MIN_CORE_ALTITUDE,
            // Only a committed site (`?site=`) carries a measured skyline — a
            // raw lat/lon never fetches a DEM here, scoring stays synchronous
            // and I/O-free, and `GET /astro/horizon` is the async door for that.
            horizonDeg: place.site?.horizonDeg,
          })
          const weather = nightWeather(night, upstreams)
          const input: AstroScoreInput = {
            night,
            cloudLow: weather.cloudLow,
            cloudMid: weather.cloudMid,
            cloudHigh: weather.cloudHigh,
            transparency: weather.transparency,
            coreDirectionMpsas: place.coreDirectionMpsas,
            coreClearanceDeg: night.peakCoreClearance,
          }
          const scored = scoreWindow(astroWindowConfig, input)
          scoredNights.push({ night, scored, serialized: serializeNight(night, scored, weather) })
        }

        // The headline is the best night in the range, not tonight — the whole
        // question is "when should I go", and tonight is frequently the answer
        // only by coincidence.
        const best =
          scoredNights.reduce<(typeof scoredNights)[number] | null>((winner, candidate) => {
            if (!winner) return candidate
            return candidate.scored.score > winner.scored.score ? candidate : winner
          }, null) ?? null

        const detailDate = query.detailDate ?? best?.night.date ?? firstDate
        const detailNight =
          scoredNights.find((entry) => entry.night.date === detailDate) ?? scoredNights[0]

        const bestWindow = best?.night.window ? serializeWindow(best.night) : null
        const summaryWanted = query.summary !== 'false'
        const summary = summaryWanted
          ? await generateSummary(
              {
                placeName: place.name,
                weekday: best
                  ? new Intl.DateTimeFormat('en-GB', {
                      timeZone: place.timeZone,
                      weekday: 'long',
                    }).format(best.night.transit)
                  : '',
                coreDirectionMpsas: place.coreDirectionMpsas,
                best: best?.serialized ?? null,
                bestWindow,
                nightCount,
              },
              deps.complete,
              now,
            )
          : null

        const near = nearestSite(place.lat, place.lon)

        return {
          location: {
            lat: place.lat,
            lon: place.lon,
            name: place.name,
            timeZone: place.timeZone,
            coreDirectionMpsas: place.coreDirectionMpsas,
            domePenaltyMag: place.domePenaltyMag,
            southHorizonDeg: place.site?.southHorizonDeg ?? null,
            darknessSource: place.darknessSource,
            siteId: place.site?.id ?? null,
            nearestSiteId: near.id,
            nearestSiteKm: Math.round(distanceKm(place, near)),
          },
          generatedAt: now.toISOString(),
          nights: scoredNights.map((entry) => entry.serialized),
          verdict: (best?.scored.verdict ?? 'out') as
            | 'excellent'
            | 'good'
            | 'marginal'
            | 'poor'
            | 'out',
          score: best?.scored.score ?? 0,
          killers: best?.scored.killers ?? [],
          bestWindow,
          summary,
          detail: {
            date: detailNight?.night.date ?? firstDate,
            hourly: detailNight ? serializeHourly(detailNight.night, upstreams) : [],
          },
          sources: upstreams.health,
          attribution: ATTRIBUTION,
        }
      },
      {
        query: WindowQuerySchema,
        response: { 200: WindowResponseSchema, 404: z.string() },
        detail: {
          tags: ['Astro & Marine'],
          summary: 'Score the next N nights for Milky Way nightscape photography',
          description:
            'Answers "is tonight (or this week) worth going out for?" for one place. Every night in the range gets a verdict from hard gates (galactic-core altitude above 8° AND above the measured terrain skyline plus a 2° framing margin when the location resolved to a committed site — see `location.southHorizonDeg`; moon under 25% illuminated, or below the horizon, or behind that same skyline; and true astronomical night that overlaps the core window) plus weighted factors (low/mid/high cloud, atmospheric transparency, the measured sky brightness in the direction the core sits, and — only when a skyline was resolved — how many degrees of clear sky the core keeps above the ridge, `peakCoreClearanceDeg` on each night and `coreClearance` per hour). A night gated on terrain names the ridge in `killers` (`"the ridge to the south stands at X° — the core never clears it while dark"`) rather than the generic flat-floor message. A night that fails a gate returns verdict `out` with a named reason in `killers` — that is different information from a low score and the two are never conflated. Top-level `verdict`/`score`/`bestWindow`/`killers` describe the BEST night in the range, not tonight; `nights[]` carries every night for an at-a-glance strip, and `detail.hourly` carries the 30-minute series for one night (the best one unless `detailDate` says otherwise). Location resolves in the order `site` > `lat`+`lon` > `city` > Munich; a raw lat/lon inherits `coreDirectionMpsas` from the nearest known site within 150 km, unless `coreMpsas` overrides it — beyond that radius `darknessSource` is `unknown`, darkness drops out of the score and `coverage` falls. Terrain is different: it is ONLY applied when the location resolved to one of the four committed sites (`?site=`) — a raw lat/lon never fetches a DEM here, so scoring stays synchronous and I/O-free; use GET /astro/horizon for an arbitrary coordinate\'s profile. All astronomy is computed locally from an ephemeris and never by a model — `summary` is the one model-generated field and is null when the model is unavailable. For plain weather use GET /weather/forecast; for the candidate sites and their measured sky use GET /astro/sites.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/sites',
      () => ({
        data: ASTRO_SITES.map((site) => ({ ...site })),
        total: ASTRO_SITES.length,
        measurement: { ...ASTRO_SITE_MEASUREMENTS },
      }),
      {
        response: z.object({
          data: z.array(SiteSchema),
          total: z.number().int(),
          measurement: MeasurementSchema,
        }),
        detail: {
          tags: ['Astro & Marine'],
          summary: 'List the candidate drive-to observing sites',
          description:
            'The candidate observing sites with their MEASURED sky and terrain, and their drive time from Munich. Pass an `id` from here as `?site=` to GET /astro/window. Per site: `mpsas`/`lpi`/`zone`/`trend10yPercent` from the Lorenz light-pollution atlas at the zenith, `coreDirectionMpsas` + `domePenaltyMag` for the direction a Milky Way frame actually points, `southHorizonDeg` from a terrain-DEM horizon sweep across the arc the core crosses, and `siteElevationM`. These are committed constants rather than a per-request lookup because they move on a yearly cadence at most — the atlas publishes once a year and the mountains never; `measurement` names the atlas vintage `trend10yPercent` runs to and the date the constants were last generated, so a caller can tell how stale they are. Rank on `coreDirectionMpsas`, not on `mpsas`: the darkest zenith of the set is 0.22 mag BRIGHTER than the runner-up where the core sits, because its towns lie south, and that flip is the whole reason a site picker needs both numbers.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/light-pollution',
      async ({ query, status }) => {
        if (hasIncompleteCoordinatePair(query)) {
          return status(422, 'lat and lon must be provided together.')
        }
        const place = resolveAtlasPlace(query)
        if (!place) return status(404, `Unknown site "${query.site}". See GET /astro/sites.`)

        const point = await deps.lightPollution({
          lat: place.lat,
          lon: place.lon,
          year: parseYear(query.year),
        })
        if (!point) {
          return status(
            502,
            'Light Pollution Atlas unavailable, or the coordinate is outside its 65°S–75°N coverage.',
          )
        }
        return serializeLightPollution(point, place.siteId)
      },
      {
        query: PointQuerySchema,
        response: {
          200: LightPollutionResponseSchema,
          404: z.string(),
          422: z.string(),
          502: z.string(),
        },
        detail: {
          tags: ['Astro & Marine'],
          summary: 'Zenith light pollution for a coordinate, from the Lorenz atlas',
          description:
            "Returns measured ZENITH sky brightness for one point: `lpi` (artificial over natural zenith brightness), `mpsas` (total zenith brightness in mag/arcsec², higher is darker), the Lorenz `0a`..`7b` zone band, and `trend10yPercent` (the change in LPI from the 2016 atlas to the requested year, which runs +25% per decade at some German sites and flat at others). Values come from David J. Lorenz's binary tiles at 30-arcsec resolution; `year` selects the vintage (2016, 2020, 2022, 2023, 2024, 2025 — default the latest). Location resolves `site` > `lat`+`lon` > Munich. A subjective whole-sky darkness class is deliberately NOT offered: those scales are driven mostly by light domes near the horizon, which a zenith map cannot produce, and the atlas author asks explicitly that the two not be conflated. Treat absolute `mpsas` as ±0.2 mag, because the 22.0 mag/arcsec² natural baseline it is measured against is a convention rather than a constant. This endpoint describes the part of the sky a Milky Way frame never contains; for the direction that actually matters use GET /astro/skyglow, and for the full go/no-go verdict use GET /astro/window. Returns 422 when only one of `lat`/`lon` is given, and 502 when the atlas is unreachable — there is no cached or modelled value to degrade to.",
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/skyglow',
      async ({ query, status }) => {
        if (hasIncompleteCoordinatePair(query)) {
          return status(422, 'lat and lon must be provided together.')
        }
        const place = resolveAtlasPlace(query)
        if (!place) return status(404, `Unknown site "${query.site}". See GET /astro/sites.`)

        const date = query.date ?? formatLocalDate(deps.now(), place.timeZone)
        const peak = resolveCorePeak({
          observer: { lat: place.lat, lon: place.lon },
          timeZone: place.timeZone,
          date,
        })

        // The core's declination is −29°, so it never clears the horizon above
        // ~61°N — and the scattering kernel is only defined above it. Answering
        // anyway would report a confident dome penalty for a direction that is
        // under the ground; name the number instead.
        if (peak.altitudeDeg <= 0) {
          return status(
            422,
            `The galactic core stays below the horizon here on ${date} — it peaks at ${round1(peak.altitudeDeg)}°. There is no direction to measure.`,
          )
        }

        const result = await deps.skyglow({
          lat: place.lat,
          lon: place.lon,
          year: parseYear(query.year),
          coreAzimuthDeg: peak.azimuthDeg,
          coreAltitudeDeg: peak.altitudeDeg,
        })
        if (!result) {
          return status(
            502,
            'Light Pollution Atlas unavailable, or the coordinate is outside its 65°S–75°N coverage.',
          )
        }
        return serializeSkyglow(result, place, peak.time)
      },
      {
        query: SkyglowQuerySchema,
        response: {
          200: SkyglowResponseSchema,
          404: z.string(),
          422: z.string(),
          502: z.string(),
        },
        detail: {
          tags: ['Astro & Marine'],
          summary: 'Direction-resolved skyglow and the sky brightness where the core actually sits',
          description:
            'Returns an azimuth × altitude rose of ARTIFICIAL skyglow around one point (`profile.mpsas[altitudeIndex][azimuthIndex]`, azimuths 0–355° in 5° steps, altitudes 5/8/10/13/15/20/30°), the dominant light-dome direction at 10°, and — the number this endpoint exists for — `core.mpsas`: sky brightness in the direction the galactic core peaks on this night, with `core.domePenaltyMag` giving how many magnitudes darker the published zenith figure reads than that direction. It re-orders real sites: the darkest zenith of the four shipped sites loses its lead entirely once the light dome sits where the camera points. Every number is a deterministic ray-march over Lorenz atlas tiles weighted by a scattering kernel (echoed back in `model`); NO model computes any figure here, and the ephemeris behind `coreTime`/`core.azimuthDeg`/`core.altitudeDeg` is the same one GET /astro/window uses. `profile` is artificial glow ALONE — airglow enters only `core.mpsas`, so the rose reads as "what the lights cost me". `date` (YYYY-MM-DD) picks the night and defaults to today in the location timezone; `year` picks the atlas vintage; location resolves `site` > `lat`+`lon` > Munich. Absolute dome penalties move ±0.35 mag across nine kernel variants, but the ORDERING of sites is invariant across all nine — rank with this, do not quote it as a measurement. For the zenith value on its own use GET /astro/light-pollution. Returns 422 above ~61°N (where the core never clears the horizon and there is no direction to measure) or when only one of `lat`/`lon` is given, and 502 when the atlas is unreachable.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/horizon',
      async ({ query, request, status }) => {
        /*
         * Guard BEFORE the client, because the cost is in the enumeration, not
         * the fetch: the march's box grows as 1/cos(lat)², so a coordinate a
         * fraction of a degree from the pole names over a hundred million DEM
         * tiles. 422 rather than 502 — the coordinate is the problem, not the
         * upstream, and no retry will ever help.
         */
        const tiles = horizonTileCount({ lat: query.lat, lon: query.lon })
        if (tiles > MAX_HORIZON_TILES) {
          return status(
            422,
            `Too close to the pole for a ${HORIZON_RANGE_M / 1000} km march at zoom ${HORIZON_DEM_ZOOM}: ` +
              `this coordinate needs ${tiles} DEM tiles against a ceiling of ${MAX_HORIZON_TILES}.`,
          )
        }

        const result = await deps.horizon({ lat: query.lat, lon: query.lon })
        if (!result) {
          return status(
            502,
            'Terrarium DEM unavailable, or the coordinate’s own tile could not be read.',
          )
        }

        const body = JSON.stringify(serializeHorizon(result))
        const headers: Record<string, string> = { 'content-type': 'application/json' }

        // A partial profile is a fabricated horizon — see HORIZON_PARTIAL_CACHE_CONTROL.
        if (!result.complete) {
          headers['cache-control'] = HORIZON_PARTIAL_CACHE_CONTROL
          return new Response(body, { headers })
        }

        const etag = horizonEtag(body)
        headers['cache-control'] = HORIZON_CACHE_CONTROL
        headers['etag'] = etag
        if (request.headers.get('if-none-match') === etag) {
          return new Response(null, { status: 304, headers })
        }
        return new Response(body, { headers })
      },
      {
        query: HorizonQuerySchema,
        // No `response` schema: this handler returns a raw `Response` so it can
        // set Cache-Control/ETag and answer a bodiless 304, the same pattern the
        // tile route below uses. The OpenAPI contract is declared by hand instead.
        detail: {
          tags: ['Astro & Marine'],
          summary: 'Terrain horizon profile for an arbitrary coordinate, from the terrarium DEM',
          description:
            "Returns a per-azimuth terrain skyline for an ARBITRARY coordinate, from the same AWS terrarium ray-march that produces the four committed sites' `southHorizonDeg` in GET /astro/sites — this route answers the identical question for any point the map is scouting, at request time rather than as a committed constant. `profile[]` carries 72 rays, 5° apart: `altitudeDeg` is the skyline BEYOND 500 m and the only band anything should score against (compare it to the flat 8° atmospheric floor GET /astro/window gates on); `nearAltitudeDeg` is the highest ground WITHIN 500 m, shipped for a panorama chart to draw but never scored — inside 500 m a DEM sample is your own hillside plus vertical noise, not a skyline (`docs/ASTRO-HORIZON-RESEARCH.md` §3). `south` reduces `profile` to `southArc`, the bearing range the galactic core actually crosses — the same reduction the committed site constants use. `demZoom`/`rangeM`/`stepM`/`nearFieldM`/`refractionK`/`azimuthStepDeg` echo the model constants so a caller can render the profile honestly instead of assuming them. `complete: false` means at least one DEM tile failed to resolve and the profile is a partial measurement; such a response is `no-store`. A complete one caches hard for 30 days as `private` — terrain does not move, and the route is bearer-guarded so no shared cache may keep it — with a strong ETag, so `If-None-Match` gets a 304. Returns 422 when `lat`/`lon` are out of range or missing — both are required, there is no `site` fallback here — and 502 when the DEM is unreachable, or the coordinate's own tile could not be read, in which case there is no elevation to measure every other altitude against.",
          security: [{ BearerAuth: [] }],
          responses: {
            // No `content` schema here: unlike the binary tile route below,
            // this body IS JSON, but wiring a hand-written OpenAPI SchemaObject
            // for it duplicates `HorizonResponseSchema` in a shape the openapi
            // types package rejects when built from `z.toJSONSchema` directly.
            // The `description` above already documents every field.
            200: { description: 'Horizon profile, JSON — see the description for the field shape' },
            304: { description: 'Not modified — the ETag matched' },
            422: { description: 'lat or lon out of range, or one of them is missing' },
            502: {
              description: 'Terrarium DEM unavailable, or the coordinate’s own tile is missing',
            },
          },
        },
      },
    )
    .get(
      '/visibility',
      async ({ query, status, request }) => {
        let lat: number
        let lon: number
        let siteId: string | null
        let horizonSource: 'site' | 'measured' | 'none'
        let horizonDeg: readonly number[] | undefined
        let horizonComplete: boolean | undefined

        if (query.site) {
          const found = findSite(query.site)
          if (!found) return status(404, `Unknown site "${query.site}". See GET /astro/sites.`)
          lat = found.lat
          lon = found.lon
          siteId = found.id
          horizonSource = 'site'
          horizonDeg = found.horizonDeg
        } else {
          if (hasIncompleteCoordinatePair(query)) {
            return status(422, 'lat and lon must be provided together.')
          }
          if (query.lat === undefined || query.lon === undefined) {
            return status(422, 'Provide either site, or lat and lon.')
          }
          lat = query.lat
          lon = query.lon
          siteId = null

          const mode = query.horizon ?? 'site'
          if (mode === 'none') {
            horizonSource = 'none'
          } else if (mode === 'site') {
            // EXACT match only — see the description. Falling back to
            // `nearestSite` here would silently hand a scouted valley a
            // distant summit's mountains.
            const exact = ASTRO_SITES.find(
              (candidate) => candidate.lat === lat && candidate.lon === lon,
            )
            if (exact) {
              horizonSource = 'site'
              horizonDeg = exact.horizonDeg
              siteId = exact.id
            } else {
              horizonSource = 'none'
            }
          } else {
            const measured = await deps.horizon({ lat, lon })
            if (!measured) {
              return status(
                502,
                'Terrarium DEM unavailable, or the coordinate’s own tile could not be read.',
              )
            }
            horizonSource = 'measured'
            horizonComplete = measured.complete
            horizonDeg = measured.profile.points.map((point) => point.altitudeDeg)
          }
        }

        const year = query.year ?? deps.now().getUTCFullYear()
        const result = annualVisibility({ observer: { lat, lon }, year, horizonDeg })

        const body = JSON.stringify(
          serializeVisibility({ lat, lon, siteId, horizonSource, horizonComplete, result }),
        )
        const headers: Record<string, string> = { 'content-type': 'application/json' }

        // A `measure`d-but-incomplete profile is provisional — see
        // VISIBILITY_PARTIAL_CACHE_CONTROL.
        if (horizonSource === 'measured' && horizonComplete === false) {
          headers['cache-control'] = VISIBILITY_PARTIAL_CACHE_CONTROL
          return new Response(body, { headers })
        }

        const etag = horizonEtag(body)
        headers['cache-control'] = VISIBILITY_CACHE_CONTROL
        headers['etag'] = etag
        if (request.headers.get('if-none-match') === etag) {
          return new Response(null, { status: 304, headers })
        }
        return new Response(body, { headers })
      },
      {
        query: VisibilityQuerySchema,
        // No `response` schema — same reason as GET /astro/horizon: this
        // handler returns a raw `Response` for Cache-Control/ETag/304.
        detail: {
          tags: ['Astro & Marine'],
          summary: 'Annual visibility budget — is this spot worth the drive AT ALL',
          description:
            'Answers a different, more durable question than GET /astro/window: not "is tonight worth going out for" but "is this spot worth driving to at all". Deterministic and weather-free — depends only on latitude, an optional skyline and a calendar year — so unlike `/astro/window` it never touches a weather upstream or the model. Integrates the whole `year` (UTC, default the current one) on a 10-minute grid under three progressively honest gates, each a `{ minutes, byMonth }` pair (`byMonth` is UTC-month, index 0 = January): `flat` gates the core on the flat `atmosphericFloorDeg` alone (the same floor GET /astro/window uses); `terrain` additionally requires the core above `max(atmosphericFloorDeg, skyline at the core’s azimuth + framingMarginDeg)` — equal to `flat` whenever `horizonSource` is `none`; `terrainMoon` is `terrain` plus the moon counting as down when it sits behind that same skyline, not just below 0°, which recovers real usable time (a 34° northern wall gains one committed site 22% more usable minutes by blocking moonlight, not core exposure). `peakClearanceDeg`/`peakClearanceDate` name the single best night’s margin over the ridge; `terrainBindsFraction` says how often the skyline, not the atmosphere, was the tighter floor — 0 at the four committed sites on the pre-alpine plain, 41–100% once a scouted valley or summit is walled in (`docs/ASTRO-HORIZON-RESEARCH.md` §4.1). Location resolves `site` (wins, uses that site’s committed lat/lon/horizonDeg directly, lat/lon and `horizon` are ignored) or `lat`+`lon` together — there is no third fallback, a confidently wrong place being worse than a 422 here. For a raw lat/lon, `horizon` picks how the skyline resolves: `site` (default) inherits a committed site’s skyline ONLY when the coordinate lands on one exactly — never the nearest one, which would silently hand a scouted valley a distant summit’s mountains — `measure` fetches a live profile for this exact coordinate via the same door as GET /astro/horizon (`horizonSource` reports `measured` and `horizonComplete` says whether every DEM tile resolved), and `none` scores flat only with no DEM fetch at all. `stepMinutes`/`atmosphericFloorDeg`/`framingMarginDeg`/`maxMoonIllumination` echo the model constants so a caller renders the budget honestly rather than assuming them. A complete answer is deterministic in (lat, lon, year, horizon source) forever, so it caches hard for 30 days as `private` with a strong ETag and a bodiless 304 on a matching `If-None-Match` — a `measure`d-but-incomplete profile is `no-store` instead, the same rule GET /astro/horizon and the light-pollution tiles use for a provisional measurement. Returns 404 for an unknown `site` id, 422 when lat/lon are incomplete or out of range, neither `site` nor a full lat/lon pair was given, or `year` is outside 1900..2100, and 502 when `horizon=measure` and the DEM is unreachable.',
          security: [{ BearerAuth: [] }],
          responses: {
            // No `content` schema — same reasoning as GET /astro/horizon: a
            // hand-written OpenAPI SchemaObject would duplicate
            // `VisibilityResponseSchema` in a shape the openapi types package
            // rejects when built straight from `z.toJSONSchema`. The
            // `description` above documents every field.
            200: {
              description:
                'Annual visibility budget, JSON — see the description for the field shape',
            },
            304: { description: 'Not modified — the ETag matched' },
            404: { description: 'Unknown `site` id' },
            422: {
              description:
                'lat/lon incomplete or out of range, neither site nor lat+lon was given, or year is outside 1900..2100',
            },
            502: {
              description:
                'horizon=measure and the terrarium DEM is unreachable, or the coordinate’s own tile could not be read',
            },
          },
        },
      },
    )
    .get(
      '/tiles/lp/:year/:z/:x/:y',
      async ({ params, request, status }) => {
        const zoom = Number(params.z)
        const column = Number(params.x)
        const row = Number(params.y.slice(0, -'.png'.length))
        if (zoom < LP_TILE_MIN_ZOOM || zoom > LP_TILE_MAX_ZOOM) {
          return status(
            422,
            `z must be inside ${LP_TILE_MIN_ZOOM}..${LP_TILE_MAX_ZOOM}; got z=${zoom}.`,
          )
        }
        const span = 2 ** zoom
        if (column >= span || row >= span) {
          return status(
            422,
            `x and y must be inside 0..${span - 1} at z${zoom}; got x=${column}, y=${row}.`,
          )
        }

        const tile = await deps.lpTile({
          x: column,
          y: row,
          z: zoom,
          year: Number(params.year) as LorenzYear,
        })
        if (!tile) return status(502, 'Light Pollution Atlas unavailable.')

        const etag = tile.etag
        // A partial render must not outlive the request that produced it — see
        // LP_TILE_PARTIAL_CACHE_CONTROL.
        const partial = tile.tilesResolved < tile.tilesRequested
        const headers: Record<string, string> = {
          'content-type': 'image/png',
          'cache-control': partial ? LP_TILE_PARTIAL_CACHE_CONTROL : LP_TILE_CACHE_CONTROL,
          etag,
        }
        // A map re-requests the same tiles constantly; a 304 saves the body but
        // still has to carry the validators the browser will reuse.
        if (request.headers.get('if-none-match') === etag) {
          return new Response(null, { status: 304, headers })
        }
        return new Response(tile.png, { headers })
      },
      {
        params: LpTileParamsSchema,
        // No `response` schema: the 200 body is binary PNG, which Zod cannot
        // describe and Elysia would try to serialize. The OpenAPI contract for
        // it is declared by hand in `detail.responses` below.
        detail: {
          tags: ['Astro & Marine'],
          summary: 'Light-pollution raster tile, terrarium-encoded for client-side colouring',
          description:
            "Returns a 256×256 PNG of sky brightness for one Web Mercator tile, at `/astro/tiles/lp/{year}/{z}/{x}/{y}.png` (the `.png` suffix is part of the path). The payload is DATA, not a picture: each pixel is terrarium-encoded, so `mpsas = (R*256 + G + B/256 - 32768) / 100` — total zenith brightness in mag/arcsec², higher is darker. Blue is always 0 (the unit is 1/100 mag, not 1/256). The palette is applied CLIENT-side by MapLibre's `color-relief` layer over a `raster-dem` source, which is what lets the map use Argo's own ramp instead of the atlas author's colour scheme. Pixels with no atlas coverage encode 22.00, the natural sky, and a tile lying entirely outside the atlas's 65°S–75°N band renders flat 22.00 rather than erroring — that is a permanent answer, not an outage. Zoom is limited to z5..z9: below that a tile spans more than the request is worth rendering, above it the atlas's own 30-arcsec grid is already coarser than the pixels. `year` picks the vintage (2016, 2020, 2022, 2023, 2024, 2025). Coordinates must be canonical decimals (no leading zeros, no hex or exponent forms), so one tile has exactly one URL. Cached hard for 30 days as `private` — the data changes once a year, and the route is bearer-guarded, so no shared cache may keep it — and served with a strong ETag, so `If-None-Match` gets a 304; a partially covered render is returned `no-store` instead, since it is provisional. For a single numeric lookup use GET /astro/light-pollution; for the direction-resolved dome use GET /astro/skyglow. Returns 422 for a zoom outside z5..z9, a non-canonical coordinate, or an x/y outside 0..2^z-1, and 502 when the atlas is unreachable.",
          security: [{ BearerAuth: [] }],
          responses: {
            200: {
              description: 'Terrarium-encoded PNG tile',
              content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
            },
            304: { description: 'Not modified — the ETag matched' },
            422: { description: 'Zoom or tile coordinate malformed, or outside the served range' },
            502: { description: 'Light Pollution Atlas unavailable' },
          },
        },
      },
    )
}

export const astroRoutes = createAstroRoutes()
