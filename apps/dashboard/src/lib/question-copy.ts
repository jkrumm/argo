import {
  LEADING_BRACKET_TAGS,
  asText,
  firstBracketTag,
  flatten,
  lastWhitespace,
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

/** What introduces a removed URL and is left dangling at the end: `: ` or `, `, or a bare `— PR`. */
const DANGLING_URL_LABEL = /(?:[\s:,;]+|\s*[—–-]\s*(?:PR|link|url|see)?)$/i

/**
 * Removes raw URLs; a bracket left open by the removal is closed, never dangling, and the colon
 * or bare label that introduced the URL goes with it (`— PR left open: {url}` → `— PR left open`).
 */
function withoutUrls(sentence: string): string {
  const removed = sentence.replace(BRACKETED_URL, '').replace(BARE_URL, '')
  if (removed === sentence) return closeBrackets(flatten(sentence))
  let text = flatten(removed)
  for (
    let next = text.replace(DANGLING_URL_LABEL, '');
    next !== text;
    next = text.replace(DANGLING_URL_LABEL, '')
  )
    text = next
  return closeBrackets(text)
}

/** The sentences of a text, each with its closing punctuation. */
const sentencesOf = (text: string): string[] =>
  flatten(text)
    .split(/(?<=[.!?])\s+/)
    .filter((part) => part !== '')

/** A sentence that asks, even when it ends `?!` or `?.`. */
const asksQuestion = (sentence: string): boolean => /\?[!.]*$/.test(sentence)

/**
 * A sentence that opens with a dash (`— PR left open`) continues the one before it: the dash goes
 * and the two read as clauses (`…commit: CI; PR left open`), never as a stray fragment.
 */
function joinDashClauses(sentences: readonly string[]): string[] {
  const joined: string[] = []
  for (const sentence of sentences) {
    const clause = /^[—–]\s*(.+)$/.exec(sentence)?.[1]
    const last = joined.at(-1)
    if (clause === undefined) joined.push(sentence)
    // A question is never folded into a statement: it stays a clause of its own.
    else if (last === undefined || asksQuestion(last) || asksQuestion(clause)) joined.push(clause)
    else joined[joined.length - 1] = `${last.replace(/[.!]+$/, '')}; ${clause}`
  }
  return joined
}

/**
 * A closing `: {word}` that only repeats a word the sentence already said (`…on the head commit:
 * CI.`) is a dangling fragment, not a fact: it goes, with its colon. Any other tail stays.
 */
function withoutEchoTail(sentence: string): string {
  const match = /^(.*\S):\s+([\p{L}\p{N}_-]+)([.!?]*)$/u.exec(sentence)
  if (match === null) return sentence
  const [, head, word, end] = match as unknown as [string, string, string, string]
  const echoed = new RegExp(`(?<![\\p{L}\\p{N}_-])${word}(?![\\p{L}\\p{N}_-])`, 'iu').test(head)
  return echoed ? `${head}${end}` : sentence
}

/**
 * One line of evidence from a reason: statements only (a second question never repeats the title's),
 * raw URLs removed (the whole reason keeps them), cut at a word boundary when long.
 */
function evidenceLeadOf(text: string, keepQuestions: boolean): string | null {
  const cleaned = joinDashClauses(
    sentencesOf(text)
      .map(withoutUrls)
      .map(withoutEchoTail)
      .filter((sentence) => sentence !== '' && !/^[\s.,;:\-–—()[\]]+$/.test(sentence)),
  )
  const statements = cleaned.filter((sentence) => !asksQuestion(sentence))
  // Evidence that is itself a question (an agent's blocker) is still the evidence when it is all there is.
  const lines = statements.length > 0 || !keepQuestions ? statements : cleaned
  if (lines.length === 0) return null
  return leadOf(lines.join(' '), EVIDENCE_LINE_MAX)
}

/** A caller-built plain question: bounded at a word, never inside a bracket (no ellipsis before the `?`), never empty. */
function boundedQuestion(question: string, max = QUESTION_MAX - 1): string {
  const stem = flatten(question).replace(/[?\s]+$/, '')
  if (stem === '') return NEUTRAL_QUESTION
  if (stem.length <= max) return `${stem}?`
  // Cut at a word, balanced; a question with no such cut is the neutral one, never a fragment.
  const cut = cutAtWord(stem, max)
  return cut === null ? NEUTRAL_QUESTION : `${cut}?`
}

const ALERT_WORD = /^(?:alert|incident|outage)s?$/i
/** A title that leads with the kind and a colon or a spaced dash (`Alert: …`, `Outage — …`; a hyphen inside a word is not one): the fallback when no field names it. */
const ALERT_TITLE_PREFIX = /^\W*(?:alert|incident|outage)s?(?:\s*:|\s+[—–-]\s)/i

// ── The question rung ──────────────────────────────────────────────────────────────────────

/** Room a subject needs to be worth printing; below it the plain question stands. */
const SUBJECT_MIN = 10

/** A word a cut subject must not end on: it promises a next word the title no longer has. */
const TRAILING_FILLER =
  /[\s_/.]+(?:a|an|the|and|or|but|nor|to|of|for|in|on|at|by|with|from|as|into|than|that|which|when|while|without|beside|its|it|this|these|those|is|are|was|were|be|has|have|do|does|did|can|will|would|should|not|no)$/i
/** Punctuation a cut leaves dangling at its end; a closing bracket is not one. */
const TRAILING_PUNCTUATION = /[\s,;:.!?\-–—/(['"`]+$/

const balanced = (text: string): boolean => {
  const count = (re: RegExp) => (text.match(re) ?? []).length
  return (
    count(/\(/g) === count(/\)/g) &&
    count(/\[/g) === count(/\]/g) &&
    count(/"/g) % 2 === 0 &&
    count(/`/g) % 2 === 0
  )
}

/** A text with no letter or digit in it names nothing. */
const names = (text: string): boolean => /[\p{L}\p{N}]/u.test(text)

/** `text` without the punctuation and filler words a cut left at its end. */
function trimmedTail(text: string): string {
  let current = text
  for (;;) {
    const next = current.replace(TRAILING_PUNCTUATION, '').replace(TRAILING_FILLER, '')
    if (next === current) return current
    current = next
  }
}

/** The longest lead of `text` before a `boundary` match within `max`, balanced and trimmed. */
function longestLead(text: string, max: number, boundary: RegExp): string | null {
  let best: string | null = null
  for (const match of text.matchAll(boundary)) {
    if (match.index > max) break
    const lead = trimmedTail(text.slice(0, match.index))
    if (names(lead) && balanced(lead)) best = lead
  }
  return best
}

/**
 * The longest lead of `text` that fits `max`, cut at a word boundary: never inside a bracket or a
 * quote, no ellipsis, no dangling punctuation or filler word. Only when that leaves less than
 * {@link SUBJECT_MIN} (one long identifier: `{label}: {one_long_identifier}`) may the cut fall
 * between an identifier's own words (`_`, `/`, `.`). `null` when nothing fits.
 */
function cutAtWord(text: string, max: number): string | null {
  const lead = longestLead(text, max, /\s+/g)
  if (lead !== null && lead.length >= SUBJECT_MIN) return lead
  return longestLead(text, max, /[\s_/.]+/g) ?? lead
}

/** A whole subject keeps its last word; only its closing punctuation gives way to the `?`. */
const wholeSubject = (subject: string): string => flatten(subject).replace(/[\s,;:.!?\-–—]+$/, '')

/** The subject as the title shows it in `room` characters: whole when it fits, else cut at a word. */
export function subjectLead(subject: string, room: number): string | null {
  if (room < SUBJECT_MIN) return null
  const flat = wholeSubject(subject)
  if (!names(flat)) return null
  return flat.length <= room ? flat : cutAtWord(flat, room)
}

/** How one item's question can read: with no subject, and the two heads its subject can take. */
export type QuestionForms = {
  /** The question when the item names no subject: `Implement {repo} change`. */
  plain: string
  /** What heads the subject: `Implement change` (read `Implement change: {subject}?`). */
  stem: string
  /** The shortest honest head, for siblings that need the room: `Implement`. */
  terse: string
  /** The stem already says `failed` (`Retry failed run`): a subject that opens with `fail…` takes the terse head. */
  stemSaysFailed?: boolean
}

export type QuestionInput = QuestionForms & {
  /** Orders the ordinal tie-break, so it is stable across refreshes. */
  key: string
  /** What the item is about: its title, or its ask's lead. `null` when it names nothing. */
  subject: string | null
  /** A question the item already carries (authored, its own ask, a question title): verbatim. */
  fixed?: string | null
  /** The commit label the subject was stripped of (`fix(scope)`): given back only to tell siblings apart. */
  label?: string | null
}

export type QuestionTitle = {
  question: string
  /** The subject words the question shows; `null` when it shows none (plain or fixed). */
  subject: string | null
}

const keyOf = (title: QuestionTitle) => title.question.toLowerCase()

function compose(
  input: QuestionInput,
  head: 'stem' | 'terse',
  ordinal: number | null,
): QuestionTitle {
  const tail = ordinal === null ? '' : ` (${ordinal})`
  // `Retry failed run: failed to build …` says the word twice: the terse head carries the verb alone.
  const doubled = input.stemSaysFailed === true && /^fail/i.test(input.subject ?? '')
  const stem = flatten(head === 'stem' && !doubled ? input.stem : input.terse)
  // The tail's room is reserved first, so an ordinal is never the part that goes.
  const room = QUESTION_MAX - 1 - tail.length - stem.length - 2
  const lead = input.subject === null ? null : subjectLead(input.subject, room)
  if (lead === null) {
    const plain = boundedQuestion(input.plain, QUESTION_MAX - 1 - tail.length).slice(0, -1)
    return { question: `${plain}${tail}?`, subject: null }
  }
  return { question: `${stem}: ${lead}${tail}?`, subject: lead }
}

/** Words that open a clause: the word after one of these starts a later distinguishing clause. */
const CLAUSE_END = /(?:[,;:]|^[—–-])$/

/**
 * A subject told apart from `others` (the full subjects it would read the same as) by the clause
 * where it parts from them: `{terse}: {opening words} … {distinguishing clause}?`. The opening and
 * the clause are both whole words and balanced; the ellipsis never sits before the `?`. `null`
 * when the subject has no word the others lack (it is theirs word for word, or a prefix of one).
 */
function composeApart(input: QuestionInput, others: readonly string[]): QuestionTitle | null {
  if (input.subject === null) return null
  const own = wholeSubject(input.subject).split(' ')
  const lower = own.map((word) => word.toLowerCase())
  let common = 0
  for (const other of others) {
    const theirs = wholeSubject(other).toLowerCase().split(' ')
    let shared = 0
    while (shared < lower.length && lower[shared] === theirs[shared]) shared += 1
    common = Math.max(common, shared)
  }
  if (common === 0 || common >= own.length) return null
  // The distinguishing part starts at its clause when one opens within three words of it.
  let start = common
  for (let back = common; back > Math.max(0, common - 3); back -= 1) {
    if (CLAUSE_END.test(own[back - 1]!)) {
      start = back
      break
    }
  }
  // Never inside a bracket: an opening the head leaves unclosed pulls the clause back to it.
  while (start > 0 && !balanced(own.slice(0, start).join(' '))) start -= 1
  const stem = flatten(input.terse)
  const room = QUESTION_MAX - 1 - stem.length - 2
  const clause = own.slice(start).join(' ')
  // The whole clause with the longest opening that leaves it room; failing that, a cut clause.
  for (const whole of [true, false]) {
    for (let size = start; size >= 1; size -= 1) {
      const head = trimmedTail(own.slice(0, size).join(' '))
      if (!names(head) || !balanced(head)) continue
      const joint = size === start ? ' ' : ' … '
      const clauseRoom = room - head.length - joint.length
      const shown =
        clause.length <= clauseRoom ? clause : whole ? null : cutAtWord(clause, clauseRoom)
      // The clause must reach the first word the others lack, or it tells nothing apart.
      if (shown === null || shown.split(' ').length < common - start + 1) continue
      return { question: `${stem}: ${head}${joint}${shown}?`, subject: head }
    }
  }
  // No opening fits beside the clause: the clause alone, as long as it reaches the distinguishing word.
  const alone = clause.length <= room ? clause : cutAtWord(clause, room)
  if (alone === null || alone.split(' ').length < common - start + 1) return null
  return { question: `${stem}: ${alone}?`, subject: null }
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * THE question rule, for every card of ONE surface (the page or inbox the owner reads together),
 * in input order. Deterministic and pure:
 *  1. a `fixed` question (the producer's own) is used verbatim;
 *  2. otherwise the title keeps its subject: `{stem}: {subject}?`, the subject cut at a word when it
 *     does not fit {@link QUESTION_MAX} — never inside a bracket or token, never an ellipsis before
 *     the `?`; with no subject the plain question stands;
 *  3. siblings that read the same take the terse head (more room for more of their subject), when
 *     that alone tells them apart;
 *  4. siblings still the same whose FULL subjects differ are told apart by subject: the opening
 *     words, then the clause where each parts from the others (`… {clause}?`);
 *  5. only cards whose normalised full subjects are word-for-word identical are numbered ` (n)`, in
 *     `key` order (code-unit comparison), each taking the lowest ordinal no other card already reads.
 *     A subject that is a word-prefix of a sibling's is never numbered: the longer one shows its
 *     extra words; if even they cannot be shown whole, both keep their titles, unnumbered.
 */
export function questionTitles(inputs: readonly QuestionInput[]): QuestionTitle[] {
  const titles = inputs.map((input) => {
    const fixed = flatten(input.fixed ?? '')
    return fixed === '' ? compose(input, 'stem', null) : { question: fixed, subject: null }
  })
  const derived = inputs.map((input) => flatten(input.fixed ?? '') === '')
  const clashing = (list: readonly QuestionTitle[]): number[] => {
    const count = new Map<string, number>()
    for (const title of list) count.set(keyOf(title), (count.get(keyOf(title)) ?? 0) + 1)
    return list.flatMap((title, i) => (derived[i] && count.get(keyOf(title))! > 1 ? [i] : []))
  }

  const first = clashing(titles)
  if (first.length === 0) return titles
  const terse = titles.map((title, i) =>
    first.includes(i) ? compose(inputs[i]!, 'terse', null) : title,
  )
  const stillTerse = new Set(clashing(terse))
  for (const i of first) if (!stillTerse.has(i)) titles[i] = terse[i]!

  // Still the same: a subject stripped of its commit label gets the label back (`fix(a): …`).
  const subjects = inputs.map((input) => input.subject)
  for (const i of clashing(titles)) {
    const { label, subject } = inputs[i]!
    if (label == null || subject === null) continue
    subjects[i] = `${label}: ${subject}`
    titles[i] = compose({ ...inputs[i]!, subject: subjects[i] }, 'stem', null)
  }

  // Same title, different full subjects: the subjects themselves tell them apart.
  const full = subjects.map((subject) =>
    subject === null ? null : wholeSubject(subject).toLowerCase(),
  )
  const groups = new Map<string, number[]>()
  for (const i of clashing(titles)) {
    const group = keyOf(titles[i]!)
    groups.set(group, [...(groups.get(group) ?? []), i])
  }
  for (const members of groups.values()) {
    const apart = members.map((i) => {
      const others = members.flatMap((j) =>
        j !== i && full[j] !== null && full[j] !== full[i] ? [subjects[j]!] : [],
      )
      return others.length === 0
        ? null
        : composeApart({ ...inputs[i]!, subject: subjects[i] ?? null }, others)
    })
    members.forEach((i, n) => {
      if (apart[n] != null) titles[i] = apart[n]!
    })
  }

  // Only word-identical normalised subjects are numbered; a card whose subject differs keeps its
  // apart or terse title, even in the rare case no title can show its extra words.
  const still = clashing(titles)
  const order = still
    .filter((i) =>
      still.some((j) => j !== i && keyOf(titles[j]!) === keyOf(titles[i]!) && full[j] === full[i]),
    )
    .toSorted((a, b) => byKey(inputs[a]!.key, inputs[b]!.key))
  const taken = new Set(titles.map(keyOf))
  for (const i of order) {
    const numbered = (n: number) =>
      compose({ ...inputs[i]!, subject: subjects[i] ?? null }, 'stem', n)
    let ordinal = 1
    let next = numbered(ordinal)
    while (taken.has(keyOf(next)) && ordinal <= inputs.length) {
      ordinal += 1
      next = numbered(ordinal)
    }
    taken.add(keyOf(next))
    titles[i] = next
  }
  return titles
}

/** The forms of a question about `noun`: `{verb} {where} {noun}` with no subject, `{verb} {noun}: …` with one. */
export function questionForms(verb: string, noun: string, where: string | null): QuestionForms {
  const place = stripShortcodes(where ?? '')
  return {
    plain: `${verb} ${place === '' ? 'this' : place} ${noun}`,
    stem: `${verb} ${noun}`,
    terse: verb.replace(/\s+(?:for|on|to)$/i, ''),
  }
}

/** A conventional-commit label: `fix(scope): `, `ci: `, `feat!: ` — a known type only, so `warning: …` keeps its word. */
const COMMIT_PREFIX =
  /^(?:feat|fix|chore|ci|docs|style|refactor|perf|test|build|deps|revert|security|release)(?:\([^)]*\))?!?:\s+/

/** An uptime monitor's raw `[{monitor}]` prefix on its status line (`[{monitor}] Down …`): the monitor is the subject, not a tag. */
const MONITOR_PREFIX = /^\[([^\]]+)\]\s+(?=(?:Down|Up|Pending|Maintenance)\b)/

/** The commit label {@link subjectOf} strips (`fix(scope)`), `null` when the title has none. */
export function commitLabelOf(title: unknown): string | null {
  const match = COMMIT_PREFIX.exec(stripShortcodes(asText(title)))
  return match === null ? null : match[0].replace(/:\s+$/, '')
}

/** A title's subject: shortcodes stripped, a leading producer kind (`[alert] `, `Alert: `), a commit label (`fix(scope): `) and a monitor's `[…]` prefix removed, code backticks unwrapped; `null` when nothing is left. */
export function subjectOf(title: unknown): string | null {
  const text = stripShortcodes(asText(title))
  const tag = firstBracketTag(text)
  const untagged =
    tag !== null && ALERT_WORD.test(tag) ? text.replace(/^\s*\[[^\]]*\]\s*/, '') : text
  // The stem already says `alert`: a title that leads with the kind (`Alert: …`) does not say it
  // twice; a commit-style `type(scope): ` is a label, not the subject (the whole title stays in the detail).
  // Each strip leaves a space behind: trim between steps, so the next anchored prefix still matches.
  const subject = untagged
    .replace(ALERT_TITLE_PREFIX, '')
    .trim()
    .replace(COMMIT_PREFIX, '')
    .trim()
    .replace(MONITOR_PREFIX, '$1 ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/`/g, '')
    .trim()
  return names(subject) ? subject : null
}

/** The forms of a card whose caller names no verb. */
const NEUTRAL_FORMS: QuestionForms = questionForms('Decide on', 'item', null)

// ── Card copy ──────────────────────────────────────────────────────────────────────────────

export type CardCopySource = 'authored' | 'ask' | 'title' | 'plain'

export type CardCopy = {
  /** At most {@link QUESTION_MAX} characters, ends in `?` unless authored; never empty. */
  question: string
  /** The raw title when the question does not already say it; whole, `null` past {@link ENTITY_MAX} (it sits in `detail`). */
  entity: string | null
  /** One line of evidence, statements only, no raw URL, never the question's own words; `null` when there is none. */
  evidenceLine: string | null
  /** The whole ask/reason (and a title the question cut), only when the evidence line did not show all of it. */
  detail: string | null
  /** Which rung of the rule produced the question. */
  source: CardCopySource
  /** The subject words the question shows; `null` for a plain or producer question. */
  subject: string | null
}

export type CardInput = {
  /** Orders the ordinal tie-break among identical siblings. */
  key: string
  authored?: string | null | undefined
  ask?: string
  body?: string | null
  title?: string | null | undefined
  /** The question forms; neutral (`Decide on item: …`) when the caller names no verb. */
  forms?: QuestionForms
  /** The commit label stripped from the subject; defaults to the title's {@link commitLabelOf}. */
  label?: string | null
  /** What the item is about; defaults to the title's {@link subjectOf}. */
  subject?: string | null
  /** Show the body as the evidence line even when it is only questions (an agent's blocker). */
  keepQuestionEvidence?: boolean
}

/** Which rung asks the question, and the producer's text when it is not the derived one. */
function rungOf({ authored, ask = '', title }: CardInput): {
  source: CardCopySource
  fixed: string | null
} {
  const written = flatten(authored ?? '')
  const sentence = flatten(ask)
  const item = flatten(title ?? '')
  const isQuestion = (text: string) => text.endsWith('?') && text.length <= QUESTION_MAX
  // An over-long authored question is never cut into a fragment: it falls through, whole in the detail.
  if (written !== '' && written.length <= QUESTION_MAX)
    return { source: 'authored', fixed: written }
  if (isQuestion(sentence)) return { source: 'ask', fixed: sentence }
  if (isQuestion(item)) return { source: 'title', fixed: item }
  return { source: 'plain', fixed: null }
}

/**
 * `text` without the sentence the question's `said` subject opened, when it leads with it: the
 * evidence takes the next fact instead of restating the title. A leading `[tag]` run is a fact the
 * question does not say, so it stays when anything follows it. `whole` is set when the question
 * said all of the dropped sentence, so nothing of it is left for the detail to show.
 */
function withoutSaid(text: string, said: string): { text: string; whole: boolean } {
  const tags = LEADING_BRACKET_TAGS.exec(text)?.[0] ?? ''
  for (const prefix of tags === '' ? [''] : ['', tags]) {
    const body = text.slice(prefix.length)
    if (body.slice(0, said.length).toLowerCase() !== said.toLowerCase()) continue
    const rest = body.slice(said.length)
    // A word or two the title happens to share (`Flaky` over `Flaky thread test …`) is no
    // restatement; a short subject that is the whole sentence is.
    const endsSentence = /^\s*(?:[.!?](?:\s|$)|$)/.test(rest)
    if (/^[\p{L}\p{N}_]/u.test(rest) || (said.length < SUBJECT_MIN && !endsSentence))
      return { text, whole: false }
    const stop = rest.search(/[.!?](?:\s|$)/)
    // With no sentence stop after the subject, the remainder is the next fact: kept, never dropped.
    const next = (stop === -1 ? rest.replace(/^[\s,;:—–-]+/, '') : rest.slice(stop + 1)).trim()
    const whole =
      prefix === '' && /^[.!?]?$/.test((stop === -1 ? rest : rest.slice(0, stop + 1)).trim())
    return { text: next === '' ? '' : `${prefix}${next}`.trim(), whole }
  }
  return { text, whole: false }
}

function finishCopy(input: CardInput, source: CardCopySource, title: QuestionTitle): CardCopy {
  const written = flatten(input.authored ?? '')
  const sentence = flatten(input.ask ?? '')
  const item = flatten(input.title ?? '')
  const { question, subject } = title
  const spill = written.length > QUESTION_MAX ? written : ''
  const used = source === 'ask' ? '' : sentence
  const joined = [spill, used, input.body ?? '']
    .map(flatten)
    .filter((part) => part !== '')
    .join(' ')
  const { text, whole: saidWhole } =
    subject === null ? { text: joined, whole: false } : withoutSaid(joined, subject)
  const saidTitle = bareTitle(item).toLowerCase()
  const showsTitle =
    source === 'title' ||
    bareTitle(question).toLowerCase() === saidTitle ||
    // A subject that carries the whole title says it; a cut one leaves the whole title to the detail.
    (subject !== null && saidTitle !== '' && question.toLowerCase().includes(saidTitle))
  const entityFits = item !== '' && !showsTitle && subject === null && item.length <= ENTITY_MAX
  const lead = text === '' ? null : evidenceLeadOf(text, input.keepQuestionEvidence ?? false)
  // The evidence line never restates the question, nor the subject it shows.
  const said = [question, subject ?? ''].map((t) => bareTitle(t).toLowerCase())
  const evidenceLine = lead !== null && said.includes(bareTitle(lead).toLowerCase()) ? null : lead
  const unsaidTitle = item !== '' && !showsTitle && !entityFits ? item : ''
  const whole = [unsaidTitle, joined].filter((part) => part !== '').join(' ')
  // Nothing is hidden when the question said the opening sentence whole and the line shows the rest.
  const shownAll =
    whole === evidenceLine ||
    (unsaidTitle === '' &&
      saidWhole &&
      (text === '' ? evidenceLine === null : text === evidenceLine))
  return {
    question,
    entity: entityFits ? item : null,
    evidenceLine,
    detail: whole !== '' && !shownAll ? whole : null,
    source,
    subject,
  }
}

/**
 * The copy of every card on ONE surface (Home's inbox, the Warden page, Agents needs-you — never
 * app-wide), in input order: the question by {@link questionTitles}, then the entity, the evidence
 * line and the detail around it. Whatever did not become the question (`body`, a statement `ask`,
 * a long authored question) is the evidence line / detail.
 */
export function surfaceCopies(inputs: readonly CardInput[]): CardCopy[] {
  const rungs = inputs.map(rungOf)
  const titles = questionTitles(
    inputs.map((input, i) => ({
      ...(input.forms ?? NEUTRAL_FORMS),
      key: input.key,
      subject: input.subject === undefined ? subjectOf(input.title) : input.subject,
      label: input.label === undefined ? commitLabelOf(input.title) : input.label,
      fixed: rungs[i]!.fixed,
    })),
  )
  return inputs.map((input, i) => finishCopy(input, rungs[i]!.source, titles[i]!))
}

/** The copy of one card alone on its surface. */
export function cardCopy(input: Omit<CardInput, 'key'> & { key?: string }): CardCopy {
  return surfaceCopies([{ key: '', ...input }])[0]!
}

/** What a card shows of its reason: the line, and the whole text behind the disclosure. */
type Evidence = { evidenceLine: string | null; detail: string | null }

/**
 * Cards whose evidence lines read the same word for word tell nothing apart: only the first in
 * `order` (display order, indices into `cards`; default input order) keeps the line, the others drop
 * it and keep the whole text behind their disclosure. A `null` line is never a group; a card outside
 * `order` is left as it is.
 */
export function withoutRepeatedEvidence<T extends Evidence>(
  cards: readonly T[],
  order: readonly number[] = cards.map((_, i) => i),
): T[] {
  const seen = new Set<string>()
  const result = [...cards]
  for (const i of order) {
    const card = cards[i]!
    const line = card.evidenceLine
    if (line === null) continue
    const key = line.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      continue
    }
    result[i] = { ...card, evidenceLine: null, detail: card.detail ?? line }
  }
  return result
}

// ── Warden ───────────────────────────────────────────────────────────────────────────────────

/** The noun a Warden card asks about per primary verb: `<verb> <noun>: <subject>?`. */
const WARDEN_ASK: Partial<Record<WardenActionVerb, readonly [verb: string, noun: string]>> = {
  merge: ['Merge', 'PR'],
  implement: ['Implement', 'change'],
  reinvestigate: ['Re-investigate', 'item'],
  retry: ['Retry', 'item'],
}

/** What an alert asks for per primary verb: the verb the card's button carries. */
const ALERT_VERB: Record<WardenActionVerb, string> = {
  implement: 'Implement fix for',
  merge: 'Merge fix for',
  reinvestigate: 'Re-investigate',
  retry: 'Retry',
  dismiss: 'Dismiss',
  note: 'Add a note to',
}

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

/** What a Warden question is about: one shape for a retry (`failed run` / `failed alert`), else the alert, else the verb's noun. */
function askedNoun({
  alert,
  failedRun,
  fallback,
}: {
  alert: boolean
  failedRun: boolean
  fallback: string
}): string {
  if (failedRun) return alert ? 'failed alert' : 'failed run'
  return alert ? 'alert' : fallback
}

/**
 * The question forms of a Warden item from the verb its card offers first (`Merge PR: {subject}?`,
 * `Merge {repo} PR?` with no subject). `Retry failed run` only for a failed item whose primary is
 * retry; any other verb (or none) is neutral (`Decide on`), so a question never promises an action
 * the card does not carry. An `alert` is asked about as an alert in the verb its button carries
 * (`Implement fix for alert: {subject}?`), never as a change. On `home`, whose only button opens the
 * item in Warden, every question is `Decide on {noun}`: it names what to decide, never a verb the
 * card cannot do.
 */
export function wardenQuestionForms({
  failed,
  repo,
  primary,
  alert = false,
  surface = 'warden',
}: {
  failed: boolean
  repo: string | null
  primary: WardenActionVerb | null
  alert?: boolean
  surface?: 'warden' | 'home'
}): QuestionForms {
  const where = stripShortcodes(asText(repo))
  const entry = primary === null ? undefined : WARDEN_ASK[primary]
  const failedRun = failed && primary === 'retry'
  const noun = askedNoun({ alert, failedRun, fallback: entry?.[1] ?? 'item' })
  const verb =
    surface === 'home' || primary === null
      ? 'Decide on'
      : alert
        ? ALERT_VERB[primary]
        : (entry?.[0] ?? 'Decide on')
  const forms = questionForms(verb, noun, where)
  return failedRun
    ? {
        ...forms,
        plain: `${verb} failed ${where === '' ? '' : `${where} `}${alert ? 'alert' : 'run'}`,
        stemSaysFailed: true,
      }
    : forms
}
