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

/** A title without its trailing punctuation: the form a question is compared against. */
const bareTitle = (title: string): string => flatten(title).replace(/[.!?…:;,]+$/, '')

/** A title longer than this does not sit on the entity line; it moves, whole, into the disclosure. */
export const ENTITY_MAX = 120

const URL_IN_TEXT = /\s*(?:\b(?:see|at|in|via|on)\s+)?\bhttps?:\/\/\S+/gi

/** The sentences of a text, each with its closing punctuation. */
const sentencesOf = (text: string): string[] =>
  flatten(text)
    .split(/(?<=[.!?])\s+/)
    .filter((part) => part !== '')

/**
 * One line of evidence from a reason: statements only (a second question never repeats the title's),
 * raw URLs removed (the whole reason keeps them), cut at a word boundary when long.
 */
function evidenceLeadOf(text: string): string | null {
  const statements = sentencesOf(text)
    .filter((sentence) => !sentence.endsWith('?'))
    .map((sentence) => flatten(sentence.replace(URL_IN_TEXT, '')))
    .filter((sentence) => sentence !== '' && !/^[\s.,;:\-–—]+$/.test(sentence))
  if (statements.length === 0) return null
  return leadOf(statements.join(' '), EVIDENCE_LINE_MAX)
}

/** The plain question a card falls back to: `<verb> <object>?`, e.g. `Merge {repo} PR?`. */
export const plainQuestion = (verb: string, object: string): string => `${verb} ${flatten(object)}?`

export type CardCopySource = 'authored' | 'ask' | 'title' | 'plain'

export type CardCopy = {
  /** At most {@link QUESTION_MAX} characters, never empty. */
  question: string
  /** The raw title when the question does not already say it; whole, `null` past {@link ENTITY_MAX} (it sits in `detail`). */
  entity: string | null
  /** One line of evidence, statements only, no raw URL; `null` when there is none. */
  evidenceLine: string | null
  /** The whole ask/reason (and an over-long title), only when the evidence line did not show all of it. */
  detail: string | null
  /** Which rung of the rule produced the question. */
  source: CardCopySource
}

/**
 * THE question rule — every decision surface (Agents, Warden, Home) derives its title here.
 * In order:
 *  1. `authored` — the question the producer wrote, verbatim (flattened; capped at {@link QUESTION_MAX}
 *     with the cut text kept in the evidence);
 *  2. `ask` — the item's own first sentence, when it already is a question that fits;
 *  3. `title` — when the title itself is a question that fits;
 *  4. `plain` — a short question from the item's kind and state (`Merge {repo} PR?`), with the raw
 *     title moved to the entity line, whole. A verb is never glued onto a raw title.
 * `body` and a `ask` that was not the question become the evidence line / detail.
 */
export function cardCopy({
  authored,
  ask = '',
  body = null,
  title,
  plain = 'Decide on this item?',
}: {
  authored?: string | null | undefined
  ask?: string
  body?: string | null
  title?: string | null | undefined
  plain?: string
}): CardCopy {
  const written = flatten(authored ?? '')
  const sentence = flatten(ask)
  const item = flatten(title ?? '')
  const isQuestion = (text: string) => text.endsWith('?') && text.length <= QUESTION_MAX

  let source: CardCopySource
  let question: string
  let spill = ''
  if (written !== '') {
    source = 'authored'
    question = written.length <= QUESTION_MAX ? written : leadOf(written, QUESTION_MAX)
    if (written.length > QUESTION_MAX) spill = written
  } else if (isQuestion(sentence)) {
    source = 'ask'
    question = sentence
  } else if (isQuestion(item)) {
    source = 'title'
    question = item
  } else {
    source = 'plain'
    question = flatten(plain)
  }

  const used = source === 'ask' ? '' : sentence
  const lead = [spill, used, body ?? ''].map(flatten).filter((part) => part !== '')
  const text = lead.join(' ')
  const showsTitle =
    source === 'title' || bareTitle(question).toLowerCase() === bareTitle(item).toLowerCase()
  const entityFits = item !== '' && !showsTitle && item.length <= ENTITY_MAX
  const evidenceLine = text === '' ? null : evidenceLeadOf(text)
  const whole = [item !== '' && !showsTitle && !entityFits ? item : '', text]
    .filter((part) => part !== '')
    .join(' ')
  return {
    question,
    entity: entityFits ? item : null,
    evidenceLine,
    detail: whole !== '' && whole !== evidenceLine ? whole : null,
    source,
  }
}
