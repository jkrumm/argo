import {
  LEADING_BRACKET_TAGS,
  asText,
  firstBracketTag,
  flatten,
  lastWhitespace,
  leadClauses,
  stripShortcodes,
} from './text'
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
  const lastSpace = lastWhitespace(head)
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
export type Disambiguation = {
  clauses: number
  ordinal: number | null
  /** The stem shrinks to its verb (`Answer: {handle}?`): set when the shared stem repeats on every card. */
  terse?: boolean
}

const balanced = (text: string): boolean =>
  (text.match(/\(/g) ?? []).length === (text.match(/\)/g) ?? []).length &&
  (text.match(/\[/g) ?? []).length === (text.match(/\]/g) ?? []).length

/**
 * The longest whole-clause lead of `source` (at most `clauses` clauses) that fits `room`: never cut
 * inside a bracket or a word, no ellipsis. `null` when no whole clause fits or none names anything.
 */
function fittingLead(source: string, clauses: number, room: number): string | null {
  const rungs = [...new Set([clauses, 2, 1].filter((n) => n <= clauses))]
  for (const n of rungs) {
    const lead = leadClauses(source, n)
    // A handle with no letter or digit in it names nothing.
    if (lead.length <= room && /[\p{L}\p{N}]/u.test(lead) && balanced(lead)) return lead
  }
  return null
}

/** The pieces of a handled question, assembled in one place ({@link assemble}). */
export type QuestionParts = { stem: string; lead: string | null; ordinal: number | null }

/** `<stem>: <lead> (<n>)?`; a missing lead or ordinal leaves its part out. */
const assemble = ({ stem, lead, ordinal }: QuestionParts): string =>
  `${stem}${lead === null ? '' : `: ${lead}`}${ordinal === null ? '' : ` (${ordinal})`}?`

/**
 * The plain question with the item's own handle: the first `disambiguation.clauses` clauses of
 * `source` (a leading `[tag]` removed), whole, then ` (n)` when clauses alone left two items
 * identical. Bounded to {@link QUESTION_MAX} with the `?` kept; a handle that does not fit whole is
 * dropped (the ordinal rung takes over), never cut. `null` when nothing fits and there is no ordinal:
 * the plain question stands.
 */
function withHandle(
  plain: string,
  source: string,
  { clauses, ordinal, terse = false }: Disambiguation,
): QuestionParts | null {
  const tail = ordinal === null ? '' : ` (${ordinal})`
  // The tail's room is reserved before anything is cut, so an ordinal is never the part that goes.
  const stemMax = QUESTION_MAX - 1 - tail.length
  const whole = flatten(plain).replace(/[?\s]+$/, '')
  const full = whole.length > stemMax ? leadOf(whole, stemMax) : whole
  const stem = terse ? (full.split(' ')[0] ?? full) : full
  const room = stemMax - stem.length - 2
  const lead =
    room < HANDLE_MIN ? null : fittingLead(source.replace(LEADING_BRACKET_TAGS, ''), clauses, room)
  return lead === null && ordinal === null ? null : { stem, lead, ordinal }
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
  /** The handled question's pieces; `null` when the question carries no handle or ordinal. */
  parts: QuestionParts | null
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
  let parts: QuestionParts | null = null
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
    parts = handle === null ? null : withHandle(plain, handle.source, handle)
    question = parts === null ? boundedQuestion(plain) : assemble(parts)
    carriesHandle = parts !== null
  }

  const spill = written.length > QUESTION_MAX ? written : ''
  const used = source === 'ask' ? '' : sentence
  const joined = [spill, used, body ?? '']
    .map(flatten)
    .filter((part) => part !== '')
    .join(' ')
  // The handle is the opening words of the text: the question says them, the evidence does not repeat them.
  const text = parts?.lead == null ? joined : withoutLead(joined, parts.lead)
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
    parts,
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

/**
 * `text` without the repeated `lead` and the full stop after it, when it opens with it and the lead
 * ends a sentence. A leading `[tag]` run is a fact the question does not say, so it stays. A lead
 * that stops mid-sentence leaves the line as written: the remainder would be a fragment.
 */
function withoutLead(text: string, lead: string): string {
  const tags = LEADING_BRACKET_TAGS.exec(text)?.[0] ?? ''
  for (const prefix of tags === '' ? [''] : ['', tags]) {
    const body = text.slice(prefix.length)
    if (body.slice(0, lead.length).toLowerCase() !== lead.toLowerCase()) continue
    const rest = body.slice(lead.length)
    if (!/^\s*(?:[.!?]|$)/.test(rest)) return text
    return `${prefix}${rest.replace(/^[\s.!?]+/, '')}`.trim()
  }
  return text
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
    terseStem = false,
  }: {
    derive: (item: T, options: { handle: Disambiguation | null }) => R
    key: (item: T) => string
    /** Where a shared stem would head every card (`Answer this request: …`), keep only its verb. */
    terseStem?: boolean
  },
): R[] {
  const results = items.map((item) => derive(item, { handle: null }))
  const used: (Disambiguation | null)[] = items.map(() => null)
  const clashes = () => collidingCopies(results.map((r) => r.copy))
  const finish = (): R[] => (terseStem ? withTerseStems(items, results, used, derive) : results)
  let last: Disambiguation = { clauses: 1, ordinal: null }
  for (const clauses of LADDER) {
    const flags = clashes()
    if (!flags.some(Boolean)) return finish()
    last = { clauses, ordinal: null }
    flags.forEach((flag, i) => {
      if (!flag) return
      used[i] = last
      results[i] = derive(items[i]!, { handle: last })
    })
  }
  // Still identical: number them in key order. Each takes the lowest ordinal whose question no other
  // card on the surface already reads, so `Disk full`, `Disk full` and `Disk full (1)` stay distinct.
  const taken = new Set(results.map((r) => r.copy.question.toLowerCase()))
  const flags = clashes()
  const order = items
    .map((_, i) => i)
    .filter((i) => flags[i])
    .toSorted((a, b) => key(items[a]!).localeCompare(key(items[b]!)))
  for (const index of order) {
    const item = items[index]!
    // The first of an identical group keeps the question the others will be measured against.
    let ordinal = 1
    let next = derive(item, { handle: { ...last, ordinal } })
    while (taken.has(next.copy.question.toLowerCase()) && ordinal < items.length + 1) {
      ordinal += 1
      next = derive(item, { handle: { ...last, ordinal } })
    }
    taken.add(next.copy.question.toLowerCase())
    used[index] = { ...last, ordinal }
    results[index] = next
  }
  return finish()
}

