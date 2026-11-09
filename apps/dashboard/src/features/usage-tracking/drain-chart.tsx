/**
 * One drain card's chart: what is left over the card's window, the same form for every card. Recorded
 * solid with a faint fill and a dot at now, the projection dashed from now with a fainter fill, the even
 * pace dotted, every jump back up labelled with what it gives back. One neutral ink: the marks and the
 * labels carry the reading, not hue. Composed on `CartesianChart` because no shipped kind draws rules
 * and labels over lines; `drain-model.ts` owns the data, this file only draws it.
 */
import { areaY } from '@tanstack/charts/area'
import { dot } from '@tanstack/charts/dot'
import { lineY } from '@tanstack/charts/line'
import { decorative } from '@tanstack/charts/mark/decorative'
import { ruleX } from '@tanstack/charts/rule'
import { text } from '@tanstack/charts/text'
import {
  CartesianChart,
  type ChartMarks,
  type ChartSeries,
  type PlotContext,
} from 'basalt-ui/charts'
import { useSizeClass } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import {
  drainRows,
  drainTicks,
  placeResetLabel,
  thinJumps,
  type DrainKey,
  type DrainModel,
  type DrainRow,
} from './drain-model'
import { shortDay, shortHour } from './model'

/** Under this plot width (px) captions stack instead of sitting side by side. */
const NARROW_PLOT_PX = 320

const DOTTED = '2 3'

/** Every drain line is this one ink. */
const INK = VX.ink

const LINE_WIDTH: Record<DrainKey, number> = { actual: 2, projection: 1.75, even: 1 }

/** Jump labels closer than this (px) would touch; the bigger jump keeps its label. */
const JUMP_GAP_PX = 44

/** Head room above the full line so a jump to the top still has its label inside the plot. */
const HEADROOM = 1.12

type Plot = PlotContext<DrainRow, Date>
type Mark = ChartMarks[number]

function lineMarks(plot: Plot): Mark[] {
  const bottom = plot.yDomain[0]
  return plot.visible.flatMap((s) => {
    const key = s.key as DrainKey
    const points = plot.rows(key).filter((r) => r.y !== null)
    const area =
      key === 'even'
        ? []
        : [
            areaY(points, {
              id: `${key}-area`,
              x: (r) => r.x,
              y: 'y',
              y1: bottom,
              fill: alpha(INK, key === 'actual' ? 0.12 : 0.05),
            }),
          ]
    const line = lineY(points, {
      id: key,
      x: (r) => r.x,
      y: 'y',
      z: 'series',
      stroke: s.color,
      strokeWidth: LINE_WIDTH[key],
      strokeOpacity: key === 'even' ? 0.7 : 1,
      ...(key === 'projection' ? { strokeDasharray: VX.dashArray } : {}),
      ...(key === 'even' ? { strokeDasharray: DOTTED } : {}),
    })
    return [...area, line]
  })
}

function nowMarks(plot: Plot, model: DrainModel): Mark[] {
  const now = new Date(model.now)
  const leftwards = (plot.xFraction(now) ?? 0) > 0.5
  return [
    decorative(
      ruleX([{ at: now }], {
        id: 'now',
        x: (d) => d.at,
        stroke: VX.ink2,
        strokeOpacity: 0.7,
        strokeWidth: 1,
        strokeDasharray: VX.dashArray,
      }),
    ),
    decorative(
      text([{ at: now }], {
        id: 'now-label',
        x: (d) => d.at,
        y: () => plot.yDomain[1],
        text: () => 'now',
        fill: VX.ink2,
        fontSize: VX.text.xs,
        anchor: leftwards ? 'end' : 'start',
        dx: leftwards ? -4 : 4,
        dy: 10,
      }),
    ),
  ]
}

/** The one reset a key has is the day it is back under its cap: labelled at the top, short. */
function resetMarks(plot: Plot, model: DrainModel): Mark[] {
  const now = new Date(model.now)
  return model.resets.flatMap((reset, i) => {
    const at = new Date(reset.at)
    const full = reset.label.replace(/^back /, '')
    const place = placeResetLabel({
      plotWidth: plot.plotWidth,
      nowFraction: plot.xFraction(now) ?? 0,
      resetFraction: plot.xFraction(at) ?? 0,
      full,
      short: full.replace(/^under cap /, ''),
    })
    return [
      decorative(
        ruleX([{ at }], {
          id: `reset-${i}`,
          x: (d) => d.at,
          stroke: VX.muted,
          strokeOpacity: 0.7,
          strokeWidth: 1,
          strokeDasharray: VX.dashArray,
        }),
      ),
      decorative(
        text([{ at }], {
          id: `reset-label-${i}`,
          x: (d) => d.at,
          y: () => plot.yDomain[1],
          text: () => place.text,
          fill: VX.ink2,
          fontSize: VX.text.xs,
          anchor: place.anchor,
          dx: place.anchor === 'end' ? -4 : 4,
          dy: place.row === 0 ? 10 : 24,
        }),
      ),
    ]
  })
}

