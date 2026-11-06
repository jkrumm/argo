/** The slots of the models page: the agw routes grouped by model and effort, each with its variant and verdict. */
import type { EfficiencyRoute, EfficiencyVariant } from './api/types'
import { groupSlots, verdictOf, type SlotGroup, type Verdict } from './model'

export interface SlotRow {
  key: string
  group: SlotGroup
  variant: EfficiencyVariant | null
  /** `Terra medium`, or the raw model id when AA has no row. */
  name: string
  verdict: Verdict | null
}

/** The slots with their variants and verdicts; `visible` is the set a verdict compares against. */
export function slotRows(
  routes: readonly EfficiencyRoute[],
  variants: readonly EfficiencyVariant[],
  visible: readonly EfficiencyVariant[],
  names: (variant: EfficiencyVariant) => string,
): SlotRow[] {
  const bySlug = new Map(variants.map((v) => [v.slug, v]))
  return groupSlots(routes).map((group) => {
    const variant = group.variantSlug === null ? null : (bySlug.get(group.variantSlug) ?? null)
    return {
      key: group.key,
      group,
      variant,
      name:
        variant === null
          ? `${group.model}${group.effort === null ? '' : ` ${group.effort}`}`
          : names(variant),
      verdict: variant === null ? null : verdictOf(variant, visible),
    }
  })
}
