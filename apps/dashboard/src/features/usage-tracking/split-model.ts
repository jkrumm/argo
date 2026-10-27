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
const FOLD_KEY = 'other'
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

/** The wallet that holds most of a row, with its share of the row; `null` for an empty row. */
export function biggestWallet(
  row: SplitRow,
  lens: UsageLens,
): { payer: string; label: string; share: number } | null {
  const total = measureOf(row, lens)
  if (total <= 0) return null
  const top = row.payers
    .map((p) => ({ payer: p.payer, value: measureOf(p, lens) }))
    .reduce<{ payer: string; value: number } | null>(
      (best, p) => (best === null || p.value > best.value ? p : best),
      null,
    )
  if (top === null || top.value <= 0) return null
  return {
    payer: top.payer,
    label: PAYER_LABELS[top.payer as PayerValue] ?? top.payer,
    share: top.value / total,
  }
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

/** Whether a range total clears the bar for Me API to get a card of its own ("only when it reaches $1"). */
export const SHOW_AT_USD = 1
