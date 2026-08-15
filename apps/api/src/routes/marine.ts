import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  fetchMarineUpstreams,
  marineAt,
  windAt,
  type MarineReading,
  type MarineUpstreams,
  type WindReading,
} from '../clients/marine-upstreams.js'
import {
  addDays,
  formatLocalDate,
  formatLocalTime,
  sunAltitudeDeg,
  zonedTimeToUtc,
} from '../lib/astro-night.js'
import { distanceKm } from '../lib/astro-sites.js'
import {
  classifyWind,
  DEFAULT_SPOT,
  findSpot,
  MARINE_SPOTS,
  type MarineSpot,
} from '../lib/marine-spots.js'
import { marineWindowConfig, type MarineScoreInput } from '../lib/marine-score.js'
import { completeSentence } from '../lib/ai-sentence.js'
import { circularMean, scoreWindow, type Killer, type ScoredWindow } from '../lib/window-score.js'
import { aiComplete } from './ai.js'

/**
 * "Is this day worth the drive for a surf?" — the marine sibling of
 * `/astro/window`, over the SAME engine (`../lib/window-score.ts`) with a
 * different config (`../lib/marine-score.ts`). Marine has no equivalent of
 * astronomical darkness — you surf in daylight — so where astro asks "does
 * the core window overlap the dark window", this asks "which contiguous run
 * of daylight hours is simultaneously ungated", per day.
 *
 * Division of labour is identical to astro: swell/wind physics and the score
 * are computed deterministically from `../lib/marine-score.ts` and the
 * upstream series; the model only turns the finished verdict into one
 * sentence. Upstream fan-out is flat: one `fetchMarineUpstreams` call covers
 * every day in the range.
 */

/** Open-Meteo Marine and the Open-Meteo global forecast are both CC BY 4.0. */
const ATTRIBUTION = 'Wave and wind data by Open-Meteo.com (CC BY 4.0).'

/** The marine model's real forecast horizon. Beyond this the score means nothing. */
const MAX_DAYS = 7

/** How long a generated sentence is reused for. Forecasts refresh hourly at best. */
const SUMMARY_TTL_MS = 30 * 60_000

const HOUR_MS = 60 * 60 * 1000

const KillerSchema = z.object({
  id: z.string().describe('Stable machine id, e.g. `swell-period`'),
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

const WindKindSchema = z.enum(['offshore', 'cross-shore', 'onshore'])

const SessionWindowSchema = z.object({
  start: z.string().describe('ISO 8601 UTC'),
  end: z.string().describe('ISO 8601 UTC — end of the last ungated hour'),
  localStart: z.string().describe('HH:MM in the spot timezone'),
  localEnd: z.string().describe('HH:MM in the spot timezone'),
  minutes: z.number().int(),
  peakTime: z.string().describe('ISO 8601 UTC — the highest-scoring hour inside the window'),
  localPeakTime: z.string(),
  peakScore: z.number().describe('0..100 — the score of the peak hour'),
})

const ConditionsSchema = z.object({
  swellHeight: z.number().nullable().describe('Mean significant swell height, metres'),
  swellPeriod: z.number().nullable().describe('Mean swell period, seconds'),
  swellDirection: z.number().nullable().describe('Mean swell direction, degrees FROM'),
  waveHeight: z.number().nullable().describe('Mean total significant wave height, metres'),
  windSpeed: z.number().nullable().describe('Mean wind speed, knots'),
  windDirection: z.number().nullable().describe('Mean wind direction, degrees FROM'),
  windKind: WindKindSchema.nullable().describe('null when wind direction is unknown'),
})

const DaySchema = z.object({
  date: z.string().describe('Local calendar date, YYYY-MM-DD'),
  verdict: z
    .enum(['excellent', 'good', 'marginal', 'poor', 'out'])
    .describe('`out` means a hard gate failed — see killers; it is not a low score'),
  score: z.number().describe('0..100. Always exactly 0 when verdict is `out`'),
  coverage: z
    .number()
    .describe('0..1 — share of the scoring weight that had upstream data behind it'),
  killers: z.array(KillerSchema),
  factors: z.array(FactorSchema),
  window: SessionWindowSchema.nullable().describe(
    'Longest contiguous run of ungated daylight hours. Null when every daylight hour gated',
  ),
  conditions: ConditionsSchema,
})

const HourlyPointSchema = z.object({
  time: z.string().describe('ISO 8601 UTC'),
  localTime: z.string().describe('HH:MM in the spot timezone'),
  swellHeight: z.number().nullable(),
  swellPeriod: z.number().nullable(),
  swellDirection: z.number().nullable(),
  waveHeight: z.number().nullable(),
  windSpeed: z.number().nullable(),
  windDirection: z.number().nullable(),
  windKind: WindKindSchema.nullable(),
  score: z.number(),
  gated: z.boolean(),
})

const LocationSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  name: z.string(),
  country: z.string(),
  timeZone: z.string(),
  shoreNormal: z.number().describe('Bearing the beach faces out to sea, degrees from true north'),
  spotId: z.string().nullable().describe('Null for a raw lat/lon request'),
  driveMinutes: z.number().int().nullable().describe('Null for a raw lat/lon request'),
})

