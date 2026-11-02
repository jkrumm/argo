/**
 * Pure arithmetic of `GET /usage/pace`: spent per pool and cycle, credit left, the production rate,
 * the waterfall (pools drained in cycle-end order), the spill onto IU, the verdict and the eval
 * reserve. Spec: docs/design/usage-tracking.md §Pace model. No database and no clock of its own:
 * `now` is always passed in. Days are UTC dates (`YYYY-MM-DD`), matching how the usage queries bucket.
 *
 * Deliberately self-contained (no import from the Credits routes, which a later change deletes).
 */
import { addDays } from './iu-budget.js'

export const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** The rate window: the last 7 × 24 h, clipped to the first gateway row. */
export const RATE_WINDOW_MS = 7 * DAY_MS
/** A rate from a window shorter than this is marked thin. */
export const THIN_WINDOW_HOURS = 24
/** The gateway keeps this much of every pool undrawn (agent-workflows docs/gateway.md §Credit pacing). */
export const GATEWAY_HEADROOM_USD = 2
/** `under` fires when a pool expires with more than max(UNDER_MIN_USD, UNDER_RATIO × grant) unspent. */
export const UNDER_MIN_USD = 5
export const UNDER_RATIO = 0.05

/** Pools the page always lists, with the grant the subscription gives per cycle; the API-side registry. */
export const POOL_REGISTRY: ReadonlyArray<{ account: string; grantUsd: number }> = [
  { account: 'iu', grantUsd: 200 },
  { account: 'me', grantUsd: 100 },
  { account: 'me2', grantUsd: 100 },
]

export const round4 = (n: number): number => Math.round(n * 10_000) / 10_000
export const utcDay = (instant: Date): string => instant.toISOString().slice(0, 10)

/** Every UTC day from `from` through `to` inclusive. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return days
}

export interface DaySpend {
  day: string
  usd: number
}

export type CycleStatus = 'open' | 'unknown-end' | 'awaiting-reconcile' | 'none'
export type Verdict = 'on-pace' | 'under' | 'over' | 'no-pool'

export interface CycleInput {
  start: Date
  end: Date | null
  grantUsd: number
  closedAt: Date | null
  reconciledUsd: number | null
  unspentUsd: number | null
}

/**
 * The pool's current cycle: the unclosed row that started and has not ended (an unknown end counts as
 * running). `awaiting-reconcile` = the newest unclosed row already ended (no balance until
 * usage-tracker closes it); `none` = no usable row. `previous` = the newest closed cycle with an end.
 */
export function selectCycles(
  cyclesNewestFirst: readonly CycleInput[],
  now: Date,
): { status: CycleStatus; current: CycleInput | null; previous: CycleInput | null } {
  const unclosed = cyclesNewestFirst.filter((c) => c.closedAt === null && c.start <= now)
  const running = unclosed.find((c) => c.end === null || c.end > now) ?? null
  const expired = running === null ? (unclosed.find((c) => c.end !== null) ?? null) : null
  const current = running ?? expired
  const status: CycleStatus =
    running === null
      ? expired
        ? 'awaiting-reconcile'
        : 'none'
      : running.end
        ? 'open'
        : 'unknown-end'
  const previous = cyclesNewestFirst.find((c) => c.closedAt !== null && c.end !== null) ?? null
  return { status, current, previous }
}

// ── Spent ─────────────────────────────────────────────────────────────────────────────────────

export interface SpentBreakdown {
  /** Σ over the cycle's days of max(metered_day, reported_day). */
  spentUsd: number
  /** Σ metered_day. */
  meteredUsd: number
  /** Σ reported_day; null when the pool has no provider report at all. */
  reportedUsd: number | null
  /** What the report holds on days the gateway did not carry (metered_day = 0). */
  outsideUsd: number
  days: Array<{ day: string; meteredUsd: number; reportedUsd: number | null; leftUsd: number }>
}

/**
 * Spent per pool and cycle. The provider report lags (it undercounts today) and includes spend made
 * outside the gateway; the meter misses that spend. The per-day max takes whichever is larger for
 * each day, which is the gateway's own reconcile rule. `reported` null = no report for the pool.
 */
