/**
 * The Flow tab's drain cards: one small chart per payer, every one the same shape (share left on a
 * fixed window, the actual line, the projection from now at the current drain rate, the even pace and
 * the rules where the window resets). Three builders turn the plain data of a subscription's weekly
 * quota, a credit pool and the IU personal key into one `DrainModel`; `drain-chart.tsx` only draws it.
 * Pure: no React, no queries.
 */
import { formatDuration, withUnit } from '../../lib/format'
import type { PaceResponse } from '../../lib/queries/usage'
import { dayToDate } from './constants'
import { DAY_MS, fmtDay, fmtUsd } from './flow-model'
import { paceModel } from './pace-model'

const HOUR_MS = 3_600_000
const WEEK_MS = 7 * DAY_MS

/** A weekly window shows last week and this one, so a reset is visible. */
const SUB_SPAN_MS = 2 * WEEK_MS

/** A burn read over less than this is noise. */
const MIN_ELAPSED_MS = 2 * HOUR_MS

/**
 * Resets of one account closer than this are one reset: a weekly window cannot reset twice in a day.
 * The API can hold both the scheduled instant and the actual one; the LATEST of a cluster wins, since
 * the actual reset happens after the scheduled one is reported.
 */
const RESET_DEDUPE_MS = DAY_MS

/** How far past the newest portal day the key's projection runs. */
const KEY_AHEAD_DAYS = 14

/** A pool whose cycle end is unknown still gets this much room to project into. */
const POOL_OPEN_MS = 14 * DAY_MS

export interface DrainPoint {
  at: number
  /** Share left, 0–100. */
  left: number
}

export interface DrainMark {
  at: number
  label: string
}

export interface DrainModel {
  id: string
  kind: 'sub' | 'pool' | 'key'
  title: string
  /** The payer id `colorForPayer` takes. */
  payer: string
  /** The fixed x domain, epoch ms. */
  window: { from: number; to: number }
  now: number
  actual: DrainPoint[]
  projection: DrainPoint[]
  even: DrainPoint[]
  /** The vertical rules: resets, renewals, the day a key is back under its cap. */
  resets: DrainMark[]
  runOut: DrainMark | null
  /** The headline figure: `62 % left`, `$58 left`. */
  headline: string
  /** States the fixed window. */
  subtitle: string
  /** One plain-language line: when it runs out, or what is left unspent at the reset. */
  verdict: string
  info: string
  /** The tooltip's value for a share left, in the payer's own unit. */
  leftText: (left: number) => string
  /** Set when there is nothing to draw: the card's empty label. */
  empty: string | null
}

const clamp = (n: number): number => Math.min(100, Math.max(0, n))
const pctText = (n: number): string => withUnit(Math.round(n), '%')

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const two = (n: number): string => String(n).padStart(2, '0')

/** `Fri 14:00` in local time. */
export function whenText(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getDay()]} ${two(d.getHours())}:${two(d.getMinutes())}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `12 Nov`, the local day (a bare `YYYY-MM-DD` day parses to local midnight here). */
const dayText = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

const inText = (ms: number): string => `in ${formatDuration(Math.max(0, ms))}`

function emptyModel(
  base: Pick<
    DrainModel,
    'id' | 'kind' | 'title' | 'payer' | 'window' | 'now' | 'info' | 'subtitle'
  >,
  empty: string,
  leftText: (left: number) => string,
): DrainModel {
  return {
    ...base,
    actual: [],
    projection: [],
    even: [],
    resets: [],
    runOut: null,
    headline: '—',
    verdict: empty,
    leftText,
    empty,
  }
}

// ── Subscriptions ────────────────────────────────────────────────────────────────────────────

export interface SubDrainInput {
  id: string
  title: string
  payer: string
  /** The account's hourly quota samples. */
  points: ReadonlyArray<{ at: string; sevenDayPct: number | null }>
  /** The account's `seven_day` reset instants from the API. */
  resets: readonly string[]
  /** The next reset reported by the latest reading; null when none. */
  nextResetAt: string | null
  /** The latest reading's weekly percent used; null without one. */
  sevenDayPct: number | null
  now: number
}

const SUB_INFO =
  'Share of the weekly quota left: 100 % right after a reset, falling as you use it. Solid: what the collector sampled, last week and this week (it jumps back to 100 % at each reset). Dashed: where this week ends at the pace so far. Dotted: the even pace that would use it all exactly at the reset.'

