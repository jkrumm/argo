/**
 * The pace chart's data: credit left per pool on a calendar axis. Per pool three lines — what happened
 * (the burn-down), the even pace that spends the grant exactly at expiry, and the projection at the
 * production rate R (flat until the router starts drawing on the pool, then down to dry or to the credit
 * left at expiry) — plus the markers the reader needs to judge it: dry points, expiry rules and the IU
 * spill window. Pure: the chart file only draws what this returns.
 */
import type { PacePool, PaceResponse } from '../../lib/queries/usage'
import { DAY_MS, enabledPools, fmtDay, fmtRate, fmtUsd } from './flow-model'

export interface PacePoint {
  at: number
  usd: number
}

export type LineKind = 'actual' | 'report' | 'even' | 'projection'

export interface PaceLine {
  /** `iu`, `iu:even`, `iu:projection`: the chart series key. */
  key: string
  account: string
  kind: LineKind
  points: PacePoint[]
}

export interface PaceMarker {
  account: string
  at: number
  /** `iu dry 3 Nov`. */
  label: string
  /** `iu dry`, for a narrow plot. */
  short: string
}

export interface PaceRule {
  account: string
  at: number
  /** `iu renews`. */
  label: string
}

export interface PaceBand {
  from: number
  until: number
  label: string
  /** The caption for a narrow plot. */
  short: string
}

export interface PaceModel {
  lines: PaceLine[]
  dry: PaceMarker[]
  expiry: PaceRule[]
  spill: PaceBand | null
  now: number
  domain: [number, number]
  maxUsd: number
}

const ms = (iso: string): number => new Date(iso).getTime()
/** The instant a UTC day ends: the burn-down's `leftUsd` is the credit left at that point. */
const dayEnd = (day: string): number => ms(`${day}T00:00:00Z`) + DAY_MS

/** What happened: the grant at the cycle start, the credit left at each day's end, the credit left now. */
function actualPoints(pool: PacePool, now: number): PacePoint[] {
  const points: PacePoint[] = [{ at: ms(pool.cycle.start), usd: pool.grantUsd }]
  for (const d of pool.days) {
    const end = dayEnd(d.day)
    // Today's entry is the credit left now, not at a midnight that has not come.
    if (end > now) break
    points.push({ at: end, usd: d.leftUsd })
  }
  if (pool.leftUsd !== null) points.push({ at: now, usd: pool.leftUsd })
  return points
}

/**
 * What the provider's own report alone says: the grant less the report's cumulative daily spend, on the
 * days it has a figure. The gap to `actual` is what the report has not caught up with yet.
 */
function reportPoints(pool: PacePool): PacePoint[] {
  const points: PacePoint[] = []
  let cumulative = 0
  for (const d of pool.days) {
    if (d.reportedUsd === null) continue
    cumulative += d.reportedUsd
    points.push({ at: dayEnd(d.day), usd: Math.max(0, pool.grantUsd - cumulative) })
  }
  return points
}

/** Flat until the pool is reached, then down to zero at the dry instant, or to the credit left at expiry. */
function projectionPoints(pool: PacePool, now: number): PacePoint[] {
  const { drawsFrom, dryAt, unspentAtEndUsd } = pool.projection
  if (pool.leftUsd === null) return []
  const points: PacePoint[] = [{ at: now, usd: pool.leftUsd }]
  const start = drawsFrom === null ? now : Math.max(now, ms(drawsFrom))
  if (start > now) points.push({ at: start, usd: pool.leftUsd })
  if (dryAt !== null) {
    points.push({ at: ms(dryAt), usd: 0 })
  } else if (pool.cycle.end !== null && unspentAtEndUsd !== null) {
    points.push({ at: ms(pool.cycle.end), usd: unspentAtEndUsd })
  }
  return points.length > 1 ? points : []
}