/**
 * Cards that all open with the same stem before their handle (`Answer this request: …`) say it
 * once too often: those cards keep the verb alone. A card keeps its full stem when the terse form
 * lost its handle or reads the same as another card on the surface.
 */
function withTerseStems<T, R extends { copy: CardCopy }>(
  items: readonly T[],
  results: R[],
  used: readonly (Disambiguation | null)[],
  derive: (item: T, options: { handle: Disambiguation | null }) => R,
): R[] {
  const counts = new Map<string, number>()
  for (const { copy } of results) {
    const stem = copy.parts?.lead == null ? null : copy.parts.stem.toLowerCase()
    if (stem !== null) counts.set(stem, (counts.get(stem) ?? 0) + 1)
  }
  const terse = results.map((result, i) => {
    const handle = used[i]
    const stem = result.copy.parts?.lead == null ? null : result.copy.parts.stem.toLowerCase()
    if (handle == null || stem === null || (counts.get(stem) ?? 0) < 2) return null
    const next = derive(items[i]!, { handle: { ...handle, terse: true } })
    return next.copy.parts?.lead == null ? null : next
  })
  const merged = results.map((result, i) => terse[i] ?? result)
  const clashing = collidingCopies(merged.map((r) => r.copy))
  return merged.map((result, i) => (clashing[i] && terse[i] != null ? results[i]! : result))
}

// ── Warden ───────────────────────────────────────────────────────────────────────────────────

/** The plain question per primary verb: `[verb, noun]`, read as `<verb> <repo> <noun>?`. */
const WARDEN_PLAIN: Partial<Record<WardenActionVerb, readonly [verb: string, noun: string]>> = {
  merge: ['Merge', 'PR'],
  implement: ['Implement', 'change'],
  reinvestigate: ['Re-investigate', 'item'],
  retry: ['Retry', 'item'],
}

/** What an alert asks for per primary verb: the verb the card's button carries, then what it acts on. */
const ALERT_PLAIN: Record<WardenActionVerb, readonly [verb: string, object: string]> = {
  implement: ['Implement', 'fix for'],
  merge: ['Merge', 'fix for'],
  reinvestigate: ['Re-investigate', ''],
  retry: ['Retry', ''],
  dismiss: ['Dismiss', ''],
  note: ['Add a note to', ''],
}

const ALERT_WORD = /^(?:alert|incident|outage)s?$/i
/** A title that leads with the kind and a colon or a spaced dash (`Alert: …`, `Outage — …`; a hyphen inside a word is not one): the fallback when no field names it. */
const ALERT_TITLE_PREFIX = /^\W*(?:alert|incident|outage)s?(?:\s*:|\s+[—–-]\s)/i

/**
 * Whether an item is an alert, incident or outage. A title the producer tagged `[alert]` is one; else
 * the first explicit kind field (`origin`, `kind`, `type`) decides — a `github_issue` titled
 * `Alert: …` is an issue; only with no field at all does a title that leads with the kind count. Callers pass the item's raw `kinds` (a missing or blank one
 * reads as none) and its title; shortcodes are stripped here.
 */
export function isAlert({
  kinds = [],
  title,
}: {
  kinds?: readonly unknown[]
  title?: unknown
}): boolean {
  const text = stripShortcodes(asText(title))
  const tag = firstBracketTag(text)
  if (tag !== null && ALERT_WORD.test(tag)) return true
  const explicit = kinds.map((k) => asText(k).trim()).find((k) => k !== '')
  if (explicit !== undefined) return ALERT_WORD.test(explicit)
  return ALERT_TITLE_PREFIX.test(text)
}

/**
 * The plain question of a Warden item from the verb its card offers first: `Merge {repo} PR?`.
 * `Retry failed {repo} run?` only for a failed item whose primary is retry; any other verb (or none)
 * is neutral, so a question never promises an action the card does not carry. An `alert` is asked
 * about as an alert in the verb its button carries (`Implement fix for {repo} alert?`, `Dismiss …`),
 * never as a change; with no verb it is neutral (`Decide on {repo} alert?`).
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
    const [verb, object] = primary === null ? (['Decide on', ''] as const) : ALERT_PLAIN[primary]
    const alertName = where === '' ? 'this alert' : `${where} alert`
    return plainQuestion(verb, object === '' ? alertName : `${object} ${alertName}`)
  }
  const entry = primary === null ? undefined : WARDEN_PLAIN[primary]
  if (entry === undefined)
    return plainQuestion('Decide on', where === '' ? 'this item' : `${where} item`)
  const [verb, noun] = entry
  if (primary === 'retry' && failed)
    return plainQuestion(verb, where === '' ? 'failed run' : `failed ${where} run`)
  return plainQuestion(verb, where === '' ? `this ${noun}` : `${where} ${noun}`)
}
