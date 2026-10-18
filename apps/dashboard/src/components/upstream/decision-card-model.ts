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
const FACTS_MAX = 3
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
  return `${(space > max / 2 ? cut.slice(0, space) : cut.slice(0, max - 1)).replace(/[\s,;:.\-–—]+$/, '')}…`
}

const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** A title without its trailing punctuation: the form a question is compared and built from. */
const bareTitle = (title: string): string => flatten(title).replace(/[.!?…:;,]+$/, '')

/**
 * `<verb> <title>?`, never longer than {@link QUESTION_MAX}: the verb, the space, the `?` and the
 * title's ellipsis are all inside the budget, and only the title is shortened (at a word boundary).
 */
export function titleQuestion(verb: string, title: string): string {
  const clean = bareTitle(title)
  const room = QUESTION_MAX - verb.length - 2
  return `${verb} ${clean.length > room ? leadOf(clean, room) : clean}?`
}

/** A title that is already a question stays one (bounded); anything else becomes `<verb> <title>?`. */
function asQuestion(verb: string, title: string): string {
  const flat = flatten(title)
  if (!flat.endsWith('?')) return titleQuestion(verb, flat)
  return flat.length <= QUESTION_MAX ? flat : `${leadOf(flat.slice(0, -1), QUESTION_MAX - 1)}?`
}

export type CardCopy = {
  /** At most {@link QUESTION_MAX} characters, never empty: the ask's first sentence, else a question built from the title. */
  question: string
  /** The item the question is about, when the question does not already name it; else `null`. */
  entity: string | null
  /** One line of evidence, the lead of the reason; `null` when there is none. */
  evidenceLine: string | null
  /** The whole ask/reason, only when the evidence line had to shorten it (the disclosure content). */
  detail: string | null
  /** The question was rebuilt from the title, so the title must not also repeat as a kicker. */
  fromTitle: boolean
}

/**
 * The text of a decision card's interior. `question` is the ask's first sentence, `body` what
 * follows it. A question over {@link QUESTION_MAX} is replaced by the `title` as a question
 * (itself when it already is one, else `<verb> <title>?`), or, with no title, shortened to its lead;
 * the long sentence moves into the body, so nothing is cut and nothing is lost. A blank question
 * is built from the title too. `named` says the caller built `question` from the title already.
 */
export function cardCopy({
  question,
  body,
  title,
  verb = 'Approve',
  named = false,
}: {
  question: string
  body: string | null
  title?: string | null | undefined
  verb?: string
  named?: boolean
}): CardCopy {
  const ask = flatten(question)
  const item = flatten(title ?? '')
  const rebuild = item !== '' && (ask === '' || ask.length > QUESTION_MAX)
  const trim = ask.length > QUESTION_MAX && !rebuild
  const asked = rebuild
    ? asQuestion(verb, item)
    : trim
      ? leadOf(ask, QUESTION_MAX)
      : ask === ''
        ? 'Needs your decision'
        : ask
  const text = [rebuild || trim ? ask : '', body ?? '']
    .map(flatten)
    .filter((part) => part !== '')
    .join(' ')
  const lead = text === '' ? null : leadOf(text, EVIDENCE_LINE_MAX)
  const bare = bareTitle(item).toLowerCase()
  return {
    question: asked,
    entity: item === '' || rebuild || named || bareTitle(ask).toLowerCase() === bare ? null : item,
    evidenceLine: lead,
    detail: lead !== null && lead !== text ? text : null,
    fromTitle: rebuild,
  }
}