const WindowResponseSchema = z.object({
  location: LocationSchema,
  generatedAt: z.string(),
  days: z.array(DaySchema).describe('One entry per requested day, earliest first'),
  verdict: z.enum(['excellent', 'good', 'marginal', 'poor', 'out']).describe('The best day’s'),
  score: z.number(),
  killers: z.array(KillerSchema).describe('Of the best day; empty unless every day is out'),
  bestWindow: SessionWindowSchema.nullable().describe(
    'Null when no day in the range has a usable session',
  ),
  summary: z
    .string()
    .nullable()
    .describe('One-sentence plain-English recommendation. Null when the model is unavailable'),
  detail: z.object({
    date: z.string(),
    hourly: z.array(HourlyPointSchema),
  }),
  sources: z.object({ marine: z.boolean(), wind: z.boolean() }),
  attribution: z.string(),
})

const MarineSpotSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  lat: z.number(),
  lon: z.number(),
  timeZone: z.string(),
  shoreNormal: z.number(),
  driveMinutes: z.number().int(),
  note: z.string(),
})

const WindowQuerySchema = z.object({
  spot: z.string().optional().describe('Spot id from GET /marine/spots. Wins over lat/lon'),
  lat: z.coerce
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe('Required together with lon and shoreNormal'),
  lon: z.coerce.number().min(-180).max(180).optional(),
  shoreNormal: z.coerce
    .number()
    .min(0)
    .max(359)
    .optional()
    .describe(
      'Bearing the beach faces out to sea, degrees from true north. Required together with lat/lon — without it wind cannot be judged',
    ),
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_DAYS)
    .optional()
    .describe('How many days from today. Default 5'),
  detailDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Which day the hourly series covers. Default: the best day'),
  // Not `z.coerce.boolean()`: `Boolean('false')` is `true`, so coercion would
  // silently ignore the one value anyone ever passes here.
  summary: z
    .enum(['true', 'false'])
    .optional()
    .describe('Set `false` to skip the generated sentence and the model call entirely'),
})

export type MarineRouteDeps = {
  fetchUpstreams: typeof fetchMarineUpstreams
  complete: typeof aiComplete
  /** Injectable clock — a route whose answer depends on "today" is untestable without one. */
  now: () => Date
}

const defaultDeps: MarineRouteDeps = {
  fetchUpstreams: fetchMarineUpstreams,
  complete: aiComplete,
  now: () => new Date(),
}

type ResolvedPlace = {
  lat: number
  lon: number
  name: string
  country: string
  timeZone: string
  shoreNormal: number
  spotId: string | null
  driveMinutes: number | null
}

type ResolveResult =
  | { ok: true; place: ResolvedPlace }
  | { ok: false; status: 404 | 400; message: string }

function fromSpot(spot: MarineSpot): ResolvedPlace {
  return {
    lat: spot.lat,
    lon: spot.lon,
    name: spot.name,
    country: spot.country,
    timeZone: spot.timeZone,
    shoreNormal: spot.shoreNormal,
    spotId: spot.id,
    driveMinutes: spot.driveMinutes,
  }
}

