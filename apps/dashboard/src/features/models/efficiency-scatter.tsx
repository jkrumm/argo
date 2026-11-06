/**
 * One scatter of the models page: intelligence (y, shared by all three) against a log axis of cost,
 * tokens or time per task. Composed on `CartesianChart` because no shipped kind draws a scatter.
 *
 * The encoding is the same on every chart so the eye carries over: a thin line joins each lineage's
 * variants in effort order (the ladder), a dotted line is the Pareto frontier of what is drawn, a faint
 * band is the most attractive quadrant (cheaper than the median, smarter than the median), the three
 * vendors have a hue and everything else is neutral, and a variant one of the owner's routes uses gets a
 * ring (solid on a quota, dashed when it bills) and a persistent label. The x scale is linear over
 * `log10(x)`: `CartesianChart` has a log y axis only, so ticks and the tooltip map back to the value.
 */
import { Anchor, Box, Text } from '@mantine/core'
import { dot } from '@tanstack/charts/dot'
import { lineY } from '@tanstack/charts/line'
import { decorative } from '@tanstack/charts/mark/decorative'
import { rect } from '@tanstack/charts/rect'
import { text } from '@tanstack/charts/text'
import { useSizeClass } from 'basalt-ui'
import {
  CartesianChart,
  ChartCard,
  type ChartMarks,
  type ChartSeries,
  type ChartState,
  type ChartTooltipRow,
  type ResponsiveChartHeight,
  type PlotContext,
} from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { MODEL_CREATOR } from '../../lib/series'
import type { EfficiencyResponse } from './api/types'
import {
  APPROX,
  EM_DASH,
  fmtMinuteTick,
  fmtPrice,
  fmtSeconds,
  fmtTokenTick,
  fmtTokens,
  fmtUsd,
  logTicks,
} from './format'
import { placeLabels, type LabelCandidate, type LabelObstacle } from './labels'
import {
  attractiveQuadrant,
  creatorKey,
  ladders,
  paretoFrontier,
  type Axis,
  type RouteUse,
  type ScatterPoint,
} from './model'

const NEVER = () => null

const AXIS_TICK: Record<Axis, (value: number) => string> = {
  cost: (v) => fmtUsd(v),
  tokens: fmtTokenTick,
  time: fmtMinuteTick,
}

/** Log10 units added to each end of the x domain. */
const X_PAD = 0.14
const DOT_R = 3.4
const ROUTED_R = 4.8
const SELECTED_BUMP = 0.8
const RING_GAP = 4.5
const RING_SEGMENTS = 28
const DIM_OPACITY = 0.2
/** Estimated glyph width of the 12 px label font, px. */
const CHAR_WIDTH = 6.3
const LINE_HEIGHT = 14
/** Under this plot width (px) labels shorten from `· 4 routes` to `· 4`. */
const NARROW_PLOT_PX = 420

type Vendor = 'openai' | 'anthropic' | 'google' | 'other'

function vendorOf(variant: ScatterPoint['variant']): Vendor {
  const key = creatorKey(variant.creator)
  return key === 'openai' || key === 'anthropic' || key === 'google' ? key : 'other'
}

const VENDOR_COLOR: Record<Vendor, string> = {
  openai: MODEL_CREATOR.openai,
  anthropic: MODEL_CREATOR.anthropic,
  google: MODEL_CREATOR.google,
  other: VX.neutral,
}

const VENDOR_LABEL: Record<Vendor, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  other: 'Others',
}

export interface EfficiencyScatterProps {
  axis: Axis
  title: string
  subtitle: string
  info: string
  points: readonly ScatterPoint[]
  /** Variants with a cost of exactly 0: not on a log axis, counted in the footnote. */
  free: number
  /** The y domain all three charts share. */
  yDomain: readonly [number, number]
  use: ReadonlyMap<string, RouteUse>
  /** The highlighted lineage, `''` for none. */
  selected: string
  /** A lineage's display name. */
  names: (lineage: string) => string
  source: EfficiencyResponse['source'] | null
  state: ChartState
  height: number | ResponsiveChartHeight
  cursorGroup: string
}

