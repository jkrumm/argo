/**
 * The Quotas tab's two multi-payer charts. `quotaDrain`: the Claude subscriptions' weekly windows, one
 * line per account and the COMBINED pool weighted by weekly capacity units, recorded and projected.
 * `creditDrain`: the three API-credit pools summed into one dollar line (total, even pace, projection,
 * renewals as labelled jumps). Pure: no React, no queries; `quota-chart.tsx` and `drain-chart.tsx` only draw what these return.
 */
import { formatDuration } from '../../lib/format'
import type { PaceResponse, QuotaLatestResponse, QuotaResponse } from '../../lib/queries/usage'
import { PLAN_NAMES, USAGE_ACCOUNTS } from './accounts'
import {
  clamp,
  emptyModel,
  inText,
  JUMP_LEAD_MS,
  pctText,
  risesOf,
  whenText,
  type DrainModel,
  type DrainPoint,
  type DrainTick,
} from './drain-model'
import {
  DAY_MS,
  enabledPools,
  fmtDay,
  fmtRate,
  fmtUsd,
  poolTitle,
  reportAgeNote,
} from './flow-model'
import { paceModel, type PaceLine } from './pace-model'

/** The quota history both the verdict and the subscriptions card read: 15 days, hourly buckets. */
export const QUOTA_WINDOW_HOURS = 360

const HOUR_MS = 3_600_000
const HALF_DAY_MS = DAY_MS / 2
const WEEK_MS = 7 * DAY_MS

/** The subscriptions chart shows this much history. */
const SUB_SPAN_MS = 14 * DAY_MS

/** A burn read over less than this is noise. */
const MIN_ELAPSED_MS = 2 * HOUR_MS

/** Resets of one account closer than this are one reset (the API can hold the scheduled and the actual one). */
const RESET_DEDUPE_MS = DAY_MS

/** A pool whose cycle end is unknown still gets this much room to project into. */
const POOL_OPEN_MS = 14 * DAY_MS

/** A combined rise under this many points is sampling noise, not a reset. */
const QUOTA_MIN_RISE_PCT = 3

/** A credit rise under this is not a renewal. */
const CREDIT_MIN_RISE_USD = 1

// ── Shared ───────────────────────────────────────────────────────────────────────────────────

/** The last value at or before `t` in a time-sorted series; undefined before its first point. */
function fillAt(points: readonly DrainPoint[], t: number): number | undefined {
  let value: number | undefined
  for (const p of points) {
    if (p.at > t) break
    value = p.left
  }
  return value
}

/**
 * The capacity-weighted mean of several accounts' share left on a common time grid. Each account's last
 * reading is carried forward (accounts sample at different times); at a grid instant where an account has
 * no reading yet there is no combined value. An account with no points at all is left out of the mean
 * (a new account must not blank the line); the caller says how many it covers.
 */
export function combinedLeft(
  lines: ReadonlyArray<{ units: number; points: readonly DrainPoint[] }>,
  grid: readonly number[],
): DrainPoint[] {
  const active = lines.filter((l) => l.points.length > 0 && l.units > 0)
  const units = active.reduce((sum, l) => sum + l.units, 0)
  if (units === 0) return []
  const out: DrainPoint[] = []
  for (const at of grid) {
    let weighted = 0
    let complete = true
    for (const l of active) {
      const value = fillAt(l.points, at)
      if (value === undefined) {
        complete = false
        break
      }
      weighted += l.units * value
    }
    if (complete) out.push({ at, left: weighted / units })
  }
  return out
}

const sortedUnique = (values: Iterable<number>): number[] =>
  [...new Set(values)].toSorted((a, b) => a - b)

// ── Claude subscriptions ─────────────────────────────────────────────────────────────────────

export interface QuotaAccountInput {
  id: string
  label: string
  /** `Ultra`, `Max 5x`. */
  plan: string
  payer: string
  /** Weekly capacity units: the weight in the combined line. */
  units: number
  /** The account's hourly quota samples. */
  points: ReadonlyArray<{ at: string; sevenDayPct: number | null }>
  /** The account's `seven_day` reset instants from the API. */
  resets: readonly string[]
  /** The next reset reported by the latest reading; null when none. */
  nextResetAt: string | null
  /** The latest reading's weekly percent used; null without one. */
  sevenDayPct: number | null
}

export type QuotaStatus = 'ok' | 'runs-out' | 'limit' | 'none'