export function spentOf(input: {
  days: readonly string[]
  grantUsd: number
  metered: readonly DaySpend[]
  reported: readonly DaySpend[] | null
}): SpentBreakdown {
  const meteredByDay = new Map(input.metered.map((d) => [d.day, d.usd]))
  const reportedByDay = input.reported ? new Map(input.reported.map((d) => [d.day, d.usd])) : null
  let spent = 0
  let metered = 0
  let reported = 0
  let outside = 0
  const days = input.days.map((day) => {
    const m = meteredByDay.get(day) ?? 0
    const r = reportedByDay?.get(day) ?? null
    metered += m
    reported += r ?? 0
    if (m <= 0 && r !== null) outside += r
    spent += Math.max(m, r ?? 0)
    return {
      day,
      meteredUsd: round4(m),
      reportedUsd: r === null ? null : round4(r),
      leftUsd: round4(input.grantUsd - spent),
    }
  })
  return {
    spentUsd: round4(spent),
    meteredUsd: round4(metered),
    reportedUsd: reportedByDay && reportedByDay.size > 0 ? round4(reported) : null,
    outsideUsd: round4(outside),
    days,
  }
}

// ── Production rate ───────────────────────────────────────────────────────────────────────────

export interface Rate {
  productionUsdPerDay: number
  evalUsdPerDay: number
  windowHours: number
  /** Window under 24 h: the verdict is built on a short sample. */
  thin: boolean
}

/**
 * R and E: the Claude-eligible demand over the window ending at `now`, which is the last 7 × 24 h
 * clipped to the first gateway row (`cutover`; null = no gateway row yet). `productionUsd` and
 * `evalUsd` are the sums over that same window.
 */
export function rateOf(input: {
  now: Date
  cutover: Date | null
  productionUsd: number
  evalUsd: number
}): Rate {
  const start = Math.max(
    input.now.getTime() - RATE_WINDOW_MS,
    input.cutover?.getTime() ?? input.now.getTime(),
  )
  const windowHours = Math.max(0, (input.now.getTime() - start) / HOUR_MS)
  const perDay = (usd: number) => (windowHours > 0 ? usd / (windowHours / 24) : 0)
  return {
    productionUsdPerDay: round4(perDay(input.productionUsd)),
    evalUsdPerDay: round4(perDay(input.evalUsd)),
    windowHours: round4(windowHours),
    thin: windowHours < THIN_WINDOW_HOURS,
  }
}

// ── Waterfall ─────────────────────────────────────────────────────────────────────────────────

export interface WaterfallPool {
  account: string
  leftUsd: number
  end: Date
}

export interface PoolProjection {
  account: string
  drawsFrom: Date | null
  dryAt: Date | null
  unspentAtEndUsd: number
}

/**
 * Pools drained in cycle-end order (the router's pick order). The first draws `rateUsdPerDay` from
 * `now`; it is dry at cursor + left ÷ rate, or expires with left − rate × days unspent. The next pool
 * starts drawing when the previous one dries, or when it expires (the demand moves on either way). A
 * pool whose end is already behind the cursor is never drawn from. Pools must be enabled with a known end.
 */
export function waterfall(
  pools: readonly WaterfallPool[],
  rateUsdPerDay: number,
  now: Date,
): PoolProjection[] {
  const ordered = pools.toSorted((a, b) => a.end.getTime() - b.end.getTime())
  let cursor = now.getTime()
  return ordered.map((pool): PoolProjection => {
    const left = Math.max(0, pool.leftUsd)
    const endMs = pool.end.getTime()
    if (rateUsdPerDay <= 0 || cursor >= endMs) {
      return { account: pool.account, drawsFrom: null, dryAt: null, unspentAtEndUsd: round4(left) }
    }
    const drawsFrom = new Date(cursor)
    const dryMs = cursor + (left / rateUsdPerDay) * DAY_MS
    if (dryMs <= endMs) {
      cursor = dryMs
      return {
        account: pool.account,
        drawsFrom,
        dryAt: new Date(dryMs),
        unspentAtEndUsd: 0,
      }
    }
    const drawn = rateUsdPerDay * ((endMs - cursor) / DAY_MS)
    cursor = endMs
    return {
      account: pool.account,
      drawsFrom,
      dryAt: null,
      unspentAtEndUsd: round4(left - drawn),
    }
  })
}

export interface Spill {
  from: Date
  until: Date
  days: number
  claudeListUsd: number
}

/**
 * From the last pool's dry instant to the soonest renewal (the earliest cycle end among the enabled
 * pools), `rate × days` in Claude list dollars. Null when the last pool outlasts the renewal or never
 * dries.
 */
