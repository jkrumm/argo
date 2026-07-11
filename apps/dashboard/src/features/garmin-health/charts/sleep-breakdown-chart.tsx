import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Bars, ChartCard, TooltipRow, VX } from 'basalt-ui/charts'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { SERIES } from '../../../lib/series'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

const CHART_HEIGHT = 280
const CHART_ID = 'sleep-breakdown'

type SeriesPoint = {
  date: string
  sleepScore: number | null
  sleepDurationSec: number | null
  deepSleepSec: number | null
  lightSleepSec: number | null
  remSleepSec: number | null
  awakeSleepSec: number | null
}

type SleepPoint = {
  date: string
  /** Hours, ≥0 — stacked positively. */
  deep: number
  light: number
  rem: number
  /** Hours, ≥0 — declared in `negativeBars` so it stacks below baseline. */
  awake: number
  sleepScore: number | null
}

const SLEEP_KEYS = {
  deep: 'deep',
  light: 'light',
  rem: 'rem',
  awake: 'awake',
  sleepScore: 'sleepScore',
} as const

const secToHours = (sec: number | null): number => (sec === null ? 0 : sec / 3600)
const fmtHours = (h: number): string => `${h.toFixed(1)}h`

function buildSleepData(points: SeriesPoint[]): SleepPoint[] {
  return points
    .filter((p) => p.sleepDurationSec !== null)
    .map((p) => ({
      date: p.date,
      deep: secToHours(p.deepSleepSec),
      light: secToHours(p.lightSleepSec),
      rem: secToHours(p.remSleepSec),
      awake: secToHours(p.awakeSleepSec),
      sleepScore: p.sleepScore,
    }))
}

function sleepScoreColor(score: number): string {
  if (score >= 80) return VX.goodSolid
  if (score >= 60) return VX.warnSolid
  return VX.badSolid
}

function sleepGetValue(d: SleepPoint, key: string): number | null {
  switch (key) {
    case SLEEP_KEYS.deep:
      return d.deep
    case SLEEP_KEYS.light:
      return d.light
    case SLEEP_KEYS.rem:
      return d.rem
    case SLEEP_KEYS.awake:
      return d.awake
    case SLEEP_KEYS.sleepScore:
      return d.sleepScore
    default:
      return null
  }
}

export default function SleepBreakdownChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.series(params))

  const points = useMemo(
    () => applyVisibilityFilter(data.points as SeriesPoint[], (p) => p.date, { hideToday: false }),
    [data.points],
  )
  const sleepData = useMemo(() => buildSleepData(points), [points])

  const latest = sleepData[sleepData.length - 1]
  const headerExtra =
    latest && latest.sleepScore !== null
      ? (() => {
          const total = latest.deep + latest.light + latest.rem
          const color = sleepScoreColor(latest.sleepScore)
          return (
            <span style={{ fontSize: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color }}>
                {Math.round(latest.sleepScore)}
              </span>
              {total > 0 && <span style={{ opacity: 0.5 }}> · {fmtHours(total)}</span>}
            </span>
          )
        })()
      : null

  return (
    <ChartCard
      title="Sleep Breakdown"
      subtitle="How well did I sleep?"
      tooltip={METRIC_TOOLTIPS.sleepStages}
      extra={headerExtra}
    >
      {sleepData.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} />
      ) : (
        <Bars<SleepPoint>
          data={sleepData}
          height={CHART_HEIGHT}
          chartId={CHART_ID}
          getX={(d) => d.date}
          getValue={sleepGetValue}
          positiveBars={[
            {
              key: SLEEP_KEYS.deep,
              label: 'Deep',
              color: SERIES.deep,
              formatValue: fmtHours,
            },
            {
              key: SLEEP_KEYS.light,
              label: 'Light',
              color: SERIES.light,
              formatValue: fmtHours,
            },
            {
              key: SLEEP_KEYS.rem,
              label: 'REM',
              color: SERIES.rem,
              formatValue: fmtHours,
            },
          ]}
          negativeBars={[
            {
              key: SLEEP_KEYS.awake,
              label: 'Awake',
              color: SERIES.awake,
              formatValue: fmtHours,
            },
          ]}
          lines={[
            {
              key: SLEEP_KEYS.sleepScore,
              label: 'Sleep Score',
              color: VX.line,
              axisSide: 'right',
              strokeWidth: 2,
              formatValue: (v) => String(Math.round(v)),
            },
          ]}
          zones={[{ from: 7, to: 9, fill: VX.goodSoft, axisSide: 'left' }]}
          leftAxis={{
            domain: 'auto',
            autoPad: 1.05,
            autoMaxFloor: 9,
            autoMinCeil: -1,
            numTicks: 6,
            formatTick: (v) => (v < 0 ? `−${Math.abs(v)}h` : `${v}h`),
          }}
          rightAxis={{ domain: [0, 100], numTicks: 4 }}
          tooltipLabel={(d) =>
            d.sleepScore === null
              ? null
              : {
                  text: String(Math.round(d.sleepScore)),
                  color: sleepScoreColor(d.sleepScore),
                }
          }
          renderPrefixTooltipRows={(d) => {
            const total = d.deep + d.light + d.rem
            if (total <= 0) return null
            return (
              <TooltipRow
                color={VX.line}
                label="Total sleep"
                value={fmtHours(total)}
                shape="line"
                strokeWidth={2}
              />
            )
          }}
          ariaLabel="Sleep stages breakdown with sleep score overlay"
        />
      )}
    </ChartCard>
  )
}