export interface QuotaAccountView {
  id: string
  label: string
  plan: string
  payer: string
  /** Share left over the window, 0–100. */
  line: DrainPoint[]
  leftPct: number | null
  /** `Wed 16:00 · in 4 d`; null without a window. */
  resetsText: string | null
  status: QuotaStatus
  /** `runs out Sat 14:00`, `limit reached`; null when it is fine. */
  note: string | null
  /** When it runs out at the pace so far, before its reset; null otherwise. */
  runOutAt: number | null
  /** How long the quota is gone before the reset: reset minus run-out. */
  emptyForMs: number | null
}

export interface QuotaModel {
  window: { from: number; to: number }
  now: number
  accounts: QuotaAccountView[]
  /** The capacity-weighted combined share left. */
  combined: DrainPoint[]
  combinedLeftPct: number | null
  /** The combined pool as a drain chart: recorded, projected, every reset a labelled jump. */
  pool: DrainModel
  /** One short tick per reset, coloured by its account. */
  ticks: DrainTick[]
  headline: string
  subtitle: string
  verdict: string
  info: string
  empty: string | null
}

const QUOTA_INFO =
  'The combined share of the weekly quotas left: the mean of the accounts weighted by weekly capacity units (iu 2, me 1, me2 1), an account’s last reading carried forward to the next sample. Dashed: each account burns on at its pace so far this week and refills at its own reset, each label is what a reset gives back. The Accounts tab shows the three accounts on their own.'

export const quotaLeftText = (left: number): string => `${pctText(left)} left`

/** API resets inside the window, deduped (the latest of a cluster wins), then the reported next reset. */
function resetsOf(input: QuotaAccountInput, from: number, next: number | null): number[] {
  const inside = input.resets
    .map((r) => Date.parse(r))
    .filter((t) => !Number.isNaN(t) && t >= from && (next === null || t < next - RESET_DEDUPE_MS))
    .toSorted((a, b) => a - b)
  const deduped: number[] = []
  for (const t of inside) {
    const last = deduped[deduped.length - 1]
    if (last === undefined || t - last >= RESET_DEDUPE_MS) deduped.push(t)
    else deduped[deduped.length - 1] = t
  }
  return next === null ? deduped : [...deduped, next]
}

/** The share of the week burned per ms so far; 0 when there is too little of the week to read. */
function burnPerMs(pct: number | null, next: number | null, now: number): number {
  if (pct === null || next === null || pct <= 0) return 0
  const elapsed = now - (next - WEEK_MS)
  return elapsed < MIN_ELAPSED_MS ? 0 : pct / elapsed
}

/** The pool's weighted share ahead of now: each account burns at its pace and refills at its reset. */
function quotaProjection(
  accounts: ReadonlyArray<{ units: number; left: number; next: number | null; rate: number }>,
  now: number,
  to: number,
): DrainPoint[] {
  const units = accounts.reduce((sum, a) => sum + a.units, 0)
  if (units === 0) return []
  const leftAt = (a: (typeof accounts)[number], t: number): number =>
    a.next === null || t < a.next
      ? Math.max(0, a.left - a.rate * (t - now))
      : Math.max(0, 100 - a.rate * (t - a.next))
  const kinks = accounts.flatMap((a) => [
    ...(a.next === null ? [] : [a.next - JUMP_LEAD_MS, a.next]),
    ...(a.rate > 0 ? [now + a.left / a.rate] : []),
    ...(a.rate > 0 && a.next !== null ? [a.next + 100 / a.rate] : []),
  ])
  return sortedUnique([now, to, ...kinks])
    .filter((t) => t >= now && t <= to)
    .map((at) => ({ at, left: accounts.reduce((s, a) => s + a.units * leftAt(a, at), 0) / units }))
}

function accountView(
  input: QuotaAccountInput,
  line: DrainPoint[],
  next: number | null,
  now: number,
): QuotaAccountView {
  const pct = input.sevenDayPct
  const base = {
    id: input.id,
    label: input.label,
    plan: input.plan,
    payer: input.payer,
    line,
    leftPct: pct === null ? null : clamp(100 - pct),
    resetsText: next === null ? null : `${whenText(next)} · ${inText(next - now)}`,
  }
  const fine = { runOutAt: null, emptyForMs: null }
  if (pct === null || next === null) return { ...base, ...fine, status: 'none', note: null }
  if (pct >= 100) {
    return {
      ...base,
      runOutAt: now,
      emptyForMs: next - now,
      status: 'limit',
      note: 'limit reached',
    }
  }
  const rate = burnPerMs(pct, next, now)
  if (rate === 0) return { ...base, ...fine, status: 'ok', note: null }
  const emptyAt = now + (100 - pct) / rate
  if (emptyAt >= next) return { ...base, ...fine, status: 'ok', note: null }
  return {
    ...base,
    runOutAt: emptyAt,
    emptyForMs: next - emptyAt,
    status: 'runs-out',
    note: `runs out ${whenText(emptyAt)}`,
  }
}

