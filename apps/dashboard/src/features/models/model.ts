/**
 * The models page's logic, pure: which variants are visible, the efficiency index, the Pareto frontier
 * and the attractive quadrant of the chart, the effort ladders, the leanest alternative to a slot, and
 * the slots grouped from the agw routes. The components only draw what this returns.
 */
import type { EfficiencyRoute, EfficiencyVariant, Effort } from './api/types'

const EFFORT_ORDER: readonly Effort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'default']

/** Position of an effort on the ladder; `default` (a model with no effort setting) sits last. */
export const effortRank = (effort: Effort): number => EFFORT_ORDER.indexOf(effort)

export const byEffort = (a: EfficiencyVariant, b: EfficiencyVariant): number =>
  effortRank(a.effort) - effortRank(b.effort) || a.intelligence - b.intelligence

// ── names ───────────────────────────────────────────────────────────────────

/** A lineage's readable name: a variant's `name` without its trailing parenthetical (`GPT-6.1 Terra (Medium)`). */
export const lineageNameOf = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '')

/** Lineage slug → readable name, from the first variant of each. */
export function lineageNames(variants: readonly EfficiencyVariant[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const variant of variants) {
    if (!names.has(variant.lineage)) names.set(variant.lineage, lineageNameOf(variant.name))
  }
  return names
}

/** A variant as the page names it: `GPT-6.1 Terra medium`; an effort-less model has no suffix. */
export const variantLabel = (
  variant: EfficiencyVariant,
  display: (lineage: string) => string,
): string =>
  `${display(variant.lineage)}${variant.effort === 'default' ? '' : ` ${variant.effort}`}`

/**
 * The lineage a route's model id belongs to, through any variant that carries it (`gpt-6.1-terra` is the
 * IU id of lineage `gpt-6-1-terra`), or null when no variant does.
 */
export function lineageOfModel(
  model: string,
  variants: readonly EfficiencyVariant[],
): string | null {
  const match = variants.find((v) => v.iu.id === model || v.lineage === model || v.slug === model)
  return match?.lineage ?? null
}

// ── creators ────────────────────────────────────────────────────────────────

export const CREATOR_VALUES = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'zai',
  'kimi',
  'alibaba',
  'other',
] as const
export type CreatorKey = (typeof CREATOR_VALUES)[number]

export const CREATOR_LABELS: Record<CreatorKey, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  zai: 'Z AI',
  kimi: 'Kimi',
  alibaba: 'Alibaba',
  other: 'Other',
}

export function creatorKey(creator: string): CreatorKey {
  const slug = creator.toLowerCase().replace(/[^a-z0-9]/g, '')
  return CREATOR_VALUES.find((key) => key === slug) ?? 'other'
}

// ── visibility ──────────────────────────────────────────────────────────────

export interface ModelFilters {
  /** Only variants the IU endpoint can call. */
  callable: boolean
  /** Also the models a newer one replaced. */
  superseded: boolean
  /** Creator keys; empty is every creator. */
  creators: readonly string[]
}

export const routedSlugs = (routes: readonly EfficiencyRoute[]): Set<string> =>
  new Set(routes.flatMap((r) => (r.variantSlug === null ? [] : [r.variantSlug])))

/**
 * A variant a route uses is always shown, whatever the callable and superseded filters say: the page
 * is about the slots, and a stale one must stay in sight. The creator filter still narrows the field.
 */
export function isVisible(
  variant: EfficiencyVariant,
  filters: ModelFilters,
  routed: ReadonlySet<string>,
): boolean {
  if (filters.creators.length > 0 && !filters.creators.includes(creatorKey(variant.creator))) {
    return false
  }
  if (routed.has(variant.slug)) return true
  if (filters.callable && !variant.iu.accessible) return false
  if (!filters.superseded && variant.superseded) return false
  return true
}

export const visibleVariants = (
  variants: readonly EfficiencyVariant[],
  filters: ModelFilters,
  routes: readonly EfficiencyRoute[],
): EfficiencyVariant[] => {
  const routed = routedSlugs(routes)
  return variants.filter((v) => isVisible(v, filters, routed))
}

// ── efficiency index ────────────────────────────────────────────────────────

/**
 * What the index weighs. The token and time estimates are derived from cost per task, so the index is
 * not three independent measurements: mathematically it weighs tokens x1, price x0.6 and speed x-0.3.
 * Lowering the tokens weight therefore raises the price or speed weight; token use stays x1.
 */