const subLeftText = (left: number): string => `${pctText(left)} left · ${pctText(100 - left)} used`

/** API resets inside the domain, deduped, with the reported next reset; none inside → one week back. */
function subResets(input: SubDrainInput, from: number, next: number): number[] {
  const inside = input.resets
    .map((r) => Date.parse(r))
    .filter((t) => !Number.isNaN(t) && t >= from && t < next - RESET_DEDUPE_MS)
    .toSorted((a, b) => a - b)
  const deduped: number[] = []
  for (const t of inside) {
    const last = deduped[deduped.length - 1]
    if (last === undefined || t - last >= RESET_DEDUPE_MS) deduped.push(t)
    else deduped[deduped.length - 1] = t
  }
  if (deduped.length === 0) deduped.push(next - WEEK_MS)
  return [...deduped, next]
}

export function subDrain(input: SubDrainInput): DrainModel {
  const { now } = input
  const next = input.nextResetAt === null ? NaN : Date.parse(input.nextResetAt)
  const window = Number.isNaN(next)
    ? { from: now - SUB_SPAN_MS, to: now }
    : { from: next - SUB_SPAN_MS, to: next }
  const base = {
    id: input.id,
    kind: 'sub' as const,
    title: input.title,
    payer: input.payer,
    window,
    now,
    info: SUB_INFO,
    subtitle: 'weekly window',
  }
  if (Number.isNaN(next) || next <= now) {
    return emptyModel(base, 'No weekly window reported', subLeftText)
  }
  const subtitle = `7 d window, last week + this week · resets ${whenText(next)} (${inText(next - now)})`
  const windowStart = next - WEEK_MS

  const actual: DrainPoint[] = input.points
    .map((p) => ({ at: Date.parse(p.at), pct: p.sevenDayPct }))
    .filter((p) => !Number.isNaN(p.at) && p.at >= window.from && p.at <= window.to)
    .toSorted((a, b) => a.at - b.at)
    .flatMap((p) => (p.pct === null ? [] : [{ at: p.at, left: clamp(100 - p.pct) }]))
  const pct = input.sevenDayPct
  const lastAt = actual[actual.length - 1]?.at ?? -Infinity
  if (pct !== null && now > lastAt) actual.push({ at: now, left: clamp(100 - pct) })
  if (actual.length === 0) {
    return emptyModel({ ...base, subtitle }, 'No quota samples yet', subLeftText)
  }

  const resets = subResets(input, window.from, next).map((at) => ({
    at,
    label: `resets ${whenText(at)}`,
  }))
  const even: DrainPoint[] = [
    { at: windowStart, left: 100 },
    { at: next, left: 0 },
  ]
  const model: DrainModel = {
    ...base,
    subtitle,
    actual,
    projection: [],
    even,
    resets,
    runOut: null,
    headline: pct === null ? '—' : `${pctText(100 - pct)} left`,
    verdict: 'No reading yet',
    leftText: subLeftText,
    empty: null,
  }
  const elapsed = now - windowStart
  if (pct === null) return model
  if (pct >= 100) {
    return {
      ...model,
      runOut: { at: now, label: `empty ${whenText(now)}` },
      verdict: `Limit reached, resets ${inText(next - now)}`,
    }
  }
  if (elapsed < MIN_ELAPSED_MS) {
    return { ...model, verdict: `Window just started, resets ${inText(next - now)}` }
  }

  const left = 100 - pct
  const burnPerMs = pct / elapsed
  const emptyAt = burnPerMs > 0 ? now + left / burnPerMs : Infinity
  if (emptyAt < next) {
    return {
      ...model,
      projection: [
        { at: now, left },
        { at: emptyAt, left: 0 },
      ],
      runOut: { at: emptyAt, label: `empty ${whenText(emptyAt)}` },
      verdict: `Runs out ${whenText(emptyAt)}, ${formatDuration(next - emptyAt)} before the reset`,
    }
  }
  const spare = clamp(left - burnPerMs * (next - now))
  return {
    ...model,
    projection: [
      { at: now, left },
      { at: next, left: spare },
    ],
    verdict: `Resets ${inText(next - now)} with ≈${pctText(spare)} unspent`,
  }
}

// ── Credit pools ─────────────────────────────────────────────────────────────────────────────

export interface PoolDrainInput {
  id: string
  title: string
  payer: string
  account: string
  pace: PaceResponse
  now: number
}

