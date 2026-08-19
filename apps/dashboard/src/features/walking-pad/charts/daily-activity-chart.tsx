import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Group } from '@mantine/core'
import {
  Bars,
  ChartCard,
  TooltipRow,
  type BarsBar,
  type BarsLine,
  type CartesianTooltipRowContext,
} from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { METRIC_DEFS, fmtSteps, useMetricSelection, type MetricKey } from '../metric-toggle'
import { ChartEmpty } from './empty'

type Point = {
  date: string
  distance_m: number
  sessions: number
  duration_s: number
  steps: number
}

type DailyMetric = {
  pick: (p: Point) => number
  formatTotal: (v: number) => string
  formatAvg: (v: number) => string
  /** Per-day minimum scale ceiling so a near-empty window still shows a usable y-axis. */
  autoMaxFloor: number
}

const DAILY_METRICS: Record<MetricKey, DailyMetric> = {
  distance: {
    pick: (p) => p.distance_m,
    formatTotal: (m) => `${(m / 1000).toFixed(1)} km`,
    formatAvg: (m) => `${(m / 1000).toFixed(2)} km/day`,
    autoMaxFloor: 1000,
  },
  duration: {
    pick: (p) => p.duration_s,
    formatTotal: (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`),
    formatAvg: (s) => `${Math.round(s / 60)} min/day`,
    autoMaxFloor: 1800,
  },
  steps: {
    pick: (p) => p.steps,
    formatTotal: fmtSteps,
    formatAvg: (v) => `${fmtSteps(Math.round(v))} steps/day`,
    autoMaxFloor: 3000,
  },
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`

export function DailyActivityChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))
  const { enabled } = useMetricSelection()

  const points: Point[] = data.points

  // Per-metric max in the window — used to normalize bars when 2+ metrics
  // are active (different scales can't share a single axis).
  const metricMax = useMemo(() => {
    const out = {} as Record<MetricKey, number>
    for (const m of enabled) {
      let max = 0
      for (const p of points) {
        const v = DAILY_METRICS[m].pick(p)
        if (v > max) max = v
      }
      out[m] = max
    }
    return out
  }, [points, enabled])

  const hasData = enabled.some((m) => (metricMax[m] ?? 0) > 0)
  const isMulti = enabled.length > 1
  const totalSessions = points.reduce((s, p) => s + p.sessions, 0)

  if (enabled.length === 0) {
    return (
      <ChartCard
        title="Daily activity"
        subtitle="How much did I walk each day?"
        tooltip="Per-UTC-day total of the selected metrics. Pick one or more metrics from the page header to populate."
      >
        <ChartEmpty height={280} label="No metric selected — toggle one in the page header." />
      </ChartCard>
    )
  }

  const getValue = (d: Point, key: string): number | null => {
    const m = key as MetricKey
    if (!enabled.includes(m)) return null
    const raw = DAILY_METRICS[m].pick(d)
    if (raw <= 0) return null
    if (!isMulti) return raw
    const max = metricMax[m] ?? 0
    if (max <= 0) return null
    return raw / max
  }

  const singleMetric = enabled[0]
  const singleDef = singleMetric !== undefined ? METRIC_DEFS[singleMetric] : null
  const singleConfig = singleMetric !== undefined ? DAILY_METRICS[singleMetric] : null

  const positiveBars: BarsBar<Point>[] = enabled.map((m) => ({
    key: m,
    label: METRIC_DEFS[m].label,
    color: isMulti ? METRIC_DEFS[m].color : VX.line,
    // Normalized bars carry a fraction of the metric's own window max, which
    // reads as a meaningless percent — the absolute values come in as extra
    // tooltip rows instead.
    tooltip: !isMulti,
    formatValue: METRIC_DEFS[m].format,
  }))

  const lines: BarsLine<Point>[] = [
    {
      key: 'sessions',
      label: 'Sessions',
      color: VX.line2,
      axisSide: 'right',
      dashed: true,
      strokeWidth: 1.5,
      formatValue: (v) => String(Math.round(v)),
    },
  ]

  // Header summary: one line per enabled metric.
  const headerSummary = (
    <Group gap="sm" wrap="wrap">
      {enabled.map((m) => (
        <span
          key={m}
          style={{
            fontSize: VX.text.xs,
            fontWeight: 600,
            color: isMulti ? METRIC_DEFS[m].color : VX.line,
          }}
        >
          {DAILY_METRICS[m].formatTotal(points.reduce((s, p) => s + DAILY_METRICS[m].pick(p), 0))}
        </span>
      ))}
      <span style={{ fontSize: VX.text.xs, color: 'var(--mantine-color-dimmed)' }}>
        · {totalSessions} sessions
      </span>
    </Group>
  )

  // When normalized, the bars are suppressed from the derived rows and these
  // carry the raw per-metric values in their own units — filtered to the
  // legend's currently visible series so a hidden metric drops out here too.
  const extraRows = (d: Point, ctx: CartesianTooltipRowContext<Point>) => (
    <>
      {enabled.map((m) => {
        if (ctx.hidden.has(m)) return null
        const raw = DAILY_METRICS[m].pick(d)
        return (
          <TooltipRow
            key={m}
            color={METRIC_DEFS[m].color}
            label={METRIC_DEFS[m].label}
            value={raw > 0 ? METRIC_DEFS[m].format(raw) : '—'}
            shape="bar"
          />
        )
      })}
    </>
  )

  return (
    <ChartCard
      title="Daily activity"
      subtitle="How much did I walk each day?"
      tooltip="Per-UTC-day total of each enabled metric. With 2+ metrics, bars are normalized to each metric's own window-max so the rhythm is comparable; tooltips show absolute values. The dashed line is the per-day session count on the right axis."
      extra={hasData ? headerSummary : null}
    >
      {!hasData ? (
        <ChartEmpty height={280} label="No walks in this window" />
      ) : (
        <Bars
          ariaLabel="Daily activity, per-day totals of the enabled walking metrics"
          data={points}
          height={280}
          chartId="walking-pad-daily-activity"
          getX={(d) => d.date}
          getValue={getValue}
          positiveBars={positiveBars}
          barLayout={isMulti ? 'grouped' : 'stacked'}
          lines={lines}
          y={{
            domain: isMulti ? [0, 1] : 'auto',
            autoMaxFloor: isMulti ? undefined : singleConfig?.autoMaxFloor,
            format: isMulti ? fmtPct : (singleDef?.format ?? fmtPct),
            ticks: 5,
            nice: true,
          }}
          y2={{
            domain: 'auto',
            format: (v) => String(Math.round(v)),
            ticks: 4,
            autoMaxFloor: 3,
          }}
          tooltip={isMulti ? { extraRows } : {}}
        />
      )}
      <Box
        component="span"
        mt={4}
        style={{ fontSize: VX.text.micro, color: 'var(--mantine-color-dimmed)' }}
      >
        {hasData && !isMulti && singleConfig !== null
          ? `${singleConfig.formatAvg(
              points.reduce((s, p) => s + DAILY_METRICS[singleMetric as MetricKey].pick(p), 0) /
                Math.max(1, points.length),
            )} average across the window.`
          : isMulti
            ? `Bars normalized per metric (0–100% of window max). Hover for absolute values.`
            : ''}
      </Box>
    </ChartCard>
  )
}

export function DailyActivityChartSkeleton() {
  return <ChartEmpty height={280} label="Loading…" />
}