/**
 * Nearest of the four candidate spots by great-circle distance — used only to
 * infer a timezone and a display country for a raw lat/lon request, the same
 * fallback role `nearestSite` plays for astro's Bortle inference.
 */
function nearestMarineSpot(lat: number, lon: number): MarineSpot {
  let nearest: MarineSpot = MARINE_SPOTS[0]!
  let nearestDistance = distanceKm({ lat, lon }, nearest)
  for (const spot of MARINE_SPOTS.slice(1)) {
    const distance = distanceKm({ lat, lon }, spot)
    if (distance < nearestDistance) {
      nearest = spot
      nearestDistance = distance
    }
  }
  return nearest
}

/** Resolution order: `spot` > `lat`+`lon`+`shoreNormal` > `DEFAULT_SPOT`. */
function resolvePlace(query: z.infer<typeof WindowQuerySchema>): ResolveResult {
  if (query.spot) {
    const spot = findSpot(query.spot)
    if (!spot) {
      return {
        ok: false,
        status: 404,
        message: `Unknown spot "${query.spot}". See GET /marine/spots.`,
      }
    }
    return { ok: true, place: fromSpot(spot) }
  }

  if (query.lat !== undefined && query.lon !== undefined) {
    if (query.shoreNormal === undefined) {
      return {
        ok: false,
        status: 400,
        message:
          'shoreNormal is required together with lat/lon — without it wind cannot be judged at all, and guessing a shore orientation would produce confident nonsense.',
      }
    }
    const near = nearestMarineSpot(query.lat, query.lon)
    return {
      ok: true,
      place: {
        lat: query.lat,
        lon: query.lon,
        name: `${query.lat.toFixed(3)}, ${query.lon.toFixed(3)}`,
        country: near.country,
        timeZone: near.timeZone,
        shoreNormal: query.shoreNormal,
        spotId: null,
        driveMinutes: null,
      },
    }
  }

  return { ok: true, place: fromSpot(DEFAULT_SPOT) }
}

/** One evaluated daylight hour: the raw upstream readings plus its score. */
type HourEval = {
  time: Date
  marine: MarineReading | null
  wind: WindReading | null
  scored: ScoredWindow
}

type Run = { startIndex: number; endIndex: number }

const NO_DAYLIGHT_KILLERS: Killer[] = [
  { id: 'daylight', label: 'Daylight', reason: 'No daylight hours in range' },
]

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${date}"`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

/** Every local-clock hour of `date` (00:00..23:00) whose sun altitude clears the horizon. */
function daylightHours(
  date: string,
  timeZone: string,
  observer: { lat: number; lon: number },
): Date[] {
  const { year, month, day } = parseIsoDate(date)
  const localMidnight = zonedTimeToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone)
  const hours: Date[] = []
  for (let h = 0; h < 24; h++) {
    const time = new Date(localMidnight.getTime() + h * HOUR_MS)
    if (sunAltitudeDeg(time, observer) > 0) hours.push(time)
  }
  return hours
}

function evaluateHour(time: Date, shoreNormal: number, upstreams: MarineUpstreams): HourEval {
  const marine = marineAt(upstreams.marine, time)
  const wind = windAt(upstreams.wind, time)
  const input: MarineScoreInput = {
    spot: { shoreNormal },
    swellHeight: marine?.swellHeight ?? null,
    swellPeriod: marine?.swellPeriod ?? null,
    swellDirection: marine?.swellDirection ?? null,
    windSpeed: wind?.speedKn ?? null,
    windDirection: wind?.directionDeg ?? null,
    waveHeight: marine?.waveHeight ?? null,
  }
  return { time, marine, wind, scored: scoreWindow(marineWindowConfig, input) }
}

