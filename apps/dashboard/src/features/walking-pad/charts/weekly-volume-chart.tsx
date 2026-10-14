import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { Bars, ChartCard, type BarsBar } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { integer } from 'basalt-ui/format'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { walkingStore } from '../../../lib/window-stores'
import { METRIC_DEFS, type MetricKey } from '../metrics'
import { chartStateOf, utcDay } from './chart-state'

type Point = {
  /** Monday week-start — a bucket's leading edge, not an instant. */
  date: Date
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
    formatTotal: (v) => `${integer(v, { locale: 'en-US' })} steps total`,
    formatAvg: (v) => `${integer(Math.round(v), { locale: 'en-US' })} steps/week`,
    autoMaxFloor: 15_000,
  },
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`

export function WeeklyVolumeChart({ params }: { params: WalkingPadWindowParams }) {
  const query = useQuery(walkingPadQueries.series({ ...params, bucket: 'week' }))
  const [enabled] = walkingStore.field.metrics.use()

  const points = useMemo<Point[]>(
    () => (query.data?.points ?? []).map((p) => ({ ...p, date: utcDay(p.date) })),
    [query.data],
  )

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

  const singleMetric = enabled[0]
  const singleDef = singleMetric !== undefined ? METRIC_DEFS[singleMetric] : null
  const singleConfig = singleMetric !== undefined ? WEEKLY_METRICS[singleMetric] : null

  const bars: BarsBar<Point>[] = enabled.map((m) => ({
    key: m,
    label: METRIC_DEFS[m].label,
    color: isMulti ? METRIC_DEFS[m].color : VX.line,
    getValue: (d) => {
      const raw = WEEKLY_METRICS[m].pick(d)
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

  const headerSummary = (
    <Group gap="sm" wrap="wrap">
      {enabled.map((m) => (
        <Text key={m} span size="xs" fw={600} {...(isMulti && { c: METRIC_DEFS[m].color })}>
          {WEEKLY_METRICS[m].formatTotal(points.reduce((s, p) => s + WEEKLY_METRICS[m].pick(p), 0))}
        </Text>
      ))}
    </Group>
  )

  const footer =
    hasData && !isMulti && singleConfig !== null && singleMetric !== undefined
      ? `${singleConfig.formatAvg(
          points.reduce((s, p) => s + WEEKLY_METRICS[singleMetric].pick(p), 0) /
            Math.max(1, points.length),
        )} average across the window.`
      : isMulti
        ? 'Bars normalized per metric (0–100% of window max). Hover for absolute values.'
        : ''

  return (
    <ChartCard
      title="Weekly volume"
      subtitle="Is the habit holding week to week?"
      info="ISO-week buckets within the window. With 2+ metrics, bars are normalized to each metric's own window-max so the rhythm is comparable; tooltips show absolute values."
      actions={hasData ? headerSummary : null}
      state={chartStateOf(
        query,
        (enabled.length === 0 && 'No metric selected — toggle one in the page header.') ||
          (!hasData && 'No weekly data in this window.') ||
          false,
      )}
      placeholderHeight={280}
    >
      <Bars
        ariaLabel="Weekly volume, ISO-week totals of the enabled walking metrics"
        data={points}
        height={280}
        x={(d) => d.date}
        bars={bars}
        layout={isMulti ? 'grouped' : 'stacked'}
        y={{
          domain: isMulti ? [0, 1] : 'auto',
          ...(!isMulti && singleConfig !== null && { autoMaxFloor: singleConfig.autoMaxFloor }),
          format: isMulti ? fmtPct : (singleDef?.format ?? fmtPct),
          ticks: 5,
          nice: true,
        }}
        // `x` is the Monday week-start — a bucket's leading edge, so a hover in the back half of
        // the week must still resolve to that week's own bar, not the next one.
        cursorResolution="leading"
        tooltip={{
          // When normalized, the bars are suppressed from the derived rows and these carry the raw
          // per-metric values in their own units — a hidden metric drops out here too.
          rows: (d, ctx) =>
            isMulti
              ? enabled
                  .filter((m) => !ctx.hidden.some((s) => s.key === m))
                  .map((m) => {
                    const raw = WEEKLY_METRICS[m].pick(d)
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
