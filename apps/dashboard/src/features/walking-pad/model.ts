// Pure derivations for the WalkingPad page. Every figure a sentence repeats is computed here once,
// so the summary line, the strip cells and the chart headers cannot disagree.

import { WALKING_WINDOW_VALUES } from '../../lib/window-stores'

export const DEFAULT_WEEKLY_TARGET_KM = 15
export const MS_PER_DAY = 86_400_000
/** Day buckets drawn by the "Days" view; a longer window shows its latest 90 days. */
export const DAY_VIEW_MAX = 90
/** The session list is not windowed server-side: the histogram facts read this many newest rows. */
export const FACTS_ROW_LIMIT = 200

export type SeriesPoint = {
  date: string
  sessions: number
  duration_s: number
  distance_m: number
  steps: number
  kcal: number
  avg_speed_kmh: number | null
}

export type SessionRow = {
  uuid: string
  started_at: string
  ended_at: string
  duration_s: number
  distance_m: number
  steps: number
  avg_speed_kmh: number
  max_speed_kmh: number
  kcal: number
  pause_count: number
}

// ── Formats ──────────────────────────────────────────────────────────────────

/** Kilometres with one decimal and no unit, from metres. */
export const fmtKm = (meters: number): string => (meters / 1000).toFixed(1)

export const fmtKmh = (kmh: number | null): string => (kmh === null ? '—' : kmh.toFixed(1))

/** An unsigned delta figure: the `DeltaBadge` glyph carries the direction. */
export const fmtKmAbs = (deltaMeters: number): string => `${fmtKm(Math.abs(deltaMeters))} km`
export const fmtKmhAbs = (delta: number): string => `${Math.abs(delta).toFixed(1)} km/h`

export const fmtSignedKmh = (delta: number): string =>
  `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)} km/h`

export const fmtSignedKm = (deltaMeters: number): string =>
  `${deltaMeters > 0 ? '+' : deltaMeters < 0 ? '−' : ''}${fmtKm(Math.abs(deltaMeters))} km`

/** `2 h 05 min` / `45 min` / `30 s`, from seconds. */
export function fmtDuration(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return `${total} s`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h === 0) return `${m} min`
  return `${h} h ${String(m).padStart(2, '0')} min`
}

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many)

// ── Window naming ────────────────────────────────────────────────────────────

const WINDOW_LONG: Record<string, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '6m': '6 months',
  '1y': 'year',
}
const WINDOW_SHORT: Record<string, string> = {
  '7d': '7 d',
  '30d': '30 d',
  '90d': '90 d',
  '6m': '6 mo',
  '1y': '1 y',
}

/** "the last 30 days"; a custom range is "this range", the all-time window "any window". */
export function windowPhrase(preset: string | undefined): string {
  if (preset === 'all') return 'any window'
  const long = preset === undefined ? undefined : WINDOW_LONG[preset]
  return long === undefined ? 'this range' : `the last ${long}`
}

/** "last 30 days" for a chart title; "all time" and "selected range" for the open and custom windows. */
export function windowTitle(preset: string | undefined): string {
  if (preset === 'all') return 'all time'
  const long = preset === undefined ? undefined : WINDOW_LONG[preset]
  return long === undefined ? 'selected range' : `last ${long}`
}

/** "30 d" for a title qualifier, `null` for a window that has no named length. */
export function windowShort(preset: string | undefined): string | null {
  return preset === undefined ? null : (WINDOW_SHORT[preset] ?? null)
}

/** "30 d" / "all time" / "range": the period a cell's caption names. */
export function windowQualifier(preset: string | undefined): string {
  if (preset === 'all') return 'all time'
  return windowShort(preset) ?? 'range'
}

/** "prior 30 d" / "prior window" — what a pace delta is compared against. */
export function priorLabel(preset: string | undefined): string {
  const short = windowShort(preset)
  return short === null ? 'prior window' : `prior ${short}`
}

/** The next wider preset after `current`, or `null` when none is wider ("all" / a custom range). */
export function widerPreset(
  current: string | undefined,
): (typeof WALKING_WINDOW_VALUES)[number] | null {
  const i = WALKING_WINDOW_VALUES.findIndex((v) => v === current)
  if (i < 0) return '90d'
  return WALKING_WINDOW_VALUES[i + 1] ?? null
}