/** Longest contiguous run of hours that are NOT gated. Null when every hour is gated. */
function longestUngatedRun(hours: HourEval[]): Run | null {
  let best: Run | null = null
  let runStart = -1
  for (let i = 0; i <= hours.length; i++) {
    const inRun = i < hours.length && !hours[i]!.scored.gated
    if (inRun && runStart === -1) runStart = i
    if (inRun || runStart === -1) continue
    const endIndex = i - 1
    if (!best || endIndex - runStart > best.endIndex - best.startIndex) {
      best = { startIndex: runStart, endIndex }
    }
    runStart = -1
  }
  return best
}

/**
 * The highest-scoring hour in `hours`. When every hour is gated (all score 0)
 * the tie-break is fewer killers — a single named reason is a less-bad day
 * than a stack of them — then chronological order.
 */
function bestHour(hours: HourEval[]): HourEval {
  let best = hours[0]!
  for (const hour of hours.slice(1)) {
    if (hour.scored.score > best.scored.score) {
      best = hour
      continue
    }
    if (
      hour.scored.score === best.scored.score &&
      hour.scored.killers.length < best.scored.killers.length
    ) {
      best = hour
    }
  }
  return best
}

type DayEvaluation = {
  date: string
  hours: HourEval[]
  best: HourEval | null
  windowRun: Run | null
}

function evaluateDay(
  date: string,
  place: Pick<ResolvedPlace, 'lat' | 'lon' | 'timeZone' | 'shoreNormal'>,
  upstreams: MarineUpstreams,
): DayEvaluation {
  const times = daylightHours(date, place.timeZone, { lat: place.lat, lon: place.lon })
  const hours = times.map((time) => evaluateHour(time, place.shoreNormal, upstreams))
  if (hours.length === 0) return { date, hours, best: null, windowRun: null }

  const windowRun = longestUngatedRun(hours)
  const best = windowRun
    ? bestHour(hours.slice(windowRun.startIndex, windowRun.endIndex + 1))
    : bestHour(hours)
  return { date, hours, best, windowRun }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function isNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined
}

/** The window's hours when one exists, otherwise every daylight hour — mirrors astro's `weatherSamples` fallback. */
function conditionSamples(evaluation: DayEvaluation): HourEval[] {
  if (evaluation.windowRun) {
    return evaluation.hours.slice(
      evaluation.windowRun.startIndex,
      evaluation.windowRun.endIndex + 1,
    )
  }
  return evaluation.hours
}

/**
 * Bearings are averaged with `circularMean`, never with `mean`. The arithmetic
 * mean of 350° and 10° is 180° — it turns a north wind into a south one and
 * inverts the offshore/onshore verdict the whole endpoint hangs on. A day whose
 * wind boxed the compass gets `null` rather than a confident wrong answer.
 */
function dayConditions(evaluation: DayEvaluation, shoreNormal: number) {
  const samples = conditionSamples(evaluation)
  const windDirection = circularMean(samples.map((h) => h.wind?.directionDeg).filter(isNumber))
  return {
    swellHeight: mean(samples.map((h) => h.marine?.swellHeight).filter(isNumber)),
    swellPeriod: mean(samples.map((h) => h.marine?.swellPeriod).filter(isNumber)),
    swellDirection: roundOrNull(
      circularMean(samples.map((h) => h.marine?.swellDirection).filter(isNumber)),
    ),
    waveHeight: mean(samples.map((h) => h.marine?.waveHeight).filter(isNumber)),
    windSpeed: mean(samples.map((h) => h.wind?.speedKn).filter(isNumber)),
    windDirection: roundOrNull(windDirection),
    windKind: windDirection === null ? null : classifyWind(windDirection, shoreNormal).kind,
  }
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : round1(value)
}

function serializeSessionWindow(evaluation: DayEvaluation, run: Run, timeZone: string) {
  const windowHours = evaluation.hours.slice(run.startIndex, run.endIndex + 1)
  const peak = bestHour(windowHours)
  const start = windowHours[0]!.time
  const end = new Date(windowHours[windowHours.length - 1]!.time.getTime() + HOUR_MS)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    localStart: formatLocalTime(start, timeZone),
    localEnd: formatLocalTime(end, timeZone),
    minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
    peakTime: peak.time.toISOString(),
    localPeakTime: formatLocalTime(peak.time, timeZone),
    peakScore: peak.scored.score,
  }
}

