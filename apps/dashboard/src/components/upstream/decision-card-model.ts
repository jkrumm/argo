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

// ── Card interior: question, facts, evidence line ───────────────────────────────────────────

/** A question longer than this reads as prose, not a title. */
export const QUESTION_MAX = 80
/** A card carries the entity plus two or three facts, not a record. */
export const FACTS_MAX = 3
/** The evidence line is the lead of the reason; the full text sits behind the disclosure. */
export const EVIDENCE_LINE_MAX = 140

/** The first {@link FACTS_MAX} non-blank facts. */
export function capFacts(facts: readonly DecisionCardFact[]): DecisionCardFact[] {
  return visibleFacts(facts)
    .slice(0, FACTS_MAX)
    .map((fact) => (fact.tone === undefined ? fact.text : { text: fact.text, tone: fact.tone }))
}

/** `text` cut at the last word boundary within `max` characters, with an ellipsis; whole if it fits. */
export function leadOf(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`
}

/** `Decide on <title>?`: the short question for an ask whose own first sentence is prose. */
export function decideQuestion(title: string): string {
  return `Decide on ${title.trim().replace(/[.!?…:;,]+$/, '')}?`
}

export type CardCopy = {
  /** Short enough to be a title: the ask's first sentence, or `Decide on <title>?` when that is prose. */
  question: string
  /** One line of evidence, the lead of the reason; `null` when there is none. */
  evidenceLine: string | null
  /** The whole ask/reason, only when the evidence line had to shorten it (the disclosure content). */
  detail: string | null
  /** The question was rebuilt from the title, so the title must not also repeat as a kicker. */
  fromTitle: boolean
}

/**
 * The text of a decision card's interior. `question` is the ask's first sentence, `body` what
 * follows it; `title` (the entity) replaces a question longer than {@link QUESTION_MAX} and the
 * long sentence moves into the body, so nothing is cut and nothing is lost.
 */
export function cardCopy({
  question,
  body,
  title,
}: {
  question: string
  body: string | null
  title?: string | null | undefined
}): CardCopy {
  const entity = title?.trim() ?? ''
  const long = question.length > QUESTION_MAX && entity !== ''
  const text = (long ? [question, body] : [body])
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const lead = text === '' ? null : leadOf(text, EVIDENCE_LINE_MAX)
  return {
    question: long ? decideQuestion(entity) : question,
    evidenceLine: lead,
    detail: lead !== null && lead !== text ? text : null,
    fromTitle: long,
  }
}
