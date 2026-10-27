/**
 * Pure derivations for tuning the Claude account picker from its own log: spill rate per lane and,
 * per quota window, the capacity left unused at the reset and how long a 5-hour reset waits before
 * the picker comes back to that account. No DB.
 */

export type PickCount = { lane: string; picked: string; reason: string; count: number }

/** Per lane: picks, spills (no Max account had room: picked or reason `spill`) and the rate. */
export function laneSpills(counts: readonly PickCount[]) {
  const lanes = new Map<string, { total: number; spills: number }>()
  for (const c of counts) {
    const lane = lanes.get(c.lane) ?? { total: 0, spills: 0 }
    lane.total += c.count
    if (c.picked === 'spill' || c.reason === 'spill') lane.spills += c.count
    lanes.set(c.lane, lane)
  }
  return [...lanes]
    .map(([lane, v]) => ({ lane, ...v, spillRate: v.total === 0 ? 0 : v.spills / v.total }))
    .toSorted((a, b) => b.total - a.total)
}

export type QuotaWindow = {
  account: string
  window: 'five_hour' | 'seven_day'
  resetAt: string
  /** Percent used in the last sample before the reset; null without one. */
  pctAtReset: number | null
  /** 100 − pctAtReset: the capacity the window expired with. */
  unusedPct: number | null
  /** When that last sample was taken: far from the reset means the reading is old. */
  lastSampleAt: string | null
  /** 5-hour windows only: the first pick of this account at or after the reset. */
  firstPickAt: string | null
  minutesToFirstPick: number | null
}

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = xs.toSorted((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length

/** Per account and window kind: how many resets, the unused capacity they left, the wait to the next pick. */
export function windowSummary(windows: readonly QuotaWindow[]) {
  const groups = new Map<string, QuotaWindow[]>()
  for (const w of windows) {
    const key = `${w.account}\u0000${w.window}`
    groups.set(key, [...(groups.get(key) ?? []), w])
  }
  return [...groups.values()].map((ws) => {
    const unused = ws.flatMap((w) => (w.unusedPct === null ? [] : [w.unusedPct]))
    const waits = ws.flatMap((w) => (w.minutesToFirstPick === null ? [] : [w.minutesToFirstPick]))
    return {
      account: ws[0]!.account,
      window: ws[0]!.window,
      resets: ws.length,
      medianUnusedPct: median(unused),
      meanUnusedPct: mean(unused),
      medianMinutesToFirstPick: median(waits),
      /** 5-hour resets with no pick of the account since. */
      neverPickedAfter:
        ws[0]!.window === 'five_hour' ? ws.filter((w) => w.firstPickAt === null).length : 0,
    }
  })
}

const pctOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * The picker's per-account snapshot (`{iu: {s, w}, …}`, stored as opaque jsonb) as numbers; any
 * other shape reads as nulls, never throws.
 */
export function snapshotOf(raw: unknown): Record<string, { s: number | null; w: number | null }> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, { s: number | null; w: number | null }> = {}
  for (const [account, v] of Object.entries(raw)) {
    const o = v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    out[account] = { s: pctOrNull(o['s']), w: pctOrNull(o['w']) }
  }
  return out
}
