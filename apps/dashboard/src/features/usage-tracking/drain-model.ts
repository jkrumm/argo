/**
 * The Quotas tab's drain chart: what is left on a window, recorded up to now and projected past it, with
 * every jump back up labelled. `keyDrain` turns an IU key's rolling cap into one `DrainModel` and
 * `quotas-model.ts` builds the subscription and credit models; `drain-chart.tsx` only draws them. Pure:
 * no React, no queries.
 */
import { formatDuration, withUnit } from '../../lib/format'
import { dayToDate } from './constants'
import { DAY_MS, fmtUsd } from './flow-model'
import { shortDay } from './model'

/** How far past the newest portal day a key's projection runs: everything spent today is back by then. */
const KEY_AHEAD_DAYS = 30

/** A renewal or reset is a jump: the line is sampled this long before it and at it. */
export const JUMP_LEAD_MS = 60_000

/** A key's visible give-back under this many dollars carries no label. */
const KEY_MIN_RISE_USD = 3

/** A day giving back less than this is not worth a row. */
const KEY_MIN_RETURN_USD = 1

const KEY_RETURN_ROWS = 4

export interface DrainPoint {
  at: number
  /** What is left in the model's unit: a share 0–100, or dollars when `yMax` is the total grant. */
  left: number
}

export interface DrainMark {
  at: number
  label: string
}

/** A short tick on the baseline in a payer's colour: one account's reset. */
export interface DrainTick extends DrainMark {
  payer: string
}

/** A rise of the line, labelled where it tops out. */
export interface DrainJump {
  at: number
  /** The line's value at the top of the rise. */
  left: number
  /** `+$43`, `+46 %`. */
  label: string
  size: number
}

export interface DrainModel {
  id: string
  kind: 'credit' | 'key' | 'quota'
  title: string
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
  /** The vertical rules: the day a key is back under its cap. */
  resets: DrainMark[]
  /** Where the line jumps back up: resets, renewals, a key's old days dropping off. */
  jumps: DrainJump[]
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
    'id' | 'kind' | 'title' | 'yMax' | 'yText' | 'window' | 'now' | 'info' | 'subtitle'
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
    jumps: [],
    runOut: null,
    headline: '—',
    verdict: empty,
    leftText,
    empty,
  }
}

// ── Rises ────────────────────────────────────────────────────────────────────────────────────

/** Every run of rising points worth `minRise` or more, as one jump at its top. */
export function risesOf(
  points: readonly DrainPoint[],
  minRise: number,
  label: (rise: number) => string,
): DrainJump[] {
  const jumps: DrainJump[] = []
  let base = points[0]
  for (let i = 1; i <= points.length; i++) {
    const top = points[i - 1]
    const next = points[i]
    if (top === undefined) continue
    if (next !== undefined && next.left > top.left) continue
    const size = base === undefined ? 0 : top.left - base.left
    if (size >= minRise) jumps.push({ at: top.at, left: top.left, label: label(size), size })
    base = next
  }
  return jumps
}

/** The biggest jumps first, each at least `minGapPx` from every one kept; returned in time order. */
export function thinJumps(
  jumps: readonly DrainJump[],
  xOf: (at: number) => number,
  minGapPx: number,
): DrainJump[] {
  const kept: DrainJump[] = []
  for (const jump of jumps.toSorted((a, b) => b.size - a.size)) {
    const x = xOf(jump.at)
    if (kept.every((k) => Math.abs(xOf(k.at) - x) >= minGapPx)) kept.push(jump)
  }
  return kept.toSorted((a, b) => a.at - b.at)
}

// ── The IU keys ──────────────────────────────────────────────────────────────────────────────

export interface KeyDrainInput {
  id: string
  title: string
  budget: {
    limitUsd: number
    windowFrom: string
    windowTo: string
    rolling30Usd: number
    burn7dUsdPerDay: number
    daily: ReadonlyArray<{ day: string; usd: number }>
    history: ReadonlyArray<{ day: string; rollingUsd: number }>
    underCapOn: string | null
    fetchedAt: string | null
  }
  now: number
}

/** One day's spend coming back to the key. */
export interface KeyReturn {
  at: number
  /** `tomorrow · 10 Nov`, `in 4 d · 13 Nov`. */
  when: string
  usd: number
  /** `$37 left`, `$6 over`. */
  after: string
}

export interface KeyView {
  model: DrainModel
  /** The next days that give something back. */
  returns: KeyReturn[]
}

const KEY_INFO =
  'Dollars left under the key’s $500 rolling 30-day cap. There is no reset: each day’s spend comes back 30 days after it was spent, so the future is known day by day. Solid: the cap left as of each past day, shown only where all 30 days of that window are on record. Dashed: the old days dropping off, exactly as they were spent, and the last 7 days’ burn continuing. Each label is what a day visibly gives back; while the key is over its cap a give-back first pays off the overshoot.'

