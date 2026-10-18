/** Text helpers shared by the views that render third-party strings (alert titles, repo names). */

/** `[red_circle: build failed]` → group 1 is the text worth keeping. */
const BRACKET_SHORTCODE = /\[:?[a-z][a-z0-9_+-]*:?\s*:\s*([^\]]*)\]/g
/** A standalone `:rocket:`; never the colons inside `m365:auth:prod`, `a:b:c` or `10:30:45`. */
const BARE_SHORTCODE = /(?<![\w:]):[a-z][a-z0-9_+-]*:(?![\w:])/g

/** Runs of whitespace except the no-break space, which keeps a number and its unit together. */
const WHITESPACE = /[^\S\u00a0]+/g

/**
 * Slack-style emoji shortcodes are noise in a source line or a title: `[red_circle: text]` keeps its
 * `text`, a bare `:name:` is dropped, and the whitespace left behind is collapsed.
 */
export function stripShortcodes(text: string): string {
  return text
    .replace(BRACKET_SHORTCODE, '$1')
    .replace(BARE_SHORTCODE, '')
    .replace(WHITESPACE, ' ')
    .trim()
}

/** Whitespace collapsed to single spaces (a no-break space survives), ends trimmed. */
export const flatten = (text: string): string => text.replace(WHITESPACE, ' ').trim()

/** The first sentence of a text (up to `.`, `!` or `?` followed by a space or the end), flattened. */
export function firstSentence(text: string): string {
  const flat = flatten(text)
  const stop = flat.search(/[.!?](\s|$)/)
  return stop === -1 ? flat : flat.slice(0, stop + 1)
}

/** What follows {@link firstSentence}; `null` when nothing does. */
export function restAfterFirstSentence(text: string): string | null {
  const flat = flatten(text)
  const rest = flat.slice(firstSentence(flat).length).trim()
  return rest === '' ? null : rest
}

/**
 * A question a producer authored, read defensively off a loose wire object: only a non-blank string
 * counts (a number, object or array is a producer bug, not a question), shortcodes stripped,
 * whitespace flattened. Every path that reads a producer `question` goes through this.
 */
export function authoredQuestion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = stripShortcodes(value)
  return clean === '' ? null : clean
}

/** A wire value read as text: anything that is not a string is none. */
export const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Where a title's clause ends: a dash between words, a sentence stop, a semicolon or an opening bracket. */
const CLAUSE_STOP = /\s[—–-]\s|[.;!?](?=\s|$)|\s[([]/g

/**
 * The first `count` clauses of a title (`Infinity` is the whole title): cut at the `count`-th stop,
 * trailing punctuation removed. A stop with nothing before it is not a stop. `Fix the build — host a`
 * is `Fix the build` at one clause and whole at two.
 */
export function leadClauses(text: string, count: number): string {
  const flat = flatten(text).replace(/^[\s.,;:\-–—]+/, '')
  let end = flat.length
  let seen = 0
  for (const match of flat.matchAll(CLAUSE_STOP)) {
    if (match.index === 0 || flat.slice(0, match.index).trim() === '') continue
    seen += 1
    if (seen === count) {
      end = match.index
      break
    }
  }
  return flat.slice(0, end).replace(/[\s,;:.\-–—]+$/, '')
}

/** The first clause of a title; `''` when the text has no words. */
export const firstClause = (text: string): string => leadClauses(text, 1)

/**
 * The shared opening of a waiting-on-the-owner headline: `Nothing needs you`, the oldest wait, or —
 * when no age is reported — that items wait, never a figure the source did not send. The counts
 * live in the sections, so the headline repeats none.
 */
export function oldestWaitSentence(count: number, oldest: string | null): string {
  if (count === 0) return 'Nothing needs you'
  if (oldest === null) return count === 1 ? 'An item is waiting on you' : 'Items are waiting on you'
  return `Oldest wait on you ${oldest}`
}
