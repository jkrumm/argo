import { INNER_JOINT, TOKEN_BOUNDARY } from '../../lib/text-breaks'

/** Longest token kept whole: a longer one breaks only at its joints so a giant id cannot overflow the card. */
export const IDENTIFIER_MAX = 32

/**
 * `text` is plain breakable prose; `identifier` is a short jointed token kept on one line;
 * `breakable` is a jointed token longer than {@link IDENTIFIER_MAX}, cut into `parts` that may
 * break between them (joining `parts` gives the token back).
 */
export type TextRun =
  | { kind: 'text'; text: string }
  | { kind: 'identifier'; text: string }
  | { kind: 'breakable'; text: string; parts: string[] }

/**
 * Splits a title into runs: a token with an inner joint is an identifier (at most
 * {@link IDENTIFIER_MAX} chars) or breakable (longer); everything else, spaces included, is plain
 * text. Joining the run texts gives the input back.
 */
export function identifierRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  for (const part of text.split(/(\s+)/)) {
    if (part === '') continue
    if (/^\s/.test(part) || !INNER_JOINT.test(part)) {
      const last = runs.at(-1)
      if (last?.kind === 'text') last.text += part
      else runs.push({ kind: 'text', text: part })
    } else if (part.length > IDENTIFIER_MAX) {
      runs.push({ kind: 'breakable', text: part, parts: part.split(TOKEN_BOUNDARY) })
    } else runs.push({ kind: 'identifier', text: part })
  }
  return runs
}
