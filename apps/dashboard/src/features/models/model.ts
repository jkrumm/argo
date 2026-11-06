/**
 * The models page's logic, pure: which variants are visible, the efficiency index, the Pareto frontier
 * and the attractive quadrant of the chart, the effort ladders, the leanest alternative to a slot, and
 * the slots grouped from the agw routes. The components only draw what this returns.
 */
import type { EfficiencyRoute, EfficiencyVariant, Effort } from './api/types'

export const EFFORT_ORDER: readonly Effort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'default',
]

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
export const INDEX_WEIGHTS = { cost: 0.6, time: 0.3, tokens: 0.1 } as const

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

// ── chart points ────────────────────────────────────────────────────────────

export type Axis = 'index' | 'cost' | 'tokens' | 'time'

/** The x of a variant on an axis (time in minutes), or null when it cannot sit on a log axis. */
export function axisValue(
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
  /** Intelligence. */
  y: number
  /** The efficiency index, null when the variant misses a measure. */
  index: number | null
}

export function scatterPoints(
  variants: readonly EfficiencyVariant[],
  axis: Axis,
  indexes: ReadonlyMap<string, number>,
): { points: ScatterPoint[]; free: number; missing: number } {
  const points: ScatterPoint[] = []
  let free = 0
  let missing = 0
  for (const variant of variants) {
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
      y: variant.intelligence,
      index: indexes.get(variant.slug) ?? null,
    })
  }
  return { points, free, missing }
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

/** The y domain every chart shares: the visible intelligence range, padded and snapped to 5. */
export function intelligenceDomain(variants: readonly EfficiencyVariant[]): [number, number] {
  if (variants.length === 0) return [0, 60]
  const values = variants.map((v) => v.intelligence)
  const low = Math.floor((Math.min(...values) - 2) / 5) * 5
  const high = Math.ceil((Math.max(...values) + 2) / 5) * 5
  return [Math.max(0, low), high]
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

/** The leanest variant in `pool` at equal or better intelligence, if it saves enough to matter. */
export function leanestAlternative(
  variant: EfficiencyVariant,
  pool: readonly EfficiencyVariant[],
  indexes: ReadonlyMap<string, number>,
): Alternative | null {
  const own = indexes.get(variant.slug)
  if (own === undefined) return null
  let best: { by: EfficiencyVariant; index: number } | null = null
  for (const candidate of pool) {
    if (candidate.slug === variant.slug || candidate.superseded) continue
    if (candidate.intelligence < variant.intelligence) continue
    const index = indexes.get(candidate.slug)
    if (index === undefined) continue
    if (best === null || index < best.index) best = { by: candidate, index }
  }
  if (best === null || best.index > MIN_SAVING * own) return null
  return {
    by: best.by,
    points: best.by.intelligence - variant.intelligence,
    indexRatio: best.index / own,
  }
}
