import { flatten, stripShortcodes } from './text'
import type { WardenActionVerb } from './queries/warden'

// THE question rule for every decision surface (Agents, Warden, Home): one ladder, one place.
// Pure and React-free. The card's presentational model stays in components/upstream.

/** A question longer than this reads as prose, not a title. */
export const QUESTION_MAX = 80
/** The evidence line is the lead of the reason; the full text sits behind the disclosure. */
export const EVIDENCE_LINE_MAX = 140
/** A title longer than this does not sit on the entity line; it moves, whole, into the disclosure. */
export const ENTITY_MAX = 120

const NEUTRAL_QUESTION = 'Decide on this item?'

/** `text` cut at the last word boundary within `max` characters, with an ellipsis; whole if it fits. */
export function leadOf(text: string, max: number): string {
  const flat = flatten(text)
  if (flat.length <= max) return flat
  const head = flat.slice(0, max)
  const lastSpace = head.lastIndexOf(' ')
  const atWord = lastSpace > max / 2
  const kept = atWord ? head.slice(0, lastSpace) : head.slice(0, max - 1)
  const withoutTail = kept.replace(/[\s,;:.\-–—]+$/, '')
  return `${withoutTail}…`
}

/** A title without its trailing punctuation: the form a question is compared against. */
const bareTitle = (title: string): string => flatten(title).replace(/[.!?…:;,]+$/, '')

/** A URL with the words that introduce it, or the whole `(see https://…)` it sits in. */
const BRACKETED_URL = /\s*[([]\s*(?:(?:see|at|in|via|on)\s+)?https?:\/\/[^\s)\]]*[)\]]/gi
const BARE_URL = /\s*(?:\b(?:see|at|in|via|on)\s+)?\bhttps?:\/\/[^\s)\]]*/gi

/** Appends the closers a removal left unmatched, so no `(` or `[` dangles. */
function closeBrackets(text: string): string {
  const count = (re: RegExp) => (text.match(re) ?? []).length
  const missingParens = Math.max(0, count(/\(/g) - count(/\)/g))
  const missingSquares = Math.max(0, count(/\[/g) - count(/\]/g))
  if (missingParens === 0 && missingSquares === 0) return text
  return `${text.replace(/[\s,;:]+$/, '')}${']'.repeat(missingSquares)}${')'.repeat(missingParens)}`
}

/** Removes raw URLs; a bracket left open by the removal is closed, never dangling. */
function withoutUrls(sentence: string): string {
  return closeBrackets(flatten(sentence.replace(BRACKETED_URL, '').replace(BARE_URL, '')))
}

/** The sentences of a text, each with its closing punctuation. */
const sentencesOf = (text: string): string[] =>
  flatten(text)
    .split(/(?<=[.!?])\s+/)
    .filter((part) => part !== '')

/**
 * One line of evidence from a reason: statements only (a second question never repeats the title's),
 * raw URLs removed (the whole reason keeps them), cut at a word boundary when long.
 */
function evidenceLeadOf(text: string, keepQuestions: boolean): string | null {
  const cleaned = sentencesOf(text)
    .map(withoutUrls)
    .filter((sentence) => sentence !== '' && !/^[\s.,;:\-–—()[\]]+$/.test(sentence))
  const statements = cleaned.filter((sentence) => !sentence.endsWith('?'))
  // Evidence that is itself a question (an agent's blocker) is still the evidence when it is all there is.
  const lines = statements.length > 0 || !keepQuestions ? statements : cleaned
  if (lines.length === 0) return null
  return leadOf(lines.join(' '), EVIDENCE_LINE_MAX)
}

/** `<verb> <object>?`, never longer than {@link QUESTION_MAX} and never losing its `?`. */
export function plainQuestion(verb: string, object: string): string {
  return boundedQuestion(`${verb} ${object}`)
}

/** A caller-built plain question: bounded, never empty, always ending in `?`. */
function boundedQuestion(question: string): string {
  const stem = flatten(question).replace(/[?\s]+$/, '')
  if (stem === '') return NEUTRAL_QUESTION
  return `${stem.length > QUESTION_MAX - 1 ? leadOf(stem, QUESTION_MAX - 1) : stem}?`
}

