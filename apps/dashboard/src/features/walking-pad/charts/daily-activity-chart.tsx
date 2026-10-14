import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { Bars, ChartCard, type BarsLine } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { integer } from 'basalt-ui/format'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { walkingStore } from '../../../lib/window-stores'
import { METRIC_DEFS, type MetricKey } from '../metrics'
import { chartStateOf } from '../../../lib/chart-state'
import { utcDay } from './utc-day'
import { useVolumeBars, type VolumeMetric } from './volume-bars'

type Point = {
  date: Date
  distance_m: number
  sessions: number
  duration_s: number
  steps: number
}

const DAILY_METRICS: Record<MetricKey, VolumeMetric<Point>> = {
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

const fmtCount = (v: number) => String(Math.round(v))

const SESSION_LINES: BarsLine<Point>[] = [
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

export function DailyActivityChart({ params }: { params: WalkingPadWindowParams }) {
  const query = useQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))
  const [enabled] = walkingStore.field.metrics.use()

  const points = useMemo<Point[]>(
    () => (query.data?.points ?? []).map((p) => ({ ...p, date: utcDay(p.date) })),
    [query.data],
  )
  const { bars, hasData, isMulti, y, tooltip, total, footer } = useVolumeBars(
    points,
    enabled,
    DAILY_METRICS,
  )
  const totalSessions = points.reduce((s, p) => s + p.sessions, 0)
  const footerText = footer()

  const headerSummary = (
    <Group gap="sm" wrap="wrap">
      {enabled.map((m) => (
        <Text key={m} span size="xs" fw={600} {...(isMulti && { c: METRIC_DEFS[m].color })}>
          {DAILY_METRICS[m].formatTotal(total(m))}
        </Text>
      ))}
      <Text span size="xs" c="dimmed">
        · {totalSessions} sessions
      </Text>
    </Group>
  )

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
          undefined,
      )}
      placeholderHeight={280}
    >
      <Bars
        ariaLabel="Daily activity, per-day totals of the enabled walking metrics"
        data={points}
        height={280}
        x={(d) => d.date}
        bars={bars}
        lines={SESSION_LINES}
        layout={isMulti ? 'grouped' : 'stacked'}
        y={y}
        y2={{ domain: 'auto', format: fmtCount, ticks: 4, autoMaxFloor: 3 }}
        // `x` is the UTC day-start — a bucket's leading edge, so a sibling chart's cursor in the
        // back half of a day must land on that day's bar, not the next one.
        cursorResolution="leading"
        tooltip={tooltip}
      />
      {footerText !== '' && (
        <Text size="xs" c="dimmed" mt={4}>
          {footerText}
        </Text>
      )}
    </ChartCard>
  )
}
