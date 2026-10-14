import { useMemo } from 'react'
import type { BarsBar, ChartTooltipConfig } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { METRIC_DEFS, type MetricKey } from '../metrics'

/** Per-metric reading of one bucket, for the daily and weekly volume charts. */
export type VolumeMetric<P> = {
  pick: (p: P) => number
  formatTotal: (v: number) => string
  formatAvg: (v: number) => string
  /** Minimum scale ceiling so a near-empty window still shows a usable y-axis. */
  autoMaxFloor: number
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`

/**
 * The shared body of the daily and weekly volume charts: one bar series per enabled metric. With
 * 2+ metrics each is normalised to its own window max (different units cannot share an axis), the
 * bars drop out of the derived tooltip rows, and `tooltipRows` carries the absolute values instead.
 */
export function useVolumeBars<P>(
  points: readonly P[],
  enabled: readonly MetricKey[],
  metrics: Record<MetricKey, VolumeMetric<P>>,
) {
  const isMulti = enabled.length > 1

  const maxima = useMemo(
    () =>
      new Map(
        enabled.map((m) => [m, points.reduce((max, p) => Math.max(max, metrics[m].pick(p)), 0)]),
      ),
    [points, enabled, metrics],
  )
  const hasData = enabled.some((m) => (maxima.get(m) ?? 0) > 0)

  const bars = useMemo<BarsBar<P>[]>(
    () =>
      enabled.map((m) => ({
        key: m,
        label: METRIC_DEFS[m].label,
        color: isMulti ? METRIC_DEFS[m].color : VX.line,
        // 0 is no walk in that bucket: an absence, not a zero-height bar.
        getValue: (d) => {
          const raw = metrics[m].pick(d)
          if (raw <= 0) return null
          if (!isMulti) return raw
          const max = maxima.get(m) ?? 0
          return max > 0 ? raw / max : null
        },
        // A normalised bar carries a fraction of the metric's own max — a meaningless percent.
        tooltip: !isMulti,
        formatValue: METRIC_DEFS[m].format,
      })),
    [enabled, isMulti, maxima, metrics],
  )

  const single = enabled[0]
  const y = {
    domain: isMulti ? ([0, 1] as const) : ('auto' as const),
    ...(!isMulti && single !== undefined && { autoMaxFloor: metrics[single].autoMaxFloor }),
    format: isMulti ? fmtPct : single !== undefined ? METRIC_DEFS[single].format : fmtPct,
    ticks: 5,
    nice: true,
  }

  const tooltip: ChartTooltipConfig<P> = {
    // A metric hidden through the legend drops out here too.
    rows: (d, ctx) =>
      isMulti
        ? enabled
            .filter((m) => !ctx.hidden.some((s) => s.key === m))
            .map((m) => {
              const raw = metrics[m].pick(d)
              return {
                label: METRIC_DEFS[m].label,
                value: raw > 0 ? METRIC_DEFS[m].format(raw) : '—',
                color: METRIC_DEFS[m].color,
              }
            })
        : [],
  }

  const total = (m: MetricKey): number => points.reduce((s, p) => s + metrics[m].pick(p), 0)

  /** The footer line under the chart. */
  const footer = (): string => {
    if (isMulti)
      return 'Bars normalized per metric (0–100% of window max). Hover for absolute values.'
    if (!hasData || single === undefined) return ''
    return `${metrics[single].formatAvg(total(single) / Math.max(1, points.length))} average across the window.`
  }

  return { bars, hasData, isMulti, y, tooltip, total, footer }
}