/** The registry's accounts joined with their samples, resets and latest reading. */
export function quotaInputs(
  quota: QuotaResponse,
  latest: QuotaLatestResponse,
): QuotaAccountInput[] {
  return USAGE_ACCOUNTS.map((a) => {
    const reading = latest.accounts.find((x) => x.account === a.id)
    return {
      id: a.id,
      label: a.label,
      plan: a.plan === 'ultra' ? PLAN_NAMES.ultra : `Max ${PLAN_NAMES[a.plan]}`,
      payer: a.payer,
      units: a.weeklyUnits,
      points: quota.series.find((s) => s.account === a.id)?.points ?? [],
      resets: quota.resets
        .filter((r) => r.account === a.id && r.window === 'seven_day')
        .map((r) => r.at),
      nextResetAt: reading?.sevenDayResetsAt ?? null,
      sevenDayPct: reading?.sevenDayPct ?? null,
    }
  })
}

export function quotaDrain(inputs: readonly QuotaAccountInput[], now: number): QuotaModel {
  const from = now - SUB_SPAN_MS
  const nexts = inputs.map((i) => {
    const t = i.nextResetAt === null ? NaN : Date.parse(i.nextResetAt)
    return Number.isNaN(t) || t <= now ? null : t
  })
  const latestNext = Math.max(now, ...nexts.map((t) => t ?? 0))
  const window = { from, to: latestNext + HALF_DAY_MS }

  const lines = inputs.map((input) => {
    const line: DrainPoint[] = input.points
      .map((p) => ({ at: Date.parse(p.at), pct: p.sevenDayPct }))
      .filter((p) => !Number.isNaN(p.at) && p.at >= from && p.at <= now)
      .toSorted((a, b) => a.at - b.at)
      .flatMap((p) => (p.pct === null ? [] : [{ at: p.at, left: clamp(100 - p.pct) }]))
    const lastAt = line[line.length - 1]?.at ?? -Infinity
    if (input.sevenDayPct !== null && now > lastAt) {
      line.push({ at: now, left: clamp(100 - input.sevenDayPct) })
    }
    return line
  })

  const info = QUOTA_INFO
  const base = { window, now, info }
  const poolBase = {
    id: 'subscriptions',
    kind: 'quota' as const,
    title: 'Claude subscriptions',
    yMax: 100,
    yText: pctText,
    window,
    now,
    info,
  }
  if (lines.every((l) => l.length === 0)) {
    return {
      ...base,
      accounts: inputs.map((input, i) => accountView(input, [], nexts[i] ?? null, now)),
      combined: [],
      combinedLeftPct: null,
      pool: emptyModel(
        { ...poolBase, subtitle: 'weekly quota · no samples yet' },
        'No quota samples yet',
        quotaLeftText,
      ),
      ticks: [],
      headline: '—',
      subtitle: 'weekly quota · no samples yet',
      verdict: 'No quota samples yet',
      empty: 'No quota samples yet',
    }
  }

  const accounts = inputs.map((input, i) =>
    accountView(input, lines[i] ?? [], nexts[i] ?? null, now),
  )
  const grid = sortedUnique([...lines.flatMap((l) => l.map((p) => p.at)), now])
  const combined = combinedLeft(
    inputs.map((input, i) => ({ units: input.units, points: lines[i] ?? [] })),
    grid,
  )
  const combinedLeftPct = combined[combined.length - 1]?.left ?? null
  const covered = lines.filter((l) => l.length > 0).length

  const ticks: DrainTick[] = inputs.flatMap((input, i) =>
    resetsOf(input, from, nexts[i] ?? null).map((at) => ({
      at,
      payer: input.payer,
      label: `${input.label} resets ${whenText(at)}`,
    })),
  )

  const soonest = accounts
    .filter((a) => a.status === 'runs-out')
    .toSorted((a, b) => (a.runOutAt ?? 0) - (b.runOutAt ?? 0))
  const urgent = soonest[0]
  const limited = accounts.filter((a) => a.status === 'limit')
  const verdict =
    urgent !== undefined
      ? `${urgent.label} ${urgent.note ?? ''}, ${formatDuration(urgent.emptyForMs ?? 0)} before its reset` +
        (soonest.length > 1 ? ` · ${soonest.length - 1} more at risk` : '')
      : limited.length > 0
        ? `${limited.map((a) => a.label).join(', ')} at the limit until the reset`
        : 'Every account lasts to its weekly reset at the pace so far'

  const projection = quotaProjection(
    inputs.flatMap((input, i) => {
      const left = lines[i]?.at(-1)?.left
      const next = nexts[i] ?? null
      return left === undefined || input.units <= 0
        ? []
        : [{ units: input.units, left, next, rate: burnPerMs(input.sevenDayPct, next, now) }]
    }),
    now,
    window.to,
  )
  const riseLabel = (rise: number): string => `+${pctText(rise)}`
  const headline = combinedLeftPct === null ? '—' : `${pctText(combinedLeftPct)} left combined`
  const subtitle = `weekly quota · last 14 d to the next reset${covered < inputs.length ? ` · ${covered} of ${inputs.length} accounts` : ''}`

  return {
    ...base,
    accounts,
    combined,
    combinedLeftPct,
    pool: {
      ...poolBase,
      actual: combined,
      projection,
      even: [],
      resets: [],
      jumps: [
        ...risesOf(combined, QUOTA_MIN_RISE_PCT, riseLabel),
        ...risesOf(projection, QUOTA_MIN_RISE_PCT, riseLabel),
      ],
      runOut: null,
      headline,
      subtitle,
      verdict,
      leftText: quotaLeftText,
      empty: null,
    },
    ticks,
    headline,
    subtitle,
    verdict,
    empty: null,
  }
}

