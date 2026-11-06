import { USAGE_RANK } from '../../lib/series'
import type { Lane, Tier } from './model'

// The page's whole colour vocabulary, on the usage rank ladder (accent shades two steps apart, then
// greys, the folded tail the last grey). Review tiers are one kind of thing, so they are the accent's
// three shades, deepest tier darkest; Issue lanes continue onto greys for the support lanes.

export const TIER_COLOR: Record<Tier, string> = {
  light: USAGE_RANK.rank3,
  standard: USAGE_RANK.rank2,
  deep: USAGE_RANK.rank1,
}

export const LANE_COLOR: Record<Lane, string> = {
  lead: USAGE_RANK.rank1,
  implementer: USAGE_RANK.rank2,
  reviewer: USAGE_RANK.rank3,
  verifier: USAGE_RANK.rank4,
  Explore: USAGE_RANK.rank5,
  other: USAGE_RANK.rank6,
}

const TYPE_RANKS = [
  USAGE_RANK.rank1,
  USAGE_RANK.rank2,
  USAGE_RANK.rank3,
  USAGE_RANK.rank4,
  USAGE_RANK.rank5,
] as const

/** Subagent types by rank (1st..5th), the folded `(other)` last. */
export const typeColor = (index: number, other: boolean): string =>
  other ? USAGE_RANK.rank6 : (TYPE_RANKS[index] ?? USAGE_RANK.rank6)
