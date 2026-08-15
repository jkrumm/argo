import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  cloudAt,
  fetchAstroUpstreams,
  transparencyAt,
  type AstroUpstreams,
} from '../clients/astro-upstreams.js'
import {
  addDays,
  formatLocalDate,
  formatLocalTime,
  resolveNight,
  type AstroNight,
  type NightSample,
} from '../lib/astro-night.js'
import {
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
 * How far the nearest known site may be before its Bortle class stops meaning
 * anything about the requested coordinates. Beyond this the class is reported
 * as unknown and drops out of the score, lowering `coverage` — which is honest,
 * where handing back Munich's Bortle 8 for a request in Tenerife would not be.
 */
const BORTLE_INFERENCE_RADIUS_KM = 150

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
  moon: MoonSchema,
  weather: WeatherSchema,
})

const HourlyPointSchema = z.object({
  time: z.string().describe('ISO 8601 UTC'),
  localTime: z.string().describe('HH:MM in the location timezone'),
  coreAltitude: z.number(),
  coreAzimuth: z.number(),
  sunAltitude: z.number(),
  moonAltitude: z.number(),
  astroDark: z.boolean(),
  cloudLow: z.number().nullable(),
  cloudMid: z.number().nullable(),
  cloudHigh: z.number().nullable(),
})

const LocationSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  name: z.string(),
  timeZone: z.string(),
  bortle: z
    .number()
    .int()
    .nullable()
    .describe(
      '1 (pristine) to 9 (inner city). Null when no known site is close enough to infer it',
    ),
  bortleSource: z
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
  bortle: z.number().int(),
  driveMinutes: z.number().int(),
  note: z.string(),
})

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
  bortle: z.coerce
    .number()
    .int()
    .min(1)
    .max(9)
    .optional()
    .describe('Override the Bortle class for a raw lat/lon'),
  // Not `z.coerce.boolean()`: `Boolean('false')` is `true`, so coercion would
  // silently ignore the one value anyone ever passes here.
  summary: z
    .enum(['true', 'false'])
    .optional()
    .describe('Set `false` to skip the generated sentence and the model call entirely'),
})

export type AstroRouteDeps = {
  fetchUpstreams: typeof fetchAstroUpstreams
  complete: typeof aiComplete
  /** Injectable clock — a route whose answer depends on "tonight" is untestable without one. */
  now: () => Date
}

const defaultDeps: AstroRouteDeps = {
  fetchUpstreams: fetchAstroUpstreams,
  complete: aiComplete,
  now: () => new Date(),
}

type ResolvedPlace = {
  lat: number
  lon: number
  name: string
  timeZone: string
  bortle: number | null
  bortleSource: 'site' | 'nearest-site' | 'query' | 'unknown'
  site: AstroSite | null
}

/** Bortle for a raw coordinate: the caller's override, the nearest site, or nothing. */
function inferBortle(
  lat: number,
  lon: number,
  override: number | undefined,
): { bortle: number | null; bortleSource: ResolvedPlace['bortleSource'] } {
  if (override !== undefined) return { bortle: override, bortleSource: 'query' }
  const near = nearestSite(lat, lon)
  if (distanceKm({ lat, lon }, near) > BORTLE_INFERENCE_RADIUS_KM) {
    return { bortle: null, bortleSource: 'unknown' }
  }
  return { bortle: near.bortle, bortleSource: 'nearest-site' }
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
      bortle: query.bortle ?? site.bortle,
      bortleSource: query.bortle === undefined ? 'site' : 'query',
      site,
    }
  }

  if (query.lat !== undefined && query.lon !== undefined) {
    return {
      lat: query.lat,
      lon: query.lon,
      name: `${query.lat.toFixed(3)}, ${query.lon.toFixed(3)}`,
      timeZone: nearestSite(query.lat, query.lon).timeZone,
      ...inferBortle(query.lat, query.lon, query.bortle),
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
      ...inferBortle(located.lat, located.lon, query.bortle),
      site: null,
    }
  }

  return {
    lat: DEFAULT_SITE.lat,
    lon: DEFAULT_SITE.lon,
    name: DEFAULT_SITE.name,
    timeZone: DEFAULT_SITE.timeZone,
    bortle: query.bortle ?? DEFAULT_SITE.bortle,
    bortleSource: query.bortle === undefined ? 'site' : 'query',
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
      moonAltitude: round1(sample.moonAltitude),
      astroDark: sample.astroDark,
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
  bortle: number | null
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
    facts.bortle === null
      ? `Location: ${facts.placeName}, sky darkness unknown.`
      : `Location: ${facts.placeName}, Bortle ${facts.bortle}.`,
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
          })
          const weather = nightWeather(night, upstreams)
          const input: AstroScoreInput = {
            night,
            cloudLow: weather.cloudLow,
            cloudMid: weather.cloudMid,
            cloudHigh: weather.cloudHigh,
            transparency: weather.transparency,
            bortle: place.bortle,
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
                bortle: place.bortle,
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
            bortle: place.bortle,
            bortleSource: place.bortleSource,
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
            'Answers "is tonight (or this week) worth going out for?" for one place. Every night in the range gets a verdict from hard gates (galactic-core altitude above 8°, moon under 25% illuminated or below the horizon, and true astronomical night that overlaps the core window) plus weighted factors (low/mid/high cloud, atmospheric transparency, Bortle class). A night that fails a gate returns verdict `out` with a named reason in `killers` — that is different information from a low score and the two are never conflated. Top-level `verdict`/`score`/`bestWindow`/`killers` describe the BEST night in the range, not tonight; `nights[]` carries every night for an at-a-glance strip, and `detail.hourly` carries the 30-minute series for one night (the best one unless `detailDate` says otherwise). Location resolves in the order `site` > `lat`+`lon` > `city` > Munich; a raw lat/lon inherits its Bortle class from the nearest known site unless `bortle` overrides it. All astronomy is computed locally from an ephemeris and never by a model — `summary` is the one model-generated field and is null when the model is unavailable. For plain weather use GET /weather/forecast; for the candidate sites and their Bortle baselines use GET /astro/sites.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/sites',
      () => ({ data: ASTRO_SITES.map((site) => ({ ...site })), total: ASTRO_SITES.length }),
      {
        response: z.object({ data: z.array(SiteSchema), total: z.number().int() }),
        detail: {
          tags: ['Astro & Marine'],
          summary: 'List the candidate drive-to observing sites',
          description:
            'The static set of observing sites with their Bortle baseline and drive time from Munich. Pass an `id` from here as `?site=` to GET /astro/window. Bortle is a hand-maintained constant rather than a live lookup: light pollution changes yearly, not hourly. Use this to populate a site picker, or to decide whether a 45-minute drive south is worth two Bortle classes.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
}

export const astroRoutes = createAstroRoutes()
