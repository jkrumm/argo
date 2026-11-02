/** The Flow tab's ink: what a pick target and a demand purpose are drawn in. */
import { VX } from 'basalt-ui/tokens'
import { USAGE_RANK } from '../../lib/series'
import { colorForPayer } from './constants'
import { poolPayer, type Purpose } from './flow-model'

/** What a request pick landed on, as ink: a pool takes its credit shade, IU the IU API grey, refused the bad status. */
export function targetColor(target: string): string {
  if (target === 'iu-api') return colorForPayer('iu-api')
  if (target === 'refused') return VX.status.bad
  return colorForPayer(poolPayer(target))
}

/** The purposes of agw demand, shades of one accent and then greys, two ramp steps apart. */
export const PURPOSE_STYLE = {
  prod: { label: 'production', color: USAGE_RANK.rank2 },
  verify: { label: 'verify', color: USAGE_RANK.rank4 },
  eval: { label: 'eval', color: USAGE_RANK.rank6 },
  other: { label: 'other', color: USAGE_RANK.rank5 },
} as const satisfies Record<Purpose, { label: string; color: string }>
