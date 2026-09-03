import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Group } from '@mantine/core'
import {
  Bars,
  ChartCard,
  TooltipRow,
  type BarsBar,
  type CartesianTooltipRowContext,
} from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { walkingStore } from '../../../lib/window-stores'
import { METRIC_DEFS, fmtSteps, type MetricKey } from '../metrics'

type Point = {
  date: string // Monday week-start YYYY-MM-DD — treated as a categorical x.
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
  const [enabled] = walkingStore.field.metrics.use()

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

  const singleMetric = enabled[0]
  const singleDef = singleMetric !== undefined ? METRIC_DEFS[singleMetric] : null
  const singleConfig = singleMetric !== undefined ? WEEKLY_METRICS[singleMetric] : null

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
          {WEEKLY_METRICS[m].formatTotal(points.reduce((s, p) => s + WEEKLY_METRICS[m].pick(p), 0))}
        </span>
      ))}
    </Group>
  )

  // When normalized, the bars are suppressed from the derived rows and these
  // carry the raw per-metric values in their own units — filtered to the
  // legend's currently visible series so a hidden metric drops out here too.
  const extraRows = (d: Point, ctx: CartesianTooltipRowContext<Point>) => (
    <>
      {enabled.map((m) => {
        if (ctx.hidden.has(m)) return null
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

  return (
    <ChartCard
      title="Weekly volume"
      subtitle="Is the habit holding week to week?"
      info="ISO-week buckets within the window. With 2+ metrics, bars are normalized to each metric's own window-max so the rhythm is comparable; tooltips show absolute values."
      actions={hasData ? headerSummary : null}
      state={{
        empty:
          (enabled.length === 0 && 'No metric selected — toggle one in the page header.') ||
          (!hasData && 'No weekly data in this window.'),
      }}
      placeholderHeight={280}
    >
      <Bars
        ariaLabel="Weekly volume, ISO-week totals of the enabled walking metrics"
        data={points}
        height={280}
        chartId="walking-pad-weekly-volume"
        getX={(d) => d.date}
        getValue={getValue}
        positiveBars={positiveBars}
        barLayout={isMulti ? 'grouped' : 'stacked'}
        y={{
          domain: isMulti ? [0, 1] : 'auto',
          autoMaxFloor: isMulti ? undefined : singleConfig?.autoMaxFloor,
          format: isMulti ? fmtPct : (singleDef?.format ?? fmtPct),
          ticks: 5,
          nice: true,
        }}
        tooltip={isMulti ? { extraRows } : {}}
        // `getX` returns the Monday week-start — a bucket's leading edge, not an instant — so a
        // hover in the back half of the week must still resolve to that week's own bar, not the
        // next one.
        cursorResolution="leading"
      />
      <Box
        component="span"
        mt={4}
        style={{ fontSize: VX.text.micro, color: 'var(--mantine-color-dimmed)' }}
      >
        {hasData && !isMulti && singleConfig !== null
          ? `${singleConfig.formatAvg(
              points.reduce((s, p) => s + WEEKLY_METRICS[singleMetric as MetricKey].pick(p), 0) /
                Math.max(1, points.length),
            )} average across the window.`
          : isMulti
            ? `Bars normalized per metric (0–100% of window max). Hover for absolute values.`
            : ''}
      </Box>
    </ChartCard>
  )
}
