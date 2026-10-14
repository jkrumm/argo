import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { integer } from 'basalt-ui/format'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { walkingStore } from '../../../lib/window-stores'
import { METRIC_DEFS, type MetricKey } from '../metrics'
import { chartStateOf } from '../../../lib/chart-state'
import { utcDay } from './utc-day'
import { useVolumeBars, type VolumeMetric } from './volume-bars'

type Point = {
  /** Monday week-start — a bucket's leading edge, not an instant. */
  date: Date
  distance_m: number
  duration_s: number
  steps: number
  sessions: number
}

const WEEKLY_METRICS: Record<MetricKey, VolumeMetric<Point>> = {
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

export function WeeklyVolumeChart({ params }: { params: WalkingPadWindowParams }) {
  const query = useQuery(walkingPadQueries.series({ ...params, bucket: 'week' }))
  const [enabled] = walkingStore.field.metrics.use()

  const points = useMemo<Point[]>(
    () => (query.data?.points ?? []).map((p) => ({ ...p, date: utcDay(p.date) })),
    [query.data],
  )
  const { bars, hasData, isMulti, y, tooltip, total, footer } = useVolumeBars(
    points,
    enabled,
    WEEKLY_METRICS,
  )
  const footerText = footer()

  const headerSummary = (
    <Group gap="sm" wrap="wrap">
      {enabled.map((m) => (
        <Text key={m} span size="xs" fw={600} {...(isMulti && { c: METRIC_DEFS[m].color })}>
          {WEEKLY_METRICS[m].formatTotal(total(m))}
        </Text>
      ))}
    </Group>
  )

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
          undefined,
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
        y={y}
        // `x` is the Monday week-start — a bucket's leading edge. A sibling chart's cursor (the
        // daily chart shares the page cursor group) sits on a day inside the week, and must snap
        // back to that week's own bar rather than the nearest Monday, which may be the next one.
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