const WIDEN_LABEL: Record<string, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '6m': '6 months',
  '1y': '1 year',
  all: 'all time',
}

/** "Show 90 days" — the action that widens an empty window to `preset`. */
export const widenLabel = (preset: string): string => `Show ${WIDEN_LABEL[preset] ?? preset}`

// ── Weeks ────────────────────────────────────────────────────────────────────

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const keyMs = (key: string): number => Date.parse(`${key}T00:00:00Z`)

/** The UTC Monday of the week containing `nowMs`, as the API's `YYYY-MM-DD` bucket key. */
export function mondayKey(nowMs: number): string {
  const d = new Date(nowMs)
  const sinceMonday = (d.getUTCDay() + 6) % 7
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday))
}

export type WeekSummary = {
  distanceM: number
  sessions: number
  /** Last week's distance, `null` when the series does not carry that bucket. */
  priorDistanceM: number | null
  deltaM: number | null
}

/** This week (Mon–Sun, UTC) against last week from a week-bucket series; `null` when this week's bucket is missing. */
export function weekSummary(points: readonly SeriesPoint[], nowMs: number): WeekSummary | null {
  const monday = mondayKey(nowMs)
  const current = points.find((p) => p.date === monday)
  if (current === undefined) return null
  const lastKey = dayKey(keyMs(monday) - 7 * MS_PER_DAY)
  const prior = points.find((p) => p.date === lastKey)
  return {
    distanceM: current.distance_m,
    sessions: current.sessions,
    priorDistanceM: prior?.distance_m ?? null,
    deltaM: prior === undefined ? null : current.distance_m - prior.distance_m,
  }
}