export function spillOf(
  projections: readonly PoolProjection[],
  soonestRenewal: Date | null,
  rateUsdPerDay: number,
): Spill | null {
  const last = projections.at(-1)
  if (!last?.dryAt || !soonestRenewal || last.dryAt >= soonestRenewal) return null
  const days = (soonestRenewal.getTime() - last.dryAt.getTime()) / DAY_MS
  return {
    from: last.dryAt,
    until: soonestRenewal,
    days: round4(days),
    claudeListUsd: round4(rateUsdPerDay * days),
  }
}

/** `over` beats `under`: running dry is the louder state. `no-pool` when nothing is enabled. */
export function verdictOf(input: {
  enabledPools: number
  spill: Spill | null
  expiringUnspent: ReadonlyArray<{ unspentAtEndUsd: number; grantUsd: number }>
}): Verdict {
  if (input.enabledPools === 0) return 'no-pool'
  if (input.spill) return 'over'
  const under = input.expiringUnspent.some(
    (p) => p.unspentAtEndUsd > Math.max(UNDER_MIN_USD, UNDER_RATIO * p.grantUsd),
  )
  return under ? 'under' : 'on-pace'
}

/** The gateway's eval reserve: production's pro-rata share of the days left. */
export function evalReserveUsd(input: {
  grantUsd: number
  daysLeft: number
  cycleDays: number
}): number {
  if (input.cycleDays <= 0) return input.grantUsd
  return round4((input.grantUsd * Math.max(0, input.daysLeft)) / input.cycleDays)
}

// ── Assembly ──────────────────────────────────────────────────────────────────────────────────

export interface PoolInput {
  account: string
  /** The registry grant, used only while no cycle row gives one. */
  registryGrantUsd: number
  cyclesNewestFirst: readonly CycleInput[]
  /** Gateway spend per UTC day from the current cycle's start. */
  metered: readonly DaySpend[]
  /** Provider-reported spend per UTC day from the cycle start; null = the report is unavailable. */
  reported: readonly DaySpend[] | null
  reportedAt: Date | null
}

export interface PoolPace {
  account: string
  enabled: boolean
  note: string | null
  grantUsd: number
  cycle: { start: string; end: string | null; status: CycleStatus }
  spentUsd: number
  meteredUsd: number
  reportedUsd: number | null
  outsideUsd: number
  reportedAt: string | null
  leftUsd: number | null
  daysLeft: number | null
  requiredUsdPerDay: number | null
  evalReserveUsd: number | null
  evalAvailableUsd: number | null
  projection: { drawsFrom: string | null; dryAt: string | null; unspentAtEndUsd: number | null }
  days: SpentBreakdown['days']
  previous: {
    start: string
    end: string
    grantUsd: number
    reconciledUsd: number | null
    unspentUsd: number | null
  } | null
}

export interface Pace {
  verdict: Verdict
  thin: boolean
  rate: { productionUsdPerDay: number; evalUsdPerDay: number; windowHours: number }
  pools: PoolPace[]
  spill: { from: string; until: string; days: number; claudeListUsd: number } | null
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)
const poolRank = (account: string): number => {
  const i = POOL_REGISTRY.findIndex((p) => p.account === account)
  return i === -1 ? POOL_REGISTRY.length : i
}

/** Accounts the page lists: the registry first, then any other account that has a cycle row. */
export function poolAccounts(cycleAccounts: Iterable<string>): string[] {
  const all = new Set([...POOL_REGISTRY.map((p) => p.account), ...cycleAccounts])
  return [...all].toSorted((a, b) => poolRank(a) - poolRank(b) || a.localeCompare(b))
}

function describeNote(status: CycleStatus): string | null {
  switch (status) {
    case 'none':
      return 'not enabled'
    case 'awaiting-reconcile':
      return 'awaiting reconcile'
    case 'unknown-end':
      return 'cycle unknown'
    case 'open':
      return null
  }
}