export type CardCopySource = 'authored' | 'ask' | 'title' | 'plain'

export type CardCopy = {
  /** At most {@link QUESTION_MAX} characters, ends in `?` unless authored; never empty. */
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
 * The question rule. In order:
 *  1. `authored` — the question the producer wrote, verbatim, when it fits {@link QUESTION_MAX};
 *     an over-long one is never cut into a fragment, it falls through and its full text goes to the detail;
 *  2. `ask` — the item's own first sentence, when it already is a question that fits;
 *  3. `title` — when the title itself is a question that fits;
 *  4. `plain` — a short question from the item's kind and state (`Merge {repo} PR?`), with the raw
 *     title moved to the entity line, whole. A verb is never glued onto a raw title.
 * Whatever did not become the question (`body`, a statement `ask`, a long authored question) is the
 * evidence line / detail.
 */
export function cardCopy({
  authored,
  ask = '',
  body = null,
  title,
  plain = NEUTRAL_QUESTION,
  keepQuestionEvidence = false,
}: {
  authored?: string | null | undefined
  ask?: string
  body?: string | null
  title?: string | null | undefined
  plain?: string
  /** Show the body as the evidence line even when it is only questions (an agent's blocker). */
  keepQuestionEvidence?: boolean
}): CardCopy {
  const written = flatten(authored ?? '')
  const sentence = flatten(ask)
  const item = flatten(title ?? '')
  const isQuestion = (text: string) => text.endsWith('?') && text.length <= QUESTION_MAX

  let source: CardCopySource
  let question: string
  if (written !== '' && written.length <= QUESTION_MAX) {
    source = 'authored'
    question = written
  } else if (isQuestion(sentence)) {
    source = 'ask'
    question = sentence
  } else if (isQuestion(item)) {
    source = 'title'
    question = item
  } else {
    source = 'plain'
    question = boundedQuestion(plain)
  }

  const spill = written.length > QUESTION_MAX ? written : ''
  const used = source === 'ask' ? '' : sentence
  const text = [spill, used, body ?? '']
    .map(flatten)
    .filter((part) => part !== '')
    .join(' ')
  const showsTitle =
    source === 'title' || bareTitle(question).toLowerCase() === bareTitle(item).toLowerCase()
  const entityFits = item !== '' && !showsTitle && item.length <= ENTITY_MAX
  const evidenceLine = text === '' ? null : evidenceLeadOf(text, keepQuestionEvidence)
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

// ── Warden ───────────────────────────────────────────────────────────────────────────────────

/** The plain question per primary verb: `[verb, noun]`, read as `<verb> <repo> <noun>?`. */
const WARDEN_PLAIN: Partial<Record<WardenActionVerb, readonly [verb: string, noun: string]>> = {
  merge: ['Merge', 'PR'],
  implement: ['Implement', 'change'],
  reinvestigate: ['Reinvestigate', 'item'],
  retry: ['Retry', 'item'],
}

/**
 * The plain question of a Warden item from the verb its card offers first: `Merge {repo} PR?`.
 * `Retry failed {repo} run?` only for a failed item whose primary is retry; any other verb (or none)
 * is neutral, so a question never promises an action the card does not carry.
 */
export function wardenPlainQuestion({
  failed,
  repo,
  primary,
}: {
  failed: boolean
  repo: string | null
  primary: WardenActionVerb | null
}): string {
  const where = stripShortcodes(repo ?? '')
  const entry = primary === null ? undefined : WARDEN_PLAIN[primary]
  if (entry === undefined)
    return plainQuestion('Decide on', where === '' ? 'this item' : `${where} item`)
  const [verb, noun] = entry
  if (primary === 'retry' && failed)
    return plainQuestion(verb, where === '' ? 'failed run' : `failed ${where} run`)
  return plainQuestion(verb, where === '' ? `this ${noun}` : `${where} ${noun}`)
}
