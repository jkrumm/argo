/**
 * PINNED CONTRACT — the response of modelpick's `GET /api/efficiency` (repo ~/SourceRoot/modelpick),
 * relayed by Argo as `GET /api/models/efficiency`. Copied from the agreed contract; re-copy when the
 * modelpick side changes, do not edit by hand.
 *
 * Money is dollars, time is seconds, prices are dollars per 1M tokens. `intelligence` is the
 * Artificial Analysis Intelligence Index and `costPerTask` what AA measured to run its index suite
 * once. `tokensPerTaskEst` (cost / output price) and `timePerTaskEstSec` (tokens / speed) are
 * ESTIMATES. `supersededBy` is the superseding lineage's slug. A route's `variantSlug` is null when AA has
 * no row for its model at its effort (`reason` says so).
 */
export type Effort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'default'

export interface EfficiencyVariant {
  slug: string
  name: string
  lineage: string
  effort: Effort
  creator: string
  releaseDate: string | null
  intelligence: number
  costPerTask: number | null
  priceIn: number | null
  priceOut: number | null
  priceCacheRead: number | null
  tokensPerTaskEst: number | null
  timePerTaskEstSec: number | null
  e2eSec: number | null
  tps: number | null
  ttfatSec: number | null
  superseded: boolean
  supersededBy: string | null
  iu: { id: string | null; listed: boolean; accessible: boolean; legs: string[] }
}

export interface EfficiencyRoute {
  route: string
  wire: string
  model: string
  effort: string | null
  /** `subscription` runs on a Max quota and does not bill the listed dollars. */
  access: 'subscription' | 'metered'
  variantSlug: string | null
  reason: string | null
}

export interface UnscoredModel {
  id: string
  legs: string[]
  accessible: boolean
}

export interface EfficiencyResponse {
  capturedAt: string | null
  generatedAt: string
  source: {
    name: 'Artificial Analysis'
    url: 'https://artificialanalysis.ai'
    attribution: 'Source: Artificial Analysis (artificialanalysis.ai)'
  }
  variants: EfficiencyVariant[]
  routes: EfficiencyRoute[]
  routesError: string | null
  unscored: UnscoredModel[]
}
