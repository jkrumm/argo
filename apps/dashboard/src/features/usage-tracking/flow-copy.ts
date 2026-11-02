/** Definitions the router's cards and its detail share. */
export const PICKS_INFO =
  'One pick per Anthropic request the gateway served: the credit pool it drew on, the IU passthrough, or a refusal, with the reason. A drained retry writes two picks. The list is the reason of each pick.'
export const IU_INFO =
  'Gateway rows billed to the IU personal key over the range, by cause: a non-Claude model is on IU by design, a Claude model takes its pick’s reason. Claude work on IU (Claude Code shaped, credit fallback, route fallback) is drawn in the warn ink. The Athena team key never counts.'
export const CACHE_INFO =
  'Share of a caller’s prompt tokens served from the cache: cache-read over input + cache-read + cache-write, per caller and the pool or IU it paid with. Caches are per organization, so a session that changes pool starts cold.'
