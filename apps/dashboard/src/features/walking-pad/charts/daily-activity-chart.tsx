import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Bars, ChartCard, ChartLegend, TooltipRow, VX, useVxTheme } from '@argo/charts'
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
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line2 } = useVxTheme()
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

  const positiveBars = enabled.map((m) => ({
    key: m,
    label: METRIC_DEFS[m].label,
    color: isMulti ? METRIC_DEFS[m].color : VX.line,
    formatValue: METRIC_DEFS[m].format,
  }))

  const singleMetric = enabled[0]
  const singleDef = singleMetric !== undefined ? METRIC_DEFS[singleMetric] : null
  const singleConfig = singleMetric !== undefined ? DAILY_METRICS[singleMetric] : null

  // Y-axis labels for steps run up to 5 digits ("12,000"); default 44px is
  // tight. Multi-metric mode normalizes to 0-100% which fits fine.
  const marginLeft = !isMulti && singleMetric === 'steps' ? 56 : undefined

  // Header summary: one line per enabled metric.
  const headerSummary = (
    <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
      {enabled.map((m) => (
        <span
          key={m}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: isMulti ? METRIC_DEFS[m].color : VX.line,
          }}
        >
          {DAILY_METRICS[m].formatTotal(points.reduce((s, p) => s + DAILY_METRICS[m].pick(p), 0))}
        </span>
      ))}
      <span style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
        · {totalSessions} sessions
      </span>
    </span>
  )

  // Custom tooltip rows: when normalized, show raw values per metric instead
  // of the auto-generated percent rows. Always show sessions count too.
  const renderExtraTooltipRows = isMulti
    ? (d: Point) => (
        <>
          {enabled.map((m) => {
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
    : undefined

  return (
    <ChartCard
      title="Daily activity"
      subtitle="How much did I walk each day?"
      tooltip="Per-UTC-day total of each enabled metric. With 2+ metrics, bars are normalized to each metric's own window-max so the rhythm is comparable; tooltips show absolute values. The dashed line is the per-day session count on the right axis."
      extra={hasData ? headerSummary : null}
    >
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={280} label="No walks in this window" />
        ) : width > 0 ? (
          <Bars<Point>
            data={points}
            width={Math.max(width, 200)}
            height={280}
            chartId="walking-pad-daily-activity"
            getX={(d) => d.date}
            getValue={getValue}
            positiveBars={positiveBars}
            barLayout={isMulti ? 'grouped' : 'stacked'}
            lines={[
              {
                key: 'sessions',
                label: 'Sessions',
                color: line2,
                axisSide: 'right',
                dashed: true,
                strokeWidth: 1.5,
                formatValue: (v) => String(Math.round(v)),
              },
            ]}
            leftAxis={{
              domain: isMulti ? [0, 1] : 'auto',
              formatTick: isMulti ? fmtPct : (singleDef?.format ?? fmtPct),
              numTicks: 5,
              autoMaxFloor: isMulti ? undefined : singleConfig?.autoMaxFloor,
            }}
            rightAxis={{
              domain: 'auto',
              formatTick: (v) => String(Math.round(v)),
              numTicks: 4,
              autoMaxFloor: 3,
            }}
            formatValue={isMulti ? fmtPct : (singleDef?.format ?? fmtPct)}
            marginLeft={marginLeft}
            hideBarTooltipRows={isMulti}
            renderExtraTooltipRows={renderExtraTooltipRows}
          />
        ) : null}
      </div>
      <ChartLegend
        items={[
          ...enabled.map((m) => ({
            key: m,
            label: `${METRIC_DEFS[m].label} / day`,
            color: isMulti ? METRIC_DEFS[m].color : VX.line,
            shape: 'bar' as const,
          })),
          { key: 'sessions', label: 'Sessions', color: line2, dashed: true, strokeWidth: 1.5 },
        ]}
      />
      <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)', marginTop: 4 }}>
        {hasData && !isMulti && singleConfig !== null
          ? `${singleConfig.formatAvg(
              points.reduce((s, p) => s + DAILY_METRICS[singleMetric as MetricKey].pick(p), 0) /
                Math.max(1, points.length),
            )} average across the window.`
          : isMulti
            ? `Bars normalized per metric (0–100% of window max). Hover for absolute values.`
            : ''}
      </span>
    </ChartCard>
  )
}

export function DailyActivityChartSkeleton() {
  return <ChartEmpty height={280} label="Loading…" />
}
