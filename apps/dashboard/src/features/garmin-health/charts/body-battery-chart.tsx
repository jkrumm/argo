import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard, type BarsBar, type BarsLine } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { toChartFact } from '../chart-facts'
import { RefetchDim } from '../refetch-dim'
import { bodyBatteryFact, dayLabel, mean, signed } from '../model'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { shotState } from '../../../lib/shot-state'
import { useChartEmpty } from './empty'
import { localDay } from './local-day'

type BodyBatteryPoint = {
  day: Date
  date: string
  charged: number | null
  drained: number | null
  net: number | null
  highest: number | null
  lowest: number | null
}

const formatNet = (v: number) => (Math.round(v) === 0 ? '0' : signed(Math.round(v)))
const formatBar = (v: number) => String(Math.round(Math.abs(v)))

const BARS: BarsBar<BodyBatteryPoint>[] = [
  {
    key: 'charged',
    label: 'Charged',
    color: VX.goodSolid,
    getValue: (d) => d.charged,
    formatValue: formatBar,
  },
  {
    key: 'drained',
    label: 'Drained',
    color: VX.badSolid,
    // The API stores drain as a positive amount; below the zero line it is plotted negated.
    getValue: (d) => (d.drained === null ? null : -d.drained),
    formatValue: formatBar,
  },
]

const LINES: BarsLine<BodyBatteryPoint>[] = [
  {
    key: 'net',
    label: 'Net',
    color: VX.line,
    strokeWidth: 2,
    getValue: (d) => d.net,
    formatValue: formatNet,
  },
]

export default function BodyBatteryChart({ params }: { params: SummaryParams }) {
  const query = useQuery(dailyMetricsQueries.series(params))
  // `basalt-ui shot`'s `empty` state renders the chart's own empty branch.
  const data = shotState() === 'empty' ? undefined : query.data

  const points = useMemo<BodyBatteryPoint[]>(
    () =>
      applyVisibilityFilter(
        (data?.points ?? []).filter((p) => p.bbCharged !== null || p.bbDrained !== null),
        (p) => p.date,
      ).map((p) => ({
        day: localDay(p.date),
        date: p.date,
        charged: p.bbCharged,
        drained: p.bbDrained,
        net: p.bbNet,
        highest: p.bbHighest,
        lowest: p.bbLowest,
      })),
    [data],
  )

  // Net, high and low come from the latest day that has a net, not whatever the last row holds.
  const latest = points.findLast((p) => p.net !== null)
  const fact = bodyBatteryFact({
    when: dayLabel(latest?.date),
    net: latest?.net ?? null,
    mean: mean(points.map((p) => p.net)),
    high: latest?.highest ?? null,
    low: latest?.lowest ?? null,
    dayCount: points.filter((p) => p.net !== null).length,
  })

  const emptyLabel = useChartEmpty('bodyBatteryChart', 'body battery', params, {
    settled: query.isSuccess && !query.isPlaceholderData,
    empty: points.length === 0,
  })

  return (
    <ChartCard
      title="Body battery"
      state={chartStateOf(query, emptyLabel)}
      placeholderHeight={280}
      facts={toChartFact(fact)}
    >
      <RefetchDim active={query.isPlaceholderData}>
        <Bars
          cursorResolution="leading"
          ariaLabel="Body battery charged vs drained per day with net line"
          data={points}
          height={280}
          x={(d) => d.day}
          bars={BARS}
          lines={LINES}
          y={{
            domain: 'auto',
            autoPad: 1.1,
            autoMaxFloor: 50,
            autoMinCeil: -50,
            ticks: 5,
            format: (v) => (v === 0 ? '0' : signed(v)),
          }}
        />
      </RefetchDim>
    </ChartCard>
  )
}