const POOL_INFO =
  'Share of the credit grant left over its billing cycle (our meter against the provider’s report, the larger per day). Solid: what happened. Dashed: the projection at today’s production rate, flat until the router starts drawing on the pool. Dotted: the even pace that would spend the grant exactly at renewal.'

export function poolDrain(input: PoolDrainInput): DrainModel {
  const { now, pace, account } = input
  const pool = pace.pools.find((p) => p.account === account)
  const grant = pool?.grantUsd ?? 0
  const leftText = (left: number): string =>
    `${fmtUsd((left / 100) * grant)} of ${fmtUsd(grant)} left`
  const dryIso = pool?.projection.dryAt ?? null
  const dryAt = dryIso === null ? null : Date.parse(dryIso)
  const endIso = pool?.cycle.end ?? null
  const end = endIso === null ? null : Date.parse(endIso)
  const start = pool === undefined ? now - POOL_OPEN_MS : Date.parse(pool.cycle.start)
  const window = {
    from: start,
    to: end ?? Math.max(now + POOL_OPEN_MS, dryAt ?? 0),
  }
  const base = {
    id: input.id,
    kind: 'pool' as const,
    title: input.title,
    payer: input.payer,
    window,
    now,
    info: POOL_INFO,
    subtitle: 'billing cycle',
  }
  if (pool === undefined || !pool.enabled || grant <= 0) {
    return emptyModel(base, 'Pool not enabled', leftText)
  }
  const cycle = `${fmtDay(pool.cycle.start)} – ${pool.cycle.end === null ? 'end unknown' : fmtDay(pool.cycle.end)}`
  const subtitle = `billing cycle ${cycle}${end === null ? '' : ` · renews ${inText(end - now)}`}`
  const lines = paceModel(pace, { account }).lines
  const share = (kind: 'actual' | 'even' | 'projection'): DrainPoint[] =>
    (lines.find((l) => l.kind === kind)?.points ?? []).map((p) => ({
      at: p.at,
      left: clamp((p.usd / grant) * 100),
    }))
  const actual = share('actual')
  if (actual.length === 0)
    return emptyModel({ ...base, subtitle }, 'No spend yet this cycle', leftText)

  const leftUsd = pool.leftUsd
  const projection = share('projection')
  const model: DrainModel = {
    ...base,
    subtitle,
    actual,
    projection,
    even: share('even'),
    resets: end === null ? [] : [{ at: end, label: `renews ${whenText(end)}` }],
    runOut: null,
    headline: leftUsd === null ? '—' : `${fmtUsd(leftUsd)} left`,
    verdict: 'No reading yet',
    leftText,
    empty: null,
  }
  if (leftUsd === null) return model
  if (dryAt !== null) {
    const gap = end === null ? '' : `, ${formatDuration(end - dryAt)} before the renewal`
    return {
      ...model,
      runOut: { at: dryAt, label: `empty ${whenText(dryAt)}` },
      verdict: `Runs out ${whenText(dryAt)}${gap}`,
    }
  }
  const unspent = pool.projection.unspentAtEndUsd
  if (end === null) return { ...model, verdict: 'Cycle end unknown' }
  return {
    ...model,
    verdict:
      unspent === null
        ? `Renews ${inText(end - now)}, no draw projected`
        : `Renews ${inText(end - now)} with ≈${fmtUsd(unspent)} unspent`,
  }
}

// ── The IU personal key ──────────────────────────────────────────────────────────────────────

export interface KeyDrainInput {
  id: string
  title: string
  payer: string
  budget: {
    limitUsd: number
    windowFrom: string
    windowTo: string
    rolling30Usd: number
    burn7dUsdPerDay: number
    daily: ReadonlyArray<{ day: string; usd: number }>
    underCapOn: string | null
    fetchedAt: string | null
  }
  now: number
}

const KEY_INFO =
  'Share of the personal key’s $500 rolling 30-day cap left. There is no reset: each day drops off 30 days after it was spent. Solid: the cap left after each day’s spend, counted from the start of the current window (earlier headroom is not known). Dashed: past the newest portal day, the old days dropping off and the last 7 days’ burn continuing.'

