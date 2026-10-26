// IU API cap arithmetic, ported from usage-tracker `src/budget.ts` (`make budget` is the reference
// output). The cap is a ROLLING window: today and the 29 days before, measured by IU's own portal.
// Pure functions over per-day portal sums so the route stays a query plus a call.

export const IU_CAP_USD = 500
export const IU_WINDOW_DAYS = 30
const BURN_DAYS = 7
const TOP_MODELS = 10
/** A day is flagged when tracked and portal differ by more than max($1, 20 % of portal). */
const FLAG_MIN_USD = 1
const FLAG_RATIO = 0.2

const round2 = (n: number) => Math.round(n * 100) / 100
const sum = (xs: Iterable<number>) => {
  let total = 0
  for (const x of xs) total += x
  return total
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** True when tracked spend disagrees with the portal beyond the flag threshold. */
export function isOff(portalUsd: number, trackedUsd: number): boolean {
  return Math.abs(trackedUsd - portalUsd) > Math.max(FLAG_MIN_USD, FLAG_RATIO * portalUsd)
}

export interface PortalCell {
  day: string
  label: string
  usd: number
}

export interface IuBudget {
  limitUsd: number
  windowDays: number
  windowFrom: string
  windowTo: string
  rolling30Usd: number
  canSpendTodayUsd: number
  burn7dUsdPerDay: number
  projected7dUsd: number
  daily: Array<{ day: string; usd: number }>
  dropoffNext7: Array<{ day: string; freesUsd: number; headroomUsd: number }>
  topModels: Array<{ label: string; usd: number }>
}

/**
 * `today` is the newest day the portal reported (the portal's own clock), not the server's, so the
 * window matches what IU measured. `cells` are the non-zero (day, label) sums; days outside the
 * window are ignored.
 */
export function computeBudget(cells: readonly PortalCell[], today: string): IuBudget {
  const windowFrom = addDays(today, -(IU_WINDOW_DAYS - 1))
  const perDay = new Map<string, number>()
  const perLabel = new Map<string, number>()
  for (const c of cells) {
    perDay.set(c.day, (perDay.get(c.day) ?? 0) + c.usd)
    if (c.day >= windowFrom && c.day <= today) {
      perLabel.set(c.label, (perLabel.get(c.label) ?? 0) + c.usd)
    }
  }
  const usd = (day: string) => perDay.get(day) ?? 0
  const span = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => addDays(today, from + i))

  const rolling30 = sum(span(-(IU_WINDOW_DAYS - 1), 0).map(usd))
  const burn7 = sum(span(-(BURN_DAYS - 1), 0).map(usd)) / BURN_DAYS

  let freed = 0
  const dropoff = span(-(IU_WINDOW_DAYS - 1), -(IU_WINDOW_DAYS - BURN_DAYS)).map((day) => {
    freed += usd(day)
    return {
      day,
      freesUsd: round2(usd(day)),
      headroomUsd: round2(IU_CAP_USD - (rolling30 - freed)),
    }
  })

  return {
    limitUsd: IU_CAP_USD,
    windowDays: IU_WINDOW_DAYS,
    windowFrom,
    windowTo: today,
    rolling30Usd: round2(rolling30),
    canSpendTodayUsd: round2(IU_CAP_USD - sum(span(-(IU_WINDOW_DAYS - 1), -1).map(usd))),
    burn7dUsdPerDay: round2(burn7),
    projected7dUsd: round2(rolling30 - freed + BURN_DAYS * burn7),
    daily: span(-30, 0).map((day) => ({ day, usd: round2(usd(day)) })),
    dropoffNext7: dropoff,
    topModels: [...perLabel.entries()]
      .map(([label, v]) => ({ label, usd: round2(v) }))
      .toSorted((a, b) => b.usd - a.usd)
      .slice(0, TOP_MODELS),
  }
}

const alnum = (s: string) => s.toLowerCase().replaceAll(/[^a-z0-9]/g, '')

export interface ModelCmp {
  label: string
  portalUsd: number
  trackedUsd: number
}

/**
 * Join portal and tracked per-model totals. The portal prettifies ids ("GPT 5.6 Terra") while
 * tracking stores `model_norm`, so keys meet on their alphanumerics. A model seen on one side only
 * keeps its own label: that is the "portal spend we do not track" signal itself.
 */
export function mergeModels(
  portal: ReadonlyMap<string, number>,
  tracked: ReadonlyMap<string, number>,
): ModelCmp[] {
  const merged = new Map<string, ModelCmp>()
  const upsert = (label: string, field: 'portalUsd' | 'trackedUsd', usd: number) => {
    const key = alnum(label)
    const row = merged.get(key) ?? { label, portalUsd: 0, trackedUsd: 0 }
    row[field] += usd
    merged.set(key, row)
  }
  for (const [label, usd] of portal) upsert(label, 'portalUsd', usd)
  for (const [label, usd] of tracked) upsert(label, 'trackedUsd', usd)
  return [...merged.values()]
    .map((m) => ({ ...m, portalUsd: round2(m.portalUsd), trackedUsd: round2(m.trackedUsd) }))
    .toSorted((a, b) => Math.max(b.portalUsd, b.trackedUsd) - Math.max(a.portalUsd, a.trackedUsd))
}

export interface ReconcileDay {
  day: string
  portalUsd: number
  trackedUsd: number
  deltaUsd: number
  ratio: number | null
  flagged: boolean
  partial: boolean
}

/** One entry per day of the window ending at `today`; `today` (the newest portal day) is partial. */
export function reconcileDays(
  portal: ReadonlyMap<string, number>,
  tracked: ReadonlyMap<string, number>,
  today: string,
  days: number,
): ReconcileDay[] {
  return Array.from({ length: days }, (_, i) => addDays(today, -(days - 1) + i)).map((day) => {
    const p = portal.get(day) ?? 0
    const t = tracked.get(day) ?? 0
    return {
      day,
      portalUsd: round2(p),
      trackedUsd: round2(t),
      deltaUsd: round2(t - p),
      ratio: p > 0 ? round2(t / p) : null,
      flagged: isOff(p, t),
      partial: day === today,
    }
  })
}
