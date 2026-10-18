import type { ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { SERIES } from '../../../lib/series'
import { fmtAzimuth, fmtDegrees } from '../formulas'
import type { HourlyPoint } from '../types'

export const FLOOR_DEG = -20
export const MIN_TOP_DEG = 20
const STEP_DEG = 10
/** Float noise at a 10° boundary (30.000000000000004) must neither raise the top nor clip the sample. */
const FLOAT_TOLERANCE_DEG = 1e-9

/**
 * The night timeline's altitude domain: the bottom is fixed so the horizon and the gate band keep
 * their place, the top is 20° on a low night and the highest plotted altitude rounded up to the next
 * 10° otherwise, so a high moon or core is drawn whole rather than running off the plot.
 */
export function timelineDomain(hourly: readonly HourlyPoint[]): [number, number] {
  let peak = MIN_TOP_DEG
  for (const p of hourly) {
    for (const v of [p.coreAltitude, p.moonAltitude]) {
      if (typeof v === 'number' && Number.isFinite(v) && v > peak) peak = v
    }
  }
  return [FLOOR_DEG, Math.ceil(peak / STEP_DEG - FLOAT_TOLERANCE_DEG) * STEP_DEG]
}

/** A track outside the plot's altitude domain is a gap: it is not drawn, so it has no hover row either. */
export const inPlot = (v: number, domain: readonly [number, number]): number | null =>
  v < domain[0] - FLOAT_TOLERANCE_DEG || v > domain[1] + FLOAT_TOLERANCE_DEG ? null : v

/** The sun is a reference track: it stays clipped at the original 20° even when a high moon lifts the axis. */
export const SUN_CLIP: readonly [number, number] = [FLOOR_DEG, MIN_TOP_DEG]

export const plotSeries = (domain: readonly [number, number]): ChartSeries<HourlyPoint>[] => [
  {
    key: 'core',
    label: 'Galactic core',
    color: SERIES.coreAltitude,
    strokeWidth: 2,
    getValue: (d) => inPlot(d.coreAltitude, domain),
    // The row pairs the plotted altitude with its bearing, read straight off the hovered datum.
    formatValue: (v, d) => `${fmtDegrees(v)} · ${fmtAzimuth(d.coreAzimuth)}`,
  },
  {
    key: 'moon',
    label: 'Moon altitude',
    color: SERIES.moonAltitude,
    dash: 'dashed',
    strokeWidth: 1.5,
    getValue: (d) => inPlot(d.moonAltitude, domain),
    formatValue: fmtDegrees,
  },
  {
    key: 'sun',
    label: 'Sun altitude',
    color: VX.muted,
    dash: 'dashed',
    strokeWidth: 1,
    role: 'reference',
    getValue: (d) => inPlot(d.sunAltitude, SUN_CLIP),
    formatValue: fmtDegrees,
  },
]
