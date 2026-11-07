/**
 * What the Explore tab covers: the payers the Payer control selected, as the filter every block
 * sends and the `Scope` the shared sections (over time, rhythm) take. No React, no queries.
 */
import type { InsightsPeriod, Range } from '../../lib/queries/usage'
import { VX } from 'basalt-ui/tokens'
import type { UsageGroupBy } from '../../lib/window-stores'
import { PAYER_LABELS, USAGE_ACCOUNTS, USAGE_PAYERS, type PayerValue } from './accounts'
import { colorForPayer } from './constants'
import type { Scope } from './scope'

/** The team key is never summed into ours: it is in no "all" and appears only when selected. */
export const ATHENA_PAYER: PayerValue = 'iu-team-api'

const PAYER_ORDER: readonly PayerValue[] = USAGE_PAYERS.map((p) => p.id)

/** "All payers": every registry payer but the team key, plus the rows no payer could be named for. */
export const EXPLORE_PAYERS: readonly PayerValue[] = [
  ...PAYER_ORDER.filter((id) => id !== ATHENA_PAYER),
  'unknown',
]

/** The groupings Over time offers: payer first, as the tab spans every wallet. */
export const EXPLORE_GROUP_OPTIONS: readonly UsageGroupBy[] = [
  'payer',
  'sub_tool',
  'model_norm',
  'project',
]

const SUBSCRIPTION_PAYERS: ReadonlySet<PayerValue> = new Set(USAGE_ACCOUNTS.map((a) => a.payer))

const orderOf = (payer: PayerValue): number => {
  const i = PAYER_ORDER.indexOf(payer)
  return i === -1 ? PAYER_ORDER.length : i
}

/** The payer filter the blocks send: the selection in registry order, or every payer but the team key. */
export function explorePayers(selected: readonly PayerValue[]): PayerValue[] {
  if (selected.length === 0) return [...EXPLORE_PAYERS]
  return [...new Set(selected)].toSorted((a, b) => orderOf(a) - orderOf(b))
}

/** What `$` is called over these payers: list value for subscriptions only, spend with none, else both at API prices. */
export function exploreWord(payers: readonly PayerValue[]): Scope['word'] {
  const subs = payers.filter((p) => SUBSCRIPTION_PAYERS.has(p)).length
  if (subs === payers.length) return 'list value'
  return subs === 0 ? 'spend' : '$ at API prices'
}

export function exploreScope(selected: readonly PayerValue[]): Scope & { payers: PayerValue[] } {
  const payers = explorePayers(selected)
  const word = exploreWord(payers)
  const [only] = payers
  const single = selected.length > 0 && payers.length === 1 && only !== undefined
  return {
    id: 'explore',
    title:
      selected.length === 0
        ? 'All payers'
        : single
          ? PAYER_LABELS[only]
          : `${payers.length} payers`,
    payers,
    word,
    polarity: word === 'spend' ? 'up-bad' : 'neutral',
    color: single ? colorForPayer(only) : VX.line,
  }
}

/** The payers Weekly volume stacks, as the `{ id, title }` pairs it draws (the ones with data show). */
export const exploreVolumePayers = (
  payers: readonly PayerValue[],
): { id: PayerValue; title: string }[] => payers.map((id) => ({ id, title: PAYER_LABELS[id] }))

/**
 * The period "What stands out" reads for the page Range: 7, 30 and 90 days as they are (compared with the
 * equally long window before), `all` has no prior window and reads 90 days. `title` always names the window used.
 */
export function insightsPeriodOf(range: Range): { period: InsightsPeriod; title: string } {
  const period: InsightsPeriod = range === 'all' ? '90d' : range
  return { period, title: `${period.slice(0, -1)} d` }
}
