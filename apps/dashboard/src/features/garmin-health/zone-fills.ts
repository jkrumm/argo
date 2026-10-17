import { alpha, VX } from 'basalt-ui/tokens'

/**
 * Zone bands behind a line are context, the line is the data: the status hues at a whisper of their
 * strength, so a band tints the plot without outweighing the ink drawn over it.
 */
export const ZONE_FILL = {
  good: alpha(VX.goodSolid, 0.1),
  warn: alpha(VX.warnSolid, 0.1),
  bad: alpha(VX.badSolid, 0.1),
} as const
