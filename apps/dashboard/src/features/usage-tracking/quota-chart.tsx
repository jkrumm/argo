/**
 * The Claude subscriptions' chart: weekly share left per account (thin line in its payer colour) and
 * the capacity-weighted combined share (one thick neutral line), over the 14 days up to the latest
 * reset. A short tick on the baseline marks each account's reset, coloured like its line. Composed on
 * `CartesianChart`, like `DrainChart`; `quotas-model.ts` owns the data, this file only draws it.
 */
import { lineY } from '@tanstack/charts/line'
import { decorative } from '@tanstack/charts/mark/decorative'
import { ruleX } from '@tanstack/charts/rule'
import { text } from '@tanstack/charts/text'
import { tickX } from '@tanstack/charts/tick'
import {
  CartesianChart,
  type ChartMarks,
  type ChartSeries,
  type PlotContext,
} from 'basalt-ui/charts'
import { useSizeClass } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { colorForPayer } from './constants'
import { drainTicks, pctText } from './drain-model'
import { shortDay, shortHour } from './model'
import { quotaLeftText, type QuotaModel } from './quotas-model'

const COMBINED = 'combined'

/** The length of a reset tick on the baseline, px. */
const TICK_PX = 12

/** Same-family colours need a second cue: the later accounts take a dash. */
const DASH: Record<string, string> = { me: '6 3', me2: '1.5 3' }

const THIN_WIDTH = 1.25
const THICK_WIDTH = 3

interface QuotaRow {
  at: Date
  values: Record<string, number | null>
}

function quotaRows(model: QuotaModel): QuotaRow[] {
  const lines = [
    ...model.accounts.map((a) => ({ key: a.id, points: a.line })),
    { key: COMBINED, points: model.combined },
  ]
  const instants = [...new Set(lines.flatMap((l) => l.points.map((p) => p.at)))].toSorted(
    (a, b) => a - b,
  )
  return instants.map((at) => ({
    at: new Date(at),
    values: Object.fromEntries(
      lines.map((l) => [l.key, l.points.find((p) => p.at === at)?.left ?? null] as const),
    ),
  }))
}

export function QuotaChart({ model, height }: { model: QuotaModel; height: number }) {
  const compact = useSizeClass() === 'compact'
  const rows = quotaRows(model)

  const series: ChartSeries<QuotaRow>[] = [
    ...model.accounts.map((a): ChartSeries<QuotaRow> => ({
      key: a.id,
      label: a.label,
      color: colorForPayer(a.payer),
      getValue: (d) => d.values[a.id] ?? null,
      formatValue: quotaLeftText,
      gaps: 'connect',
      strokeWidth: THIN_WIDTH,
    })),
    {
      key: COMBINED,
      label: 'Combined',
      color: VX.ink,
      getValue: (d) => d.values[COMBINED] ?? null,
      formatValue: quotaLeftText,
      gaps: 'connect',
      strokeWidth: THICK_WIDTH,
    },
  ]

  const marks = (plot: PlotContext<QuotaRow, Date>): ChartMarks => {
    const out: ChartMarks[number][] = []
    const top = plot.yDomain[1]
    const bottom = plot.yDomain[0]

    // Thin lines first, the combined line last so it sits on top.
    const visible = plot.visible.toSorted(
      (a, b) => (a.key === COMBINED ? 1 : 0) - (b.key === COMBINED ? 1 : 0),
    )
    for (const s of visible) {
      out.push(
        lineY(
          plot.rows(s.key).filter((r) => r.y !== null),
          {
            id: s.key,
            x: (r) => r.x,
            y: 'y',
            z: 'series',
            stroke: s.color,
            strokeWidth: s.key === COMBINED ? THICK_WIDTH : THIN_WIDTH,
            ...(DASH[s.key] === undefined ? {} : { strokeDasharray: DASH[s.key] }),
          },
        ),
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
          anchor: 'end',
          dx: -4,
          dy: 10,
        }),
      ),
    )

    if (model.ticks.length > 0) {
      out.push(
        tickX(model.ticks, {
          id: 'resets',
          x: (d) => new Date(d.at),
          y: () => bottom + (top - bottom) * 0.04,
          length: TICK_PX,
          stroke: (d) => colorForPayer(d.payer),
          strokeWidth: 2,
        }),
      )
    }
    return out
  }

  return (
    <CartesianChart<QuotaRow, Date>
      ariaLabel="Claude subscriptions: weekly quota left per account and combined, last 14 days to the next reset"
      data={rows}
      height={height}
      x={(d) => d.at}
      xDomain={[new Date(model.window.from), new Date(model.window.to)]}
      xTicks={drainTicks(model.window, compact ? 3 : 5)}
      formatX={(d) => shortDay(d)}
      cursorGroup="usage-quotas-subscriptions"
      legend={false}
      series={series}
      marks={marks}
      y={{ domain: [0, 100], ticks: [0, 50, 100], format: pctText }}
      tooltip={{ formatHeader: (d) => shortHour(d) }}
    />
  )
}