export function keyDrain(input: KeyDrainInput): KeyView {
  const { now, budget } = input
  const limit = budget.limitUsd
  const leftText = (left: number): string => `${fmtUsd(left)} of ${fmtUsd(limit)} left`
  const bounded = (left: number): number => Math.min(limit, Math.max(0, left))
  const newestEnd = dayToDate(budget.windowTo).getTime() + DAY_MS
  const anchor = Math.min(now, newestEnd)
  const endOf = (day: string): number => Math.min(dayToDate(day).getTime() + DAY_MS, anchor)
  const history = budget.history.toSorted((a, b) => (a.day < b.day ? -1 : 1))
  const firstDay = history[0]?.day ?? budget.windowFrom
  const from = history.length > 1 ? endOf(firstDay) : dayToDate(firstDay).getTime()
  const to = newestEnd + KEY_AHEAD_DAYS * DAY_MS
  const base = {
    id: input.id,
    kind: 'key' as const,
    title: input.title,
    yMax: limit,
    yText: fmtUsd,
    window: { from, to },
    now,
    info: KEY_INFO,
    subtitle: 'rolling 30 d cap · each day comes back after 30 d',
  }
  if (budget.fetchedAt === null || limit <= 0) {
    return { model: emptyModel(base, 'No portal report yet', leftText), returns: [] }
  }

  const actual: DrainPoint[] = history.map((d) => ({
    at: endOf(d.day),
    left: bounded(limit - d.rollingUsd),
  }))

  const burnPerMs = budget.burn7dUsdPerDay / DAY_MS
  const aging = budget.daily
    .filter((d) => d.day >= budget.windowFrom && d.day <= budget.windowTo)
    .toSorted((a, b) => (a.day < b.day ? -1 : 1))
  const currentLeft = limit - budget.rolling30Usd
  const projection: DrainPoint[] = [{ at: anchor, left: bounded(currentLeft) }]
  const allReturns: KeyReturn[] = []
  let runOut = null as DrainMark | null
  let raw = currentLeft
  let t = anchor

  const burnUntil = (at: number): void => {
    const after = raw - burnPerMs * (at - t)
    if (runOut === null && raw > 0 && after <= 0) {
      const empty = t + raw / burnPerMs
      runOut = { at: empty, label: `empty ${whenText(empty)}` }
    }
    raw = after
    t = at
  }

  for (let k = 1; k <= KEY_AHEAD_DAYS; k++) {
    // The day that leaves the window k days ahead is gone from the start of that day.
    const at = newestEnd + (k - 1) * DAY_MS
    if (at - JUMP_LEAD_MS > t) {
      burnUntil(at - JUMP_LEAD_MS)
      projection.push({ at: t, left: bounded(raw) })
    }
    if (at > t) burnUntil(at)
    const usd = aging[k - 1]?.usd ?? 0
    raw += usd
    // A stale portal has this day's drop-off at the anchor itself: step just after it.
    const last = projection[projection.length - 1]?.at ?? t
    projection.push({ at: at > last ? at : last + JUMP_LEAD_MS, left: bounded(raw) })
    // A stale portal holds days that have already come back: only what is still ahead is listed.
    if (usd >= KEY_MIN_RETURN_USD && at > now) {
      const days = Math.ceil((at - now) / DAY_MS)
      allReturns.push({
        at,
        when: `${days === 1 ? 'tomorrow' : `in ${days} d`} · ${shortDay(new Date(at))}`,
        usd,
        after: raw < 0 ? `${fmtUsd(-raw)} over` : `${fmtUsd(raw)} left`,
      })
    }
  }
  burnUntil(to)
  projection.push({ at: to, left: bounded(raw) })

  // The portal's own figure: the share left clamps at zero, the overshoot is what the card must say.
  const over = budget.rolling30Usd - limit
  const under = budget.underCapOn === null ? null : dayToDate(budget.underCapOn).getTime()
  const resets: DrainMark[] =
    under !== null && under >= from && under <= to
      ? [{ at: under, label: `back under cap ${shortDay(new Date(under))}` }]
      : []
  const next = allReturns[0]
  const verdict =
    over > 0
      ? `Over the cap${under === null ? '' : `, back under ${shortDay(new Date(under))}`}`
      : runOut !== null
        ? `Hits the cap ${whenText(runOut.at)}`
        : `Stays under the cap${next === undefined ? '' : `, next ${fmtUsd(next.usd)} back ${shortDay(new Date(next.at))}`}`
  return {
    model: {
      ...base,
      actual,
      projection,
      even: [],
      resets,
      jumps: risesOf(projection, KEY_MIN_RISE_USD, (rise) => `+${fmtUsd(rise)}`),
      runOut,
      ...(over > 0
        ? { headline: `${fmtUsd(over)} over cap`, headlineTone: 'warn' as const }
        : { headline: `${fmtUsd(currentLeft)} left` }),
      verdict,
      leftText,
      empty: null,
    },
    returns: allReturns.slice(0, KEY_RETURN_ROWS),
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