export function keyDrain(input: KeyDrainInput): DrainModel {
  const { now, budget } = input
  const limit = budget.limitUsd
  const leftText = (left: number): string =>
    `${fmtUsd((left / 100) * limit)} of ${fmtUsd(limit)} left`
  const from = dayToDate(budget.windowFrom).getTime()
  const newestEnd = dayToDate(budget.windowTo).getTime() + DAY_MS
  const base = {
    id: input.id,
    kind: 'key' as const,
    title: input.title,
    payer: input.payer,
    window: { from, to: newestEnd + KEY_AHEAD_DAYS * DAY_MS },
    now,
    info: KEY_INFO,
    subtitle: 'rolling 30 d window · no reset, old days drop off',
  }
  if (budget.fetchedAt === null || limit <= 0) {
    return emptyModel(base, 'No portal report yet', leftText)
  }

  const days = budget.daily
    .filter((d) => d.day >= budget.windowFrom && d.day <= budget.windowTo)
    .toSorted((a, b) => (a.day < b.day ? -1 : 1))
  // The newest portal day may still be running: its point sits at "now", not at a midnight to come.
  const anchor = Math.min(now, newestEnd)
  const actual: DrainPoint[] = [{ at: from, left: 100 }]
  let spent = 0
  for (const d of days) {
    spent += d.usd
    const at = Math.min(dayToDate(d.day).getTime() + DAY_MS, anchor)
    actual.push({ at, left: clamp(100 - (spent / limit) * 100) })
  }

  // Raw (unclipped) left per day ahead: the day k ages out of the window k days past the anchor.
  const raw = (k: number): number => {
    const aged = days.slice(0, k).reduce((sum, d) => sum + d.usd, 0)
    return 100 - ((budget.rolling30Usd - aged + budget.burn7dUsdPerDay * k) / limit) * 100
  }
  const projection: DrainPoint[] = []
  let runOut: DrainMark | null = null
  for (let k = 0; k <= KEY_AHEAD_DAYS; k++) {
    const value = raw(k)
    const prev = k === 0 ? null : raw(k - 1)
    if (value <= 0) {
      const at =
        prev === null || prev <= 0
          ? anchor + k * DAY_MS
          : anchor + (k - 1 + prev / (prev - value)) * DAY_MS
      projection.push({ at, left: 0 })
      runOut = { at, label: `empty ${whenText(at)}` }
      break
    }
    projection.push({ at: anchor + k * DAY_MS, left: clamp(value) })
  }

  const current = actual[actual.length - 1]?.left ?? 100
  const resets: DrainMark[] = []
  const under = budget.underCapOn === null ? null : dayToDate(budget.underCapOn).getTime()
  if (under !== null && under >= from && under <= base.window.to) {
    resets.push({ at: under, label: `back under cap ${dayText(under)}` })
  }
  const final = projection[projection.length - 1]?.left ?? current
  const verdict =
    runOut !== null
      ? runOut.at <= anchor
        ? `Over the cap${budget.underCapOn === null ? '' : `, back under ${dayText(under ?? 0)}`}`
        : `Hits the cap ${whenText(runOut.at)}`
      : `Stays under the cap, ≈${pctText(final)} left in ${KEY_AHEAD_DAYS} d`
  return {
    ...base,
    actual,
    projection,
    even: [],
    resets,
    runOut,
    headline: `${fmtUsd((current / 100) * limit)} left`,
    verdict,
    leftText,
    empty: null,
  }
}

// ── Chart rows ───────────────────────────────────────────────────────────────────────────────

export interface DrainRow {
  at: Date
  actual: number | null
  projection: number | null
  even: number | null
}

export type DrainKey = 'actual' | 'projection' | 'even'

/** One row per instant any line has a point at; a line without one is absent there (null). */
export function drainRows(model: DrainModel): DrainRow[] {
  const lines: Record<DrainKey, DrainPoint[]> = {
    actual: model.actual,
    projection: model.projection,
    even: model.even,
  }
  const instants = [...new Set(Object.values(lines).flatMap((l) => l.map((p) => p.at)))].toSorted(
    (a, b) => a - b,
  )
  const at = (key: DrainKey, t: number): number | null =>
    lines[key].find((p) => p.at === t)?.left ?? null
  return instants.map((t) => ({
    at: new Date(t),
    actual: at('actual', t),
    projection: at('projection', t),
    even: at('even', t),
  }))
}

/** Local-midnight x ticks across the window, at most `max` of them. */
export function drainTicks(window: { from: number; to: number }, max: number): Date[] {
  const first = new Date(window.from)
  const midnights: Date[] = []
  for (let i = 1; ; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
    if (d.getTime() >= window.to) break
    midnights.push(d)
  }
  const step = Math.max(1, Math.ceil(midnights.length / max))
  return midnights.filter((_, i) => i % step === 0)
}
