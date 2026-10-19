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

/** A number and the short unit token right after it (`50 GB`, `90 %`, `3 d`), as one unbreakable pair. */
const NUMBER_UNIT = /(\d) (?=(?:[KMGT]B|ms|min|s|d|h)(?![\p{L}\d])|%)/gu

/** Render-time only: glues a quantity to its unit (NBSP) so a wrap never strands the unit. No other rewording. */
export const glueNumberUnits = (text: string): string => text.replace(NUMBER_UNIT, `$1${NBSP}`)
