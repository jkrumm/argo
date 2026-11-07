/**
 * Line-break rules for rendered copy, in three groups: identifier boundaries (where a long token may
 * break), the fact separator (`·` breaks before the dot, never after), and number→unit glue.
 */
import { NBSP } from './format'

/** The characters that join the parts of an identifier-like token (`a.b`, `a/b`, `a_b`, `a-b`); `::` joins too. */
const JOINT_CHARS = String.raw`./_-`
const JOINT = String.raw`::|[${JOINT_CHARS}]`

/** A non-space token with a joint that has a character on both sides. */
export const INNER_JOINT = new RegExp(String.raw`\S(?:${JOINT})\S`)

/** A boundary inside an identifier-like token: after a joint, before a non-separator. */
export const TOKEN_BOUNDARY = new RegExp(String.raw`(?<=${JOINT})(?=[^\s:${JOINT_CHARS}])`)

/** A breakable space before the dot, a no-break space after it: a wrapped line opens on `· {fact}`, never ends on a bare `·`. */
export const FACT_SEPARATOR = ` ·${NBSP}`

/** The short unit tokens a quantity carries; each must end at a non-letter, non-digit (`90 %ile` is not a unit). */
const UNIT = String.raw`[KMGT]B|ms|min|s|d|h|%`

/** A number and the short unit right after it (`50 GB`, `90 %`, `3 d`), as one unbreakable pair. */
const NUMBER_UNIT = new RegExp(String.raw`(\d) (?=(?:${UNIT})(?![\p{L}\d]))`, 'gu')

/** Render-time only: glues a quantity to its unit (NBSP) so a wrap never strands the unit. No other rewording. */
export const glueNumberUnits = (text: string): string => text.replace(NUMBER_UNIT, `$1${NBSP}`)

/** Tokens shorter than this are ordinary words and never get break points. */
const BREAK_TOKEN_MIN = 14

export type TitleSegment = { text: string; breakBefore: boolean }

/**
 * A title cut into segments at the natural boundaries of long identifier-like tokens; the texts
 * concatenate back to the input. `breakBefore` marks a break opportunity between this segment and
 * the previous one (never across whitespace, which breaks on its own). Ordinary words and short
 * tokens stay whole.
 */
export function titleSegments(text: string): TitleSegment[] {
  if (text === '') return []
  return text.split(/(\s+)/).flatMap((part) => {
    if (part === '') return []
    const pieces = part.length < BREAK_TOKEN_MIN ? [part] : part.split(TOKEN_BOUNDARY)
    return pieces.map((piece, i) => ({ text: piece, breakBefore: i > 0 }))
  })
}