function jumpMarks(plot: Plot, model: DrainModel): Mark[] {
  const jumps = thinJumps(
    model.jumps.filter((j) => j.at >= model.window.from && j.at <= model.window.to),
    (at) => (plot.xFraction(new Date(at)) ?? 0) * plot.plotWidth,
    JUMP_GAP_PX,
  )
  return [
    decorative(
      text(jumps, {
        id: 'jump-labels',
        x: (d) => new Date(d.at),
        y: (d) => d.left,
        text: (d) => d.label,
        fill: VX.ink2,
        fontSize: VX.text.xs,
        // Left of the rise: the line usually arrives lower there, and a label never leaves the plot's right edge.
        anchor: 'end',
        dx: -4,
        dy: -6,
      }),
    ),
  ]
}

function nowDotMarks(model: DrainModel): Mark[] {
  const point = model.actual[model.actual.length - 1]
  if (point === undefined) return []
  return [
    dot([point], {
      id: 'now-dot',
      x: (d) => new Date(d.at),
      y: (d) => d.left,
      r: 4,
      fill: INK,
    }),
  ]
}

function runOutMarks(plot: Plot, model: DrainModel): Mark[] {
  const runOut = model.runOut
  if (runOut === null) return []
  const point = { at: new Date(runOut.at), left: 0 }
  // A run-out still to come labels to its right (the line arrives from the left).
  const ahead = runOut.at > model.now
  return [
    dot([point], {
      id: 'run-out',
      x: (d) => d.at,
      y: (d) => d.left,
      r: 4,
      fill: VX.surface.panel,
      stroke: INK,
      strokeWidth: 1.5,
    }),
    decorative(
      text([point], {
        id: 'run-out-label',
        x: (d) => d.at,
        y: (d) => d.left,
        text: () => (plot.plotWidth < NARROW_PLOT_PX ? 'empty' : runOut.label),
        fill: VX.ink2,
        fontSize: VX.text.xs,
        anchor: ahead ? 'start' : 'end',
        dx: ahead ? 8 : -8,
        dy: -10,
      }),
    ),
  ]
}

export function DrainChart({ model, height }: { model: DrainModel; height: number }) {
  const compact = useSizeClass() === 'compact'
  const rows = drainRows(model)
  const format = (v: number): string => model.leftText(v)

  const series: ChartSeries<DrainRow>[] = [
    {
      key: 'actual',
      label: 'Recorded',
      color: INK,
      getValue: (d) => d.actual,
      formatValue: format,
      gaps: 'connect',
      strokeWidth: 2,
    },
    {
      key: 'projection',
      label: 'Projected',
      color: INK,
      getValue: (d) => d.projection,
      formatValue: format,
      dash: 'dashed',
      gaps: 'connect',
      strokeWidth: 1.75,
      role: 'overlay',
    },
    ...(model.even.length === 0
      ? []
      : [
          {
            key: 'even',
            label: 'Even pace',
            color: VX.muted,
            getValue: (d: DrainRow) => d.even,
            formatValue: format,
            gaps: 'connect' as const,
            strokeWidth: 1,
            tooltip: false,
            role: 'reference' as const,
          },
        ]),
  ]

  const marks = (plot: Plot): ChartMarks => [
    ...lineMarks(plot),
    ...nowMarks(plot, model),
    ...resetMarks(plot, model),
    ...jumpMarks(plot, model),
    ...nowDotMarks(model),
    ...runOutMarks(plot, model),
  ]

  return (
    <CartesianChart<DrainRow, Date>
      ariaLabel={`${model.title}: what is left, recorded and projected, with every jump back up labelled`}
      data={rows}
      height={height}
      x={(d) => d.at}
      xDomain={[new Date(model.window.from), new Date(model.window.to)]}
      xTicks={drainTicks(model.window, compact ? 3 : 5)}
      formatX={(d) => shortDay(d)}
      cursorGroup={`usage-drain-${model.id}-${model.kind}`}
      series={series}
      marks={marks}
      y={{
        domain: [0, model.yMax * HEADROOM],
        ticks: [0, model.yMax / 2, model.yMax],
        format: model.yText,
      }}
      tooltip={{ formatHeader: (d) => shortHour(d) }}
    />
  )
}
