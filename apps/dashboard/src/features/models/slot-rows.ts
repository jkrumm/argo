/**
 * The slots of the models page: the agw routes grouped by model and effort, each with its variant, its
 * efficiency index and the leanest alternative on Max and anywhere. The pools come from ALL variants,
 * never the filtered set, so a filter cannot change a recommendation.
 */
import type { EfficiencyRoute, EfficiencyVariant } from './api/types'
import {
  creatorKey,
  groupSlots,
  leanestAlternative,
  lineageOfModel,
  variantLabel,
  type Alternative,
  type SlotGroup,
} from './model'

/** What a slot's alternative cell says: nothing applies, nothing is leaner, or a leaner variant. */
export type Option = { kind: 'na' } | { kind: 'leanest' } | ({ kind: 'better' } & Alternative)

export interface SlotRow {
  key: string
  group: SlotGroup
  variant: EfficiencyVariant | null
  /** `GPT-9.1 Vega medium`; a slot with no variant takes the lineage's name, else the raw model id. */
  name: string
  /** A route bills today: `mixed` counts, a slot that spends money is read as a deliberate seat. */
  billed: boolean
  index: number | null
  /** The leanest Claude variant: a move that stays on the free Max quota. */
  onMax: Option
  /** The leanest callable or Claude variant; for a billed slot it excludes Anthropic. */
  anywhere: Option
}

const NA: Option = { kind: 'na' }

const optionOf = (found: Alternative | null): Option =>
  found === null ? { kind: 'leanest' } : { kind: 'better', ...found }

/** The slots, billed ones first (those spend money), then the busiest; `variants` is the whole response. */
export function slotRows(
  routes: readonly EfficiencyRoute[],
  variants: readonly EfficiencyVariant[],
  indexes: ReadonlyMap<string, number>,
  display: (lineage: string) => string,
): SlotRow[] {
  const bySlug = new Map(variants.map((v) => [v.slug, v]))
  const maxPool = variants.filter((v) => creatorKey(v.creator) === 'anthropic')
  const callable = variants.filter((v) => v.iu.accessible)
  const billedPool = callable.filter((v) => creatorKey(v.creator) !== 'anthropic')
  const quotaPool = [...new Set([...callable, ...maxPool])]
  const rows = groupSlots(routes).map<SlotRow>((group) => {
    const variant = group.variantSlug === null ? null : (bySlug.get(group.variantSlug) ?? null)
    const billed = group.access !== 'subscription'
    const name =
      variant === null ? unmatchedName(group, variants, display) : variantLabel(variant, display)
    const index = variant === null ? undefined : indexes.get(variant.slug)
    // Without an index nothing was compared, so the row must not read as "already leanest".
    if (variant === null || index === undefined) {
      return { key: group.key, group, variant, name, billed, index: null, onMax: NA, anywhere: NA }
    }
    return {
      key: group.key,
      group,
      variant,
      name,
      billed,
      index,
      onMax: billed ? NA : optionOf(leanestAlternative(variant, maxPool, indexes)),
      anywhere: optionOf(leanestAlternative(variant, billed ? billedPool : quotaPool, indexes)),
    }
  })
  // groupSlots already orders by route count, and the sort is stable.
  return rows.toSorted((a, b) => Number(b.billed) - Number(a.billed))
}

function unmatchedName(
  group: SlotGroup,
  variants: readonly EfficiencyVariant[],
  display: (lineage: string) => string,
): string {
  const lineage = lineageOfModel(group.model, variants)
  const name = lineage === null ? group.model : display(lineage)
  return `${name}${group.effort === null ? '' : ` ${group.effort}`}`
}

const betterAnywhere = (row: SlotRow): boolean => row.anywhere.kind === 'better'

/**
 * The page's headline over the slots: how many run on Max quota and how many bill, which billed slots
 * have a leaner option and which quota slots could go leaner on Max. Slots with no efficiency index are
 * counted and nothing is claimed about them. Empty when there are no slots.
 */
export function slotSummary(rows: readonly SlotRow[]): string {
  if (rows.length === 0) return ''
  const noun = (n: number, one: string, many: string): string => (n === 1 ? one : many)
  const billed = rows.filter((r) => r.billed)
  const quota = rows.filter((r) => !r.billed)
  const head = [
    quota.length > 0 ? `${quota.length} on Max quota` : null,
    billed.length > 0 ? `${billed.length} billed` : null,
  ].filter((part) => part !== null)
  const sentences = [
    `Your ${rows.length} ${noun(rows.length, 'slot', 'slots')}: ${head.join(', ')}.`,
  ]

  const unbenchmarked = rows.filter((r) => r.index === null).length
  if (unbenchmarked < rows.length) {
    const billedLeaner = billed.filter(betterAnywhere).length
    const quotaLeaner = quota.filter((r) => r.onMax.kind === 'better').length
    const clauses = [
      billedLeaner > 0
        ? `${billedLeaner} billed ${noun(billedLeaner, 'slot has', 'slots have')} a leaner option`
        : null,
      quotaLeaner > 0
        ? `${quotaLeaner} quota ${noun(quotaLeaner, 'slot', 'slots')} could go leaner on Max`
        : null,
    ].filter((clause) => clause !== null)
    sentences.push(clauses.length > 0 ? `${clauses.join('; ')}.` : 'Nothing leaner to move to.')
  }
  if (unbenchmarked > 0) {
    sentences.push(`${unbenchmarked} ${noun(unbenchmarked, 'has', 'have')} no efficiency data.`)
  }
  return sentences.join(' ')
}