const effortWord = (effort: string): string => (effort === 'default' ? '' : ` ${effort}`)

const variantName = (p: ScatterPoint, names: (lineage: string) => string): string =>
  `${names(p.variant.lineage)}${effortWord(p.variant.effort)}`

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The dots of one look are one mark: `dot` takes a single fill. */
interface DotGroup {
  color: string
  fillOpacity: number
  r: number
  points: ScatterPoint[]
}

export function EfficiencyScatter(props: EfficiencyScatterProps) {
  const { axis, points, free, source, state, height } = props
  const compact = useSizeClass() === 'compact'
  const resting = !state.pending && !state.error && !state.empty && points.length > 0

  return (
    <ChartCard
      title={props.title}
      subtitle={props.subtitle}
      info={props.info}
      placeholderHeight={height}
      state={state}
    >
      {resting ? (
        <>
          <Scatter {...props} compact={compact} />
          <Footnote source={source} free={free} axis={axis} />
        </>
      ) : null}
    </ChartCard>
  )
}

function Footnote({
  source,
  free,
  axis,
}: {
  source: EfficiencyResponse['source'] | null
  free: number
  axis: Axis
}) {
  return (
    <Box pt="xs">
      <Text size="xs" c="dimmed">
        {source === null ? null : (
          <Anchor href={source.url} target="_blank" rel="noopener noreferrer" inherit>
            {source.attribution}
          </Anchor>
        )}
        {free > 0
          ? ` · ${plural(free, 'free model')} not shown: a cost of $0 cannot sit on a log ${axis === 'cost' ? 'axis' : 'scale'}`
          : null}
      </Text>
    </Box>
  )
}

