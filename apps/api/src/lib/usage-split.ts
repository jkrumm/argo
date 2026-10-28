/**
 * Pure folding for `GET /usage/split`: per-(key, payer) sums from SQL become ranked rows, each
 * carrying its per-payer split, plus per-payer totals over every key. No DB.
 *
 * Fresh tokens are input + output + cache-write + reasoning (what the model newly processed);
 * cache-read is its own measure. See docs/design/usage-tracking.md §Token accounting.
 */

export type Measures = {
  cost: number
  fresh: number
  cacheRead: number
  output: number
  calls: number
}

export type Prior = { cost: number; fresh: number }

/** One SQL row: a key under one payer, the current window's measures and the prior window's. */
export type SplitCell = Measures & {
  key: string
  payer: string
  priorCost: number
  priorFresh: number
}

export type SplitRow = Measures & {
  key: string
  prior: Prior | null
  payers: Array<Measures & { payer: string }>
}

export type SplitTotal = Measures & { payer: string; prior: Prior | null }

/** Parenthesised like `(unset)`, so it can never be a real project, tool or model name. */
export const SPLIT_FOLD_KEY = '(other)'

/** Rows with no key read this; never folded, so its share (spend without a project) is always visible. */
export const SPLIT_UNSET_KEY = '(unset)'

/** A model-less row (`model_norm` NULL) under `by=model_norm`; same word as the flow's, never folded either. */
export const SPLIT_UNKNOWN_MODEL_KEY = '(unknown model)'

const NEVER_FOLDED: ReadonlySet<string> = new Set([SPLIT_UNSET_KEY, SPLIT_UNKNOWN_MODEL_KEY])

const zero = (): Measures => ({ cost: 0, fresh: 0, cacheRead: 0, output: 0, calls: 0 })

function addInto(into: Measures, from: Measures): void {
  into.cost += from.cost
  into.fresh += from.fresh
  into.cacheRead += from.cacheRead
  into.output += from.output
  into.calls += from.calls
}

const pick = (m: Measures): Measures => ({
  cost: m.cost,
  fresh: m.fresh,
  cacheRead: m.cacheRead,
  output: m.output,
  calls: m.calls,
})

type Acc = Measures & { prior: Prior; payers: Map<string, Measures> }

function accumulate(acc: Map<string, Acc>, key: string, cell: SplitCell): void {
  const row = acc.get(key) ?? { ...zero(), prior: { cost: 0, fresh: 0 }, payers: new Map() }
  addInto(row, cell)
  row.prior.cost += cell.priorCost
  row.prior.fresh += cell.priorFresh
  const payer = row.payers.get(cell.payer) ?? zero()
  addInto(payer, cell)
  row.payers.set(cell.payer, payer)
  acc.set(key, row)
}

/**
 * Rows ranked by the lens (dollars, or fresh tokens) over the current window, the first `top - 1`
 * kept and the rest summed into one `other` row so the rows still add up to the totals. A key with
 * nothing in the current window is not a row (it still counts in the prior totals). `hasPrior: false`
 * (an all-time range, or a prior window before the data floor) nulls every prior.
 */
export function foldSplit({
  cells,
  lens,
  top,
  hasPrior,
}: {
  cells: readonly SplitCell[]
  lens: 'cost' | 'tokens'
  top: number
  hasPrior: boolean
}): { rows: SplitRow[]; totals: SplitTotal[] } {
  const totals = new Map<string, Measures & { prior: Prior }>()
  const byKey = new Map<string, Acc>()
  for (const cell of cells) {
    const t = totals.get(cell.payer) ?? { ...zero(), prior: { cost: 0, fresh: 0 } }
    addInto(t, cell)
    t.prior.cost += cell.priorCost
    t.prior.fresh += cell.priorFresh
    totals.set(cell.payer, t)
    accumulate(byKey, cell.key, cell)
  }

  const value = (m: Measures) => (lens === 'cost' ? m.cost : m.fresh)
  const ranked = [...byKey.entries()]
    .filter(([, r]) => value(r) > 0)
    .toSorted(([, a], [, b]) => value(b) - value(a))
  const cut = ranked.length <= top ? ranked : ranked.slice(0, top - 1)
  const rest = ranked.length <= top ? [] : ranked.slice(top - 1)
  // The unset buckets are never folded: a page reads "how much has no project / model" from them.
  const head = [...cut, ...rest.filter(([key]) => NEVER_FOLDED.has(key))]
  const tail = rest.filter(([key]) => !NEVER_FOLDED.has(key))

  const toRow = (key: string, r: Acc): SplitRow => ({
    key,
    ...pick(r),
    prior: hasPrior ? { ...r.prior } : null,
    payers: [...r.payers.entries()]
      .map(([payer, m]) => ({ payer, ...pick(m) }))
      .toSorted((a, b) => value(b) - value(a)),
  })

  const rows = head.map(([key, r]) => toRow(key, r))
  if (tail.length > 0) {
    const other = new Map<string, Acc>()
    for (const [, r] of tail) {
      for (const [payer, m] of r.payers) {
        accumulate(other, SPLIT_FOLD_KEY, {
          ...m,
          key: SPLIT_FOLD_KEY,
          payer,
          priorCost: 0,
          priorFresh: 0,
        })
      }
      const o = other.get(SPLIT_FOLD_KEY)!
      o.prior.cost += r.prior.cost
      o.prior.fresh += r.prior.fresh
    }
    rows.push(toRow(SPLIT_FOLD_KEY, other.get(SPLIT_FOLD_KEY)!))
  }

  return {
    rows,
    totals: [...totals.entries()]
      .map(([payer, t]) => ({ payer, ...pick(t), prior: hasPrior ? { ...t.prior } : null }))
      .toSorted((a, b) => value(b) - value(a)),
  }
}
