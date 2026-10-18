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
