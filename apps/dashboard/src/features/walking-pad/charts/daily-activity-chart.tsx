import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { Bars, ChartCard, type BarsBar, type BarsLine } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { integer } from 'basalt-ui/format'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { walkingStore } from '../../../lib/window-stores'
import { METRIC_DEFS, type MetricKey } from '../metrics'
import { chartStateOf, utcDay } from './chart-state'

type Point = {
  date: Date
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
    formatTotal: (v) => integer(v, { locale: 'en-US' }),
    formatAvg: (v) => `${integer(Math.round(v), { locale: 'en-US' })} steps/day`,
    autoMaxFloor: 3000,
  },
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`
const fmtCount = (v: number) => String(Math.round(v))

export function DailyActivityChart({ params }: { params: WalkingPadWindowParams }) {
  const query = useQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))
  const [enabled] = walkingStore.field.metrics.use()

  const points = useMemo<Point[]>(
    () => (query.data?.points ?? []).map((p) => ({ ...p, date: utcDay(p.date) })),
    [query.data],
  )

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

  const singleMetric = enabled[0]
  const singleDef = singleMetric !== undefined ? METRIC_DEFS[singleMetric] : null
  const singleConfig = singleMetric !== undefined ? DAILY_METRICS[singleMetric] : null

  const bars: BarsBar<Point>[] = enabled.map((m) => ({
    key: m,
    label: METRIC_DEFS[m].label,
    color: isMulti ? METRIC_DEFS[m].color : VX.line,
    // 0 is no walk that day: an absence, not a zero-height bar.
    getValue: (d) => {
      const raw = DAILY_METRICS[m].pick(d)
      if (raw <= 0) return null
      if (!isMulti) return raw
      const max = metricMax[m] ?? 0
      return max > 0 ? raw / max : null
    },
    // Normalized bars carry a fraction of the metric's own window max, which reads as a
    // meaningless percent — the absolute values come in as extra tooltip rows instead.
    tooltip: !isMulti,
    formatValue: METRIC_DEFS[m].format,
  }))

  const lines: BarsLine<Point>[] = [
    {
      key: 'sessions',
      label: 'Sessions',
      color: VX.line2,
      axis: 'right',
      dash: 'dashed',
      strokeWidth: 1.5,
      getValue: (d) => (d.sessions > 0 ? d.sessions : null),
      formatValue: fmtCount,
    },
  ]

  const total = (m: MetricKey) =>
    DAILY_METRICS[m].formatTotal(points.reduce((s, p) => s + DAILY_METRICS[m].pick(p), 0))

  const headerSummary = (
    <Group gap="sm" wrap="wrap">
      {enabled.map((m) => (
        <Text key={m} span size="xs" fw={600} {...(isMulti && { c: METRIC_DEFS[m].color })}>
          {total(m)}
        </Text>
      ))}
      <Text span size="xs" c="dimmed">
        · {totalSessions} sessions
      </Text>
    </Group>
  )

  const footer =
    hasData && !isMulti && singleConfig !== null && singleMetric !== undefined
      ? `${singleConfig.formatAvg(
          points.reduce((s, p) => s + DAILY_METRICS[singleMetric].pick(p), 0) /
            Math.max(1, points.length),
        )} average across the window.`
      : isMulti
        ? 'Bars normalized per metric (0–100% of window max). Hover for absolute values.'
        : ''

  return (
    <ChartCard
      title="Daily activity"
      subtitle="How much did I walk each day?"
      info="Per-UTC-day total of each enabled metric. With 2+ metrics, bars are normalized to each metric's own window-max so the rhythm is comparable; tooltips show absolute values. The dashed line is the per-day session count on the right axis."
      actions={hasData ? headerSummary : null}
      state={chartStateOf(
        query,
        (enabled.length === 0 && 'No metric selected — toggle one in the page header.') ||
          (!hasData && 'No walks in this window') ||
          false,
      )}
      placeholderHeight={280}
    >
      <Bars
        ariaLabel="Daily activity, per-day totals of the enabled walking metrics"
        data={points}
        height={280}
        x={(d) => d.date}
        bars={bars}
        lines={lines}
        layout={isMulti ? 'grouped' : 'stacked'}
        y={{
          domain: isMulti ? [0, 1] : 'auto',
          ...(!isMulti && singleConfig !== null && { autoMaxFloor: singleConfig.autoMaxFloor }),
          format: isMulti ? fmtPct : (singleDef?.format ?? fmtPct),
          ticks: 5,
          nice: true,
        }}
        y2={{ domain: 'auto', format: fmtCount, ticks: 4, autoMaxFloor: 3 }}
        tooltip={{
          // When normalized, the bars are suppressed from the derived rows and these carry the raw
          // per-metric values in their own units — a hidden metric drops out here too.
          rows: (d, ctx) =>
            isMulti
              ? enabled
                  .filter((m) => !ctx.hidden.some((s) => s.key === m))
                  .map((m) => {
                    const raw = DAILY_METRICS[m].pick(d)
                    return {
                      label: METRIC_DEFS[m].label,
                      value: raw > 0 ? METRIC_DEFS[m].format(raw) : '—',
                      color: METRIC_DEFS[m].color,
                    }
                  })
              : [],
        }}
      />
      {footer !== '' && (
        <Text size="xs" c="dimmed" mt={4}>
          {footer}
        </Text>
      )}
    </ChartCard>
  )
}
