/** The characters that join the parts of an identifier-like token (`a.b`, `a/b`, `a_b`, `a-b`); `::` joins too. */
const JOINT_CHARS = String.raw`./_-`
const JOINT = String.raw`::|[${JOINT_CHARS}]`

/** A non-space token with a joint that has a character on both sides. */
export const INNER_JOINT = new RegExp(String.raw`\S(?:${JOINT})\S`)

/** A boundary inside an identifier-like token: after a joint, before a non-separator. */
export const TOKEN_BOUNDARY = new RegExp(String.raw`(?<=${JOINT})(?=[^\s:${JOINT_CHARS}])`)
