import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard, type BarsBar, type BarsLine } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { FactsLine } from '../facts-line'
import { bodyBatteryFact, mean } from '../model'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { localDay } from './local-day'

type BodyBatteryPoint = {
  day: Date
  charged: number | null
  drained: number | null
  net: number | null
  highest: number | null
  lowest: number | null
}

const formatNet = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}`
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

  const points = useMemo<BodyBatteryPoint[]>(
    () =>
      applyVisibilityFilter(
        (query.data?.points ?? []).filter((p) => p.bbCharged !== null || p.bbDrained !== null),
        (p) => p.date,
      ).map((p) => ({
        day: localDay(p.date),
        charged: p.bbCharged,
        drained: p.bbDrained,
        net: p.bbNet,
        highest: p.bbHighest,
        lowest: p.bbLowest,
      })),
    [query.data],
  )

  const latest = points.at(-1)
  const fact = bodyBatteryFact({
    net: latest?.net ?? null,
    mean: mean(points.map((p) => p.net)),
    high: latest?.highest ?? null,
    low: latest?.lowest ?? null,
    dayCount: points.length,
  })

  return (
    <ChartCard
      title="Body battery"
      state={chartStateOf(
        query,
        points.length === 0 ? 'No body battery in this window' : undefined,
      )}
      placeholderHeight={280}
    >
      <FactsLine fact={fact} />
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
          format: (v) => (v === 0 ? '0' : v > 0 ? `+${v}` : String(v)),
        }}
      />
    </ChartCard>
  )
}