function serializeDay(evaluation: DayEvaluation, timeZone: string, shoreNormal: number) {
  const conditions = dayConditions(evaluation, shoreNormal)
  if (!evaluation.best) {
    return {
      date: evaluation.date,
      verdict: 'out' as const,
      score: 0,
      coverage: 0,
      killers: NO_DAYLIGHT_KILLERS,
      factors: [],
      window: null,
      conditions,
    }
  }
  return {
    date: evaluation.date,
    verdict: evaluation.best.scored.verdict as 'excellent' | 'good' | 'marginal' | 'poor' | 'out',
    score: evaluation.best.scored.score,
    coverage: evaluation.best.scored.coverage,
    killers: evaluation.best.scored.killers,
    factors: evaluation.best.scored.factors,
    window: evaluation.windowRun
      ? serializeSessionWindow(evaluation, evaluation.windowRun, timeZone)
      : null,
    conditions,
  }
}

function serializeHourly(hours: HourEval[], timeZone: string, shoreNormal: number) {
  return hours.map((hour) => ({
    time: hour.time.toISOString(),
    localTime: formatLocalTime(hour.time, timeZone),
    swellHeight: hour.marine?.swellHeight ?? null,
    swellPeriod: hour.marine?.swellPeriod ?? null,
    swellDirection: hour.marine?.swellDirection ?? null,
    waveHeight: hour.marine?.waveHeight ?? null,
    windSpeed: hour.wind?.speedKn ?? null,
    windDirection: hour.wind?.directionDeg ?? null,
    windKind:
      hour.wind?.directionDeg === null || hour.wind?.directionDeg === undefined
        ? null
        : classifyWind(hour.wind.directionDeg, shoreNormal).kind,
    score: hour.scored.score,
    gated: hour.scored.gated,
  }))
}

type SummaryFacts = {
  placeName: string
  /** Weekday name of the best day's peak hour — computed here, never by the model. */
  weekday: string
  best: ReturnType<typeof serializeDay> | null
  bestWindow: ReturnType<typeof serializeSessionWindow> | null
  dayCount: number
}

/** Cache keyed on the deterministic verdict, so a sentence is regenerated only when the verdict moves. */
const summaryCache = new Map<string, { text: string; expiresAt: number }>()

function summaryCacheKey(facts: SummaryFacts): string {
  return [
    facts.placeName,
    facts.dayCount,
    facts.best?.date ?? 'none',
    facts.best?.verdict ?? 'none',
    Math.round(facts.best?.score ?? -1),
    facts.bestWindow?.localStart ?? 'none',
  ].join('|')
}

/**
 * Turn the finished verdict into one sentence. Same contract as astro's
 * `generateSummary`: everything numeric is already computed, the model may
 * not add a number of its own, and a model failure returns null rather than
 * failing the request — the sentence is an enhancement, never a dependency.
 */