const INDEX_WEIGHTS = { cost: 0.6, time: 0.3, tokens: 0.1 } as const

const positive = (value: number | null): value is number => value !== null && value > 0

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * The efficiency index of every variant that has cost, time and tokens: a weighted geometric mean of
 * each against its median, so `1` is the median variant and lower is leaner. The medians are taken over
 * ALL the variants passed in (hand it the whole response, never the filtered set, so a filter cannot
 * move a model's index). A variant missing any of the three has no entry; nothing is renormalised.
 */
export function efficiencyIndexes(variants: readonly EfficiencyVariant[]): Map<string, number> {
  const measured = variants.flatMap((v) =>
    positive(v.costPerTask) && positive(v.timePerTaskEstSec) && positive(v.tokensPerTaskEst)
      ? [
          {
            slug: v.slug,
            cost: v.costPerTask,
            time: v.timePerTaskEstSec,
            tokens: v.tokensPerTaskEst,
          },
        ]
      : [],
  )
  const indexes = new Map<string, number>()
  if (measured.length === 0) return indexes
  const med = {
    cost: median(measured.map((m) => m.cost)),
    time: median(measured.map((m) => m.time)),
    tokens: median(measured.map((m) => m.tokens)),
  }
  for (const m of measured) {
    const log =
      INDEX_WEIGHTS.cost * Math.log(m.cost / med.cost) +
      INDEX_WEIGHTS.time * Math.log(m.time / med.time) +
      INDEX_WEIGHTS.tokens * Math.log(m.tokens / med.tokens)
    indexes.set(m.slug, Math.exp(log))
  }
  return indexes
}

// ── y score ─────────────────────────────────────────────────────────────────

export const Y_METRICS = ['combined', 'general', 'coding'] as const
export type YMetric = (typeof Y_METRICS)[number]

/**
 * How the Combined y blends its two percentile ranks. General is the rank of the AA intelligence index,
 * Coding the rank of Epoch's coding score, each among every variant of the response that has it.
 */
export const Y_WEIGHTS = { general: 0.5, coding: 0.5 } as const

export interface YScore {
  /** Intelligence for General; a 0-100 score for Coding and Combined. */
  value: number
  /** Combined only: no coding score, so `value` is the General rank alone. */
  fallback: boolean
}

/** Variant slug → its score on the active metric; a variant the metric cannot score has no entry. */
export type YScores = ReadonlyMap<string, YScore>

/** The coding score of a variant, or null: no Epoch row, a response from before the contract, or fewer than 2 benchmarks. */
export const codingScore = (variant: EfficiencyVariant): number | null =>
  variant.coding?.score ?? null

/**
 * Mid-rank percentile (0-100) of every entry among all of them: `(below + equal / 2) / n * 100`, equal
 * counting the entry itself, the same rank modelpick uses for the coding score.
 */
export function percentileRanks(
  entries: readonly { slug: string; value: number }[],
): Map<string, number> {
  const ranks = new Map<string, number>()
  for (const entry of entries) {
    let below = 0
    let equal = 0
    for (const other of entries) {
      if (other.value < entry.value) below += 1
      else if (other.value === entry.value) equal += 1
    }
    ranks.set(entry.slug, ((below + equal / 2) / entries.length) * 100)
  }
  return ranks
}

/**
 * The y score of every variant on the active metric. Hand it the whole response, never the filtered set,
 * so a filter cannot move a rank. General is the raw intelligence (every variant has one). Coding is the
 * coding score, absent for a variant without one. Combined is the Y_WEIGHTS mean of the two percentile
 * ranks; a variant with no coding score falls back to its General rank alone, flagged, never dropped and
 * never scored as zero.
 */
export function yScores(
  variants: readonly EfficiencyVariant[],
  metric: YMetric,
): Map<string, YScore> {
  const scores = new Map<string, YScore>()
  if (metric === 'general') {
    for (const v of variants) scores.set(v.slug, { value: v.intelligence, fallback: false })
    return scores
  }
  if (metric === 'coding') {
    for (const v of variants) {
      const coding = codingScore(v)
      if (coding !== null) scores.set(v.slug, { value: coding, fallback: false })
    }
    return scores
  }
  const general = percentileRanks(variants.map((v) => ({ slug: v.slug, value: v.intelligence })))
  const coded = variants.flatMap((v) => {
    const value = codingScore(v)
    return value === null ? [] : [{ slug: v.slug, value }]
  })
  const coding = percentileRanks(coded)
  for (const v of variants) {
    const rank = general.get(v.slug) ?? 0
    const codingRank = coding.get(v.slug)
    scores.set(
      v.slug,
      codingRank === undefined
        ? { value: rank, fallback: true }
        : { value: Y_WEIGHTS.general * rank + Y_WEIGHTS.coding * codingRank, fallback: false },
    )
  }
  return scores
}

// ── chart points ────────────────────────────────────────────────────────────

export type Axis = 'index' | 'cost' | 'tokens' | 'time'

/** The x of a variant on an axis (time in minutes), or null when it cannot sit on a log axis. */
function axisValue(
  variant: EfficiencyVariant,
  axis: Axis,
  indexes: ReadonlyMap<string, number>,
): number | null {
  const raw =
    axis === 'index'
      ? (indexes.get(variant.slug) ?? null)
      : axis === 'cost'
        ? variant.costPerTask
        : axis === 'tokens'
          ? variant.tokensPerTaskEst
          : variant.timePerTaskEstSec === null
            ? null
            : variant.timePerTaskEstSec / 60
  return raw !== null && raw > 0 ? raw : null
}

export interface ScatterPoint {
  variant: EfficiencyVariant
  /** The axis value, positive. */
  x: number
  /** `log10(x)`: the chart's linear x. */
  lx: number
  /** The active y score: intelligence for General, 0-100 for Coding and Combined. */
  y: number
  /** Combined only: the variant has no coding score, so `y` is its General rank alone. */
  fallback: boolean
  /** The efficiency index, null when the variant misses a measure. */
  index: number | null
}

export function scatterPoints(
  variants: readonly EfficiencyVariant[],
  axis: Axis,
  indexes: ReadonlyMap<string, number>,
  /** The active y; omitted is General (the raw intelligence). */
  ys: YScores = yScores(variants, 'general'),
): { points: ScatterPoint[]; free: number; missing: number; unscored: number } {
  const points: ScatterPoint[] = []
  let free = 0
  let missing = 0
  let unscored = 0
  for (const variant of variants) {
    const score = ys.get(variant.slug)
    if (score === undefined) {
      unscored += 1
      continue
    }
    const x = axisValue(variant, axis, indexes)
    if (x === null) {
      if (variant.costPerTask === 0) free += 1
      else missing += 1
      continue
    }
    points.push({
      variant,
      x,
      lx: Math.log10(x),
      y: score.value,
      fallback: score.fallback,
      index: indexes.get(variant.slug) ?? null,
    })
  }
  return { points, free, missing, unscored }
}

export interface Ladder {
  lineage: string
  points: ScatterPoint[]
}

/** Each lineage's points in effort order (none to max), the line that makes "medium vs high" a curve. */
export function ladders(points: readonly ScatterPoint[]): Ladder[] {
  const byLineage = new Map<string, ScatterPoint[]>()
  for (const point of points) {
    const list = byLineage.get(point.variant.lineage) ?? []
    list.push(point)
    byLineage.set(point.variant.lineage, list)
  }
  return [...byLineage].map(([lineage, list]) => ({
    lineage,
    points: list.toSorted((a, b) => byEffort(a.variant, b.variant)),
  }))
}

/** The best y for a given x or less: the points no other point beats on both axes, left to right. */
export function paretoFrontier<T>(
  items: readonly T[],
  x: (item: T) => number,
  y: (item: T) => number,
): T[] {
  const sorted = items.toSorted((a, b) => x(a) - x(b) || y(b) - y(a))
  const out: T[] = []
  let best = Number.NEGATIVE_INFINITY
  for (const item of sorted) {
    if (y(item) <= best) continue
    best = y(item)
    out.push(item)
  }
  return out
}

const MIN_QUADRANT_POINTS = 4

/** The most attractive quadrant of a chart: cheaper than the median x and above the median y. */
export function attractiveQuadrant(
  points: readonly ScatterPoint[],
): { xBelow: number; yAbove: number } | null {
  if (points.length < MIN_QUADRANT_POINTS) return null
  return { xBelow: median(points.map((p) => p.x)), yAbove: median(points.map((p) => p.y)) }
}

/** The visible range of `values`, padded and snapped to 5. */
function paddedDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 60]
  const low = Math.floor((Math.min(...values) - 2) / 5) * 5
  const high = Math.ceil((Math.max(...values) + 2) / 5) * 5
  return [Math.max(0, low), high]
}