// ── Claude API credit ────────────────────────────────────────────────────────────────────────

export interface CreditRow {
  account: string
  label: string
  leftUsd: number | null
  grantUsd: number
  /** `21 Nov`; `unknown` without a cycle end. */
  renews: string
  /** Dollars a day that use the pool up by the renewal; null when unknown. */
  needed: string
  /** The pool is projected dry before its renewal. */
  dryText: string | null
}

export interface CreditView {
  model: DrainModel
  rows: CreditRow[]
}

const CREDIT_INFO =
  'The three API-credit pools as one dollar line: what is left of the grants summed (solid), the even pace that spends each grant exactly at its renewal (dotted) and the projection at today’s production rate, flat until the router starts drawing on a pool (dashed). Each label is one pool’s renewal: the total jumps back up there because the pool is full again. After a renewal a pool counts as full; its later draw is not projected. The total starts where every pool’s cycle has begun: earlier cycles are not in the data.'

const dollars = (left: number): string => `${fmtUsd(left)} left`

/** Linear value of a time-sorted polyline at `t`, held flat before the first and after the last point. */
function interpolate(points: readonly { at: number; usd: number }[], t: number): number {
  const first = points[0]
  if (first === undefined) return 0
  if (t <= first.at) return first.usd
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a === undefined || b === undefined) continue
    if (t > b.at) continue
    return b.at === a.at ? b.usd : a.usd + ((b.usd - a.usd) * (t - a.at)) / (b.at - a.at)
  }
  return points[points.length - 1]?.usd ?? 0
}

