import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSizeClass } from 'basalt-ui'
import { Bars, ChartCard, Lines, type BarsBar, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { trainingLoadQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import { toChartFact } from '../chart-facts'
import { RefetchDim } from '../refetch-dim'
import { ZONE_FILL } from '../zone-fills'
import { acwrZoneColor, acwrZoneLabel, type AcwrZone } from '../formulas'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_LEGEND,
  ACWR_OPTIMAL_TO,
  acwrFact,
  dayLabel,
  divergenceFact,
  signed,
} from '../model'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { shotState } from '../../../lib/shot-state'
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
    key: 'under',
    label: ACWR_LEGEND.undertrained,
    color: VX.warnSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
  {
    key: 'optimal',
    label: ACWR_LEGEND.optimal,
    color: VX.goodSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
  {
    key: 'caution',
    label: ACWR_LEGEND.caution,
    color: VX.warnSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
  {
    key: 'danger',
    label: ACWR_LEGEND.danger,
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
    color: VX.line2,
    getValue: (d) => d.divergence,
    formatValue: (v) => `${signed(v, 1)} MET-min/day`,
  },
]

const DIVERGENCE_HEIGHT = 60

export default function AcwrChart({ params }: { params: SummaryParams }) {
  const query = useQuery(trainingLoadQueries.summary(params))
  // `basalt-ui shot`'s `empty` state renders the chart's own empty branch.
  const data = shotState() === 'empty' ? undefined : query.data

  const points = useMemo<TrainingLoadPoint[]>(
    () =>
      applyVisibilityFilter(data?.points ?? [], (p) => p.date).map((p) => ({
        date: p.date,
        day: localDay(p.date),
        acwr: p.acwr,
        zone: p.zone,
        divergence: p.divergence,
      })),
    [data],
  )
  // At 390 the zone keys in the legend are noise; the card's header and the bands carry them.
  const compact = useSizeClass() === 'compact'
  const first = points.at(0)
  const last = points.at(-1)
  // One shared x extent so the divergence strip's days line up under the ratio line's.
  const xDomain = first && last ? ([first.day, last.day] as const) : undefined
  // Explicit weekly ticks, identical on both plots, so the day labels sit in the same columns.
  const xTicks = points.filter((_, i) => i % 7 === 0).map((p) => p.day)
  const hasAcwr = points.some((p) => p.acwr !== null)
  const latest = latestWith(points, (p) => p.acwr)
  const latestDivergence = latestWith(points, (p) => p.divergence)
  const measured = points.filter((p) => p.acwr !== null)
  const divergence = divergenceFact({
    divergence: latestDivergence?.divergence ?? null,
    when: dayLabel(latestDivergence?.date),
  })
  const fact = acwrFact({
    acwr: latest?.acwr ?? null,
    zoneLabel: acwrZoneLabel(latest?.zone ?? null),
    inZone: measured.filter((p) => p.zone === 'optimal').length,
    dayCount: measured.length,
  })

  return (
    <ChartCard
      title="ACWR"
      info={METRIC_TOOLTIPS.trainingLoad}
      state={chartStateOf(query, !hasAcwr ? 'No training load in this window' : undefined)}
      placeholderHeight={280}
      facts={[toChartFact(fact), toChartFact(divergence)]}
    >
      <RefetchDim active={query.isPlaceholderData}>
        <Lines
          cursorResolution="leading"
          ariaLabel={`Acute:chronic training load ratio with the ${ACWR_FLOOR} to ${ACWR_OPTIMAL_TO} optimal zone`}
          data={points}
          height={220}
          x={(d) => d.day}
          series={ACWR_SERIES}
          {...(compact && { legend: false as const })}
          {...(xDomain && { xDomain })}
          xTicks={xTicks}
          y={{ domain: 'auto', autoMaxFloor: 1.6, autoMinCeil: 0.6, format: (v) => v.toFixed(1) }}
          zones={[
            { from: ACWR_FLOOR, to: ACWR_OPTIMAL_TO, fill: ZONE_FILL.good },
            { from: ACWR_OPTIMAL_TO, to: ACWR_CAUTION_TO, fill: ZONE_FILL.warn },
          ]}
          thresholds={[
            { value: ACWR_CAUTION_TO, side: 'above', fill: ZONE_FILL.bad },
            { value: ACWR_FLOOR, side: 'below', fill: ZONE_FILL.warn },
          ]}
          refLines={[
            { value: ACWR_FLOOR, color: VX.warnRef },
            { value: ACWR_OPTIMAL_TO, color: VX.goodRef },
            { value: ACWR_CAUTION_TO, color: VX.badRef },
          ]}
          tooltip={{
            rows: (d) =>
              d.zone === null
                ? []
                : [{ label: 'Zone', value: acwrZoneLabel(d.zone), color: acwrZoneColor(d.zone) }],
          }}
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
          y={{ domain: 'auto', ticks: 2, autoMaxFloor: 5, autoMinCeil: -5 }}
        />
      </RefetchDim>
    </ChartCard>
  )
}
