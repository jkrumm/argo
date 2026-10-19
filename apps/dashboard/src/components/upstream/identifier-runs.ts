/** Longest token kept whole: a longer one breaks only at its joints so a giant id cannot overflow the card. */
export const IDENTIFIER_MAX = 32

/**
 * `parts` is set on a token longer than {@link IDENTIFIER_MAX} that has joints: the pieces to render
 * with a break opportunity between them. Joining `parts` gives `text` back.
 */
export type TextRun = { text: string; identifier: boolean; parts?: string[] }

/** A boundary inside an identifier-like token: after `.` `/` `_` `-` or `::`, before a non-separator. */
export const TOKEN_BOUNDARY = /(?<=::|[./_-])(?=[^\s./_:-])/

/** A non-space token with a joint (`.` `/` `_` `-` or `::`) that has a character on both sides. */
const INNER_JOINT = /\S(?:::|[./_-])\S/

/**
 * Splits a title into runs: each identifier (a token with an inner joint, at most
 * {@link IDENTIFIER_MAX} chars) is its own run, flagged so the card keeps it on one line; a longer
 * jointed token is its own run carrying `parts`, breakable only at {@link TOKEN_BOUNDARY}; everything
 * else, spaces included, is plain breakable text. Joining the run texts gives the input back.
 */
export function identifierRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  for (const part of text.split(/(\s+)/)) {
    if (part === '') continue
    const jointed = !/^\s/.test(part) && INNER_JOINT.test(part)
    if (jointed && part.length > IDENTIFIER_MAX) {
      runs.push({ text: part, identifier: false, parts: part.split(TOKEN_BOUNDARY) })
      continue
    }
    const identifier = jointed
    const last = runs.at(-1)
    if (!identifier && last !== undefined && !last.identifier && last.parts === undefined)
      last.text += part
    else runs.push({ text: part, identifier })
  }
  return runs
}
