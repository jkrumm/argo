/** Longest token kept whole: a longer one stays breakable so a giant id cannot overflow the card. */
export const IDENTIFIER_MAX = 32

export type TextRun = { text: string; identifier: boolean }

/** A non-space token with a `-` or `/` that has a character on both sides. */
const INNER_JOINT = /\S[-/]\S/

/**
 * Splits a title into runs: each identifier (a token with an inner `-` or `/`, at most
 * {@link IDENTIFIER_MAX} chars) is its own run, flagged so the card keeps it on one line; everything
 * else, spaces included, is plain breakable text. Joining the run texts gives the input back.
 */
export function identifierRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  for (const part of text.split(/(\s+)/)) {
    if (part === '') continue
    const identifier = part.length <= IDENTIFIER_MAX && INNER_JOINT.test(part) && !/^\s/.test(part)
    const last = runs.at(-1)
    if (!identifier && last !== undefined && !last.identifier) last.text += part
    else runs.push({ text: part, identifier })
  }
  return runs
}
