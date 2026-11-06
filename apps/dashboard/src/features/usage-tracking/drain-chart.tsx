/**
 * One drain card's chart: share left (0–100 %) over the card's fixed window, the same form for every
 * payer. Actual solid with a faint fill, the projection dashed from "now", the even pace dotted, a
 * rule at "now" and at each reset, a hollow dot where the projection reaches zero. Composed on
 * `CartesianChart` because no shipped kind draws rules and markers over lines; `drain-model.ts` owns
 * the data, this file only draws it.
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
import { withUnit } from '../../lib/format'
import { colorForPayer } from './constants'
import { drainRows, drainTicks, type DrainKey, type DrainModel, type DrainRow } from './drain-model'
import { shortDay, shortHour } from './model'

/** Under this plot width (px) captions stack instead of sitting side by side. */
const NARROW_PLOT_PX = 320

/** A rule past this share of the plot width labels to its left: no room to its right. */
const LEFTWARD_FROM = 0.55

const DOTTED = '2 3'

const pctTick = (v: number): string => withUnit(v, '%')

export function DrainChart({ model, height }: { model: DrainModel; height: number }) {
  const compact = useSizeClass() === 'compact'
  const rows = drainRows(model)
  const color = colorForPayer(model.payer)
  const format = (v: number): string => model.leftText(v)

  const series: ChartSeries<DrainRow>[] = [
    {
      key: 'actual',
      label: 'Left',
      color,
      getValue: (d) => d.actual,
      formatValue: format,
      gaps: 'connect',
      strokeWidth: 2,
    },
    {
      key: 'projection',
      label: 'Projected',
      color,
      getValue: (d) => d.projection,
      formatValue: format,
      dash: 'dashed',
      gaps: 'connect',
      strokeWidth: 1.75,
      role: 'overlay',
    },
    {
      key: 'even',
      label: 'Even pace',
      color: VX.muted,
      getValue: (d) => d.even,
      formatValue: format,
      gaps: 'connect',
      strokeWidth: 1,
      tooltip: false,
      role: 'reference',
    },
  ]

  const marks = (plot: PlotContext<DrainRow, Date>): ChartMarks => {
    const out: ChartMarks[number][] = []
    const narrow = plot.plotWidth < NARROW_PLOT_PX
    const top = plot.yDomain[1]
    const bottom = plot.yDomain[0]

    for (const s of plot.visible) {
      const key = s.key as DrainKey
      const points = plot.rows(key).filter((r) => r.y !== null)
      if (key === 'actual') {
        out.push(
          areaY(points, {
            id: 'actual-area',
            x: (r) => r.x,
            y: 'y',
            y1: bottom,
            fill: alpha(color, 0.12),
          }),
        )
      }
      out.push(
        lineY(points, {
          id: key,
          x: (r) => r.x,
          y: 'y',
          z: 'series',
          stroke: s.color,
          strokeWidth: key === 'actual' ? 2 : key === 'projection' ? 1.75 : 1,
          strokeOpacity: key === 'even' ? 0.7 : 1,
          ...(key === 'projection' ? { strokeDasharray: VX.dashArray } : {}),
          ...(key === 'even' ? { strokeDasharray: DOTTED } : {}),
        }),
      )
    }

    const now = new Date(model.now)
    out.push(
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
          y: () => top,
          text: () => 'now',
          fill: VX.ink2,
          fontSize: VX.text.xs,
          anchor: 'start',
          dx: 4,
          dy: 10,
        }),
      ),
    )

    for (const [i, reset] of model.resets.entries()) {
      const at = new Date(reset.at)
      const leftwards = (plot.xFraction(at) ?? 0) > LEFTWARD_FROM
      out.push(
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
            y: () => bottom,
            text: () => reset.label,
            fill: VX.ink2,
            fontSize: VX.text.xs,
            anchor: leftwards ? 'end' : 'start',
            dx: leftwards ? -4 : 4,
            // Stacked on a phone, where two captions would meet.
            dy: narrow ? -6 - i * 14 : -6,
          }),
        ),
      )
    }

    const runOut = model.runOut
    if (runOut !== null) {
      const point = { at: new Date(runOut.at), left: 0 }
      const leftwards = (plot.xFraction(point.at) ?? 0) > LEFTWARD_FROM
      out.push(
        dot([point], {
          id: 'run-out',
          x: (d) => d.at,
          y: (d) => d.left,
          r: 4,
          fill: VX.surface.panel,
          stroke: color,
          strokeWidth: 1.5,
        }),
        decorative(
          text([point], {
            id: 'run-out-label',
            x: (d) => d.at,
            y: (d) => d.left,
            text: () => (narrow ? 'empty' : runOut.label),
            fill: VX.ink2,
            fontSize: VX.text.xs,
            anchor: leftwards ? 'end' : 'start',
            dx: leftwards ? -8 : 8,
            dy: -22,
          }),
        ),
      )
    }
    return out
  }

  return (
    <CartesianChart<DrainRow, Date>
      ariaLabel={`${model.title}: share left over its window, with the projection at the current rate`}
      data={rows}
      height={height}
      x={(d) => d.at}
      xDomain={[new Date(model.window.from), new Date(model.window.to)]}
      xTicks={drainTicks(model.window, compact ? 3 : 5)}
      formatX={(d) => shortDay(d)}
      cursorGroup={`usage-drain-${model.id}-${model.kind}`}
      legend={false}
      series={series}
      marks={marks}
      y={{ domain: [0, 100], ticks: [0, 50, 100], format: pctTick }}
      tooltip={{ formatHeader: (d) => shortHour(d) }}
    />
  )
}
