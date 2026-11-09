/**
 * The one scatter of the models page: intelligence (y) against a log axis of the efficiency index, cost,
 * tokens or time per task, switched by the toggle in the card's actions. Composed on `CartesianChart`
 * because no shipped kind draws a scatter.
 *
 * A thin line joins each lineage's
 * variants in effort order (the ladder), a dotted line is the Pareto frontier of what is drawn, a faint
 * band is the most attractive quadrant (cheaper than the median, smarter than the median), the three
 * vendors have a hue and everything else is neutral, and a variant one of the owner's routes uses gets a
 * ring (solid on a quota, dashed when it bills) and a persistent label. The x scale is linear over
 * `log10(x)`: `CartesianChart` has a log y axis only, so ticks and the tooltip map back to the value.
 * Hovering a dot dims the other ladders; a click highlights the lineage (`pick`, shown as a chip in the
 * actions). On a phone the tooltip is a block under the chart, so it never covers the dot.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Anchor, Box, Button, Group, Paper, Stack, Text } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import { dot } from '@tanstack/charts/dot'
import { lineY } from '@tanstack/charts/line'
import { decorative } from '@tanstack/charts/mark/decorative'
import { rect } from '@tanstack/charts/rect'
import { text } from '@tanstack/charts/text'
import { useSizeClass } from 'basalt-ui'
import { ViewTabs } from 'basalt-ui/controls'
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
import { modelsStore } from '../../lib/window-stores'
import type { EfficiencyResponse } from './api/types'
import {
  APPROX,
  EM_DASH,
  fmtIndex,
  fmtMinuteTick,
  fmtPrice,
  fmtSeconds,
  fmtTokenTick,
  fmtTokens,
  fmtUsd,
  logTicks,
  timeTicks,
} from './format'
import { captureRadius, nearestPoint, pointerInPlot, toPlotPixel } from './pointer'
import { dotRadius, labelPass, RING_GAP } from './scatter-labels'
import {
  attractiveQuadrant,
  creatorKey,
  ladders,
  paretoFrontier,
  type Axis,
  type RouteUse,
  type ScatterPoint,
} from './model'
import { useField } from '../../lib/use-field'

const NEVER = () => null

const AXIS_TICK: Record<Axis, (value: number) => string> = {
  index: fmtIndex,
  cost: (v) => fmtUsd(v),
  tokens: fmtTokenTick,
  time: fmtMinuteTick,
}

/** Log10 units added to each end of the x domain. */
const X_PAD = 0.14
const RING_SEGMENTS = 28
const DIM_OPACITY = 0.2

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
  /** Variants not drawn because the axis has no value for them, counted in the footnote. */
  missing: number
  /** What the missing ones lack ("speed measure"), for the footnote. */
  lacks: string
  yDomain: readonly [number, number]
  use: ReadonlyMap<string, RouteUse>
  /** A lineage's short chart-label name (the same rule for every lineage). */
  names: (lineage: string) => string
  /** A lineage's full readable name, for the tooltip. */
  display: (lineage: string) => string
  source: EfficiencyResponse['source'] | null
  state: ChartState
  height: number | ResponsiveChartHeight
}

const effortWord = (effort: string): string => (effort === 'default' ? '' : ` ${effort}`)

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The dots of one look are one mark: `dot` takes a single fill. */
interface DotGroup {
  color: string
  fillOpacity: number
  r: number
  points: ScatterPoint[]
}

export function EfficiencyScatter(props: EfficiencyScatterProps) {
  const { axis, points, free, missing, lacks, source, state, height, display } = props
  const compact = useSizeClass() === 'compact'
  const [pick, setPick] = useField(modelsStore.field.pick)
  const resting = !state.pending && !state.error && !state.empty && points.length > 0

  return (
    <ChartCard
      title={props.title}
      subtitle={props.subtitle}
      info={props.info}
      placeholderHeight={height}
      state={state}
      actions={
        <Group gap="xs" wrap="wrap" justify="flex-end">
          {pick === '' ? null : (
            <Button
              size="compact-xs"
              variant="light"
              color="gray"
              rightSection={<IconX size={12} />}
              aria-label={`Clear highlight: ${display(pick)}`}
              onClick={() => setPick('')}
            >
              {display(pick)}
            </Button>
          )}
          <ViewTabs field={modelsStore.field.metric} label="Chart measure" />
        </Group>
      }
    >
      {resting ? (
        <>
          <Scatter {...props} compact={compact} />
          <Footnote source={source} free={free} missing={missing} lacks={lacks} axis={axis} />
        </>
      ) : null}
    </ChartCard>
  )
}

