/**
 * The Quotas tab's drain chart: share (or dollars) left on a fixed window, the actual line, the
 * projection from now at the current drain rate, the even pace and the marks where the window resets.
 * `keyDrain` turns an IU key's rolling cap into one `DrainModel` and `quotas-model.ts` builds the
 * credit model; `drain-chart.tsx` only draws it. Pure: no React, no queries.
 */
import { formatDuration, withUnit } from '../../lib/format'
import { dayToDate } from './constants'
import { DAY_MS, fmtUsd } from './flow-model'
import { shortDay } from './model'

/** How far past the newest portal day the key's projection runs. */
const KEY_AHEAD_DAYS = 14

export interface DrainPoint {
  at: number
  /** What is left in the model's unit: a share 0–100, or dollars when `yMax` is the total grant. */
  left: number
}

export interface DrainMark {
  at: number
  label: string
}

/** A short tick on the baseline in a payer's colour: one pool's renewal. */
export interface DrainTick extends DrainMark {
  payer: string
}

export interface DrainModel {
  id: string
  kind: 'credit' | 'key'
  title: string
  /** The payer id `colorForPayer` takes. */
  payer: string
  /** Draw the lines in the neutral ink instead of the payer's colour (a total over several payers). */
  neutral?: boolean
  /** The top of the y axis: 100 for a share, the total grant for dollars. */
  yMax: number
  /** The y axis tick text. */
  yText: (v: number) => string
  /** The fixed x domain, epoch ms. */
  window: { from: number; to: number }
  now: number
  actual: DrainPoint[]
  projection: DrainPoint[]
  even: DrainPoint[]
  /** The vertical rules: resets, renewals, the day a key is back under its cap. */
  resets: DrainMark[]
  /** Short per-payer ticks (renewals) that carry no full-height rule. */
  ticks: DrainTick[]
  runOut: DrainMark | null
  /** The headline figure: `62 % left`, `$58 left`. */
  headline: string
  /** The headline's ink: `warn` while a cap is exceeded. */
  headlineTone?: 'warn'
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

export const clamp = (n: number): number => Math.min(100, Math.max(0, n))
export const pctText = (n: number): string => withUnit(Math.round(n), '%')

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const two = (n: number): string => String(n).padStart(2, '0')

/** `Fri 14:00` in local time. */
export function whenText(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getDay()]} ${two(d.getHours())}:${two(d.getMinutes())}`
}

export const inText = (ms: number): string => `in ${formatDuration(Math.max(0, ms))}`

export function emptyModel(
  base: Pick<
    DrainModel,
    'id' | 'kind' | 'title' | 'payer' | 'yMax' | 'yText' | 'window' | 'now' | 'info' | 'subtitle'
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
    ticks: [],
    runOut: null,
    headline: '—',
    verdict: empty,
    leftText,
    empty,
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
  'Share of the key’s $500 rolling 30-day cap left. There is no reset: each day drops off 30 days after it was spent. Solid: the cap left after each day’s spend, counted from the start of the current window (earlier headroom is not known). Dashed: past the newest portal day, the old days dropping off and the last 7 days’ burn continuing.'

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
    yMax: 100,
    yText: pctText,
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
  // The portal's own figure: the share left clamps at zero, the overshoot is what the card must say.
  const over = budget.rolling30Usd - limit
  const resets: DrainMark[] = []
  const under = budget.underCapOn === null ? null : dayToDate(budget.underCapOn).getTime()
  if (under !== null && under >= from && under <= base.window.to) {
    resets.push({ at: under, label: `back under cap ${shortDay(new Date(under))}` })
  }
  const final = projection[projection.length - 1]?.left ?? current
  const verdict =
    runOut !== null
      ? runOut.at <= anchor
        ? `Over the cap${budget.underCapOn === null ? '' : `, back under ${shortDay(new Date(under ?? 0))}`}`
        : `Hits the cap ${whenText(runOut.at)}`
      : `Stays under the cap, ≈${pctText(final)} left in ${KEY_AHEAD_DAYS} d`
  return {
    ...base,
    actual,
    projection,
    even: [],
    resets,
    ticks: [],
    runOut,
    ...(over > 0
      ? { headline: `${fmtUsd(over)} over cap`, headlineTone: 'warn' as const }
      : { headline: `${fmtUsd((current / 100) * limit)} left` }),
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

// ── Label placement ──────────────────────────────────────────────────────────────────────────

/** Approximate width of one chart-text character (px) and the gap between a label and its rule. */
const CHAR_PX = 6.5
const LABEL_GAP_PX = 4
const NOW_CHARS = 3

export interface ResetLabelPlacement {
  text: string
  anchor: 'start' | 'end'
  /** 0 is the top row (shared with the "now" label), 1 the row under it. */
  row: 0 | 1
}

/**
 * Where a reset rule's label goes so it never collides with the "now" label or leaves the plot: right of
 * its rule in full, right in short, left in full, left in short, and only then on the row under "now".
 * Fractions are the rules' positions across the plot (0–1).
 */
export function placeResetLabel(input: {
  plotWidth: number
  nowFraction: number
  resetFraction: number
  full: string
  short: string
}): ResetLabelPlacement {
  const { plotWidth: width } = input
  const nowX = input.nowFraction * width
  const resetX = input.resetFraction * width
  const nowW = NOW_CHARS * CHAR_PX
  // The "now" label sits left of its rule in the right half of the plot, right of it otherwise.
  const nowBox =
    input.nowFraction > 0.5
      ? [nowX - LABEL_GAP_PX - nowW, nowX - LABEL_GAP_PX]
      : [nowX + LABEL_GAP_PX, nowX + LABEL_GAP_PX + nowW]
  const options: ResetLabelPlacement[] = [
    { text: input.full, anchor: 'start', row: 0 },
    { text: input.short, anchor: 'start', row: 0 },
    { text: input.full, anchor: 'end', row: 0 },
    { text: input.short, anchor: 'end', row: 0 },
  ]
  for (const option of options) {
    const w = option.text.length * CHAR_PX
    const from = option.anchor === 'start' ? resetX + LABEL_GAP_PX : resetX - LABEL_GAP_PX - w
    const to = from + w
    const inside = from >= 0 && to <= width
    const clear = to <= (nowBox[0] ?? 0) || from >= (nowBox[1] ?? 0)
    if (inside && clear) return option
  }
  return { text: input.short, anchor: 'end', row: 1 }
}