async function generateSummary(
  facts: SummaryFacts,
  complete: MarineRouteDeps['complete'],
  now: Date,
): Promise<string | null> {
  const key = summaryCacheKey(facts)
  const cached = summaryCache.get(key)
  if (cached && cached.expiresAt > now.getTime()) return cached.text

  const lines: string[] = [`Location: ${facts.placeName}.`, `Days evaluated: ${facts.dayCount}.`]
  if (facts.best && facts.bestWindow) {
    lines.push(
      `Best day: ${facts.weekday} ${facts.best.date}, verdict ${facts.best.verdict}, score ${facts.best.score}/100.`,
      `Session: ${facts.bestWindow.localStart}–${facts.bestWindow.localEnd} local (${facts.bestWindow.minutes} min).`,
      `Swell: ${facts.best.conditions.swellHeight ?? 'unknown'} m at ${facts.best.conditions.swellPeriod ?? 'unknown'} s.`,
      `Wind: ${facts.best.conditions.windSpeed ?? 'unknown'} kn, ${facts.best.conditions.windKind ?? 'unknown'}.`,
    )
  } else {
    // A flat week still has a story, and it is the one the operator most needs:
    // *why*, and how close it got. Handing the model only "no day is usable"
    // gave it nothing to write and it returned a fragment.
    lines.push(`No day in the range is usable across all ${facts.dayCount} days.`)
    if (facts.best) {
      lines.push(
        `Closest day: ${facts.weekday || facts.best.date}.`,
        `Its swell: ${facts.best.conditions.swellHeight ?? 'unknown'} m at ${facts.best.conditions.swellPeriod ?? 'unknown'} s.`,
        `Its wind: ${facts.best.conditions.windSpeed ?? 'unknown'} kn, ${facts.best.conditions.windKind ?? 'unknown'}.`,
      )
      const reasons = facts.best.killers.map((killer) => killer.reason)
      if (reasons.length > 0) lines.push(`Why it is out: ${reasons.join('; ')}.`)
    }
  }

  // Two different jobs, so two different instructions. The "lead with the
  // weekday and the session start" register is impossible to satisfy when there
  // is no session, and asking for it anyway is what produced a mangled fragment
  // on a flat week.
  const system = facts.bestWindow
    ? 'You write ONE short sentence for a surf trip planner — a terse field note, at most 25 words. Use ONLY the facts given: never compute, estimate or invent a number, time or date, and never restate every figure. Lead with the weekday and the session start, then the two or three numbers that actually decide the day. No preamble, no markdown, no list. Example of the register: "Saturday 09:00 — 1.5m at 13s, offshore 8kn; the pick of the week at Hossegor."'
    : 'You write ONE short sentence for a surf trip planner telling the reader NOT to go, and why. At most 25 words. Use ONLY the facts given: never compute, estimate or invent a number, time or date. Name the single limiting reason and the number behind it. Do not mention a session time — there is no session. No preamble, no markdown, no list. Example of the register: "Flat all week at Hossegor — 0.8m at 5.5s is windsea, and the wind is onshore every day."'

  const sentence = await completeSentence(complete, lines.join('\n'), {
    system,
    subTool: 'marine-window',
  })
  if (sentence) summaryCache.set(key, { text: sentence, expiresAt: now.getTime() + SUMMARY_TTL_MS })
  return sentence
}

/** Exported for tests — the summary cache is module-scope and would otherwise leak between cases. */
export function clearMarineSummaryCache(): void {
  summaryCache.clear()
}