/** The General y domain: the visible intelligence range, padded and snapped to 5. */
export const intelligenceDomain = (variants: readonly EfficiencyVariant[]): [number, number] =>
  paddedDomain(variants.map((v) => v.intelligence))

/**
 * The y domain of the active metric over the variants shown. General is the intelligence range; Coding
 * and Combined are 0-100 scores, so the top is capped at 100.
 */
export function yDomain(
  variants: readonly EfficiencyVariant[],
  ys: YScores,
  metric: YMetric,
): [number, number] {
  if (metric === 'general') return intelligenceDomain(variants)
  const [low, high] = paddedDomain(variants.flatMap((v) => ys.get(v.slug)?.value ?? []))
  return [low, Math.min(100, high)]
}

// ── slots ───────────────────────────────────────────────────────────────────

export interface SlotGroup {
  key: string
  model: string
  effort: string | null
  routes: EfficiencyRoute[]
  /** `mixed` when some of the routes bill the listed dollars and some run on a quota. */
  access: 'subscription' | 'metered' | 'mixed'
  variantSlug: string | null
  reason: string | null
}

/** The agw routes grouped by (model, effort); the route ids collapse into the list. */
export function groupSlots(routes: readonly EfficiencyRoute[]): SlotGroup[] {
  const groups = new Map<string, SlotGroup>()
  for (const route of routes) {
    const key = `${route.model}|${route.effort ?? ''}`
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, {
        key,
        model: route.model,
        effort: route.effort,
        routes: [route],
        access: route.access,
        variantSlug: route.variantSlug,
        reason: route.reason,
      })
      continue
    }
    group.routes.push(route)
    if (group.access !== route.access) group.access = 'mixed'
    group.variantSlug ??= route.variantSlug
    group.reason ??= route.reason
  }
  return [...groups.values()].toSorted(
    (a, b) => b.routes.length - a.routes.length || a.model.localeCompare(b.model),
  )
}

