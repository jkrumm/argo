/**
 * The persistent labels of one scatter, pure: the highlighted lineage, then every variant a route uses
 * (always labelled), then the frontier around them. Rings come first and are never dropped; on a phone
 * the frontier labels are what gives way.
 */
import { placeLabels, type LabelCandidate, type PlacedLabel } from './labels'
import { paretoFrontier, type RouteUse, type ScatterPoint } from './model'
import { toPlotPixel } from './pointer'

export const DOT_R = 3.4
export const ROUTED_R = 4.8
export const SELECTED_BUMP = 0.8
export const RING_GAP = 4.5
/** Estimated glyph width of the 12 px label font, px. */
export const CHAR_WIDTH = 6.4
export const LINE_HEIGHT = 14
/** Under this plot width (px) labels shorten from `· 4 routes` to `· 4`. */
export const NARROW_PLOT_PX = 420

export const dotRadius = (
  point: ScatterPoint,
  use: ReadonlyMap<string, RouteUse>,
  selected: string,
): number =>
  (use.has(point.variant.slug) ? ROUTED_R : DOT_R) +
  (point.variant.lineage === selected ? SELECTED_BUMP : 0)

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export interface LabelPassInput {
  /** The points drawn. */
  points: readonly ScatterPoint[]
  use: ReadonlyMap<string, RouteUse>
  /** The highlighted lineage slug, `''` for none. */
  selected: string
  /** A lineage's short chart-label name. */
  names: (lineage: string) => string
  /** The plot in px and the domains the chart is given. */
  plot: { width: number; height: number }
  xDomain: readonly [number, number]
  yDomain: readonly [number, number]
}

export interface LabelPass {
  placed: PlacedLabel[]
  /** The Pareto frontier of the points drawn. */
  frontier: ScatterPoint[]
}

export function labelPass(input: LabelPassInput): LabelPass {
  const { points, use, selected, names, plot, xDomain, yDomain } = input
  const frontier = paretoFrontier(
    points,
    (p) => p.x,
    (p) => p.y,
  )
  const frontierSlugs = new Set(frontier.map((p) => p.variant.slug))
  const narrow = plot.width < NARROW_PLOT_PX
  const routesOf = (p: ScatterPoint): number => use.get(p.variant.slug)?.routes.length ?? 0

  const labelText = (p: ScatterPoint): string => {
    const routes = routesOf(p)
    const { lineage, effort } = p.variant
    if (lineage === selected && routes === 0) {
      return effort === 'default' ? names(lineage) : effort
    }
    const name = `${names(lineage)}${effort === 'default' ? '' : ` ${effort}`}`
    if (routes === 0) return name
    return narrow ? `${name} · ${routes}` : `${name} · ${plural(routes, 'route')}`
  }
  // Selected lineage, then routed, then frontier; the rest has no persistent label.
  const rank = (p: ScatterPoint): number =>
    (p.variant.lineage === selected ? 0 : 3) +
    (routesOf(p) > 0 ? 0 : frontierSlugs.has(p.variant.slug) ? 1 : 9)
  const labelled = points
    .filter((p) => rank(p) < 9)
    .toSorted((a, b) => rank(a) - rank(b) || routesOf(b) - routesOf(a) || b.y - a.y)

  const pixel = (p: ScatterPoint) => toPlotPixel({ x: p.lx, y: p.y }, xDomain, yDomain, plot)
  const candidates: LabelCandidate[] = labelled.map((p) => ({
    id: p.variant.slug,
    text: labelText(p),
    ...pixel(p),
    r: dotRadius(p, use, selected) + (routesOf(p) > 0 ? RING_GAP : 0),
    required: routesOf(p) > 0,
  }))
  // A ring is part of its dot: a label keeps clear of it too.
  const obstacles = points.map((p) => ({
    ...pixel(p),
    r: dotRadius(p, use, selected) + (routesOf(p) > 0 ? RING_GAP : 0) + 1.5,
  }))
  const placed = placeLabels(candidates, obstacles, {
    width: plot.width,
    height: plot.height,
    charWidth: CHAR_WIDTH,
    lineHeight: LINE_HEIGHT,
  })
  return { placed, frontier }
}
