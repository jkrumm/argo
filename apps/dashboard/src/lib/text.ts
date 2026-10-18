/** Text helpers shared by the views that render third-party strings (alert titles, repo names). */

/** `[red_circle: build failed]` → group 1 is the text worth keeping. */
const BRACKET_SHORTCODE = /\[:?[a-z][a-z0-9_+-]*:?\s*:\s*([^\]]*)\]/g
/** A standalone `:rocket:`; never the colons inside `m365:auth:prod`, `a:b:c` or `10:30:45`. */
const BARE_SHORTCODE = /(?<![\w:]):[a-z][a-z0-9_+-]*:(?![\w:])/g

/**
 * Slack-style emoji shortcodes are noise in a source line or a title: `[red_circle: text]` keeps its
 * `text`, a bare `:name:` is dropped, and the whitespace left behind is collapsed.
 */
export function stripShortcodes(text: string): string {
  return text
    .replace(BRACKET_SHORTCODE, '$1')
    .replace(BARE_SHORTCODE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whitespace collapsed to single spaces, ends trimmed. */
export const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim()

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
