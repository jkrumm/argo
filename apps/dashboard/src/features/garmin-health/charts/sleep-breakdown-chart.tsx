import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { Bars, ChartCard, type BarsBar, type BarsLine } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { SERIES } from '../../../lib/series'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from './chart-state'
import { localDay } from './local-day'

const CHART_HEIGHT = 280

type SleepPoint = {
  day: Date
  /** Hours; `null` is an unmeasured stage, never a zero-height bar. */
  deep: number | null
  light: number | null
  rem: number | null
  awake: number | null
  sleepScore: number | null
}

const secToHours = (sec: number | null): number | null => (sec === null ? null : sec / 3600)
const fmtHours = (h: number): string => `${Math.abs(h).toFixed(1)}h`

function sleepScoreColor(score: number): string {
  if (score >= 80) return VX.goodSolid
  if (score >= 60) return VX.warnSolid
  return VX.badSolid
}

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

const LINES: BarsLine<SleepPoint>[] = [
  {
    key: 'sleepScore',
    label: 'Sleep Score',
    color: VX.line,
    axis: 'right',
    strokeWidth: 2,
    getValue: (d) => d.sleepScore,
    formatValue: (v) => String(Math.round(v)),
  },
]

const totalSleep = (d: SleepPoint): number => (d.deep ?? 0) + (d.light ?? 0) + (d.rem ?? 0)

export default function SleepBreakdownChart({ params }: { params: SummaryParams }) {
  const query = useQuery(dailyMetricsQueries.series(params))

  // Sleep locks in overnight, so today is kept (`hideToday: false`).
  const sleepData = useMemo<SleepPoint[]>(
    () =>
      applyVisibilityFilter(query.data?.points ?? [], (p) => p.date, { hideToday: false })
        .filter((p) => p.sleepDurationSec !== null)
        .map((p) => ({
          day: localDay(p.date),
          deep: secToHours(p.deepSleepSec),
          light: secToHours(p.lightSleepSec),
          rem: secToHours(p.remSleepSec),
          awake: secToHours(p.awakeSleepSec),
          sleepScore: p.sleepScore,
        })),
    [query.data],
  )

  const latest = sleepData.at(-1)
  const latestTotal = latest ? totalSleep(latest) : 0

  return (
    <ChartCard
      title="Sleep Breakdown"
      subtitle="How well did I sleep?"
      info={METRIC_TOOLTIPS.sleepStages}
      actions={
        latest && latest.sleepScore !== null ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md" c={sleepScoreColor(latest.sleepScore)}>
              {Math.round(latest.sleepScore)}
            </Text>
            {latestTotal > 0 && (
              <Text span size="xs" c="dimmed">
                · {fmtHours(latestTotal)}
              </Text>
            )}
          </Group>
        ) : null
      }
      state={chartStateOf(query, sleepData.length === 0 && 'No sleep in this window')}
      placeholderHeight={CHART_HEIGHT}
    >
      <Bars
        cursorResolution="leading"
        ariaLabel="Sleep stages breakdown with sleep score overlay"
        data={sleepData}
        height={CHART_HEIGHT}
        x={(d) => d.day}
        bars={BARS}
        lines={LINES}
        zones={[{ from: 7, to: 9, fill: VX.goodSoft, axisSide: 'left' }]}
        y={{
          domain: 'auto',
          autoPad: 1.05,
          autoMaxFloor: 9,
          autoMinCeil: -1,
          ticks: 6,
          format: (v) => (v < 0 ? `−${Math.abs(v)}h` : `${v}h`),
        }}
        y2={{ domain: [0, 100], ticks: 4 }}
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
    </ChartCard>
  )
}
