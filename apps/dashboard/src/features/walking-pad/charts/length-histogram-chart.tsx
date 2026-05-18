import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Bars, ChartCard, ChartLegend, TooltipRow } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { METRIC_DEFS, fmtSteps, useMetricSelection, type MetricKey } from '../metric-toggle'
import { ChartEmpty } from './empty'

type Bucket = {
  bucketMin: number
  sessions: number
  distance_m: number
  duration_s: number
  steps: number
}

type HistogramMetric = {
  pick: (b: Bucket) => number
  formatTotal: (v: number) => string
  autoMaxFloor: number
}

const HIST_METRICS: Record<MetricKey, HistogramMetric> = {
  distance: {
    pick: (b) => b.distance_m,
    formatTotal: (m) => `${(m / 1000).toFixed(1)} km total`,
    autoMaxFloor: 1000,
  },
  duration: {
    pick: (b) => b.duration_s,
    formatTotal: (s) => `${(s / 3600).toFixed(1)} h total`,
    autoMaxFloor: 1800,
  },
  steps: {
    pick: (b) => b.steps,
    formatTotal: (v) => `${fmtSteps(v)} steps total`,
    autoMaxFloor: 3000,
  },
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`

export function LengthHistogramChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.lengthHistogram(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { enabled } = useMetricSelection()

  const buckets: Bucket[] = data.buckets
  const totalSessions = buckets.reduce((s, b) => s + b.sessions, 0)
  // Mode (busiest bucket) — useful "you tend to walk X minutes" abstraction.
  // Always derived from session count regardless of metric selection.
  const mode = buckets.reduce<Bucket | null>(
    (best, b) => (best === null || b.sessions > best.sessions ? b : best),
    null,
  )

  const metricMax = useMemo(() => {
    const out = {} as Record<MetricKey, number>
    for (const m of enabled) {
      let max = 0
      for (const b of buckets) {
        const v = HIST_METRICS[m].pick(b)
        if (v > max) max = v
      }
      out[m] = max
    }
    return out
  }, [buckets, enabled])

  const hasData = enabled.some((m) => (metricMax[m] ?? 0) > 0)
  const isMulti = enabled.length > 1

  if (enabled.length === 0) {
    return (
      <ChartCard
        title="Session length"
        subtitle="How long are my walks?"
        tooltip="Distribution across 5-minute duration buckets, clamped at 90 minutes. Pick one or more metrics from the page header to populate."
      >
        <ChartEmpty height={240} label="No metric selected — toggle one in the page header." />
      </ChartCard>
    )
  }

  const getValue = (d: Bucket, key: string): number | null => {
    const m = key as MetricKey
    if (!enabled.includes(m)) return null
    const raw = HIST_METRICS[m].pick(d)
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
  const singleConfig = singleMetric !== undefined ? HIST_METRICS[singleMetric] : null

  const headerSummary = (
    <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
      {mode !== null && mode.sessions > 0 ? (
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          most common: {mode.bucketMin}–{mode.bucketMin + 5} min
        </span>
      ) : null}
      {enabled.map((m) => (
        <span key={m} style={{ fontSize: 12, fontWeight: 600, color: METRIC_DEFS[m].color }}>
          {HIST_METRICS[m].formatTotal(buckets.reduce((s, b) => s + HIST_METRICS[m].pick(b), 0))}
        </span>
      ))}
    </span>
  )

  const renderExtraTooltipRows = isMulti
    ? (d: Bucket) => (
        <>
          {enabled.map((m) => {
            const raw = HIST_METRICS[m].pick(d)
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
      title="Session length"
      subtitle="How long are my walks?"
      tooltip="Distribution of session metrics across 5-minute duration buckets (clamped at 90 min). With 2+ metrics, bars are normalized to each metric's own window-max so the rhythm is comparable; tooltips show absolute values."
      extra={hasData ? headerSummary : null}
    >
      <div ref={ref} style={{ height: 240, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={240} label="No sessions in this window." />
        ) : width > 0 ? (
          <Bars<Bucket>
            data={buckets}
            width={Math.max(width, 200)}
            height={240}
            chartId="walking-pad-length-histogram"
            getX={(d) => `${d.bucketMin}m`}
            getValue={getValue}
            positiveBars={positiveBars}
            barLayout={isMulti ? 'grouped' : 'stacked'}
            leftAxis={{
              domain: isMulti ? [0, 1] : 'auto',
              formatTick: isMulti ? fmtPct : (singleDef?.format ?? fmtPct),
              numTicks: 4,
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
          label: METRIC_DEFS[m].label,
          color: METRIC_DEFS[m].color,
          shape: 'bar' as const,
        }))}
      />
      <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)', marginTop: 4 }}>
        {totalSessions} sessions · 5-min buckets, clamped at 90 min
        {isMulti ? ' · normalized per metric (hover for absolute values)' : ''}
      </span>
    </ChartCard>
  )
}
