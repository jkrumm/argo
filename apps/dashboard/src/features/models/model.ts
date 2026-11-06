/**
 * The models page's logic, pure: which variants are visible, the Pareto frontier and the attractive
 * quadrant of a chart, the effort ladders, the verdict on a slot, the slots grouped from the agw
 * routes, and the catalog's lineage rows. The components only draw what this returns.
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

// ── chart points ────────────────────────────────────────────────────────────

export type Axis = 'cost' | 'tokens' | 'time'

/** The x of a variant on an axis (time in minutes), or null when it cannot sit on a log axis. */
export function axisValue(variant: EfficiencyVariant, axis: Axis): number | null {
  const raw =
    axis === 'cost'
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
}

export function scatterPoints(
  variants: readonly EfficiencyVariant[],
  axis: Axis,
): { points: ScatterPoint[]; free: number } {
  const points: ScatterPoint[] = []
  let free = 0
  for (const variant of variants) {
    const x = axisValue(variant, axis)
    if (x === null) {
      if (variant.costPerTask === 0) free += 1
      continue
    }
    points.push({ variant, x, lx: Math.log10(x), y: variant.intelligence })
  }
  return { points, free }
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

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
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

// ── verdict ─────────────────────────────────────────────────────────────────

/**
 * What a better variant has to offer to count as "beating" a slot: enough more intelligence for about
 * the same money, or a smaller gain for half the money. A bare tie on intelligence at a quarter of the
 * price is not here on purpose: Terra low is 0.8 points over DeepSeek high and a seventh of the price,
 * but it is not the model anyone would move to.
 */
export const BEATS: readonly { minGain: number; maxCostRatio: number }[] = [
  { minGain: 5, maxCostRatio: 1.1 },
  { minGain: 2, maxCostRatio: 0.5 },
]

export type Verdict =
  | { kind: 'unscored' }
  | { kind: 'frontier' }
  | { kind: 'near' }
  | { kind: 'beaten'; by: EfficiencyVariant; points: number; costRatio: number }

/**
 * The verdict on a slot's variant against the `visible` ones: beaten by the cheapest callable variant
 * that meets {@link BEATS}, else on the cost frontier, else near it.
 */
export function verdictOf(
  variant: EfficiencyVariant,
  visible: readonly EfficiencyVariant[],
): Verdict {
  const cost = variant.costPerTask
  if (cost === null || cost <= 0) return { kind: 'unscored' }
  const better = visible
    .filter(
      (c) =>
        c.slug !== variant.slug && c.iu.accessible && c.costPerTask !== null && c.costPerTask > 0,
    )
    .map((c) => ({
      by: c,
      points: c.intelligence - variant.intelligence,
      costRatio: (c.costPerTask ?? 0) / cost,
    }))
    .filter((c) => BEATS.some((b) => c.points >= b.minGain && c.costRatio <= b.maxCostRatio))
    .toSorted((a, b) => a.costRatio - b.costRatio || b.points - a.points)
  const best = better[0]
  if (best !== undefined) return { kind: 'beaten', ...best }
  const priced = [...visible, variant].filter((v) => v.costPerTask !== null && v.costPerTask > 0)
  const frontier = paretoFrontier(
    priced,
    (v) => v.costPerTask ?? 0,
    (v) => v.intelligence,
  )
  return { kind: frontier.some((v) => v.slug === variant.slug) ? 'frontier' : 'near' }
}

// ── catalog ─────────────────────────────────────────────────────────────────

export interface LineageRow {
  lineage: string
  creator: string
  releaseDate: string | null
  /** The variants in effort order. */
  variants: EfficiencyVariant[]
  /** The most intelligent variant: the catalog's cost, tokens and time are this one's. */
  best: EfficiencyVariant
  callable: boolean
  legs: string[]
  /** Routes using any variant of the lineage. */
  slots: number
  superseded: boolean
}

export function lineageRows(
  visible: readonly EfficiencyVariant[],
  routes: readonly EfficiencyRoute[],
): LineageRow[] {
  const use = routeUse(routes)
  const groups = new Map<string, EfficiencyVariant[]>()
  for (const variant of visible) {
    const list = groups.get(variant.lineage) ?? []
    list.push(variant)
    groups.set(variant.lineage, list)
  }
  return [...groups].map(([lineage, list]) => {
    const variants = list.toSorted(byEffort)
    const best = variants.reduce((a, b) => (b.intelligence > a.intelligence ? b : a))
    return {
      lineage,
      creator: best.creator,
      releaseDate: best.releaseDate,
      variants,
      best,
      callable: variants.some((v) => v.iu.accessible),
      legs: [...new Set(variants.flatMap((v) => v.iu.legs))],
      slots: variants.reduce((n, v) => n + (use.get(v.slug)?.routes.length ?? 0), 0),
      superseded: variants.every((v) => v.superseded),
    }
  })
}

export const CATALOG_SORT_KEYS = [
  'lineage',
  'creator',
  'released',
  'intelligence',
  'cost',
  'tokens',
  'time',
  'priceIn',
  'priceOut',
  'slots',
] as const
export type CatalogSortKey = (typeof CATALOG_SORT_KEYS)[number]

const sortValue = (row: LineageRow, key: CatalogSortKey): string | number | null => {
  switch (key) {
    case 'lineage':
      return row.lineage
    case 'creator':
      return row.creator
    case 'released':
      return row.releaseDate
    case 'intelligence':
      return row.best.intelligence
    case 'cost':
      return row.best.costPerTask
    case 'tokens':
      return row.best.tokensPerTaskEst
    case 'time':
      return row.best.timePerTaskEstSec
    case 'priceIn':
      return row.best.priceIn
    case 'priceOut':
      return row.best.priceOut
    case 'slots':
      return row.slots
  }
}

/** Rows ordered by a column; a row without the value sorts last in either direction. */
export function sortLineageRows(
  rows: readonly LineageRow[],
  key: CatalogSortKey,
  dir: 'asc' | 'desc',
): LineageRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows.toSorted((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1
    const order = typeof va === 'string' ? va.localeCompare(String(vb)) : va - Number(vb)
    return sign * order || a.lineage.localeCompare(b.lineage)
  })
}
