import type { LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/** True when a slot node would render something: not undefined, null, a boolean or an empty string. */
export function isRenderable(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== 'boolean' && node !== ''
}

export type DecisionCardAction = {
  label: string
  /** Stable React key for menu items; defaults to `label`. */
  key?: string
  /** Callback verb (copy, retry). Navigation verbs set `href` instead. */
  onClick?: () => void
  /** Navigation verb, rendered as a router link so middle- and cmd-click work. */
  href?: LinkProps['to']
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
}

/** A fact is plain text, or text with a status tone (an age past its limit, say). */
export type DecisionCardFact = string | { text: string; tone: 'warn' | 'bad' }

/** Normalises a fact to its trimmed text and tone; blank facts are dropped. */
export function visibleFacts(
  facts: readonly DecisionCardFact[],
): { text: string; tone: 'warn' | 'bad' | undefined }[] {
  return facts
    .map((fact) =>
      typeof fact === 'string'
        ? { text: fact.trim(), tone: undefined }
        : { text: fact.text.trim(), tone: fact.tone },
    )
    .filter((fact) => fact.text !== '')
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

// ── Card interior: facts ────────────────────────────────────────────────────────────────────

/** A card carries the entity plus two or three facts, not a record. */
const FACTS_MAX = 3

/** The first {@link FACTS_MAX} non-blank facts. */
export function capFacts(facts: readonly DecisionCardFact[]): DecisionCardFact[] {
  return visibleFacts(facts)
    .slice(0, FACTS_MAX)
    .map((fact) => (fact.tone === undefined ? fact.text : { text: fact.text, tone: fact.tone }))
}