export interface RouteUse {
  routes: EfficiencyRoute[]
  /** Metered as soon as one route bills the listed dollars. */
  access: 'subscription' | 'metered'
}

/** Variant slug → the routes that use it. */
export function routeUse(routes: readonly EfficiencyRoute[]): Map<string, RouteUse> {
  const out = new Map<string, RouteUse>()
  for (const route of routes) {
    if (route.variantSlug === null) continue
    const use = out.get(route.variantSlug) ?? { routes: [], access: 'subscription' as const }
    use.routes.push(route)
    if (route.access === 'metered') use.access = 'metered'
    out.set(route.variantSlug, use)
  }
  return out
}

// ── leanest alternative ────────────────────────────────────────────────────

/** An alternative has to be at most this share of the slot's index to count: under 10% saved is noise. */
export const MIN_SAVING = 0.9

export interface Alternative {
  by: EfficiencyVariant
  /** Intelligence gained, zero or more. */
  points: number
  /** The alternative's index over the slot's: 0.4 is 60% leaner. */
  indexRatio: number
}

/**
 * The leanest variant in `pool` at equal or better score on the active y, if it saves enough to matter.
 * `ys` omitted is General (intelligence). A variant with no score on the metric has no alternative, and
 * a candidate with none is not one.
 */
export function leanestAlternative(
  variant: EfficiencyVariant,
  pool: readonly EfficiencyVariant[],
  indexes: ReadonlyMap<string, number>,
  ys: YScores = yScores([variant, ...pool], 'general'),
): Alternative | null {
  const own = indexes.get(variant.slug)
  const ownScore = ys.get(variant.slug)
  if (own === undefined || ownScore === undefined) return null
  let best: { by: EfficiencyVariant; index: number; score: number } | null = null
  for (const candidate of pool) {
    if (candidate.slug === variant.slug || candidate.superseded) continue
    const score = ys.get(candidate.slug)
    if (score === undefined || score.value < ownScore.value) continue
    const index = indexes.get(candidate.slug)
    if (index === undefined) continue
    if (best === null || index < best.index) best = { by: candidate, index, score: score.value }
  }
  if (best === null || best.index > MIN_SAVING * own) return null
  return {
    by: best.by,
    points: best.score - ownScore.value,
    indexRatio: best.index / own,
  }
}