export type WeekTick = {
  /** Single-letter weekday, Mon first. */
  label: string
  key: string
  state: 'walked' | 'rest' | 'upcoming'
  today: boolean
  sessions: number
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Seven Mon–Sun ticks for the current UTC week from a day-bucket series. */
export function weekTicks(points: readonly SeriesPoint[], nowMs: number): WeekTick[] {
  const monday = keyMs(mondayKey(nowMs))
  const today = dayKey(nowMs)
  return WEEKDAY_LETTERS.map((label, i) => {
    const key = dayKey(monday + i * MS_PER_DAY)
    const sessions = points.find((p) => p.date === key)?.sessions ?? 0
    const state = key > today ? 'upcoming' : sessions > 0 ? 'walked' : 'rest'
    return { label, key, state, today: key === today, sessions }
  })
}

/** Drop the empty buckets before the first walk (the "all" window carries decades of them). */
export function trimLeadingEmpty<T extends { sessions: number }>(points: readonly T[]): T[] {
  const first = points.findIndex((p) => p.sessions > 0)
  return first < 0 ? [] : points.slice(first)
}

/** Weekly pace values for the sparkline; weeks without a walk have no pace and are left out. */
export function paceValues(points: readonly SeriesPoint[]): number[] {
  return trimLeadingEmpty(points).flatMap((p) =>
    p.avg_speed_kmh === null ? [] : [p.avg_speed_kmh],
  )
}

// ── Session rows → histogram facts ───────────────────────────────────────────

/** Start of a window as epoch ms, `null` for the open-ended "all" window. */
export function windowStartMs(
  params: { window?: string | undefined; from?: string | undefined },
  nowMs: number,
): number | null {
  if (params.from !== undefined) return Date.parse(params.from)
  const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
  const n = params.window === undefined ? 30 : days[params.window]
  return n === undefined ? null : nowMs - n * MS_PER_DAY
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const low = sorted[mid - 1] ?? 0
  const high = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? high : (low + high) / 2
}

export type DistanceFacts = {
  medianM: number
  longestM: number
  /** True when the newest rows do not reach back to the window's start, so the facts cover the newest rows only. */
  partial: boolean
}

/** Median and longest session distance for the rows inside the window; `null` when none are. */
export function distanceFacts(
  rows: readonly SessionRow[],
  startMs: number | null,
  limit = FACTS_ROW_LIMIT,
): DistanceFacts | null {
  const inside = rows.filter((r) => startMs === null || Date.parse(r.started_at) >= startMs)
  const med = median(inside.map((r) => r.distance_m))
  if (med === null) return null
  const oldest = rows.reduce((min, r) => Math.min(min, Date.parse(r.started_at)), Infinity)
  const partial = rows.length >= limit && (startMs === null || oldest > startMs)
  return { medianM: med, longestM: Math.max(...inside.map((r) => r.distance_m)), partial }
}

// ── Hour grid (UTC → local) ──────────────────────────────────────────────────

export type HourCell = { hour: number; dow: number; sessions: number; distance_m: number }

/** Shift UTC (dow, hour) cells by a whole-hour offset; `offsetMinutes` is `Date#getTimezoneOffset` (UTC − local). */
export function shiftCellsToLocal(cells: readonly HourCell[], offsetMinutes: number): HourCell[] {
  const shift = -Math.round(offsetMinutes / 60)
  return cells.map((c) => {
    const slot = c.dow * 24 + c.hour + shift
    const wrapped = ((slot % 168) + 168) % 168
    return { ...c, dow: Math.floor(wrapped / 24), hour: wrapped % 24 }
  })
}

export function busiestCell(cells: readonly HourCell[]): HourCell | null {
  const best = cells.reduce<HourCell | null>(
    (b, c) => (c.sessions > 0 && (b === null || c.sessions > b.sessions) ? c : b),
    null,
  )
  return best
}

/** First visible hour: 06:00, earlier only when a walk happened before it. */
export function firstVisibleHour(cells: readonly HourCell[]): number {
  return cells.reduce((min, c) => (c.sessions > 0 ? Math.min(min, c.hour) : min), 6)
}

// ── Achievements ─────────────────────────────────────────────────────────────

export type Achievement = {
  id: number
  type: string
  title: string
  description: string
  unlocked_at: string
}

export type AchievementRow = {
  title: string
  description: string
  type: string
  count: number
  lastAt: string
}

/** One row per title: repeats collapse into a count and the newest unlock time. Newest first. */
export function collapseAchievements(items: readonly Achievement[]): AchievementRow[] {
  const byTitle = new Map<string, AchievementRow>()
  for (const a of items) {
    const row = byTitle.get(a.title)
    if (row === undefined) {
      byTitle.set(a.title, {
        title: a.title,
        description: a.description,
        type: a.type,
        count: 1,
        lastAt: a.unlocked_at,
      })
      continue
    }
    row.count += 1
    if (a.unlocked_at > row.lastAt) {
      row.lastAt = a.unlocked_at
      row.description = a.description
    }
  }
  return [...byTitle.values()].toSorted((a, b) => b.lastAt.localeCompare(a.lastAt))
}

const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })

/** Newest-first rows grouped under their last unlock's month, in the order they arrive. */
export function groupByMonth(
  rows: readonly AchievementRow[],
): { month: string; rows: AchievementRow[] }[] {
  const groups: { month: string; rows: AchievementRow[] }[] = []
  for (const row of rows) {
    const month = monthFormat.format(new Date(row.lastAt))
    const last = groups.at(-1)
    if (last?.month === month) last.rows.push(row)
    else groups.push({ month, rows: [row] })
  }
  return groups
}

// ── Summary sentence ─────────────────────────────────────────────────────────

export type SummaryInput = {
  weekDistanceM: number | null
  weekSessions: number | null
  streakDays: number
  paceKmh: number | null
  paceDeltaKmh: number | null
  prior: string
}

/** "{km} km this week in {n} walks; streak {d} d; pace {p} km/h, {delta} vs the prior 30 d." */
export function summarySentence(s: SummaryInput): string {
  const week =
    s.weekDistanceM === null || s.weekSessions === null
      ? 'this week —'
      : `${fmtKm(s.weekDistanceM)} km this week in ${s.weekSessions} ${plural(s.weekSessions, 'walk')}`
  const pace =
    s.paceKmh === null
      ? 'pace —'
      : `pace ${fmtKmh(s.paceKmh)} km/h${s.paceDeltaKmh === null ? ', no prior window to compare' : `, ${fmtSignedKmh(s.paceDeltaKmh)} vs the ${s.prior}`}`
  return `${week}; streak ${s.streakDays} d; ${pace}.`
}
