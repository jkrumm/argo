import { asText, flatten, leadClauses, stripShortcodes } from './text'
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

/** Room a handle needs to be worth printing: the stem, `: `, the handle and the `?` must fit. */
const HANDLE_MIN = 10

/** How much of an item tells it apart: its first `clauses` clauses, then an ordinal among the still-identical. */
export type Disambiguation = { clauses: number; ordinal: number | null }

/** `text` cut at a word boundary within `max` characters, ellipsis added; `null` when no whole word fits. */
function wordLead(text: string, max: number): string | null {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  const head = (space === -1 ? '' : cut.slice(0, space)).replace(/[\s,;:.\-–—]+$/, '')
  return head === '' ? null : `${head}…`
}

/**
 * `<stem>: <handle> (<n>)?` — the plain question with the item's own handle: the first
 * `disambiguation.clauses` clauses of `source`, cut at a word, then ` (n)` when clauses alone left two
 * items identical. Bounded to {@link QUESTION_MAX} with the `?` kept; the plain question unchanged
 * when nothing fits (no whole word, no room). `handled` says whether the question changed.
 */
function withHandle(
  plain: string,
  source: string,
  { clauses, ordinal }: Disambiguation,
): { question: string; handled: boolean } {
  const stem = flatten(plain).replace(/[?\s]+$/, '')
  const tail = ordinal === null ? '' : ` (${ordinal})`
  const room = QUESTION_MAX - 1 - stem.length - 2 - tail.length
  const cut = room < HANDLE_MIN ? null : wordLead(leadClauses(source, clauses), room)
  // A handle with no letter or digit in it names nothing.
  const lead = cut !== null && /[\p{L}\p{N}]/u.test(cut) ? cut : null
  if (lead === null && ordinal === null) return { question: boundedQuestion(plain), handled: false }
  const body = lead === null ? `${stem}${tail}` : `${stem}: ${lead}${tail}`
  return { question: boundedQuestion(body), handled: true }
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
 *     title moved to the entity line, whole. A verb is never glued onto a raw title. When `handle`
 *     is set the question carries the item's own short handle (`Merge {repo} PR: {handle}?`) and the
 *     entity line is dropped: the title is said by the question, or whole in the detail.
 * Whatever did not become the question (`body`, a statement `ask`, a long authored question) is the
 * evidence line / detail.
 */
export function cardCopy({
  authored,
  ask = '',
  body = null,
  title,
  plain = NEUTRAL_QUESTION,
  handle = null,
  keepQuestionEvidence = false,
}: {
  authored?: string | null | undefined
  ask?: string
  body?: string | null
  title?: string | null | undefined
  plain?: string
  /**
   * Set only for an item whose plain question another card on the same surface would repeat:
   * `source` is the text the handle is taken from (the title, or the ask when there is no title).
   */
  handle?: ({ source: string } & Disambiguation) | null
  /** Show the body as the evidence line even when it is only questions (an agent's blocker). */
  keepQuestionEvidence?: boolean
}): CardCopy {
  const written = flatten(authored ?? '')
  const sentence = flatten(ask)
  const item = flatten(title ?? '')
  const isQuestion = (text: string) => text.endsWith('?') && text.length <= QUESTION_MAX

  let source: CardCopySource
  let question: string
  let carriesHandle = false
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
    const handled = handle === null ? null : withHandle(plain, handle.source, handle)
    question = handled?.handled ? handled.question : boundedQuestion(plain)
    carriesHandle = handled?.handled === true
  }

  const spill = written.length > QUESTION_MAX ? written : ''
  const used = source === 'ask' ? '' : sentence
  const text = [spill, used, body ?? '']
    .map(flatten)
    .filter((part) => part !== '')
    .join(' ')
  const saidTitle = bareTitle(item).toLowerCase()
  const showsTitle =
    source === 'title' ||
    bareTitle(question).toLowerCase() === saidTitle ||
    // A handle that carries the whole title says it; a cut one leaves the whole title to the detail.
    (carriesHandle && saidTitle !== '' && question.toLowerCase().includes(saidTitle))
  const entityFits = item !== '' && !showsTitle && !carriesHandle && item.length <= ENTITY_MAX
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

/**
 * The cards of one surface whose question another card repeats, flagged in input order. Only the
 * plain rung is a candidate: an authored, ask or title question already belongs to its item.
 */
export function collidingCopies(
  copies: readonly Pick<CardCopy, 'question' | 'source'>[],
): boolean[] {
  const count = new Map<string, number>()
  for (const { question } of copies) {
    const key = question.toLowerCase()
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  return copies.map(
    ({ source, question }) => source === 'plain' && (count.get(question.toLowerCase()) ?? 0) > 1,
  )
}

/** Each step takes more of the title; the last takes all of it. */
const LADDER: readonly number[] = [1, 2, Infinity]

/**
 * The copy of every card on ONE surface (the page or inbox the owner reads together: Home needs-you
 * across all its sources, the Warden page across needs-you and failed, Agents needs-you — never
 * app-wide). A card keeps its short plain question unless another card of the surface reads the
 * same; then it derives again with its handle, and the whole surface is re-checked after each step:
 * first clause, two clauses, the whole title, and for items still identical an ordinal in `key`
 * order, so the result is distinct for any input and stable across refreshes.
 */
export function resolveCopies<T, R extends { copy: CardCopy }>(
  items: readonly T[],
  {
    derive,
    key,
  }: {
    derive: (item: T, options: { handle: Disambiguation | null }) => R
    key: (item: T) => string
  },
): R[] {
  const results = items.map((item) => derive(item, { handle: null }))
  const reDerive = (flags: readonly boolean[], handleFor: (index: number) => Disambiguation) =>
    flags.forEach((flag, i) => {
      if (flag) results[i] = derive(items[i]!, { handle: handleFor(i) })
    })
  const clashes = () => collidingCopies(results.map((r) => r.copy))
  let last: Disambiguation = { clauses: 1, ordinal: null }
  for (const clauses of LADDER) {
    const flags = clashes()
    if (!flags.some(Boolean)) return results
    last = { clauses, ordinal: null }
    reDerive(flags, () => last)
  }
  const flags = clashes()
  const groups = new Map<string, number[]>()
  flags.forEach((flag, i) => {
    if (!flag) return
    const question = results[i]!.copy.question.toLowerCase()
    groups.set(question, [...(groups.get(question) ?? []), i])
  })
  for (const indices of groups.values()) {
    indices
      .toSorted((a, b) => key(items[a]!).localeCompare(key(items[b]!)))
      .forEach((index, rank) => {
        results[index] = derive(items[index]!, { handle: { ...last, ordinal: rank + 1 } })
      })
  }
  return results
}

// ── Warden ───────────────────────────────────────────────────────────────────────────────────

/** The plain question per primary verb: `[verb, noun]`, read as `<verb> <repo> <noun>?`. */
const WARDEN_PLAIN: Partial<Record<WardenActionVerb, readonly [verb: string, noun: string]>> = {
  merge: ['Merge', 'PR'],
  implement: ['Implement', 'change'],
  reinvestigate: ['Reinvestigate', 'item'],
  retry: ['Retry', 'item'],
}

/** What an alert asks for per primary verb: the verb the card's button carries, the noun is the alert. */
const ALERT_PLAIN: Record<WardenActionVerb, string> = {
  implement: 'Handle',
  merge: 'Merge',
  reinvestigate: 'Reinvestigate',
  retry: 'Retry',
  dismiss: 'Dismiss',
  note: 'Add a note to',
}

const ALERT_WORD = /^(?:alert|incident|outage)s?$/i
/** A title that leads with the kind (`Alert: …`, `Outage — …`): the fallback when no field names it. */
const ALERT_TITLE_PREFIX = /^\W*(?:alert|incident|outage)s?\s*[:\-–—]/i

/**
 * Whether an item is an alert, incident or outage. The first explicit kind field (`origin`, `kind`,
 * `type`) decides — a `github_issue` titled `Alert: …` is an issue; only with no field at all does a
 * title that leads with the kind count.
 */
export function isAlert({
  kinds = [],
  title,
}: {
  kinds?: readonly unknown[]
  title?: unknown
}): boolean {
  const explicit = kinds.map((k) => asText(k).trim()).find((k) => k !== '')
  if (explicit !== undefined) return ALERT_WORD.test(explicit)
  return ALERT_TITLE_PREFIX.test(stripShortcodes(asText(title)))
}

/**
 * The plain question of a Warden item from the verb its card offers first: `Merge {repo} PR?`.
 * `Retry failed {repo} run?` only for a failed item whose primary is retry; any other verb (or none)
 * is neutral, so a question never promises an action the card does not carry. An `alert` is asked
 * about as an alert in the verb its button carries (`Handle {repo} alert?`, `Dismiss …`), never as a
 * change; with no verb it is neutral (`Decide on {repo} alert?`).
 */
export function wardenPlainQuestion({
  failed,
  repo,
  primary,
  alert = false,
}: {
  failed: boolean
  repo: string | null
  primary: WardenActionVerb | null
  alert?: boolean
}): string {
  const where = stripShortcodes(asText(repo))
  if (alert) {
    const verb = primary === null ? 'Decide on' : ALERT_PLAIN[primary]
    return plainQuestion(verb, where === '' ? 'this alert' : `${where} alert`)
  }
  const entry = primary === null ? undefined : WARDEN_PLAIN[primary]
  if (entry === undefined)
    return plainQuestion('Decide on', where === '' ? 'this item' : `${where} item`)
  const [verb, noun] = entry
  if (primary === 'retry' && failed)
    return plainQuestion(verb, where === '' ? 'failed run' : `failed ${where} run`)
  return plainQuestion(verb, where === '' ? `this ${noun}` : `${where} ${noun}`)
}
