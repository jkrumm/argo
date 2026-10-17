import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard, Lines, type BarsBar, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { trainingLoadQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import { FactsLine } from '../facts-line'
import { acwrZoneColor, acwrZoneLabel, type AcwrZone } from '../formulas'
import { acwrFact, divergenceFact } from '../model'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { latestWith } from './latest'
import { localDay } from './local-day'

type TrainingLoadPoint = {
  date: string
  day: Date
  acwr: number | null
  zone: AcwrZone | null
  /** Acute minus chronic EWMA, MET-min/day. */
  divergence: number | null
}

const ACWR_SERIES: ChartSeries<TrainingLoadPoint>[] = [
  {
    key: 'acwr',
    label: 'ACWR',
    color: VX.line,
    getValue: (d) => d.acwr,
    formatValue: (v) => v.toFixed(2),
  },
  // Legend-only zone keys: `getValue` is always null, so they draw nothing and own no tooltip row.
  {
    key: 'optimal',
    label: 'Optimal (0.8–1.3)',
    color: VX.goodSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
  {
    key: 'danger',
    label: 'Overload (>1.5)',
    color: VX.badSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
]

/** Signed, so the sign is the bar's side of the axis — one neutral series, no hue. */
const DIVERGENCE_BARS: BarsBar<TrainingLoadPoint>[] = [
  {
    key: 'divergence',
    label: 'Acute − chronic',
    color: VX.line,
    getValue: (d) => d.divergence,
    formatValue: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} MET-min/day`,
  },
]

const DIVERGENCE_HEIGHT = 60

export default function AcwrChart({ params }: { params: SummaryParams }) {
  const query = useQuery(trainingLoadQueries.summary(params))

  const points = useMemo<TrainingLoadPoint[]>(
    () =>
      applyVisibilityFilter(query.data?.points ?? [], (p) => p.date).map((p) => ({
        date: p.date,
        day: localDay(p.date),
        acwr: p.acwr,
        zone: p.zone,
        divergence: p.divergence,
      })),
    [query.data],
  )
  const first = points.at(0)
  const last = points.at(-1)
  // One shared x extent so the divergence strip's days line up under the ratio line's.
  const xDomain = first && last ? ([first.day, last.day] as const) : undefined
  // Explicit weekly ticks, identical on both plots, so the day labels sit in the same columns.
  const xTicks = points.filter((_, i) => i % 7 === 0).map((p) => p.day)
  const hasAcwr = points.some((p) => p.acwr !== null)
  const latest = latestWith(points, (p) => p.acwr)
  const measured = points.filter((p) => p.acwr !== null)
  const fact = acwrFact({
    acwr: latest?.acwr ?? null,
    zoneLabel: acwrZoneLabel(latest?.zone ?? null),
    inZone: measured.filter((p) => p.zone === 'optimal').length,
    dayCount: measured.length,
  })

  return (
    <ChartCard
      title="Training load (ACWR)"
      info={METRIC_TOOLTIPS.trainingLoad}
      state={chartStateOf(query, !hasAcwr ? 'No training load in this window' : undefined)}
      placeholderHeight={280}
    >
      <FactsLine fact={fact} />
      <Lines
        cursorResolution="leading"
        ariaLabel="Acute:chronic training load ratio with optimal zone"
        data={points}
        height={220}
        x={(d) => d.day}
        series={ACWR_SERIES}
        {...(xDomain && { xDomain })}
        xTicks={xTicks}
        y={{ domain: 'auto', autoMaxFloor: 1.8, format: (v) => v.toFixed(1) }}
        zones={[{ from: 0.8, to: 1.3, fill: VX.good }]}
        thresholds={[
          { value: 1.3, side: 'above', fill: VX.bad },
          { value: 0.8, side: 'below', fill: VX.warn },
        ]}
        refLines={[
          { value: 0.8, color: VX.warnRef },
          { value: 1.3, color: VX.goodRef },
          { value: 1.5, color: VX.badRef },
        ]}
        tooltip={{
          rows: (d) =>
            d.zone === null
              ? []
              : [{ label: 'Zone', value: acwrZoneLabel(d.zone), color: acwrZoneColor(d.zone) }],
        }}
      />
      <FactsLine
        fact={divergenceFact({
          divergence: latestWith(points, (p) => p.divergence)?.divergence ?? null,
        })}
      />
      <Bars
        cursorResolution="leading"
        ariaLabel="Acute minus chronic training load per day"
        data={points}
        height={DIVERGENCE_HEIGHT}
        x={(d) => d.day}
        bars={DIVERGENCE_BARS}
        {...(xDomain && { xDomain })}
        xTicks={xTicks}
        legend={false}
        y={{ domain: 'auto', ticks: 2, autoMaxFloor: 5, autoMinCeil: -5 }}
      />
    </ChartCard>
  )
}
