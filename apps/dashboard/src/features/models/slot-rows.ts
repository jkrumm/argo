/** The slots of the models page: the agw routes grouped by model and effort, each with its variant and verdict. */
import type { EfficiencyRoute, EfficiencyVariant } from './api/types'
import {
  groupSlots,
  lineageOfModel,
  variantLabel,
  verdictOf,
  type SlotGroup,
  type Verdict,
} from './model'

export interface SlotRow {
  key: string
  group: SlotGroup
  variant: EfficiencyVariant | null
  /** `GPT-9.1 Vega medium`; a slot with no variant takes the lineage's name, else the raw model id. */
  name: string
  verdict: Verdict | null
}

/** The slots with their variants and verdicts; `visible` is the set a verdict compares against. */
export function slotRows(
  routes: readonly EfficiencyRoute[],
  variants: readonly EfficiencyVariant[],
  visible: readonly EfficiencyVariant[],
  display: (lineage: string) => string,
): SlotRow[] {
  const bySlug = new Map(variants.map((v) => [v.slug, v]))
  return groupSlots(routes).map((group) => {
    const variant = group.variantSlug === null ? null : (bySlug.get(group.variantSlug) ?? null)
    return {
      key: group.key,
      group,
      variant,
      name:
        variant === null ? unmatchedName(group, variants, display) : variantLabel(variant, display),
      verdict: variant === null ? null : verdictOf(variant, visible),
    }
  })
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

const clause = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/**
 * The page's headline over the slots: every slot is accounted for, so "3 are beaten" is never left with
 * a fifth slot unexplained. Empty when there are no slots.
 */
export function slotSummary(rows: readonly SlotRow[]): string {
  if (rows.length === 0) return ''
  const count = (pick: (row: SlotRow) => boolean): number => rows.filter(pick).length
  const kind = (row: SlotRow, wanted: Verdict['kind']): boolean => row.verdict?.kind === wanted
  const parts = [
    [
      count((r) => kind(r, 'beaten')),
      'is beaten by a callable variant',
      'are beaten by a callable variant',
    ],
    [count((r) => kind(r, 'frontier')), 'sits on the frontier', 'sit on the frontier'],
    [count((r) => kind(r, 'near')), 'is near the frontier', 'are near the frontier'],
    [count((r) => r.variant === null), 'has no benchmark row', 'have no benchmark row'],
    [count((r) => kind(r, 'unscored')), 'has no measured cost', 'have no measured cost'],
  ] as const
  const clauses = parts.filter(([n]) => n > 0).map(([n, one, many]) => clause(n, one, many))
  const joined =
    clauses.length > 1
      ? `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}`
      : (clauses[0] ?? '')
  return `Of your ${rows.length} ${rows.length === 1 ? 'slot' : 'slots'}, ${joined}.`
}