export function createMarineRoutes(overrides: Partial<MarineRouteDeps> = {}) {
  const deps: MarineRouteDeps = { ...defaultDeps, ...overrides }

  return new Elysia({ prefix: '/marine' })
    .get(
      '/window',
      async ({ query, status }) => {
        const resolved = resolvePlace(query)
        if (!resolved.ok) return status(resolved.status, resolved.message)
        const place = resolved.place

        const dayCount = query.days ?? 5
        const now = deps.now()
        const firstDate = formatLocalDate(now, place.timeZone)

        // One upstream fetch covers the whole range. One extra day of margin,
        // clamped by the client to its 7-day horizon anyway, mirrors astro's
        // `nightCount + 1` — the last requested day's daylight hours can run
        // past midnight UTC even though they never cross a calendar day in
        // the spot's own timezone.
        const upstreams = await deps.fetchUpstreams({
          lat: place.lat,
          lon: place.lon,
          days: Math.min(dayCount + 1, MAX_DAYS),
        })

        const dates = Array.from({ length: dayCount }, (_, offset) => addDays(firstDate, offset))
        const bundles = dates.map((date) => {
          const evaluation = evaluateDay(date, place, upstreams)
          const serialized = serializeDay(evaluation, place.timeZone, place.shoreNormal)
          return { evaluation, serialized }
        })

        // The headline is the best day in the range, not today.
        const best =
          bundles.reduce<(typeof bundles)[number] | null>((winner, candidate) => {
            if (!winner) return candidate
            return candidate.serialized.score > winner.serialized.score ? candidate : winner
          }, null) ?? null

        const detailDate = query.detailDate ?? best?.evaluation.date ?? firstDate
        const detailBundle =
          bundles.find((bundle) => bundle.evaluation.date === detailDate) ?? bundles[0]

        const summaryWanted = query.summary !== 'false'
        const summary = summaryWanted
          ? await generateSummary(
              {
                placeName: place.name,
                weekday: best?.evaluation.best
                  ? new Intl.DateTimeFormat('en-GB', {
                      timeZone: place.timeZone,
                      weekday: 'long',
                    }).format(best.evaluation.best.time)
                  : '',
                best: best?.serialized ?? null,
                bestWindow: best?.serialized.window ?? null,
                dayCount,
              },
              deps.complete,
              now,
            )
          : null

        return {
          location: {
            lat: place.lat,
            lon: place.lon,
            name: place.name,
            country: place.country,
            timeZone: place.timeZone,
            shoreNormal: place.shoreNormal,
            spotId: place.spotId,
            driveMinutes: place.driveMinutes,
          },
          generatedAt: now.toISOString(),
          days: bundles.map((bundle) => bundle.serialized),
          verdict: (best?.serialized.verdict ?? 'out') as
            | 'excellent'
            | 'good'
            | 'marginal'
            | 'poor'
            | 'out',
          score: best?.serialized.score ?? 0,
          killers: best?.serialized.killers ?? [],
          bestWindow: best?.serialized.window ?? null,
          summary,
          detail: {
            date: detailBundle?.evaluation.date ?? firstDate,
            hourly: detailBundle
              ? serializeHourly(detailBundle.evaluation.hours, place.timeZone, place.shoreNormal)
              : [],
          },
          sources: upstreams.health,
          attribution: ATTRIBUTION,
        }
      },
      {
        query: WindowQuerySchema,
        response: { 200: WindowResponseSchema, 400: z.string(), 404: z.string() },
        detail: {
          tags: ['Astro & Marine'],
          summary: 'Score the next N days for a surf session',
          description:
            'Answers "is this day worth the drive for a surf?" for one spot. Every day in the range gets a verdict from hard gates (swell period at least 8s — anything shorter is windsea, not groundswell — wave height inside a rideable 0.5–4m band, and wind not more than 60° off dead-offshore once it is above a glassy 5kn) plus weighted factors (swell period, wind direction, swell height, wind speed, swell/shore alignment). A day that fails every daylight hour returns verdict `out` with a named reason in `killers` — that is different information from a low score and the two are never conflated. Unlike /astro/window there is no darkness constraint: each day is scored over its longest contiguous run of ungated daylight hours (the `window`), and top-level `verdict`/`score`/`bestWindow`/`killers` describe the BEST day in the range, not today; `days[]` carries every day for an at-a-glance strip (plus mean conditions and the classified wind direction), and `detail.hourly` carries the hourly series for one day (the best one unless `detailDate` says otherwise). Location resolves in the order `spot` > `lat`+`lon`+`shoreNormal` > the nearest default spot; `shoreNormal` (the bearing the beach faces out to sea) is required whenever a raw lat/lon is given, since wind cannot otherwise be judged. All physics is computed from Open-Meteo marine + wind forecasts and never by a model — `summary` is the one model-generated field and is null when the model is unavailable. For plain weather use GET /weather/forecast; for night-photography planning at the same kind of "is it worth going" question use GET /astro/window; for the candidate spots and their shore orientation use GET /marine/spots.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .get(
      '/spots',
      () => ({ data: MARINE_SPOTS.map((spot) => ({ ...spot })), total: MARINE_SPOTS.length }),
      {
        response: z.object({ data: z.array(MarineSpotSchema), total: z.number().int() }),
        detail: {
          tags: ['Astro & Marine'],
          summary: 'List the candidate drive-to (or fly-to) surf spots',
          description:
            "The static set of candidate surf spots with their shore orientation and drive time from Munich — a starting set, not the operator's actual break list. Pass an `id` from here as `?spot=` to GET /marine/window. `shoreNormal` is hand-maintained and approximate; a raw `lat`+`lon`+`shoreNormal` on /marine/window works just as well once someone has stood on the actual beach.",
          security: [{ BearerAuth: [] }],
        },
      },
    )
}

export const marineRoutes = createMarineRoutes()