export function creditDrain(pace: PaceResponse, now: number): CreditView {
  const pools = enabledPools(pace).filter((p) => p.grantUsd > 0 && p.leftUsd !== null)
  const ends = pools.flatMap((p) => (p.cycle.end === null ? [] : [Date.parse(p.cycle.end)]))
  const allEnded = ends.length === pools.length
  const total = pools.reduce((sum, p) => sum + p.grantUsd, 0)
  const starts = pools.map((p) => Date.parse(p.cycle.start))
  const from = starts.length === 0 ? now : Math.min(now, Math.max(...starts))
  const to = allEnded && ends.length > 0 ? Math.max(...ends) + HALF_DAY_MS : now + POOL_OPEN_MS
  const base = {
    id: 'credit',
    kind: 'credit' as const,
    title: 'Claude API credit',
    yMax: total,
    yText: fmtUsd,
    window: { from, to },
    now,
    info: CREDIT_INFO,
    subtitle: 'current billing cycles to the last renewal',
  }
  if (pools.length === 0) {
    return { model: emptyModel(base, 'No credit pool enabled', dollars), rows: [] }
  }

  const lines = paceModel(pace).lines
  const lineOf = (account: string, kind: PaceLine['kind']): PaceLine['points'] =>
    lines.find((l) => l.account === account && l.kind === kind)?.points ?? []
  const endOf = (end: string | null): number | null => (end === null ? null : Date.parse(end))

  const sum = (valueOf: (p: (typeof pools)[number], t: number) => number) => (t: number) =>
    pools.reduce((acc, p) => acc + valueOf(p, t), 0)

  const actualAt = sum(
    (p, t) =>
      fillAt(
        lineOf(p.account, 'actual').map((x) => ({ at: x.at, left: x.usd })),
        t,
      ) ?? p.grantUsd,
  )
  const projectedAt = sum((p, t) => {
    const end = endOf(p.cycle.end)
    if (end !== null && t >= end) return p.grantUsd
    const pts = lineOf(p.account, 'projection')
    return pts.length === 0 ? (p.leftUsd ?? 0) : interpolate(pts, t)
  })
  const evenAt = sum((p, t) => {
    const end = endOf(p.cycle.end)
    if (end === null) return p.grantUsd
    if (t >= end) return p.grantUsd
    const start = Date.parse(p.cycle.start)
    return (p.grantUsd * (end - t)) / (end - start)
  })

  const actualGrid = sortedUnique([
    from,
    now,
    ...pools.flatMap((p) =>
      lineOf(p.account, 'actual')
        .map((x) => x.at)
        .filter((at) => at >= from && at <= now),
    ),
  ])
  const actual = actualGrid.map((at) => ({ at, left: actualAt(at) }))

  // A renewal is a jump: sample just before it and at it.
  const renewals = ends.flatMap((e) => [e - JUMP_LEAD_MS, e])
  const projectionGrid = sortedUnique([
    now,
    to,
    ...pools.flatMap((p) => lineOf(p.account, 'projection').map((x) => x.at)),
    ...renewals,
  ]).filter((at) => at >= now && at <= to)
  const projection = projectionGrid.map((at) => ({ at, left: projectedAt(at) }))
  // The even pace is a straight line to the first renewal: past it each pool starts a new cycle whose
  // length is unknown, so the reference stops there instead of zigzagging.
  const nextEnd = Math.min(...ends.filter((e) => e > now))
  const even =
    allEnded && Number.isFinite(nextEnd)
      ? [from, nextEnd - JUMP_LEAD_MS].map((at) => ({ at, left: evenAt(at) }))
      : []

  const rows: CreditRow[] = pools.map((p) => {
    const end = endOf(p.cycle.end)
    const dry = p.projection.dryAt === null ? null : Date.parse(p.projection.dryAt)
    return {
      account: p.account,
      label: poolTitle(p.account),
      leftUsd: p.leftUsd,
      grantUsd: p.grantUsd,
      renews: p.cycle.end === null ? 'unknown' : fmtDay(p.cycle.end),
      needed: fmtRate(p.requiredUsdPerDay),
      dryText: dry === null || (end !== null && dry >= end) ? null : `dry ${fmtDay(new Date(dry))}`,
    }
  })

  const left = pools.reduce((sum2, p) => sum2 + (p.leftUsd ?? 0), 0)
  const dryPools = pools
    .filter((p) => p.projection.dryAt !== null)
    .toSorted((a, b) => Date.parse(a.projection.dryAt ?? '') - Date.parse(b.projection.dryAt ?? ''))
  const first = dryPools[0]
  const unspent = pools.reduce((sum2, p) => sum2 + (p.projection.unspentAtEndUsd ?? 0), 0)
  const stale = reportAgeNote(pace, now)
  const off = pace.pools.filter((p) => !p.enabled).length
  const claim =
    first === undefined
      ? `Every pool lasts to its renewal, ≈${fmtUsd(unspent)} unspent`
      : dryPools.length === 1
        ? `${first.account} runs dry ${fmtDay(first.projection.dryAt ?? '')}${
            first.cycle.end === null
              ? ''
              : `, ${formatDuration(Date.parse(first.cycle.end) - Date.parse(first.projection.dryAt ?? ''))} before it renews`
          }`
        : `Pools empty in turn: ${dryPools.map((p) => `${p.account} ${fmtDay(p.projection.dryAt ?? '')}`).join(', ')}`
  const verdict = [
    claim,
    `projected at ${fmtRate(pace.rate.productionUsdPerDay)} production`,
    ...(off > 0 ? [`${off} pool${off === 1 ? '' : 's'} not enabled`] : []),
    ...(stale === null ? [] : [stale]),
  ].join(' · ')

  return {
    model: {
      ...base,
      actual,
      projection,
      even,
      resets: [],
      jumps: risesOf(projection, CREDIT_MIN_RISE_USD, (rise) => `+${fmtUsd(rise)}`),
      runOut: null,
      headline: `${fmtUsd(left)} left of ${fmtUsd(total)}`,
      verdict,
      leftText: (v) => `${fmtUsd(v)} of ${fmtUsd(total)} left`,
      empty: null,
    },
    rows,
  }
}
