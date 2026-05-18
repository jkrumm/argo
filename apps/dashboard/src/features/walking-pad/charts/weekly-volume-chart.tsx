import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Bars, ChartCard, ChartLegend, TooltipRow } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { METRIC_DEFS, fmtSteps, useMetricSelection, type MetricKey } from '../metric-toggle'
import { ChartEmpty } from './empty'

type Point = {
  date: string // ISO week YYYY-Www — Bars treats it as a categorical x.
  distance_m: number
  duration_s: number
  steps: number
  sessions: number
}

type WeeklyMetric = {
  pick: (p: Point) => number
  formatTotal: (v: number) => string
  formatAvg: (v: number) => string
  /** Per-week minimum scale ceiling — wider than daily because a typical week
   * sums ~5–7× a typical day. */
  autoMaxFloor: number
}

const WEEKLY_METRICS: Record<MetricKey, WeeklyMetric> = {
  distance: {
    pick: (p) => p.distance_m,
    formatTotal: (m) => `${(m / 1000).toFixed(1)} km total`,
    formatAvg: (m) => `${(m / 1000).toFixed(1)} km/week`,
    autoMaxFloor: 5000,
  },
  duration: {
    pick: (p) => p.duration_s,
    formatTotal: (s) => `${(s / 3600).toFixed(1)} h total`,
    formatAvg: (s) => `${(s / 3600).toFixed(1)} h/week`,
    autoMaxFloor: 60 * 60 * 3,
  },
  steps: {
    pick: (p) => p.steps,
    formatTotal: (v) => `${fmtSteps(v)} steps total`,
    formatAvg: (v) => `${fmtSteps(Math.round(v))} steps/week`,
    autoMaxFloor: 15_000,
  },
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`

export function WeeklyVolumeChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'week' }))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { enabled } = useMetricSelection()

  const points: Point[] = data.points

  const metricMax = useMemo(() => {
    const out = {} as Record<MetricKey, number>
    for (const m of enabled) {
      let max = 0
      for (const p of points) {
        const v = WEEKLY_METRICS[m].pick(p)
        if (v > max) max = v
      }
      out[m] = max
    }
    return out
  }, [points, enabled])

  const hasData = enabled.some((m) => (metricMax[m] ?? 0) > 0)
  const isMulti = enabled.length > 1

  if (enabled.length === 0) {
    return (
      <ChartCard
        title="Weekly volume"
        subtitle="Is the habit holding week to week?"
        tooltip="ISO-week buckets within the window. Pick one or more metrics from the page header to populate."
      >
        <ChartEmpty height={280} label="No metric selected — toggle one in the page header." />
      </ChartCard>
    )
  }

  const getValue = (d: Point, key: string): number | null => {
    const m = key as MetricKey
    if (!enabled.includes(m)) return null
    const raw = WEEKLY_METRICS[m].pick(d)
    if (raw <= 0) return null
    if (!isMulti) return raw
    const max = metricMax[m] ?? 0
    if (max <= 0) return null
    return raw / max
  }

  const positiveBars = enabled.map((m) => ({
    key: m,
    label: METRIC_DEFS[m].label,
    color: METRIC_DEFS[m].color,
    formatValue: METRIC_DEFS[m].format,
  }))

  const singleMetric = enabled[0]
  const singleDef = singleMetric !== undefined ? METRIC_DEFS[singleMetric] : null
  const singleConfig = singleMetric !== undefined ? WEEKLY_METRICS[singleMetric] : null

  const headerSummary = (
    <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
      {enabled.map((m) => (
        <span key={m} style={{ fontSize: 12, fontWeight: 600, color: METRIC_DEFS[m].color }}>
          {WEEKLY_METRICS[m].formatTotal(points.reduce((s, p) => s + WEEKLY_METRICS[m].pick(p), 0))}
        </span>
      ))}
    </span>
  )

  const renderExtraTooltipRows = isMulti
    ? (d: Point) => (
        <>
          {enabled.map((m) => {
            const raw = WEEKLY_METRICS[m].pick(d)
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
      title="Weekly volume"
      subtitle="Is the habit holding week to week?"
      tooltip="ISO-week buckets within the window. With 2+ metrics, bars are normalized to each metric's own window-max so the rhythm is comparable; tooltips show absolute values."
      extra={hasData ? headerSummary : null}
    >
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={280} label="No weekly data in this window." />
        ) : width > 0 ? (
          <Bars<Point>
            data={points}
            width={Math.max(width, 200)}
            height={280}
            chartId="walking-pad-weekly-volume"
            getX={(d) => d.date}
            getValue={getValue}
            positiveBars={positiveBars}
            barLayout={isMulti ? 'grouped' : 'stacked'}
            leftAxis={{
              domain: isMulti ? [0, 1] : 'auto',
              formatTick: isMulti ? fmtPct : (singleDef?.format ?? fmtPct),
              numTicks: 5,
              autoMaxFloor: isMulti ? undefined : singleConfig?.autoMaxFloor,
            }}
            formatValue={isMulti ? fmtPct : (singleDef?.format ?? fmtPct)}
            hideBarTooltipRows={isMulti}
            renderExtraTooltipRows={renderExtraTooltipRows}
          />
        ) : null}
      </div>
      <ChartLegend
        items={enabled.map((m) => ({
          key: m,
          label: `${METRIC_DEFS[m].label} / week`,
          color: METRIC_DEFS[m].color,
          shape: 'bar' as const,
        }))}
      />
      <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)', marginTop: 4 }}>
        {hasData && !isMulti && singleConfig !== null
          ? `${singleConfig.formatAvg(
              points.reduce((s, p) => s + WEEKLY_METRICS[singleMetric as MetricKey].pick(p), 0) /
                Math.max(1, points.length),
            )} average across the window.`
          : isMulti
            ? `Bars normalized per metric (0–100% of window max). Hover for absolute values.`
            : ''}
      </span>
    </ChartCard>
  )
}
