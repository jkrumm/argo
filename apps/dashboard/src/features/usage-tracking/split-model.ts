/**
 * Pure derivations over `GET /usage/split`: a wallet's figures out of `totals`, the per-payer
 * segments of a ranked row, the "mostly …" line of a wallet card and the head/tail cut of a list.
 * The measure is the page's lens: `cost` (dollars at API prices) or `tokens` (fresh). No React, no
 * queries.
 */
import type { MeterSegment } from 'basalt-ui'
import type { SplitResponse, SplitRow, SplitTotal } from '../../lib/queries/usage'
import type { UsageLens } from '../../lib/window-stores'
import { PAYER_LABELS, USAGE_PAYERS, type PayerValue } from './accounts'
import { colorForPayer } from './constants'
import { OTHER_KEY } from './model'

/** The key the API folds a list's tail into. */
/** `/usage/split` folds its tail into this key; parenthesised so no real key can collide with it. */
const FOLD_KEY = '(other)'
/** A key with no value in the column (empty or NULL). */
export const UNSET_KEY = '(unset)'

type Measures = { cost: number; fresh: number }

/** One measure of a row, a payer's cell or a total. */
export const measureOf = (m: Measures, lens: UsageLens): number =>
  lens === 'cost' ? m.cost : m.fresh

/** The same measure over the window before; `null` without one. */
export const priorMeasureOf = (m: { prior: Measures | null }, lens: UsageLens): number | null =>
  m.prior === null ? null : measureOf(m.prior, lens)

export const totalOf = (totals: SplitResponse['totals'], payer: string): SplitTotal | undefined =>
  totals.find((t) => t.payer === payer)

/**
 * Several payers' totals as one (a scope that covers two IU API keys): records, summed. A caps view
 * never goes through here. `undefined` when none of the payers has a total; `prior` is `null` as soon
 * as one of them has no prior window.
 */
export function combinedTotal(
  totals: SplitResponse['totals'],
  payers: readonly string[],
): Omit<SplitTotal, 'payer'> | undefined {
  const found = payers.flatMap((p) => {
    const t = totalOf(totals, p)
    return t === undefined ? [] : [t]
  })
  const [first, ...rest] = found
  if (first === undefined) return undefined
  const { payer: _payer, ...head } = first
  return rest.reduce<Omit<SplitTotal, 'payer'>>(
    (sum, t) => ({
      cost: sum.cost + t.cost,
      fresh: sum.fresh + t.fresh,
      cacheRead: sum.cacheRead + t.cacheRead,
      output: sum.output + t.output,
      calls: sum.calls + t.calls,
      prior:
        sum.prior === null || t.prior === null
          ? null
          : { cost: sum.prior.cost + t.prior.cost, fresh: sum.prior.fresh + t.prior.fresh },
    }),
    head,
  )
}

/** A payer's cell of a row: payers are listed only when they have something in the window. */
const cellOf = (row: SplitRow, payer: string): Measures =>
  row.payers.find((p) => p.payer === payer) ?? { cost: 0, fresh: 0 }

const PAYER_ORDER: readonly string[] = USAGE_PAYERS.map((p) => p.id)
const orderOf = (payer: string): number => {
  const i = PAYER_ORDER.indexOf(payer)
  return i === -1 ? PAYER_ORDER.length : i
}

/**
 * The parts of a row's bar: one segment per payer with something in it, in the registry's order,
 * each in its payer hue and named by its wallet. The sum is the row's own total.
 */
export function mixSegments(row: SplitRow, lens: UsageLens): MeterSegment[] {
  return row.payers
    .map((p) => ({ payer: p.payer, value: measureOf(p, lens) }))
    .filter((p) => p.value > 0)
    .toSorted((a, b) => orderOf(a.payer) - orderOf(b.payer))
    .map((p) => ({
      value: p.value,
      label: PAYER_LABELS[p.payer as PayerValue] ?? p.payer,
      color: colorForPayer(p.payer),
    }))
}

export type Mostly = { key: string; share: number }

/**
 * The row where one wallet's measure is largest, with its share of that wallet's total. The folded
 * tail and the unset key never win: they name no project or tool.
 */
export function mostlyOf(
  rows: readonly SplitRow[],
  payer: string,
  walletTotal: number,
  lens: UsageLens,
): Mostly | null {
  if (walletTotal <= 0) return null
  const best = rows
    .filter((r) => r.key !== FOLD_KEY && r.key !== UNSET_KEY)
    .map((r) => ({ key: r.key, value: measureOf(cellOf(r, payer), lens) }))
    .reduce<{ key: string; value: number } | null>(
      (top, r) => (top === null || r.value > top.value ? r : top),
      null,
    )
  if (best === null || best.value <= 0) return null
  return { key: best.key, share: Math.min(1, best.value / walletTotal) }
}