/** The even pace that would leave nothing at expiry: the grant down to zero over the cycle. */
function evenPoints(pool: PacePool): PacePoint[] {
  if (pool.cycle.end === null) return []
  return [
    { at: ms(pool.cycle.start), usd: pool.grantUsd },
    { at: ms(pool.cycle.end), usd: 0 },
  ]
}

export function paceModel(pace: PaceResponse, only?: { account: string }): PaceModel {
  const now = ms(pace.asOf)
  const pools = enabledPools(pace).filter((p) => only === undefined || p.account === only.account)
  const lines: PaceLine[] = []
  const dry: PaceMarker[] = []
  const expiry: PaceRule[] = []

  for (const pool of pools) {
    const a = pool.account
    lines.push({ key: a, account: a, kind: 'actual', points: actualPoints(pool, now) })
    if (only !== undefined) {
      lines.push({ key: `${a}:report`, account: a, kind: 'report', points: reportPoints(pool) })
    }
    lines.push({ key: `${a}:even`, account: a, kind: 'even', points: evenPoints(pool) })
    lines.push({
      key: `${a}:projection`,
      account: a,
      kind: 'projection',
      points: projectionPoints(pool, now),
    })
    if (pool.projection.dryAt !== null) {
      dry.push({
        account: a,
        at: ms(pool.projection.dryAt),
        label: `${a} dry ${fmtDay(pool.projection.dryAt)}`,
        short: `${a} dry`,
      })
    }
    if (pool.cycle.end !== null) {
      expiry.push({ account: a, at: ms(pool.cycle.end), label: `${a} renews` })
    }
  }

  const spill: PaceBand | null =
    pace.spill === null
      ? null
      : {
          from: ms(pace.spill.from),
          until: ms(pace.spill.until),
          label: `No pool left · Claude seats on GPT, IU personal key · ${Math.round(pace.spill.days)} d · ≈ ${fmtUsd(pace.spill.claudeListUsd)} of Claude work`,
          short: `No pool · ${Math.round(pace.spill.days)} d · ≈ ${fmtUsd(pace.spill.claudeListUsd)}`,
        }

  const starts = pools.map((p) => ms(p.cycle.start))
  const ends = pools.flatMap((p) => (p.cycle.end === null ? [] : [ms(p.cycle.end)]))
  const first = Math.min(...(starts.length > 0 ? starts : [now - 7 * DAY_MS]))
  // A pool without a known end still gets a fortnight of room to project into.
  const last = Math.max(now, ...(ends.length > 0 ? ends : [now + 14 * DAY_MS]))
  return {
    lines,
    dry,
    expiry,
    spill,
    now,
    domain: [first, last],
    maxUsd: Math.max(0, ...pools.map((p) => p.grantUsd)),
  }
}

/** One chart row per instant any line has a point at; a line without one is absent there (null). */
export interface PaceRow {
  at: Date
  values: Record<string, number | null>
}

export function paceRows(model: PaceModel): PaceRow[] {
  const instants = [...new Set(model.lines.flatMap((l) => l.points.map((p) => p.at)))].toSorted(
    (a, b) => a - b,
  )
  return instants.map((at) => ({
    at: new Date(at),
    values: Object.fromEntries(
      model.lines.map((l) => [l.key, l.points.find((p) => p.at === at)?.usd ?? null] as const),
    ),
  }))
}

/** The legend's projection label: `projection at $85/d`. */
export const projectionLabel = (pace: PaceResponse): string =>
  `projection at ${fmtRate(pace.rate.productionUsdPerDay)}`

/** Six evenly spaced ticks over the domain, on UTC midnights. */
export function paceTicks([from, to]: [number, number], count = 6): Date[] {
  const step = Math.max(DAY_MS, Math.round((to - from) / (count - 1) / DAY_MS) * DAY_MS)
  const start = Math.floor(from / DAY_MS) * DAY_MS
  const ticks: Date[] = []
  for (let t = start; t <= to; t += step) ticks.push(new Date(t))
  return ticks
}
