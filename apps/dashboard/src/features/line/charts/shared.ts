import { alpha, VX } from 'basalt-ui/tokens'
import type { LineUptime, LineWindow } from '../../../lib/queries/line'
import { axisLabel, bucketLabel, outageZones } from '../model'

/** One cursor across every chart of the page: hovering a day in one reads the same day in all. */
export const LINE_CURSOR = 'line-time'

/** The time axis every chart shares: the same extent, so outages and sync changes line up. */
export function timeAxis(range: { from: number; to: number } | undefined, window: LineWindow) {
  return {
    ...(range && { xDomain: [range.from * 1000, range.to * 1000] as const }),
    xTicks: 5,
    formatX: (x: Date | number | string) => axisLabel(Number(x), window),
    cursorGroup: LINE_CURSOR,
    tooltip: { formatHeader: (x: Date | number | string) => bucketLabel(Number(x), window) },
  }
}

/** Outages as faint red bands on the shared axis: the one attention colour on the page. */
export function outageBands(uptime: LineUptime | undefined) {
  if (uptime === undefined) return []
  return outageZones(uptime.outages, uptime.from, uptime.to, alpha(VX.status.bad, 0.25))
}
