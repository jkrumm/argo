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

/** Index of the last whitespace character of `text` (not only a plain space), `-1` when it has none. */
export const lastWhitespace = (text: string): number => text.search(/\s\S*$/)

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
