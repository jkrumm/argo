import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard, type BarsBar } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { SERIES } from '../../../lib/series'
import { toChartFact } from '../chart-facts'
import { RefetchDim } from '../refetch-dim'
import { dayLabel, hoursFromSec, mean, sleepFact } from '../model'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { shotState } from '../../../lib/shot-state'
import { localDay } from './local-day'

const CHART_HEIGHT = 280

type SleepPoint = {
  day: Date
  date: string
  /** Hours; `null` is an unmeasured stage, never a zero-height bar. */
  deep: number | null
  light: number | null
  rem: number | null
  awake: number | null
  /** Reported sleep duration in hours. */
  total: number | null
  sleepScore: number | null
}

const fmtHours = (h: number): string => `${Math.abs(h).toFixed(1)}h`

const BARS: BarsBar<SleepPoint>[] = [
  {
    key: 'deep',
    label: 'Deep',
    color: SERIES.deep,
    getValue: (d) => d.deep,
    formatValue: fmtHours,
  },
  {
    key: 'light',
    label: 'Light',
    color: SERIES.light,
    getValue: (d) => d.light,
    formatValue: fmtHours,
  },
  { key: 'rem', label: 'REM', color: SERIES.rem, getValue: (d) => d.rem, formatValue: fmtHours },
  {
    key: 'awake',
    label: 'Awake',
    color: SERIES.awake,
    // Awake time stacks below the baseline, so it is plotted negated.
    getValue: (d) => (d.awake === null ? null : -d.awake),
    formatValue: fmtHours,
  },
]

export default function SleepBreakdownChart({ params }: { params: SummaryParams }) {
  const query = useQuery(dailyMetricsQueries.series(params))
  // `basalt-ui shot`'s `empty` state renders the chart's own empty branch.
  const data = shotState() === 'empty' ? undefined : query.data

  // Sleep locks in overnight, so today is kept (`hideToday: false`).
  const sleepData = useMemo<SleepPoint[]>(
    () =>
      applyVisibilityFilter(data?.points ?? [], (p) => p.date, { hideToday: false })
        .filter((p) => p.sleepDurationSec !== null)
        .map((p) => ({
          day: localDay(p.date),
          date: p.date,
          deep: hoursFromSec(p.deepSleepSec),
          light: hoursFromSec(p.lightSleepSec),
          rem: hoursFromSec(p.remSleepSec),
          awake: hoursFromSec(p.awakeSleepSec),
          total: hoursFromSec(p.sleepDurationSec),
          sleepScore: p.sleepScore,
        })),
    [data],
  )

  const latest = sleepData.at(-1)
  const fact = sleepFact({
    when: dayLabel(latest?.date, 'night'),
    hours: latest?.total ?? null,
    score: latest?.sleepScore ?? null,
    meanHours: mean(sleepData.map((d) => d.total)),
    dayCount: sleepData.length,
  })

  return (
    <ChartCard
      title="Sleep"
      state={chartStateOf(query, sleepData.length === 0 ? 'No sleep in this window' : undefined)}
      placeholderHeight={CHART_HEIGHT}
      facts={toChartFact(fact)}
    >
      <RefetchDim active={query.isPlaceholderData}>
        <Bars
          cursorResolution="leading"
          ariaLabel="Sleep stages in hours per night"
          data={sleepData}
          height={CHART_HEIGHT}
          x={(d) => d.day}
          bars={BARS}
          zones={[{ from: 7, to: 9, fill: VX.goodSoft, axisSide: 'left' }]}
          y={{
            domain: 'auto',
            autoPad: 1.05,
            autoMaxFloor: 9,
            autoMinCeil: -1,
            ticks: 6,
            format: (v) => (v < 0 ? `−${Math.abs(v)}h` : `${v}h`),
          }}
          tooltip={{
            rows: (d, ctx) => {
              const hidden = new Set(ctx.hidden.map((s) => s.key))
              const total =
                (hidden.has('deep') ? 0 : (d.deep ?? 0)) +
                (hidden.has('light') ? 0 : (d.light ?? 0)) +
                (hidden.has('rem') ? 0 : (d.rem ?? 0))
              return total > 0
                ? [{ label: 'Total sleep', value: fmtHours(total), color: VX.line }]
                : []
            },
          }}
        />
      </RefetchDim>
    </ChartCard>
  )
}