export type CutList = {
  /** The first `limit` named rows, in the API's rank. */
  named: SplitRow[]
  /** Everything past the cut plus the API's folded tail, summed; `null` when nothing is left. */
  rest: {
    key: typeof OTHER_KEY
    cost: number
    fresh: number
    cacheRead: number
    rows: number
  } | null
}

const sumPayers = (a: SplitRow['payers'], b: SplitRow['payers']): SplitRow['payers'] => {
  const byPayer = new Map(a.map((p) => [p.payer, p] as const))
  for (const p of b) {
    const prev = byPayer.get(p.payer)
    byPayer.set(
      p.payer,
      prev === undefined
        ? p
        : {
            payer: p.payer,
            cost: prev.cost + p.cost,
            fresh: prev.fresh + p.fresh,
            cacheRead: prev.cacheRead + p.cacheRead,
            output: prev.output + p.output,
            calls: prev.calls + p.calls,
          },
    )
  }
  return [...byPayer.values()]
}

const sumRows = (a: SplitRow, b: SplitRow): SplitRow => ({
  ...a,
  cost: a.cost + b.cost,
  fresh: a.fresh + b.fresh,
  cacheRead: a.cacheRead + b.cacheRead,
  output: a.output + b.output,
  calls: a.calls + b.calls,
  prior:
    a.prior === null || b.prior === null
      ? null
      : { cost: a.prior.cost + b.prior.cost, fresh: a.prior.fresh + b.prior.fresh },
  payers: sumPayers(a.payers, b.payers),
})

/**
 * Rows that read the same in a list are one row: a model a producer reports as `deepseek/x` and
 * another as `x` both read `x`, so their measures, prior windows and payer cells are summed (the
 * first, largest row names it). Merged lists are re-ranked by the lens; a list with nothing to merge
 * comes back as it was, and the API's folded `(other)` row is never merged.
 */
export function mergeByLabel(
  rows: readonly SplitRow[],
  lens: UsageLens,
  labelOf: (key: string) => string,
): SplitRow[] {
  const merged = new Map<string, SplitRow>()
  let combined = false
  for (const r of rows) {
    const id = r.key === FOLD_KEY ? r.key : labelOf(r.key)
    const prev = merged.get(id)
    if (prev === undefined) {
      merged.set(id, r)
      continue
    }
    combined = true
    merged.set(id, sumRows(prev, r))
  }
  const all = [...merged.values()]
  if (!combined) return all
  const named = all.filter((r) => r.key !== FOLD_KEY)
  const fold = all.filter((r) => r.key === FOLD_KEY)
  return [...named.toSorted((a, b) => measureOf(b, lens) - measureOf(a, lens)), ...fold]
}

/** The head of a ranked list and its tail as one `Other` line (a text line, never a bar). */
export function cutList(rows: readonly SplitRow[], limit: number): CutList {
  const ranked = rows.filter((r) => r.key !== FOLD_KEY)
  const named = ranked.slice(0, limit)
  const tail = [...ranked.slice(limit), ...rows.filter((r) => r.key === FOLD_KEY)]
  if (tail.length === 0) return { named, rest: null }
  return {
    named,
    rest: {
      key: OTHER_KEY,
      cost: tail.reduce((s, r) => s + r.cost, 0),
      fresh: tail.reduce((s, r) => s + r.fresh, 0),
      cacheRead: tail.reduce((s, r) => s + r.cacheRead, 0),
      rows: tail.length,
    },
  }
}

/** Keys the API keeps before folding the tail: wide enough that a wallet's own top row is in it. */
export const SPLIT_TOP = 50

/** Whether a range total clears the bar for Me API to get a card of its own ("only when it reaches $1"). */
export const SHOW_AT_USD = 1

/**
 * The share of a payer's dollars that carries no project: the `(unset)` row of a project split over
 * the payer's total. `null` without a total to divide by. A row folded into `(other)` reads as
 * missing, so ask for enough keys that the unset row is never in the tail.
 */
export function unsetShare(
  rows: readonly SplitRow[],
  total: { cost: number } | undefined,
): { share: number; cost: number } | null {
  if (total === undefined || total.cost <= 0) return null
  const cost = rows.find((r) => r.key === UNSET_KEY)?.cost ?? 0
  return { share: cost / total.cost, cost }
}
