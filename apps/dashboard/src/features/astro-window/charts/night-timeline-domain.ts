import type { HourlyPoint } from '../types'

const FLOOR_DEG = -20
const MIN_TOP_DEG = 20
const STEP_DEG = 10

/**
 * The night timeline's altitude domain: the bottom is fixed so the horizon and the gate band keep
 * their place, the top is 20° on a low night and the highest plotted altitude rounded up to the next
 * 10° otherwise, so a high moon or core is drawn whole rather than running off the plot.
 */
export function timelineDomain(hourly: readonly HourlyPoint[]): [number, number] {
  let peak = MIN_TOP_DEG
  for (const p of hourly) {
    for (const v of [p.coreAltitude, p.moonAltitude, p.sunAltitude]) {
      if (typeof v === 'number' && Number.isFinite(v) && v > peak) peak = v
    }
  }
  return [FLOOR_DEG, Math.ceil(peak / STEP_DEG) * STEP_DEG]
}