function Scatter({
  axis,
  points,
  yDomain,
  use,
  selected,
  names,
  height,
  cursorGroup,
  compact,
}: EfficiencyScatterProps & { compact: boolean }) {
  const lxs = points.map((p) => p.lx)
  const xDomain: readonly [number, number] = [Math.min(...lxs) - X_PAD, Math.max(...lxs) + X_PAD]
  const ticks = logTicks(10 ** xDomain[0], 10 ** xDomain[1], compact ? 4 : 6).map((t) =>
    Math.log10(t),
  )
  const [y0, y1] = yDomain

  const vendorsPresent = (['openai', 'anthropic', 'google', 'other'] as const).filter((v) =>
    points.some((p) => vendorOf(p.variant) === v),
  )
  const meteredPresent = points.some((p) => use.get(p.variant.slug)?.access === 'metered')
  const quotaPresent = points.some((p) => use.get(p.variant.slug)?.access === 'subscription')
  const quadrant = attractiveQuadrant(points)
  const ladderList = ladders(points).filter((l) => l.points.length > 1)

  const series: ChartSeries<ScatterPoint>[] = [
    {
      key: 'intelligence',
      label: 'Intelligence index',
      color: VX.ink2,
      getValue: (p) => p.y,
      formatValue: (v) => v.toFixed(1),
      legend: false,
    },
    ...vendorsPresent.map<ChartSeries<ScatterPoint>>((v) => ({
      key: `vendor-${v}`,
      label: VENDOR_LABEL[v],
      color: VENDOR_COLOR[v],
      mark: 'bar',
      getValue: NEVER,
    })),
    {
      key: 'ladder',
      label: 'Effort ladder',
      color: VX.muted,
      mark: 'line',
      role: 'reference',
      getValue: NEVER,
    },
    {
      key: 'frontier',
      label: 'Frontier',
      color: VX.ink2,
      mark: 'line',
      dash: 'dashed',
      role: 'reference',
      getValue: NEVER,
    },
    ...(quadrant === null
      ? []
      : [
          {
            key: 'quadrant',
            label: 'Most attractive',
            color: alpha(VX.status.good, 0.55),
            mark: 'bar',
            role: 'reference',
            getValue: NEVER,
          } satisfies ChartSeries<ScatterPoint>,
        ]),
    ...(quotaPresent
      ? [
          {
            key: 'ring-quota',
            label: 'Your route, on quota',
            color: VX.ink2,
            mark: 'line',
            role: 'reference',
            getValue: NEVER,
          } satisfies ChartSeries<ScatterPoint>,
        ]
      : []),
    ...(meteredPresent
      ? [
          {
            key: 'ring-metered',
            label: 'Your route, billed',
            color: VX.ink2,
            mark: 'line',
            dash: 'dashed',
            role: 'reference',
            getValue: NEVER,
          } satisfies ChartSeries<ScatterPoint>,
        ]
      : []),
  ]

  const marks = (plot: PlotContext<ScatterPoint, number>): ChartMarks => {
    const on = (key: string) => plot.visible.some((s) => s.key === key)
    const shown = points.filter((p) => on(`vendor-${vendorOf(p.variant)}`))
    const W = plot.plotWidth
    const H = plot.plotHeight
    const dimmed = (p: ScatterPoint) => selected !== '' && p.variant.lineage !== selected
    const out: ChartMarks[number][] = []

    // 1. The most attractive quadrant of what is drawn.
    if (quadrant !== null && on('quadrant')) {
      out.push(
        decorative(
          rect([0], {
            id: 'quadrant',
            x1: () => xDomain[0],
            x2: () => Math.log10(quadrant.xBelow),
            y1: () => quadrant.yAbove,
            y2: () => y1,
            fill: alpha(VX.status.good, 0.08),
          }),
        ),
      )
    }

    // 2. Effort ladders, one thin line per lineage in effort order.
    if (on('ladder')) {
      for (const ladder of ladderList) {
        const first = ladder.points[0]
        if (first === undefined) continue
        const vendor = vendorOf(first.variant)
        if (!on(`vendor-${vendor}`)) continue
        const dim = selected !== '' && ladder.lineage !== selected
        out.push(
          decorative(
            lineY(ladder.points, {
              id: `ladder-${ladder.lineage}`,
              x: (p) => p.lx,
              y: (p) => p.y,
              stroke: vendor === 'other' ? VX.muted : VENDOR_COLOR[vendor],
              strokeWidth: ladder.lineage === selected ? 2 : 1,
              strokeOpacity: dim ? 0.12 : ladder.lineage === selected ? 0.9 : 0.5,
            }),
          ),
        )
      }
    }

    // 3. The Pareto frontier of the points drawn, dotted.
    const frontier = paretoFrontier(
      shown,
      (p) => p.x,
      (p) => p.y,
    )
    if (frontier.length > 1 && on('frontier')) {
      out.push(
        decorative(
          lineY(frontier, {
            id: 'frontier',
            x: (p) => p.lx,
            y: (p) => p.y,
            stroke: VX.ink2,
            strokeWidth: 1.5,
            strokeOpacity: 0.8,
            strokeDasharray: '2 4',
            lineCap: 'round',
          }),
        ),
      )
    }

    // 4. Dots, grouped by look (a mark takes one fill). Dimmed first, the highlighted lineage last.
    const radius = (p: ScatterPoint) =>
      (use.has(p.variant.slug) ? ROUTED_R : DOT_R) +
      (p.variant.lineage === selected ? SELECTED_BUMP : 0)
    const groups = new Map<string, DotGroup>()
    for (const p of shown) {
      const vendor = vendorOf(p.variant)
      const color = VENDOR_COLOR[vendor]
      const fillOpacity = dimmed(p) ? DIM_OPACITY : vendor === 'other' ? 0.6 : 0.92
      const r = radius(p)
      const key = `${vendor}|${fillOpacity}|${r}`
      const group = groups.get(key) ?? { color, fillOpacity, r, points: [] }
      group.points.push(p)
      groups.set(key, group)
    }
    for (const [key, group] of [...groups].toSorted(
      ([, a], [, b]) => a.fillOpacity - b.fillOpacity,
    )) {
      out.push(
        dot(group.points, {
          id: `dots-${key}`,
          x: (p) => p.lx,
          y: (p) => p.y,
          r: group.r,
          fill: group.color,
          fillOpacity: group.fillOpacity,
          stroke: VX.dotStroke,
          strokeWidth: 1,
        }),
      )
    }

    // 5. Rings round the variants a route uses: solid on a quota, dashed when it bills.
    const dx = (xDomain[1] - xDomain[0]) / Math.max(W, 1)
    const dy = (y1 - y0) / Math.max(H, 1)
    for (const style of ['subscription', 'metered'] as const) {
      if (!on(style === 'subscription' ? 'ring-quota' : 'ring-metered')) continue
      for (const dim of [true, false]) {
        const ringed = shown.filter(
          (p) => use.get(p.variant.slug)?.access === style && dimmed(p) === dim,
        )
        if (ringed.length === 0) continue
        const rows = ringed.flatMap((p) => {
          const radiusPx = radius(p) + RING_GAP
          return Array.from({ length: RING_SEGMENTS + 1 }, (_, i) => {
            const angle = (i / RING_SEGMENTS) * Math.PI * 2
            return {
              slug: p.variant.slug,
              x: p.lx + Math.cos(angle) * radiusPx * dx,
              y: p.y + Math.sin(angle) * radiusPx * dy,
            }
          })
        })
        out.push(
          decorative(
            lineY(rows, {
              id: `ring-${style}-${dim ? 'dim' : 'on'}`,
              x: (r) => r.x,
              y: (r) => r.y,
              z: (r) => r.slug,
              stroke: VX.ink2,
              strokeWidth: 1.4,
              strokeOpacity: dim ? 0.2 : 0.9,
              ...(style === 'metered' ? { strokeDasharray: '3 2.5' } : {}),
            }),
          ),
        )
      }
    }

    // 6. Persistent labels: the highlighted lineage, then the routed variants, then the frontier.
    const frontierSlugs = new Set(frontier.map((p) => p.variant.slug))
    const narrow = W < NARROW_PLOT_PX
    const labelText = (p: ScatterPoint): string => {
      const routes = use.get(p.variant.slug)?.routes.length ?? 0
      if (p.variant.lineage === selected && routes === 0)
        return p.variant.effort === 'default' ? names(p.variant.lineage) : p.variant.effort
      const name = variantName(p, names)
      if (routes === 0) return name
      return narrow ? `${name} · ${routes}` : `${name} · ${plural(routes, 'route')}`
    }
    const rank = (p: ScatterPoint): number =>
      (p.variant.lineage === selected ? 0 : 3) +
      (use.has(p.variant.slug) ? 0 : frontierSlugs.has(p.variant.slug) ? 1 : 9)
    const labelled = shown
      .filter((p) => rank(p) < 9)
      .toSorted(
        (a, b) =>
          rank(a) - rank(b) ||
          (use.get(b.variant.slug)?.routes.length ?? 0) -
            (use.get(a.variant.slug)?.routes.length ?? 0) ||
          b.y - a.y,
      )
    const pixel = (p: ScatterPoint) => ({
      x: (plot.xFraction(p.lx) ?? Number.NaN) * W,
      y: (1 - (p.y - y0) / (y1 - y0)) * H,
    })
    const candidates: LabelCandidate[] = labelled.flatMap((p) => {
      const { x, y } = pixel(p)
      if (Number.isNaN(x)) return []
      return [
        {
          id: p.variant.slug,
          text: labelText(p),
          x,
          y,
          r: radius(p) + (use.has(p.variant.slug) ? RING_GAP : 0),
        },
      ]
    })
    const obstacles: LabelObstacle[] = shown.flatMap((p) => {
      const { x, y } = pixel(p)
      return Number.isNaN(x) ? [] : [{ x, y, r: radius(p) + 1.5 }]
    })
    const placed = placeLabels(candidates, obstacles, {
      width: W,
      height: H,
      charWidth: CHAR_WIDTH,
      lineHeight: LINE_HEIGHT,
    })
    const bySlug = new Map(shown.map((p) => [p.variant.slug, p]))
    for (const [bold, dim] of [
      [false, true],
      [false, false],
      [true, true],
      [true, false],
    ] as const) {
      const rows = placed.flatMap((label) => {
        const p = bySlug.get(label.id)
        if (p === undefined) return []
        const isBold = use.has(p.variant.slug)
        return isBold === bold && dimmed(p) === dim ? [{ p, label }] : []
      })
      if (rows.length === 0) continue
      out.push(
        decorative(
          text(rows, {
            id: `labels-${bold ? 'routed' : 'plain'}-${dim ? 'dim' : 'on'}`,
            x: (r) => r.p.lx,
            y: (r) => r.p.y,
            text: (r) => r.label.text,
            dx: (r) => r.label.dx,
            dy: (r) => r.label.dy,
            anchor: (r) => r.label.anchor,
            fill: dim ? VX.faint : bold ? VX.ink : VX.ink2,
            fontSize: VX.text.xs,
            fontWeight: bold ? 600 : 400,
          }),
        ),
      )
    }
    return out
  }

  const tooltipRows = (p: ScatterPoint): readonly ChartTooltipRow[] => {
    const v = p.variant
    const routes = use.get(v.slug)
    const rows: ChartTooltipRow[] = [
      { label: 'Cost per task', value: v.costPerTask === null ? EM_DASH : fmtUsd(v.costPerTask) },
      { label: 'Tokens per task', value: fmtTokens(v.tokensPerTaskEst) },
      { label: 'Time per task', value: fmtSeconds(v.timePerTaskEstSec) },
      {
        label: 'List price /1M',
        value: `${fmtPrice(v.priceIn)} in · ${fmtPrice(v.priceOut)} out${v.priceCacheRead === null ? '' : ` · ${fmtPrice(v.priceCacheRead)} cached`}`,
      },
      { label: 'Speed', value: v.tps === null ? EM_DASH : `${Math.round(v.tps)} tok/s` },
      {
        label: 'IU',
        value: v.iu.accessible ? `callable · ${v.iu.legs.join(', ') || EM_DASH}` : 'not callable',
      },
    ]
    if (routes !== undefined) {
      const ids = routes.routes.map((r) => r.route)
      rows.push({
        label: routes.access === 'subscription' ? 'Routes (on quota)' : 'Routes',
        value: ids.length > 3 ? `${ids.slice(0, 3).join(', ')} +${ids.length - 3}` : ids.join(', '),
      })
    }
    if (v.superseded) rows.push({ label: 'Superseded by', value: v.supersededBy ?? EM_DASH })
    return rows
  }

  return (
    <CartesianChart<ScatterPoint, number>
      ariaLabel={`${ariaLabelOf(axis)}, one dot per model and reasoning effort`}
      data={points}
      height={height}
      x={(p) => p.lx}
      xDomain={xDomain}
      xTicks={ticks}
      formatX={(lx) => AXIS_TICK[axis](10 ** lx)}
      cursorGroup={cursorGroup}
      series={series}
      marks={marks}
      y={{ domain: yDomain, ticks: yTicks(yDomain), format: (v) => String(v) }}
      legend={{ groups: true, toggle: true }}
      tooltip={{
        formatHeader: (_x, p) => variantName(p, names),
        rows: (p) => tooltipRows(p),
      }}
    />
  )
}

function ariaLabelOf(axis: Axis): string {
  switch (axis) {
    case 'cost':
      return 'Intelligence index against cost per task'
    case 'tokens':
      return `Intelligence index against ${APPROX} tokens per task`
    case 'time':
      return `Intelligence index against ${APPROX} time per task`
  }
}

const yTicks = ([lo, hi]: readonly [number, number]): number[] => {
  const step = hi - lo > 40 ? 10 : 5
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
  return out
}