function Footnote({
  source,
  free,
  missing,
  lacks,
  axis,
}: {
  source: EfficiencyResponse['source'] | null
  free: number
  missing: number
  lacks: string
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
        {missing > 0
          ? ` · ${plural(missing, 'variant')} not shown: ${missing === 1 ? 'it has' : 'they have'} no ${lacks}`
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
  names,
  display,
  height,
  compact,
}: EfficiencyScatterProps & { compact: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pick, setPick] = useField(modelsStore.field.pick)
  const [tip, setTip] = useState<TipAt | null>(null)
  // The lineage under the mouse lights its ladder over the picked one; transient, so not in the store.
  const [hover, setHover] = useState('')
  const selected = hover || pick
  const tipOpen = tip !== null

  // A phone's tooltip stays until the next tap: a touch outside the chart closes it.
  useEffect(() => {
    if (!tipOpen) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapRef.current?.contains(event.target)) return
      setTip(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [tipOpen])
  const lxs = points.map((p) => p.lx)
  const xDomain: readonly [number, number] = [Math.min(...lxs) - X_PAD, Math.max(...lxs) + X_PAD]
  const ticks = (axis === 'time' ? timeTicks : logTicks)(
    10 ** xDomain[0],
    10 ** xDomain[1],
    compact ? 4 : 6,
  ).map((t) => Math.log10(t))
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
    const radius = (p: ScatterPoint) => dotRadius(p, use, selected)
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

    // The point under the pointer or finger.
    const tipPoint = tip === null ? undefined : shown.find((p) => p.variant.slug === tip.slug)
    if (tipPoint !== undefined) {
      out.push(
        decorative(
          dot([tipPoint], {
            id: 'pointer',
            x: (p) => p.lx,
            y: (p) => p.y,
            r: radius(tipPoint) + 3,
            fill: VX.ink,
            fillOpacity: 0,
            stroke: VX.ink,
            strokeWidth: 1.5,
          }),
        ),
      )
    }

    // 6. Persistent labels.
    const { placed } = labelPass({
      points: shown,
      use,
      selected,
      names,
      plot: { width: W, height: H },
      xDomain,
      yDomain,
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
    const routeRow: ChartTooltipRow[] =
      routes === undefined
        ? []
        : [
            {
              label: routes.access === 'subscription' ? 'Routes · quota' : 'Routes',
              value: routeIds(routes.routes.map((r) => r.route)),
            },
          ]
    const core: ChartTooltipRow[] = [
      { label: 'Efficiency index', value: p.index === null ? EM_DASH : fmtIndex(p.index) },
      { label: 'Cost / task', value: v.costPerTask === null ? EM_DASH : fmtUsd(v.costPerTask) },
      { label: 'Tokens / task', value: fmtTokens(v.tokensPerTaskEst) },
      { label: 'Time / task', value: fmtSeconds(v.timePerTaskEstSec) },
    ]
    // A phone gets the figures that decide and the routes; the rest is on the desktop and in the catalog.
    if (compact) return [...core, ...routeRow]
    return [
      ...core,
      { label: 'Price /1M', value: `${fmtPrice(v.priceIn)} in · ${fmtPrice(v.priceOut)} out` },
      ...(v.priceCacheRead === null
        ? []
        : [{ label: 'Cached /1M', value: fmtPrice(v.priceCacheRead) }]),
      { label: 'Speed', value: v.tps === null ? EM_DASH : `${Math.round(v.tps)} tok/s` },
      {
        label: 'IU',
        value: v.iu.accessible ? `callable · ${v.iu.legs.join(', ') || EM_DASH}` : 'not callable',
      },
      ...routeRow,
      ...(v.superseded
        ? [
            {
              label: 'Superseded by',
              value: v.supersededBy === null ? EM_DASH : display(v.supersededBy),
            },
          ]
        : []),
    ]
  }

  /** The point nearest to the pointer in 2D pixel space, with where to draw its tooltip. */
  function locate(event: ReactPointerEvent | MouseEvent | React.MouseEvent) {
    const root = wrapRef.current
    const svg = root?.querySelector<SVGSVGElement>('svg.ts-chart')
    const clip = svg?.querySelector('clipPath rect')
    if (root === null || root === undefined || svg === null || svg === undefined || !clip)
      return null
    const box = svg.getBoundingClientRect()
    const frame = svg.viewBox.baseVal.width
    const scale = frame > 0 ? box.width / frame : 1
    const plot = {
      x: Number(clip.getAttribute('x')),
      y: Number(clip.getAttribute('y')),
      width: Number(clip.getAttribute('width')),
      height: Number(clip.getAttribute('height')),
    }
    const type = 'pointerType' in event ? event.pointerType : 'mouse'
    const radius = captureRadius(type)
    const at = pointerInPlot(
      { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale },
      plot,
      radius,
    )
    if (at === null) return null
    const hit = nearestPoint(
      at,
      points.map((p) => ({ p, ...toPlotPixel({ x: p.lx, y: p.y }, xDomain, yDomain, plot) })),
      radius,
    )
    if (hit === null) return null
    const rootBox = root.getBoundingClientRect()
    const x = box.left - rootBox.left + (plot.x + hit.x) * scale
    const y = box.top - rootBox.top + (plot.y + hit.y) * scale
    return {
      point: hit.p,
      x,
      y,
      plot: {
        left: box.left - rootBox.left + plot.x * scale,
        top: box.top - rootBox.top + plot.y * scale,
        width: plot.width * scale,
        height: plot.height * scale,
      },
    }
  }

  const show = (found: NonNullable<ReturnType<typeof locate>> | null) => {
    setTip(
      found === null
        ? null
        : {
            slug: found.point.variant.slug,
            x: found.x,
            y: found.y,
            plot: found.plot,
          },
    )
  }

  const tipPoint = tip === null ? undefined : points.find((p) => p.variant.slug === tip.slug)

  return (
    <Box
      ref={wrapRef}
      pos="relative"
      onPointerMove={(event) => {
        // A finger selects on tap; hover is the mouse's.
        if (event.pointerType === 'touch') return
        const found = locate(event)
        show(found)
        setHover(found === null ? '' : found.point.variant.lineage)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'touch') return
        setTip(null)
        setHover('')
      }}
      onClick={(event) => {
        const found = locate(event.nativeEvent as PointerEvent)
        show(found)
        if (found === null) return
        const lineage = found.point.variant.lineage
        setPick(lineage === pick ? '' : lineage)
      }}
    >
      <CartesianChart<ScatterPoint, number>
        ariaLabel={`${ariaLabelOf(axis)}, one dot per model and reasoning effort`}
        data={points}
        height={height}
        x={(p) => p.lx}
        xDomain={xDomain}
        xTicks={ticks}
        formatX={(lx) => AXIS_TICK[axis](10 ** lx)}
        series={series}
        marks={marks}
        y={{ domain: yDomain, ticks: yTicks(yDomain), format: (v) => String(v) }}
        legend={{ groups: true, toggle: false }}
        tooltip={false}
      />
      {tip === null || tipPoint === undefined ? null : (
        <PointTip
          point={tipPoint}
          title={`${display(tipPoint.variant.lineage)}${effortWord(tipPoint.variant.effort)}`}
          tip={tip}
          rows={tooltipRows(tipPoint)}
          compact={compact}
        />
      )}
    </Box>
  )
}

interface TipAt {
  slug: string
  /** The dot, px inside the chart wrapper. */
  x: number
  y: number
  /** The plot rectangle inside the wrapper. */
  plot: { left: number; top: number; width: number; height: number }
}

const TIP_WIDTH = 236
/** Room one row takes, and the title and padding, for placing the tooltip before it is measured. */
const TIP_ROW_PX = 17
const TIP_FRAME_PX = 40
const TIP_MARGIN = 6
const AXIS_PX = 26

/** `a, b +9`: the first two route ids and how many more. */
const routeIds = (ids: readonly string[]): string =>
  ids.length > 2 ? `${ids.slice(0, 2).join(', ')} +${ids.length - 2}` : ids.join(', ')

/**
 * The tooltip of one variant. It sits in the corner of the plot farthest from the dot, so it never covers
 * the dot or the ladder it belongs to, and it never takes the pointer.
 */
function PointTip({
  point,
  title,
  tip,
  rows,
  compact,
}: {
  point: ScatterPoint
  title: string
  tip: TipAt
  rows: readonly ChartTooltipRow[]
  compact: boolean
}) {
  const v = point.variant
  const body = (
    <Stack gap={2}>
      <Text size="sm" fw={600}>
        {title}
      </Text>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">
          Intelligence
        </Text>
        <Text size="xs">{v.intelligence.toFixed(1)}</Text>
      </Group>
      {rows.map((row) => (
        <Group key={row.label} justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {row.label}
          </Text>
          <Text size="xs" ta="right">
            {row.value}
          </Text>
        </Group>
      ))}
    </Stack>
  )
  // A phone: a block under the chart, so the finger and the tooltip never cover the dot.
  if (compact) {
    return (
      <Paper mt="xs" shadow="xs" data-shot-tip>
        {body}
      </Paper>
    )
  }
  const width = TIP_WIDTH
  const height = TIP_FRAME_PX + (rows.length + 1) * TIP_ROW_PX
  const { plot } = tip
  const left =
    tip.x < plot.left + plot.width / 2
      ? plot.left + plot.width - width - TIP_MARGIN
      : plot.left + TIP_MARGIN
  const top =
    tip.y < plot.top + plot.height / 2
      ? plot.top + plot.height - height - AXIS_PX
      : plot.top + TIP_MARGIN
  return (
    <Paper
      w={width}
      shadow="md"
      style={{
        position: 'absolute',
        zIndex: 5,
        pointerEvents: 'none',
        left: Math.max(0, left),
        top: Math.max(0, top),
      }}
    >
      {body}
    </Paper>
  )
}

function ariaLabelOf(axis: Axis): string {
  switch (axis) {
    case 'index':
      return 'Intelligence index against efficiency index'
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