/** One pool's facts as of `now`, before the waterfall fills its projection. */
function poolFacts(input: PoolInput, now: Date) {
  const { status, current, previous } = selectCycles(input.cyclesNewestFirst, now)
  const grantUsd = current?.grantUsd ?? input.registryGrantUsd
  const running = status === 'open' || status === 'unknown-end'
  const previousPace: PoolPace['previous'] =
    previous?.end != null
      ? {
          start: previous.start.toISOString(),
          end: previous.end.toISOString(),
          grantUsd: previous.grantUsd,
          reconciledUsd: previous.reconciledUsd,
          unspentUsd: previous.unspentUsd,
        }
      : null

  const base = {
    account: input.account,
    enabled: running,
    note: describeNote(status),
    grantUsd,
    cycle: {
      // `none` has no cycle: the start reads as the instant of the request.
      start: (current?.start ?? now).toISOString(),
      end: status === 'unknown-end' ? null : iso(current?.end ?? null),
      status,
    },
    previous: previousPace,
  }
  if (!running || !current) {
    return {
      ...base,
      end: null as Date | null,
      leftUsd: null as number | null,
      pool: {
        ...base,
        spentUsd: 0,
        meteredUsd: 0,
        reportedUsd: null,
        outsideUsd: 0,
        reportedAt: null,
        leftUsd: null,
        daysLeft: null,
        requiredUsdPerDay: null,
        evalReserveUsd: null,
        evalAvailableUsd: null,
        projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: null },
        days: [],
      } satisfies PoolPace,
    }
  }

  const lastDay = utcDay(now)
  const spent = spentOf({
    days: daysBetween(utcDay(current.start), lastDay),
    grantUsd,
    metered: input.metered,
    reported: input.reported && input.reported.length > 0 ? input.reported : null,
  })
  const leftUsd = round4(grantUsd - spent.spentUsd)
  const end = status === 'open' ? current.end : null
  const daysLeft = end ? Math.max(0, (end.getTime() - now.getTime()) / DAY_MS) : null
  const cycleDays = end ? (end.getTime() - current.start.getTime()) / DAY_MS : 0
  const reserve = end ? evalReserveUsd({ grantUsd, daysLeft: daysLeft ?? 0, cycleDays }) : grantUsd
  return {
    ...base,
    end,
    leftUsd,
    pool: {
      ...base,
      spentUsd: spent.spentUsd,
      meteredUsd: spent.meteredUsd,
      reportedUsd: spent.reportedUsd,
      outsideUsd: spent.outsideUsd,
      reportedAt: spent.reportedUsd === null ? null : iso(input.reportedAt),
      leftUsd,
      daysLeft: daysLeft === null ? null : round4(daysLeft),
      requiredUsdPerDay: daysLeft && daysLeft > 0 ? round4(Math.max(0, leftUsd) / daysLeft) : null,
      evalReserveUsd: reserve,
      evalAvailableUsd: round4(Math.max(0, leftUsd - GATEWAY_HEADROOM_USD - reserve)),
      projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: null },
      days: spent.days,
    } satisfies PoolPace,
  }
}

/** The whole `/usage/pace` body (minus the SQL-only fields) from the pools' rows and the rate. */
export function buildPace(input: { now: Date; pools: readonly PoolInput[]; rate: Rate }): Pace {
  const { now, rate } = input
  const facts = input.pools.map((p) => poolFacts(p, now))
  const pools: PoolPace[] = facts.map((f) => f.pool)

  const projectable = facts.flatMap((f) =>
    f.end && f.leftUsd !== null ? [{ account: f.account, leftUsd: f.leftUsd, end: f.end }] : [],
  )
  const projections = waterfall(projectable, rate.productionUsdPerDay, now)
  for (const projection of projections) {
    const pool = pools.find((p) => p.account === projection.account)
    if (pool) {
      pool.projection = {
        drawsFrom: iso(projection.drawsFrom),
        dryAt: iso(projection.dryAt),
        unspentAtEndUsd: projection.unspentAtEndUsd,
      }
    }
  }

  const enabled = pools.filter((p) => p.enabled)
  const renewals = projectable.map((p) => p.end.getTime())
  const soonestRenewal = renewals.length > 0 ? new Date(Math.min(...renewals)) : null
  const spill = spillOf(projections, soonestRenewal, rate.productionUsdPerDay)
  const verdict = verdictOf({
    enabledPools: enabled.length,
    spill,
    expiringUnspent: projections
      .filter((p) => p.dryAt === null)
      .map((p) => ({
        unspentAtEndUsd: p.unspentAtEndUsd,
        grantUsd: pools.find((x) => x.account === p.account)?.grantUsd ?? 0,
      })),
  })
  return {
    verdict,
    thin: rate.thin,
    rate: {
      productionUsdPerDay: rate.productionUsdPerDay,
      evalUsdPerDay: rate.evalUsdPerDay,
      windowHours: rate.windowHours,
    },
    pools,
    spill: spill
      ? {
          from: spill.from.toISOString(),
          until: spill.until.toISOString(),
          days: spill.days,
          claudeListUsd: spill.claudeListUsd,
        }
      : null,
  }
}
