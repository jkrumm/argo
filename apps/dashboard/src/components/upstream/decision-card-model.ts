import type { ReactNode } from 'react'

export type DecisionCardAction = {
  label: string
  /** Stable React key for menu items; defaults to `label`. */
  key?: string
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
}

/** Joins the non-empty facts with the `·` separator the card's facts line uses. */
export function factsLine(facts: readonly string[]): string {
  return facts
    .map((fact) => fact.trim())
    .filter((fact) => fact !== '')
    .join(' · ')
}

/** True when the card has any action row content (primary, secondary or a non-empty menu). */
export function hasActions(
  primary: DecisionCardAction | undefined,
  secondary: DecisionCardAction | undefined,
  menu: readonly DecisionCardAction[] | undefined,
): boolean {
  return primary !== undefined || secondary !== undefined || (menu?.length ?? 0) > 0
}

/** A busy or disabled action takes no clicks — one rule for both the button and the menu item. */
export function isInactive(action: DecisionCardAction): boolean {
  return (action.disabled ?? false) || (action.loading ?? false)
}
